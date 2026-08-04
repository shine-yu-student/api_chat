// ============================================================
// 全局共享类型（TypeScript 契约）
// 依据 docs/04-frontend/chat-state.md、docs/03-api-integration/*.md
// 所有模块（前端 / 后端代理 / 存储）统一引用本文件，禁止各模块自行定义重复类型。
// ============================================================

// ---------- 模型 ----------

export type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro";
export type ThinkingEffort = "low" | "high" | "max";

// ---------- 消息 ----------

export type MessageRole = "user" | "assistant";
export type MessageStatus =
  | "pending" // 已入队等待发送
  | "streaming" // 生成中
  | "completed" // 正常完成
  | "stopped" // 用户停止
  | "failed" // 失败（保留已生成内容）
  | "truncated"; // 达到输出上限被截断

export interface Citation {
  index: number;
  url: string;
  title?: string;
}

export interface UsageInfo {
  inputTokens: number;
  cachedTokens: number; // 命中缓存 token 数
  outputTokens: number;
  reasoningTokens: number; // 思维链 token
}

export interface WebSearchInfo {
  callId: string; // web_search_call item id（多轮回传必需）
  status: "searching" | "completed" | "failed";
  citations?: Citation[];
}

export interface StoredMessage {
  id: string; // crypto.randomUUID()
  role: MessageRole;
  content: string; // 最终正文（流式过程中为已生成部分）
  parentId?: string; // 对话分支（FR-12）：父消息 id；undefined = 根消息
  reasoning?: string; // 完整思维链
  reasoningElapsedMs?: number;
  hadToolCall?: boolean; // 该轮是否发生 web_search_call（决定是否需回传 reasoning）
  webSearch?: WebSearchInfo;
  status: MessageStatus;
  model: ModelId; // 发送时所用模型
  usage?: UsageInfo;
  createdAt: number;
}

// ---------- System Prompt（FR-11） ----------

export interface SystemPrompt {
  id: string; // uuid；内置条目固定为 "builtin-default"
  name: string;
  content: string;
  isBuiltin: boolean; // 内置不可编辑/删除
  createdAt: number;
  updatedAt: number;
}

export const BUILTIN_PROMPT_ID = "builtin-default";

// ---------- 会话 ----------

export interface Session {
  id: string; // crypto.randomUUID()
  title: string;
  model: ModelId; // 会话当前模型（新消息使用）
  systemPromptId: string; // 选用的库条目 id（内置 "builtin-default"）；仅展示用
  systemPromptText: string; // System Prompt 内容快照：首条 user 消息时冻结，之后不变（FR-11）
  messages: StoredMessage[]; // 全部消息（分支树平铺，按创建序）
  activeLeafId?: string; // 对话分支（FR-12）：当前查看/编辑路径的叶子消息 id
  createdAt: number;
  updatedAt: number;
}

// ---------- 设置 ----------

export interface Settings {
  apiKey: string; // localStorage 单独存
  defaultModel: ModelId;
  thinkingEnabled: boolean; // 默认 true
  thinkingEffort: ThinkingEffort; // 默认 "high"
  webSearchEnabled: boolean; // 默认 false
  temperature: number; // 默认 1.0（思考模式关闭时生效）
  defaultSystemPromptId: string; // 新建会话预选的库条目 id（默认 "builtin-default"）
  darkMode: boolean;
  anonUserId: string; // 限流隔离用，uuid
}

// ---------- 请求契约（前端 → 后端代理 → DeepSeek） ----------

export type InputItem =
  | { type: "message"; role: "user" | "assistant" | "system"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string } // 预留，本应用不产生
  | { type: "function_call_output"; call_id: string; output: string } // 预留
  | { type: "web_search_call"; id: string } // 联网搜索历史，原样回传
  | { type: "reasoning"; id: string; content: string }; // 可选回传（thinking.md 第 4 节）

export interface ChatRequest {
  apiKey: string;
  model: ModelId;
  instructions: string; // 会话 System Prompt 快照（FR-11），恒定前缀
  input: InputItem[];
  stream: true;
  reasoning?: { effort: "none" | ThinkingEffort }; // 深度思考开关
  tools?: [{ type: "web_search" }]; // 联网搜索开关
  temperature?: number; // 思考模式关闭时生效
}

// ---------- 后端错误契约 ----------

export interface ApiErrorBody {
  error: { code: ErrorCodeName; message: string; status: number };
}

export type ErrorCodeName =
  | "missing_api_key"
  | "model_not_supported"
  | "invalid_api_key"
  | "insufficient_balance"
  | "rate_limited"
  | "bad_request"
  | "context_too_long"
  | "validation_error"
  | "upstream_error"
  | "upstream_timeout"
  | "network_error";

export class ChatError extends Error {
  code: ErrorCodeName;
  status: number;
  constructor(code: ErrorCodeName, message: string, status = 0) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    this.status = status;
  }
}

// ---------- SSE 事件（DeepSeek Responses API 流式事件，后端原样透传） ----------

export interface OutputItem {
  type:
    | "reasoning"
    | "message"
    | "function_call"
    | "custom_tool_call"
    | "web_search_call";
  id: string;
  [key: string]: unknown;
}

export interface ResponseUsage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface ResponseObject {
  id: string;
  status: "completed" | "incomplete" | "failed" | "in_progress";
  model: string;
  output: OutputItem[];
  usage?: ResponseUsage;
  error?: { code?: string; message?: string };
  [key: string]: unknown;
}

export type DeepseekEvent =
  | { type: "response.created"; sequence_number: number; response: ResponseObject }
  | { type: "response.in_progress"; sequence_number: number; response: ResponseObject }
  | { type: "response.output_item.added"; sequence_number: number; item: OutputItem }
  | { type: "response.output_item.done"; sequence_number: number; item: OutputItem }
  | { type: "response.content_part.added"; sequence_number: number; item_id: string }
  | { type: "response.content_part.done"; sequence_number: number; item_id: string }
  | {
      type: "response.reasoning_text.delta";
      sequence_number: number;
      delta: string;
      item_id: string;
    }
  | {
      type: "response.reasoning_text.done";
      sequence_number: number;
      item_id: string;
    }
  | {
      type: "response.output_text.delta";
      sequence_number: number;
      delta: string;
      item_id: string;
    }
  | { type: "response.output_text.done"; sequence_number: number; item_id: string }
  | {
      type: "response.web_search_call.in_progress";
      sequence_number: number;
      item_id: string;
    }
  | {
      type: "response.web_search_call.searching";
      sequence_number: number;
      item_id: string;
    }
  | {
      type: "response.web_search_call.completed";
      sequence_number: number;
      item_id: string;
    }
  | { type: "response.completed"; sequence_number: number; response: ResponseObject }
  | { type: "response.incomplete"; sequence_number: number; response: ResponseObject }
  | { type: "response.failed"; sequence_number: number; response: ResponseObject };

// ---------- 其他常量 ----------

export const STORAGE_KEYS = {
  apiKey: "deepseek-chat.apiKey",
  settings: "deepseek-chat.settings",
  anonUserId: "deepseek-chat.anonUserId",
} as const;
