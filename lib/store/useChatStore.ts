import { create } from "zustand";
import {
  BUILTIN_PROMPT_ID,
  ChatError,
  type ChatRequest,
  type MessageStatus,
  type ModelId,
  type ResponseObject,
  type Session,
  type StoredMessage,
  type UsageInfo,
} from "@/lib/types";
import { buildChatRequest } from "@/lib/api/build-request";
import { buildInput } from "@/lib/api/build-input";
import { streamChat } from "@/lib/api/client";
import { MODEL_SUPPORT } from "@/lib/deepseek/models";
import { BUILTIN_DEFAULT_PROMPT } from "@/lib/prompts/builtin";
import { getApiKey, useSettingsStore } from "@/lib/store/useSettingsStore";
import { usePromptStore } from "@/lib/store/usePromptStore";
import {
  deleteSession as dbDeleteSession,
  getAllSessions,
  putSession as dbPutSession,
} from "@/lib/storage/db";
import { migrateLegacyCustomInstruction } from "@/lib/storage/settings";
import { openSettings } from "@/lib/store/ui";
import {
  CONTEXT_BUDGET_TOKENS,
  truncateHistory,
} from "@/lib/utils/truncate-history";
import { estimateTokens } from "@/lib/utils/token-estimate";
import { raf } from "@/lib/utils/rAF";
import { uuid } from "@/lib/utils";

/** 模型不支持时的固定文案（UI 错误条据此判断琥珀色样式） */
export const MODEL_NOT_SUPPORTED_MSG =
  "DeepSeek-V4 Pro 暂不支持 Responses API，请先在顶部切换为 Flash 模型";

// ============================================================
// 对话分支（FR-12）：消息树 + 当前路径
// ============================================================

/**
 * 会话当前路径（从根到 activeLeafId 的线性消息序列）。
 * 消息在 messages 数组中按创建序平铺（树结构由 parentId 表达），
 * 渲染/请求上下文只取路径。
 */
export function getPathMessages(session: Session): StoredMessage[] {
  const byId = new Map<string, StoredMessage>();
  for (const m of session.messages) byId.set(m.id, m);
  const path: StoredMessage[] = [];
  let cur = session.activeLeafId ? byId.get(session.activeLeafId) : undefined;
  let guard = session.messages.length + 1; // 防环
  while (cur && guard-- > 0) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/**
 * 旧版会话（无分支字段）线性迁移：按数组顺序补 parentId 链与 activeLeafId。
 * 幂等：已有 activeLeafId 的会话原样返回。
 */
export function migrateSessionGraph(session: Session): Session {
  if (session.activeLeafId) return session;
  const messages = session.messages.map((m, i) =>
    i === 0
      ? { ...m, parentId: undefined }
      : { ...m, parentId: session.messages[i - 1].id }
  );
  return {
    ...session,
    messages,
    activeLeafId: messages[messages.length - 1]?.id,
  };
}

/** 从某消息出发沿「最新子节点」走到分支末端叶子（switchBranch 用） */
function findDeepestLeaf(session: Session, startId: string): string {
  const childrenOf = new Map<string, string[]>();
  for (const m of session.messages) {
    if (!m.parentId) continue;
    const arr = childrenOf.get(m.parentId) ?? [];
    arr.push(m.id);
    childrenOf.set(m.parentId, arr);
  }
  const byId = new Map(session.messages.map((m) => [m.id, m]));
  let cur = startId;
  let guard = session.messages.length + 1;
  while (guard-- > 0) {
    const kids = childrenOf.get(cur);
    if (!kids || kids.length === 0) return cur;
    const latest = kids
      .map((id) => byId.get(id))
      .filter((m): m is StoredMessage => Boolean(m))
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))[0];
    cur = latest.id;
  }
  return cur;
}

// ============================================================
// 流式 delta 帧级节流（卡顿修复）：
// 同帧内多个 delta 累积后一次性 setState，避免每 token 触发
// 全量不可变复制 + React 重渲染（主线程占满导致 DevTools 卡死）
// ============================================================

const pendingContent = new Map<string, string>(); // key: `${sessionId}:${messageId}`
const pendingReasoning = new Map<string, string>();
let rafScheduled = false;

/** 流式请求句柄（chat-state.md 第 4 节：模块级引用，避免闭包过期） */
interface ActiveStreamRef {
  sessionId: string;
  messageId: string;
  abort: () => void;
}
let activeStreamRef: ActiveStreamRef | null = null;

/** 从任意错误形态提取可读消息（ChatError / Error / {error:{message}}） */
function extractErrorMessage(err: unknown): string {
  if (err instanceof ChatError || err instanceof Error) return err.message;
  if (
    err &&
    typeof err === "object" &&
    "error" in err &&
    err.error &&
    typeof err.error === "object" &&
    "message" in err.error
  ) {
    const msg = (err.error as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return "网络错误，请重试";
}

/** 会话持久化（session-storage.md 第 5 节）：IndexedDB 写入，失败不阻断对话但需可见 */
function persistSession(session: Session): void {
  void dbPutSession(session).catch((err) => {
    // 写入失败（配额/缺失 store 等）：内存态仍可用，下次写入重试；
    // 必须可见——否则刷新后数据静默丢失（历史教训：sessions store 缺失曾导致此问题）
    console.warn("[persistSession] IndexedDB 写入失败，会话不会被持久化", err);
  });
}

interface ChatState {
  sessions: Session[];
  activeSessionId: string | null;
  streaming: boolean;
  streamError: string | null;

  newSession(): void;
  deleteSession(id: string): void;
  renameSession(id: string, title: string): void;
  setActiveSession(id: string): void;
  setModel(model: ModelId): void;
  selectSystemPrompt(id: string): void;
  sendMessage(text: string): Promise<void>;
  editMessage(messageId: string, text: string): Promise<void>;
  retryMessage(messageId: string): void;
  switchBranch(leafId: string): void;
  stopStreaming(): void;
  clearStreamError(): void;
  loadAll(): Promise<void>;
}

export const useChatStore = create<ChatState>()((set, get) => {
  /** 原子更新某条消息字段 */
  const patchMessage = (
    sessionId: string,
    messageId: string,
    patch: Partial<StoredMessage>
  ) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId
          ? {
              ...x,
              messages: x.messages.map((m) =>
                m.id === messageId ? { ...m, ...patch } : m
              ),
            }
          : x
      ),
    }));
  };

  /**
   * 批量应用累积的 delta（同步执行；rAF 调度与流结束 finally 共用）。
   * 未变化的会话/消息返回原引用，让 React.memo 生效。
   */
  const flushDeltaBatch = () => {
    rafScheduled = false;
    if (pendingContent.size === 0 && pendingReasoning.size === 0) return;
    const contents = new Map(pendingContent);
    const reasonings = new Map(pendingReasoning);
    pendingContent.clear();
    pendingReasoning.clear();
    set((s) => ({
      sessions: s.sessions.map((x) => {
        let changed = false;
        const messages = x.messages.map((m) => {
          const key = `${x.id}:${m.id}`;
          const c = contents.get(key);
          const r = reasonings.get(key);
          if (!c && !r) return m;
          changed = true;
          return {
            ...m,
            content: c ? m.content + c : m.content,
            reasoning: r ? (m.reasoning ?? "") + r : m.reasoning,
          };
        });
        return changed ? { ...x, messages } : x;
      }),
    }));
  };

  const scheduleFlush = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    raf(() => flushDeltaBatch());
  };

  type SendKind = "send" | "edit" | "regenerate";
  interface SendOpts {
    kind: SendKind;
    text?: string; // send/edit 的输入内容
    targetMessageId?: string; // edit: user 消息 id；regenerate: assistant 消息 id
  }

  /**
   * 发送核心（chat-state.md 第 3 节 + FR-12 分支）：
   * - send        ：追加新 user + 占位 assistant（路径末端）
   * - edit        ：编辑路径上任一 user 消息 → 创建新 user 分支（旧分支保留）→ 自动重新生成
   * - regenerate  ：重新生成 assistant → 创建新 assistant 分支（旧分支保留）
   */
  const sendCore = async (sessionId: string, opts: SendOpts): Promise<void> => {
    const st = get();
    if (st.streaming) return; // 约束：streaming 期间禁止再次发送
    const session = st.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    // 1. 校验：apiKey / 模型支持
    const apiKey = getApiKey();
    if (!apiKey) {
      set({ streamError: "请先在设置中配置 API Key" });
      openSettings();
      return;
    }
    if (!MODEL_SUPPORT[session.model]) {
      set({ streamError: MODEL_NOT_SUPPORTED_MSG });
      return;
    }

    const settings = useSettingsStore.getState();
    const now = Date.now();

    // 0. System Prompt（FR-11）：会话当前选定值即快照；
    //    首条 user 消息随下方原子 setState 写入会话后即锁定，之后不再变化
    const sp = {
      systemPromptId: session.systemPromptId,
      systemPromptText: session.systemPromptText,
    };

    const path = getPathMessages(session);

    // 2/3. 按分支语义构造消息与请求上下文
    let inputMessages: StoredMessage[]; // 请求上下文（路径线性序列）
    let newUserMessage: StoredMessage | null = null;
    let assistantMessage: StoredMessage;
    let nextTitle: string | undefined;

    if (opts.kind === "send") {
      const content = (opts.text ?? "").trim();
      if (!content) return;
      // 上下文过滤：排除空内容的 assistant 消息（失败/停止残留），避免送入上游（review 修复）；
      // 树结构（parentId）不受影响——只影响本次请求的 input
      const validPath = path.filter(
        (m) => !(m.role === "assistant" && !m.content)
      );
      newUserMessage = {
        id: uuid(),
        role: "user",
        content,
        status: "pending",
        model: session.model,
        createdAt: now,
        parentId: path[path.length - 1]?.id,
      };
      assistantMessage = {
        id: uuid(),
        role: "assistant",
        content: "",
        status: "streaming",
        model: session.model,
        createdAt: now,
        parentId: newUserMessage.id,
      };
      inputMessages = [...validPath, newUserMessage];
      // 首条消息：自动生成标题（ui-design.md 4.5，取前 30 字符）
      if (
        session.title === "新对话" &&
        !session.messages.some((m) => m.role === "user")
      ) {
        nextTitle =
          content.length > 30 ? `${content.slice(0, 30)}…` : content;
      }
    } else if (opts.kind === "edit") {
      // 编辑路径上任一 user 消息：创建新 user 分支（parentId 指向原父），旧分支保留
      const target = session.messages.find(
        (m) => m.id === opts.targetMessageId
      );
      if (!target || target.role !== "user") return;
      const idx = path.findIndex((m) => m.id === target.id);
      if (idx < 0) return; // 目标不在当前路径
      const content = (opts.text ?? "").trim();
      if (!content) return;
      newUserMessage = {
        id: uuid(),
        role: "user",
        content,
        status: "pending",
        model: session.model,
        createdAt: now,
        parentId: target.parentId,
      };
      assistantMessage = {
        id: uuid(),
        role: "assistant",
        content: "",
        status: "streaming",
        model: session.model,
        createdAt: now,
        parentId: newUserMessage.id,
      };
      inputMessages = [...path.slice(0, idx), newUserMessage];
    } else {
      // regenerate：重新生成 → 创建新 assistant 分支（旧 assistant 及其后代保留）
      const target = session.messages.find(
        (m) => m.id === opts.targetMessageId
      );
      if (!target || target.role !== "assistant") return;
      const parent = target.parentId
        ? session.messages.find((m) => m.id === target.parentId)
        : undefined;
      if (!parent || parent.role !== "user") return;
      const idx = path.findIndex((m) => m.id === parent.id);
      if (idx < 0) return; // 父 user 不在当前路径
      assistantMessage = {
        id: uuid(),
        role: "assistant",
        content: "",
        status: "streaming",
        model: session.model,
        createdAt: now,
        parentId: parent.id,
      };
      inputMessages = path.slice(0, idx + 1); // 上下文 = 路径到父 user 为止（不含旧回复）
    }

    const nextMessages = newUserMessage
      ? [...session.messages, newUserMessage, assistantMessage]
      : [...session.messages, assistantMessage];

    const nextSession: Session = {
      ...session,
      title: nextTitle ?? session.title,
      systemPromptId: sp.systemPromptId,
      systemPromptText: sp.systemPromptText,
      messages: nextMessages,
      activeLeafId: assistantMessage.id,
      updatedAt: now,
    };
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === sessionId ? nextSession : x)),
      streaming: true,
      streamError: null,
    }));
    persistSession(nextSession);

    // 4. 构造请求：预算截断（context-cache.md 第 5 节）→ buildInput
    let inputHistory = inputMessages;
    const estimatedTokens = inputMessages.reduce(
      (n, m) =>
        n + estimateTokens(m.content) + (m.reasoning ? estimateTokens(m.reasoning) : 0),
      0
    );
    if (estimatedTokens > CONTEXT_BUDGET_TOKENS) {
      const kept = truncateHistory(inputMessages, CONTEXT_BUDGET_TOKENS);
      if (kept.droppedRounds > 0) {
        inputHistory = kept.messages;
        set({
          streamError: `上下文过长，已自动省略最早的 ${kept.droppedRounds} 轮对话`,
        });
      }
    }
    const request = buildChatRequest({
      apiKey,
      model: session.model,
      instructions: sp.systemPromptText,
      input: buildInput(inputHistory),
      thinkingEnabled: settings.thinkingEnabled,
      thinkingEffort: settings.thinkingEffort,
      webSearchEnabled: settings.webSearchEnabled,
      temperature: settings.temperature,
    });

    const abortController = new AbortController();
    activeStreamRef = {
      sessionId,
      messageId: assistantMessage.id,
      abort: () => abortController.abort(),
    };

    const startedAt = Date.now();
    let searchCallId = "";
    let hadToolCall = false;

    /** 终态收尾（response.completed / incomplete / failed） */
    const finish = (
      response: ResponseObject,
      status: MessageStatus,
      errorMessage?: string
    ) => {
      const usage: UsageInfo | undefined = response.usage
        ? {
            inputTokens: response.usage.input_tokens ?? 0,
            cachedTokens:
              response.usage.input_tokens_details?.cached_tokens ?? 0,
            outputTokens: response.usage.output_tokens ?? 0,
            reasoningTokens:
              response.usage.output_tokens_details?.reasoning_tokens ?? 0,
          }
        : undefined;
      patchMessage(sessionId, assistantMessage.id, {
        status,
        usage,
        hadToolCall,
      });
      if (errorMessage) set({ streamError: errorMessage });
    };

    // 6. 消费事件流（streaming.md 第 5 节分发；抽成 consume 以便 context_too_long 重试复用）
    let retriedTooLong = false;
    const consume = async (req: ChatRequest, signal: AbortSignal) => {
      for await (const event of streamChat(req, signal)) {
        switch (event.type) {
          case "response.created":
            // 标记生成中、记录开始时间（startedAt 已记录）
            break;

          case "response.output_item.added": {
            const item = event.item;
            if (item.type === "reasoning") {
              patchMessage(sessionId, assistantMessage.id, { reasoning: "" });
            } else if (item.type === "web_search_call") {
              hadToolCall = true;
              searchCallId = String(item.id ?? "");
              patchMessage(sessionId, assistantMessage.id, {
                webSearch: { callId: searchCallId, status: "searching" },
              });
            }
            break;
          }

          case "response.reasoning_text.delta": {
            // 帧级节流累积（卡顿修复）
            const key = `${sessionId}:${assistantMessage.id}`;
            pendingReasoning.set(
              key,
              (pendingReasoning.get(key) ?? "") + event.delta
            );
            scheduleFlush();
            break;
          }

          case "response.output_text.delta": {
            // 帧级节流累积（卡顿修复）
            const key = `${sessionId}:${assistantMessage.id}`;
            pendingContent.set(
              key,
              (pendingContent.get(key) ?? "") + event.delta
            );
            scheduleFlush();
            break;
          }

          case "response.web_search_call.in_progress":
          case "response.web_search_call.searching": {
            hadToolCall = true;
            patchMessage(sessionId, assistantMessage.id, {
              webSearch: { callId: event.item_id, status: "searching" },
            });
            break;
          }

          case "response.web_search_call.completed": {
            searchCallId = event.item_id;
            hadToolCall = true;
            patchMessage(sessionId, assistantMessage.id, {
              webSearch: { callId: event.item_id, status: "completed" },
            });
            break;
          }

          case "response.reasoning_text.done": {
            patchMessage(sessionId, assistantMessage.id, {
              reasoningElapsedMs: Date.now() - startedAt,
            });
            break;
          }

          case "response.completed": {
            finish(event.response, "completed");
            break;
          }

          case "response.incomplete": {
            finish(event.response, "truncated", "已达到输出长度上限，内容被截断");
            break;
          }

          case "response.failed": {
            finish(
              event.response,
              "failed",
              event.response.error?.message ?? "生成失败，请重试"
            );
            break;
          }
        }
      }
    };

    try {
      await consume(request, abortController.signal);
      // 兜底：流正常结束但未收到 completed/incomplete/failed 终态事件
      // （服务端异常断开/代理吞包）→ 置 failed，避免消息永久卡在 streaming（review 修复）
      const cur = get()
        .sessions.find((x) => x.id === sessionId)
        ?.messages.find((m) => m.id === assistantMessage.id);
      if (cur?.status === "streaming") {
        patchMessage(sessionId, assistantMessage.id, { status: "failed" });
        set({ streamError: "生成中断，请重试" });
      }
    } catch (err) {
      // 8. 失败/停止：保留已生成内容；context_too_long 自动截断重试一次（error-handling.md 第 3 节）
      if (
        err instanceof ChatError &&
        err.code === "context_too_long" &&
        !retriedTooLong
      ) {
        retriedTooLong = true;
        // 丢最旧一半轮次（error-handling.md 第 3 节）：预算取当前估算的一半，
        // 避免按固定 700K 预算在估算值偏小时无法触发
        const totalEstimated = inputMessages.reduce(
          (n, m) =>
            n + estimateTokens(m.content) + (m.reasoning ? estimateTokens(m.reasoning) : 0),
          0
        );
        const kept = truncateHistory(
          inputMessages,
          Math.max(1, Math.floor(totalEstimated / 2))
        );
        if (kept.messages.length < inputMessages.length) {
          set({ streamError: "上下文过长，已自动精简历史后重试" });
          hadToolCall = false;
          searchCallId = "";
          patchMessage(sessionId, assistantMessage.id, {
            content: "",
            reasoning: undefined,
            webSearch: undefined,
            usage: undefined,
            hadToolCall: false,
          });
          const retryRequest = buildChatRequest({
            apiKey,
            model: session.model,
            instructions: sp.systemPromptText,
            input: buildInput(kept.messages),
            thinkingEnabled: settings.thinkingEnabled,
            thinkingEffort: settings.thinkingEffort,
            webSearchEnabled: settings.webSearchEnabled,
            temperature: settings.temperature,
          });
          try {
            await consume(retryRequest, abortController.signal);
            // 兜底：重试流正常结束但无终态事件（与主路径一致，review 修复）
            const cur2 = get()
              .sessions.find((x) => x.id === sessionId)
              ?.messages.find((m) => m.id === assistantMessage.id);
            if (cur2?.status === "streaming") {
              patchMessage(sessionId, assistantMessage.id, {
                status: "failed",
              });
              set({ streamError: "生成中断，请重试" });
            }
          } catch (retryErr) {
            // 重试也失败：按普通失败处理（不再重试），不产生 unhandled rejection
            if (abortController.signal.aborted) {
              patchMessage(sessionId, assistantMessage.id, {
                status: "stopped",
              });
            } else {
              patchMessage(sessionId, assistantMessage.id, {
                status: "failed",
              });
              set({ streamError: extractErrorMessage(retryErr) });
            }
          }
          return;
        }
      }
      if (abortController.signal.aborted) {
        patchMessage(sessionId, assistantMessage.id, { status: "stopped" });
      } else {
        patchMessage(sessionId, assistantMessage.id, { status: "failed" });
        set({ streamError: extractErrorMessage(err) });
      }
    } finally {
      // 9. 结束：应用未 flush 的累积 delta（停止/异常时内容完整）→ 重置 streaming → 持久化
      flushDeltaBatch();
      if (activeStreamRef?.messageId === assistantMessage.id) {
        activeStreamRef = null;
      }
      set((s) => ({
        streaming: false,
        sessions: s.sessions.map((x) =>
          x.id === sessionId ? { ...x, updatedAt: Date.now() } : x
        ),
      }));
      const finalSession = get().sessions.find((x) => x.id === sessionId);
      if (finalSession) persistSession(finalSession);
    }
  };

  return {
    sessions: [],
    activeSessionId: null,
    streaming: false,
    streamError: null,

    newSession: () => {
      const settings = useSettingsStore.getState();
      // 预选 defaultSystemPromptId 条目（FR-11；条目被删/未加载时回退内置）
      const prompt =
        usePromptStore.getState().getPrompt(settings.defaultSystemPromptId) ??
        BUILTIN_DEFAULT_PROMPT;
      const now = Date.now();
      const session: Session = {
        id: uuid(),
        title: "新对话",
        model: settings.defaultModel,
        systemPromptId: prompt.id,
        systemPromptText: prompt.content,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({
        sessions: [session, ...s.sessions],
        activeSessionId: session.id,
        streamError: null,
      }));
      persistSession(session);
    },

    deleteSession: (id) => {
      // 流式中的会话：先 abort 再删除；streaming 复位判断必须在置 null 前（review 修复）
      const wasStreaming = activeStreamRef?.sessionId === id;
      if (wasStreaming) {
        activeStreamRef?.abort();
        activeStreamRef = null;
      }
      set((s) => {
        const sessions = s.sessions.filter((x) => x.id !== id);
        return {
          sessions,
          activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
          streaming: s.streaming && wasStreaming ? false : s.streaming,
        };
      });
      void dbDeleteSession(id).catch(() => {
        // 删除失败不阻断
      });
    },

    renameSession: (id, title) => {
      const t = title.trim();
      if (!t) return;
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === id ? { ...x, title: t, updatedAt: Date.now() } : x
        ),
      }));
      const sess = get().sessions.find((x) => x.id === id);
      if (sess) persistSession(sess);
    },

    setActiveSession: (id) => {
      // 流式期间锁定当前会话（chat-state.md 第 7 节）
      if (get().streaming) return;
      set({ activeSessionId: id, streamError: null });
    },

    setModel: (model) => {
      // 流式期间禁止切换（review 修复：避免生成中改写会话属性）
      if (get().streaming) return;
      const { activeSessionId } = get();
      if (!activeSessionId) return;
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === activeSessionId ? { ...x, model } : x
        ),
      }));
      const sess = get().sessions.find((x) => x.id === activeSessionId);
      if (sess) persistSession(sess);
    },

    selectSystemPrompt: (id) => {
      // 仅空会话（无 user 消息）生效（FR-11 锁定规则）；从库取内容快照
      const prompt = usePromptStore.getState().getPrompt(id);
      if (!prompt) return;
      const { activeSessionId } = get();
      if (!activeSessionId) return;
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === activeSessionId &&
          !x.messages.some((m) => m.role === "user")
            ? {
                ...x,
                systemPromptId: id,
                systemPromptText: prompt.content,
              }
            : x
        ),
      }));
    },

    sendMessage: (text) => {
      const { activeSessionId, streaming } = get();
      if (!activeSessionId || streaming) return Promise.resolve();
      return sendCore(activeSessionId, { kind: "send", text });
    },

    editMessage: (messageId, text) => {
      // 编辑路径上任一 user 消息 → 创建分支并自动重新生成（FR-12）
      const { activeSessionId, streaming } = get();
      if (!activeSessionId || streaming) return Promise.resolve();
      return sendCore(activeSessionId, {
        kind: "edit",
        targetMessageId: messageId,
        text,
      });
    },

    retryMessage: (messageId) => {
      // 重新生成：创建新 assistant 分支，旧分支保留（FR-12）
      const { activeSessionId, streaming } = get();
      if (!activeSessionId || streaming) return;
      void sendCore(activeSessionId, {
        kind: "regenerate",
        targetMessageId: messageId,
      });
    },

    switchBranch: (leafId) => {
      // 切换分支：将 activeLeafId 指向该分支的末端叶子（FR-12）
      const { activeSessionId, streaming } = get();
      if (!activeSessionId || streaming) return;
      const session = get().sessions.find((s) => s.id === activeSessionId);
      if (!session) return;
      if (!session.messages.some((m) => m.id === leafId)) return;
      const deepest = findDeepestLeaf(session, leafId);
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === activeSessionId ? { ...x, activeLeafId: deepest } : x
        ),
      }));
      const sess = get().sessions.find((x) => x.id === activeSessionId);
      if (sess) persistSession(sess);
    },

    stopStreaming: () => {
      const ref = activeStreamRef;
      if (!ref) return;
      ref.abort();
      // 立即置 stopped（abort 触发的 catch 也会置，幂等）
      patchMessage(ref.sessionId, ref.messageId, { status: "stopped" });
    },

    clearStreamError: () => set({ streamError: null }),

    loadAll: async () => {
      // 阶段 5/6：恢复流程（chat-state.md 第 6 节、prompt-library.md）
      // 1. 旧版自定义指令一次性迁移（先迁移，后加载 prompts 才能读到新条目）
      try {
        await migrateLegacyCustomInstruction();
      } catch {
        // 迁移失败不阻断启动（下次启动重试）
      }
      // 2. 加载 System Prompt 库（内置 + 自定义）
      try {
        await usePromptStore.getState().loadPrompts();
      } catch {
        // 库加载失败时仅内置可用
      }
      // 3. 默认 System Prompt 回退（条目被删/损坏 → 内置）
      const st = useSettingsStore.getState();
      if (!usePromptStore.getState().getPrompt(st.defaultSystemPromptId)) {
        st.setDefaultSystemPromptId(BUILTIN_PROMPT_ID);
      }
      // 4. 恢复会话（updatedAt 倒序）：分支图迁移 + 非终态归一（流式中刷新兜底）
      let sessions: Session[] = [];
      try {
        sessions = (await getAllSessions()).map((s) =>
          migrateSessionGraph(s)
        ).map((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.status === "streaming"
              ? ({ ...m, status: "failed" } as StoredMessage)
              : m.status === "pending"
                ? ({ ...m, status: "completed" } as StoredMessage) // user 消息内容已完整（review 修复）
                : m
          ),
        }));
      } catch (err) {
        // 恢复失败必须可见（历史教训：sessions store 缺失导致刷新后"对话丢失"）
        console.warn("[loadAll] 从 IndexedDB 恢复会话失败", err);
        sessions = [];
      }
      set({ sessions });
      if (sessions.length === 0) {
        get().newSession(); // 空态：新建一个会话呈现欢迎视图
      } else {
        set({ activeSessionId: sessions[0].id });
      }
    },
  };
});
