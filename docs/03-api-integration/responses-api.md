# Responses API 集成规格

> 本文档定义应用与 DeepSeek Responses API 的全部交互细节：端点、请求体构造、响应结构、兼容性边界。
> 依据：[官方「使用 Responses API」文档](https://api-docs.deepseek.com/zh-cn/guides/responses_api)（2026-07 核实）。

## 1. 端点与客户端

- **base_url**：`https://api.deepseek.com`（OpenAI 格式；OpenAI SDK 会拼接为 `/v1/responses`）
- **认证**：`Authorization: Bearer <API Key>`（由后端代理附加）
- **客户端**：openai npm SDK，后端 Node.js runtime 使用：

```ts
// lib/deepseek/sdk.ts
import OpenAI from "openai";

export function createClient(apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  });
}
```

> 备选：若部署环境不提供 Node runtime，可改用原生 `fetch` POST `${baseURL}/v1/responses`（见 05-backend/proxy-routes.md），请求体与本文档完全一致。

## 2. 模型与可用性开关

```ts
// lib/deepseek/models.ts
export const MODELS = {
  flash: { id: "deepseek-v4-flash", label: "DeepSeek-V4 Flash" },
  pro:   { id: "deepseek-v4-pro",   label: "DeepSeek-V4 Pro" },
} as const;

// Responses API 支持开关表：官方开放 Pro 后把 false 改为 true 即可
export const MODEL_SUPPORT: Record<string, boolean> = {
  "deepseek-v4-flash": true,
  "deepseek-v4-pro":   false, // 官方：2026 年 8 月初增加支持
};
```

后端在收到不支持模型的请求时直接返回结构化错误（见 error-handling.md），前端据此给出可读提示。

## 3. 请求体构造（本应用的实际请求）

```ts
// lib/api/build-request.ts —— 纯函数，单元测试目标
export interface ChatRequest {
  apiKey: string;
  model: string;                 // deepseek-v4-flash | deepseek-v4-pro
  instructions: string;          // 会话 System Prompt 快照（FR-11），恒定前缀
  input: InputItem[];            // 完整多轮上下文
  stream: true;
  reasoning?: { effort: "none" | "low" | "high" | "max" }; // 深度思考
  tools?: [{ type: "web_search" }];                        // 联网搜索
  temperature?: number;          // 思考模式关闭时生效（默认 1.0）
}
```

### 3.1 顶层参数使用规则（对照官方兼容性表）

| 参数 | 本应用用法 | 备注 |
|---|---|---|
| `model` | 必填，来自模型选择器 | 经 `MODEL_SUPPORT` 校验 |
| `instructions` | **必填**，作为第一条 system 消息；内容 = 会话 System Prompt 内容快照（prompt-library.md），首条消息发送时冻结 | 放在最前且保持稳定（缓存关键，见 context-cache.md） |
| `input` | **必填**（与 instructions 至少一个），完整历史 items | 无状态 API，必须全量发送 |
| `stream` | 恒为 `true` | 流式 |
| `reasoning` | 深度思考开关映射（见 thinking.md） | 关闭 = `{"effort":"none"}` |
| `tools` | 联网搜索开启时 `[{"type":"web_search"}]`，否则省略 | 见 web-search.md |
| `tool_choice` | 默认 `auto`（不传）；不强制搜索 | 用户需求未要求强制联网 |
| `temperature` | 仅思考模式关闭时发送（如 0.7）；开启时不发（不生效） | 避免误导 |
| `max_output_tokens` | 可选，默认不设（模型上限 384K）；如设置建议 ≥ 8192 | 达到上限会触发 `response.incomplete` |
| `user` | 可选，传固定匿名标识（如随机 uuid 持久化） | 用于限速隔离 |
| `top_logprobs` / `top_p` | 不传 | 思考模式下不生效 |

**明确不传**（官方不支持或会被静默忽略）：`previous_response_id`、`conversation`、`store`、`prompt_cache_key`、`prompt_cache_retention`、`truncation`、`metadata`、`include`、`background`、`parallel_tool_calls`、`stream_options`。

> 兼容性安全网：官方承诺不支持的参数会被**静默忽略**，因此即使 SDK 类型定义里出现多余字段也不会报错；但本应用仍按上表最小化发送。

### 3.2 input items 构造规则

input 是 items 数组，本应用只用以下类型：

```ts
export type InputItem =
  | { type: "message"; role: "user" | "assistant" | "system"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }   // 预留，本应用不产生
  | { type: "function_call_output"; call_id: string; output: string }             // 预留
  | { type: "web_search_call"; id: string }                                       // 联网搜索历史，原样回传
  | { type: "reasoning"; id: string; content: string };                           // 可选回传（见 thinking.md）
```

构造算法（`build-input.ts`，纯函数）：

```
function buildInput(history: StoredMessage[]): InputItem[] {
  // 1. 遍历会话消息（按时间序）
  // 2. user 消息  → {type:"message", role:"user", content}
  // 3. assistant 消息 → {type:"message", role:"assistant", content: 最终回答}
  //    （reasoning 单独处理，见 thinking.md 第 4 节）
  // 4. 若该轮开启了联网搜索且模型确实调用了搜索，则在对应 assistant 消息前
  //    插入 {type:"web_search_call", id: 记录下来的搜索 call id}（原样回传，服务端自动恢复搜索结果）
  // 5. 中间截断：超长历史按 context-cache.md 第 5 节截断（保留前缀，丢弃最旧）
  // 6. 最后追加当前用户输入：{type:"message", role:"user", content: 新消息}
}
```

消息 content 统一使用**字符串**形式（官方支持 `input_text`/`output_text` 内容块，但字符串最简单且等价）。

### 3.3 完整请求示例

```jsonc
// POST https://api.deepseek.com/v1/responses
{
  "model": "deepseek-v4-flash",
  "instructions": "你是 DeepSeek 网页版助手……（会话 System Prompt 快照内容）",
  "input": [
    { "type": "message", "role": "user",      "content": "中国的首都是哪里？" },
    { "type": "message", "role": "assistant", "content": "中国的首都是北京。" },
    { "type": "message", "role": "user",      "content": "那美国呢？" }
  ],
  "stream": true,
  "reasoning": { "effort": "high" },
  "tools": [{ "type": "web_search" }],
  "user": "anon-9f8e..."
}
```

## 4. 响应结构（非流式视角，供参考）

流式事件最终携带完整 response 对象（`response.completed` 事件），关键字段：

```
{
  "id": "resp_xxxx",
  "object": "response",
  "status": "completed",            // completed | incomplete | failed | in_progress
  "model": "deepseek-v4-flash",
  "output": [                        // output items 数组
    { "type": "reasoning", "id": "rs_1", "summary": [], "content": [] },  // 思维链（可能为空）
    { "type": "web_search_call", "id": "ws_1" },                          // 联网搜索调用（若发生）
    { "type": "message", "id": "msg_1", "role": "assistant",
      "content": [{ "type": "output_text", "text": "...", "annotations": [] }] }
  ],
  "usage": {
    "input_tokens": 1234,
    "input_tokens_details": { "cached_tokens": 1100 },   // ← 缓存命中（前缀缓存核心指标）
    "output_tokens": 567,
    "output_tokens_details": { "reasoning_tokens": 300 } // ← 思维链 token
  },
  "store": false
}
```

- `output[].type` 可能取值：`reasoning` / `message` / `function_call` / `custom_tool_call` / `web_search_call`
- 最终回答文本取 `output` 中 `type === "message"` 的 item 的 `content[].text` 拼接
- 前端解析统一走流式事件（见 streaming.md），此结构用于 `response.completed` 事件的 usage 提取

## 5. 兼容性边界（易踩坑清单）

1. **`deepseek-v4-pro` 暂不支持 Responses API** → 由 `MODEL_SUPPORT` 拦截，返回 501 语义错误
2. **无状态**：`previous_response_id` / `conversation` 不支持 → 客户端全量发 input
3. **不支持 `truncation`**：输入超 1M 上下文 → 400 → 前端自动截断重试（error-handling.md）
4. **不支持图片/文件输入**：`input_image` 块被替换为占位文本 → 本应用不做上传
5. **思考模式与 temperature 互斥**：开启思考时 temperature 不生效 → 开启时干脆不发送
6. **`reasoning.summary` 不生成**：summary 可传但不返回 → 前端不依赖 summary 字段
7. **流式无 `data: [DONE]`** → 以 `response.completed/incomplete/failed` 判断结束
8. **`custom` 工具仅支持 `apply_patch`** → 本应用不使用 custom 工具
9. **`web_search_call` item 需原样回传**（含原 id）→ 会话存储中必须保留搜索调用的 id
10. **`reasoning` item 明文 content 会被归并到相邻 assistant 消息** → 回传 reasoning 无副作用（见 thinking.md）

## 6. 后端代理请求/响应契约（前端 ↔ 代理）

前端 POST `/api/chat`，请求体 = `ChatRequest`（含 `apiKey`）；响应为 SSE 流（详见 streaming.md 第 4 节），错误场景返回 JSON：

```jsonc
// 非 200（非流式错误，如 401/402/模型不支持）
{ "error": { "code": "model_not_supported" | "invalid_api_key" | "insufficient_balance" | "rate_limited" | "context_too_long" | "upstream_error", "message": "人类可读文案", "status": 4xx } }
```

## 7. 实现要点 Checklist

- [ ] `lib/deepseek/models.ts`：MODELS + MODEL_SUPPORT
- [ ] `lib/deepseek/sdk.ts`：createClient
- [ ] `lib/api/build-request.ts`：ChatRequest 构造（含 reasoning/tools 条件拼接）
- [ ] `lib/api/build-input.ts`：history → InputItem[]（含 web_search_call 回传）
- [ ] 单测：请求体字段正确性、input 顺序、模型不支持拦截
