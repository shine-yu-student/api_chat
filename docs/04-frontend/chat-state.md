# 对话状态管理（Chat State）

> 定义前端状态模型（TypeScript 类型）、zustand store 结构、流式更新协议与消息生命周期。

## 1. 核心类型（lib/types.ts）

```ts
export type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro";
export type ThinkingEffort = "low" | "high" | "max";
export type MessageRole = "user" | "assistant";
export type MessageStatus =
  | "pending"      // 已入队等待发送（UI 上瞬时）
  | "streaming"    // 生成中
  | "completed"    // 正常完成
  | "stopped"      // 用户停止
  | "failed"       // 失败（保留已生成内容）
  | "truncated";   // 达到输出上限被截断

export interface Citation {
  index: number;
  url: string;
  title?: string;
}

export interface UsageInfo {
  inputTokens: number;
  cachedTokens: number;       // 命中缓存 token 数
  outputTokens: number;
  reasoningTokens: number;    // 思维链 token
}

export interface StoredMessage {
  id: string;                 // 客户端生成 uuid
  role: MessageRole;
  content: string;            // 最终正文（流式过程中为已生成部分）
  parentId?: string;          // 对话分支（FR-12）：父消息 id；undefined = 根消息
  reasoning?: string;         // 完整思维链（展示 + 可能回传）
  reasoningElapsedMs?: number;
  hadToolCall?: boolean;      // 该轮是否发生 web_search_call（thinking.md 回传依据）
  webSearch?: {
    callId: string;
    status: "searching" | "completed" | "failed";
    citations?: Citation[];
  };
  status: MessageStatus;
  model: ModelId;             // 发送时所用模型
  usage?: UsageInfo;
  createdAt: number;
}

export interface SystemPrompt {
  id: string;              // uuid；内置固定 "builtin-default"
  name: string;
  content: string;
  isBuiltin: boolean;      // 内置不可编辑/删除
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  title: string;
  model: ModelId;             // 会话当前模型（新消息使用）
  systemPromptId: string;     // 选用的库条目 id（内置 "builtin-default"）；仅展示用
  systemPromptText: string;   // System Prompt 内容【快照】：首条 user 消息时冻结，之后不变（FR-11）
  messages: StoredMessage[];  // 全部消息（分支树平铺，按创建序；树结构由 parentId 表达）
  activeLeafId?: string;      // 对话分支（FR-12）：当前查看/编辑路径的叶子消息 id
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  apiKey: string;             // localStorage 单独存（见 settings.md）
  defaultModel: ModelId;
  thinkingEnabled: boolean;   // 默认 true
  thinkingEffort: ThinkingEffort; // 默认 "high"
  webSearchEnabled: boolean;  // 默认 false
  temperature: number;        // 默认 1.0（思考关闭时生效）
  defaultSystemPromptId: string; // 新建会话预选的库条目 id（默认 "builtin-default"）
  darkMode: boolean;
  anonUserId: string;         // 限流隔离用，uuid
  sidebarWidth: number;       // 侧边栏宽度 px（FR-14，默认 260，范围 200~480）
  sidebarCollapsed: boolean;  // 侧边栏是否收起（FR-14，默认 false，仅桌面生效）
}
```

## 2. zustand store（useChatStore）

```ts
interface ChatState {
  sessions: Session[];              // 全部会话（内存镜像）
  activeSessionId: string | null;
  streaming: boolean;               // 是否有请求进行中
  streamError: string | null;

  // actions
  newSession(): void;                                   // 新建（自动命名「新对话」，预选 defaultSystemPromptId 条目）
  deleteSession(id: string): void;
  renameSession(id: string, title: string): void;
  setActiveSession(id: string): void;
  setModel(model: ModelId): void;                       // 更新当前会话 model
  selectSystemPrompt(id: string): void;                 // 空会话（未锁定）更换 System Prompt；已锁定则 no-op

  sendMessage(text: string): Promise<void>;             // 核心：完整一轮（追加到当前分支末端）
  editMessage(messageId: string, text: string): Promise<void>; // 编辑 user 消息 → 创建分支并自动重新生成（FR-12）
  stopStreaming(): void;
  retryMessage(messageId: string): void;                // 重新生成 → 创建新 assistant 分支（FR-12）
  switchBranch(leafId: string): void;                   // 切换分支（activeLeafId → 该分支末端叶子）
  clearStreamError(): void;
  loadAll(): Promise<void>;                             // 启动时从 IndexedDB 恢复
}
```

`useSettingsStore`（zustand + persist 中间件）单独管理 `Settings`，localStorage key：`deepseek-chat.settings`（apiKey 独立 key，见 settings.md）。

### usePromptStore（System Prompt 库，IndexedDB 持久化）

```ts
interface PromptState {
  prompts: SystemPrompt[];          // 内置 + 自定义（内置恒在，自定义按 updatedAt 倒序）
  loadPrompts(): Promise<void>;     // 启动时从 IndexedDB 加载并合并 BUILTIN_DEFAULT_PROMPT
  createPrompt(name: string, content: string): Promise<SystemPrompt>;
  updatePrompt(id: string, name: string, content: string): Promise<void>;  // 内置禁止
  deletePrompt(id: string): Promise<void>;   // 内置禁止；删除后修正 defaultSystemPromptId（回退内置）
  getPrompt(id: string): SystemPrompt | undefined;
}
```

- `loadPrompts` 结果 = `[BUILTIN_DEFAULT_PROMPT, ...userPrompts]`；内置条目恒在，无需空态处理
- 删除/编辑只影响库与新建会话；已锁定会话持快照，不受影响（prompt-library.md 第 7 节）
- 新建会话时 `newSession()` 读取 `settings.defaultSystemPromptId` 预选；条目不存在（被删）时回退 `"builtin-default"`

## 3. 消息生命周期与分支（sendCore 状态机）

三种入口共用 `sendCore(sessionId, opts)`（opts.kind = send | edit | regenerate）：

```
send（sendMessage）
 1. 校验：apiKey 存在？模型受支持？（本地 MODEL_SUPPORT 镜像）→ 否则拦截提示
 2. 路径 = getPathMessages(session)（根 → activeLeafId；纯函数，见 useChatStore.ts）
 3. 构造 user 消息（parentId = 路径末条 id）→ 占位 assistant（parentId = user id）
 4. activeLeafId = assistant id；持久化；streaming = true
 5. 请求上下文 inputMessages = 路径 + 新 user
 6. 预算截断 → buildChatRequest → streamChat 消费（事件分发见 streaming.md 第 5 节）
 7. 收尾：usage、持久化

edit（editMessage：编辑路径上任一 user 消息 → 分支）
 1. 目标 user 必须在当前路径上（UI 只渲染路径消息）
 2. 创建新 user 消息 U'（id 新，parentId = 原目标 parentId），旧分支（原目标及后代）保留
 3. 占位 assistant（parentId = U'）→ activeLeafId = assistant id
 4. inputMessages = 路径[:目标位置] + U'；自动开始生成

regenerate（retryMessage：重新生成任意 assistant 消息 → 分支）
 1. 目标 assistant 的父 user 必须在当前路径上
 2. 创建新 assistant 消息 A'（parentId = 父 user id），旧 assistant 及其后代保留
 3. activeLeafId = A' id
 4. inputMessages = 路径[:父 user 位置]（不含旧回复，避免回传旧内容）
```

**关键约束**：`streaming === true` 期间禁止 sendMessage / editMessage / retryMessage / switchBranch（输入区禁用），保证前缀顺序（context-cache.md 规则 8）。

## 4. 流式更新与渲染性能（FR-13）

- **帧级节流**：`output_text.delta` / `reasoning_text.delta` 累积到模块级缓冲（key = `${sessionId}:${messageId}`），经 `raf()`（Node 测试环境回退 setTimeout 16ms）每帧批量 `flushDeltaBatch()` 一次 setState；流结束 finally 同步 flush 剩余 delta（停止/中断时内容完整）。
- **引用稳定**：flush 时未变化的会话/消息返回原引用，配合 MessageItem（React.memo）与 Markdown/ReasoningPanel 的 props 浅比较，流式期间仅目标消息重渲染。
- **分支数据缓存**：MessageList 以「拓扑签名」（parentId 序列字符串）为 useMemo 依赖构建 childrenByParent，delta 不改变拓扑 → 引用稳定 → BranchSwitcher memo 生效。
- 事件分发中仍直接 setState 的低频事件：output_item.added / web_search_call.* / reasoning_text.done / completed / incomplete / failed。

## 5. 会话持久化时机

| 时机 | 操作 |
|---|---|
| 新建/删除/重命名/切换会话 | 立即写 IndexedDB |
| 消息追加（user/assistant 占位） | 立即写 |
| 流式 delta | 防抖 500ms 写 |
| 轮次完成/失败/停止 | 立即写 |

## 6. 恢复流程（loadAll）

```
页面加载 → useSettingsStore.hydrate()
         → db.getAllSessions() → setSessions
         → activeSessionId = 最近 updatedAt 的会话（或 null → 欢迎视图 + 自动新建）
```

恢复后不自动重发任何请求；流式中的会话在刷新后按「stopped」处理（已生成内容保留，可手动重试）。

## 7. 边界情况

| 场景 | 行为 |
|---|---|
| 发送时切会话 | 不允许：发送中锁定当前会话（store 校验 activeSessionId 未变） |
| 流式中删除会话 | 先 abort 再删除 |
| 流式中切换模型 | 只影响下一条消息 |
| 空会话更换 System Prompt | 允许（未锁定）；不产生任何请求，无缓存影响 |
| 已锁定会话更换 System Prompt | 拒绝（UI 无入口 + store no-op）；提示新建会话 |
| 库条目被删/被改 | 已锁定会话快照不受影响（prompt-library.md 第 7 节） |
| 编辑/重生成（FR-12） | 创建新分支：旧消息完整保留，activeLeafId 指向新消息；流式中禁止 |
| 分支切换（FR-12） | switchBranch 沿最新子节点走到分支末端叶子；流式中禁止 |
| 切换分支后发送 | 新消息追加在当前分支末端（parentId = 路径末条） |
| 旧版会话（无分支字段） | loadAll 时 migrateSessionGraph 线性补链（parentId + activeLeafId） |
| 浏览器关闭/刷新 | 未完成轮次保留为 stopped |
| 同一会话双标签页 | 不做同步（范围外，NFR 未要求） |

## 8. 实现要点 Checklist

- [ ] types.ts 全部类型（与 06-storage schema 一致）
- [ ] useChatStore 全部 actions + sendMessage 状态机
- [ ] 流式事件 → store 的分发函数（`applyEvent(store, event)`，可单测：喂事件序列断言消息状态）
- [ ] 持久化防抖与恢复流程
