import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_PROMPT_ID, ChatError, type DeepseekEvent } from "@/lib/types";

// localStorage stub（useSettingsStore persist 依赖）
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
vi.stubGlobal("localStorage", localStorageMock);
vi.stubGlobal("window", { localStorage: localStorageMock });

// mock streamChat：可注入行为，并记录每次调用参数
const { streamChatMock } = vi.hoisted(() => ({ streamChatMock: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ streamChat: streamChatMock }));

const { useChatStore } = await import("@/lib/store/useChatStore");
const { setApiKey } = await import("@/lib/store/useSettingsStore");

function resetStore() {
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    streaming: false,
    streamError: null,
  });
}

function completedEvent(): DeepseekEvent {
  return {
    type: "response.completed",
    sequence_number: 1,
    response: {
      id: "resp_1",
      status: "completed",
      model: "deepseek-v4-flash",
      output: [],
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 5 },
        output_tokens: 3,
        output_tokens_details: { reasoning_tokens: 1 },
      },
    },
  };
}

describe("useChatStore 流式收尾与 retry 语义（review 修复验证）", () => {
  beforeEach(() => {
    store.clear();
    setApiKey("sk-test");
    resetStore();
    streamChatMock.mockReset();
  });

  it("流正常结束但无终态事件 → 消息兜底置 failed（不卡 streaming）", async () => {
    streamChatMock.mockImplementation(async function* () {
      // 只发 created + delta，无 completed/incomplete/failed
      yield {
        type: "response.created",
        sequence_number: 0,
        response: { id: "r", status: "in_progress", model: "deepseek-v4-flash", output: [] },
      } satisfies DeepseekEvent;
      yield {
        type: "response.output_text.delta",
        sequence_number: 1,
        delta: "部分内容",
        item_id: "m",
      } satisfies DeepseekEvent;
    });

    useChatStore.getState().newSession();
    await useChatStore.getState().sendMessage("你好");

    const session = useChatStore.getState().sessions[0];
    const assistant = session.messages.find((m) => m.role === "assistant")!;
    expect(assistant.status).toBe("failed");
    expect(assistant.content).toBe("部分内容"); // 已生成内容保留
    expect(useChatStore.getState().streaming).toBe(false);
  });

  it("retry 时请求 input 不含旧 assistant 内容/推理/搜索（不回传旧回复）", async () => {
    // 第一轮：先产出内容再失败
    streamChatMock.mockImplementationOnce(async function* () {
      yield {
        type: "response.created",
        sequence_number: 0,
        response: { id: "r", status: "in_progress", model: "deepseek-v4-flash", output: [] },
      } satisfies DeepseekEvent;
      yield {
        type: "response.output_text.delta",
        sequence_number: 1,
        delta: "旧回复内容",
        item_id: "m",
      } satisfies DeepseekEvent;
      throw new ChatError("network_error", "网络错误");
    });

    useChatStore.getState().newSession();
    await useChatStore.getState().sendMessage("问题1");
    const session0 = useChatStore.getState().sessions[0];
    const assistant0 = session0.messages.find((m) => m.role === "assistant")!;
    expect(assistant0.status).toBe("failed");
    expect(assistant0.content).toBe("旧回复内容");

    // 第二轮：重新生成 —— 创建新分支（FR-12），检查传给上游的 input
    let retryInput: unknown = null;
    streamChatMock.mockImplementationOnce(async function* (req: { input: unknown }) {
      retryInput = req.input;
      yield completedEvent();
    });

    useChatStore.getState().retryMessage(assistant0.id);
    // 等待异步完成（retryMessage 内部 void sendCore）
    await vi.waitFor(() => {
      expect(useChatStore.getState().streaming).toBe(false);
    });

    const session1 = useChatStore.getState().sessions[0];
    // 旧消息保留（分支），新 assistant 消息生成
    const oldAssistant = session1.messages.find((m) => m.id === assistant0.id)!;
    expect(oldAssistant.status).toBe("failed");
    const newAssistant = session1.messages.find(
      (m) => m.role === "assistant" && m.id !== assistant0.id
    )!;
    expect(newAssistant.status).toBe("completed");
    expect(newAssistant.parentId).toBe(oldAssistant.parentId); // 同一父 user
    expect(session1.activeLeafId).toBe(newAssistant.id);
    // 重新生成的上游 input 不含旧回复（上下文 = 根..父 user，无 assistant item）
    const items = retryInput as { type: string; role?: string; content?: string }[];
    const assistantItems = items.filter(
      (i) => i.type === "message" && i.role === "assistant"
    );
    expect(assistantItems).toHaveLength(0);
    expect(items.some((i) => i.type === "reasoning")).toBe(false);
    expect(items.some((i) => i.type === "web_search_call")).toBe(false);
  });

  it("context_too_long 自动截断重试一次，且第二次 input 变短", async () => {
    // 预置一个已有多轮历史的会话（含 parentId 链与 activeLeafId，FR-12）
    useChatStore.getState().newSession();
    const s0 = useChatStore.getState().sessions[0];
    useChatStore.setState({
      sessions: [
        {
          ...s0,
          activeLeafId: "a1",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Q1",
              status: "completed",
              model: "deepseek-v4-flash",
              createdAt: 1,
            },
            {
              id: "a1",
              role: "assistant",
              content: "A1",
              parentId: "u1",
              status: "completed",
              model: "deepseek-v4-flash",
              createdAt: 2,
            },
          ],
        },
      ],
    });

    streamChatMock.mockImplementationOnce(async function* () {
      throw new ChatError("context_too_long", "上下文过长");
    });
    const inputs: unknown[] = [];
    streamChatMock.mockImplementationOnce(async function* (req: {
      input: unknown;
    }) {
      inputs.push(req.input);
      yield completedEvent();
    });

    await useChatStore.getState().sendMessage("Q2");

    expect(streamChatMock).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().streamError).toContain("精简历史");
    expect(useChatStore.getState().streaming).toBe(false);
    // 第二次请求只含当前输入（旧轮次被截断）
    const items = inputs[0] as { type: string; role?: string; content?: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "message", role: "user", content: "Q2" });
  });

  it("System Prompt 快照：首条消息后 selectSystemPrompt 为 no-op", async () => {
    streamChatMock.mockImplementation(async function* () {
      yield completedEvent();
    });
    useChatStore.getState().newSession();
    // 空会话时可换
    useChatStore.getState().selectSystemPrompt(BUILTIN_PROMPT_ID);
    await useChatStore.getState().sendMessage("你好");
    // 已锁定：再选无效（内容不变——内置条目本就相同，验证不抛错且快照仍在）
    useChatStore.getState().selectSystemPrompt(BUILTIN_PROMPT_ID);
    const session = useChatStore.getState().sessions[0];
    expect(session.systemPromptText.length).toBeGreaterThan(0);
  });

  it("帧级节流（FR-13）：同帧多个 delta 合并且不丢失", async () => {
    streamChatMock.mockImplementation(async function* () {
      yield {
        type: "response.created",
        sequence_number: 0,
        response: { id: "r", status: "in_progress", model: "deepseek-v4-flash", output: [] },
      } satisfies DeepseekEvent;
      for (let i = 0; i < 50; i++) {
        yield {
          type: "response.output_text.delta",
          sequence_number: i + 1,
          delta: `块${i}`,
          item_id: "m",
        } satisfies DeepseekEvent;
      }
      yield completedEvent();
    });

    useChatStore.getState().newSession();
    await useChatStore.getState().sendMessage("hi");

    const assistant = useChatStore
      .getState()
      .sessions[0].messages.find((m) => m.role === "assistant")!;
    // finally 同步 flush：50 个 delta 全部累积、无丢失、顺序正确
    const expected = Array.from({ length: 50 }, (_, i) => `块${i}`).join("");
    expect(assistant.content).toBe(expected);
    expect(assistant.status).toBe("completed");
  });

  it("失败（空内容）的 assistant 消息不进入后续请求上下文（review 修复）", async () => {
    // 第一轮：立即失败（无任何 delta）→ assistant 内容为空、status failed
    streamChatMock.mockImplementationOnce(async function* () {
      throw new ChatError("network_error", "网络错误");
    });
    useChatStore.getState().newSession();
    await useChatStore.getState().sendMessage("问题1");

    // 第二轮：捕获请求 input
    let secondInput: unknown = null;
    streamChatMock.mockImplementationOnce(async function* (req: { input: unknown }) {
      secondInput = req.input;
      yield completedEvent();
    });
    await useChatStore.getState().sendMessage("问题2");

    const items = secondInput as { type: string; role?: string; content?: string }[];
    const assistantItems = items.filter(
      (i) => i.type === "message" && i.role === "assistant"
    );
    // 空内容的失败 assistant 被过滤，不送入上游
    expect(assistantItems).toHaveLength(0);
  });
});
