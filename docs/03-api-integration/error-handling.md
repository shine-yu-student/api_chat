# 错误处理与降级（Error Handling）

> 定义全链路错误分类、错误码映射、用户提示文案与降级策略。
> 依据：[官方「错误码」文档](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes)（2026-07 核实）。

## 1. 错误分类与映射

### 1.1 HTTP 错误码（DeepSeek API 非流式/首事件前失败）

| HTTP | 官方含义 | 应用映射 code | 用户文案（前端展示） |
|---|---|---|---|
| 400 | 请求格式错误（含**上下文超限**、模型不支持、参数非法） | `bad_request` / `context_too_long` / `model_not_supported` | 「请求有误：{detail}」；超限 → 自动截断重试（见第 3 节） |
| 401 | API Key 无效 | `invalid_api_key` | 「API Key 无效，请检查设置中的 Key」 |
| 402 | 余额不足 | `insufficient_balance` | 「账户余额不足，请前往 DeepSeek 平台充值」 |
| 422 | 参数校验失败 | `validation_error` | 「参数校验失败：{detail}」 |
| 429 | 请求频率超限 | `rate_limited` | 「请求过于频繁，请稍后重试」（附重试等待时间） |
| 5xx | 服务端错误 | `upstream_error` | 「DeepSeek 服务暂时不可用，请稍后重试」 |

### 1.2 流内错误

- `response.failed` 事件：response 对象携带 `error`（含 `code`/`message`），按上述 code 映射展示；已生成内容保留。
- `response.incomplete`：达到 `max_output_tokens` 截断 → 提示「已达输出上限，已截断」，内容保留，可「继续生成」或重试。
- 网络层（fetch 失败 / 上游中断）：`network_error` → 「网络连接中断，已保留已生成内容」。

### 1.3 本应用自产错误

| code | 场景 | 说明 |
|---|---|---|
| `missing_api_key` | 未配置 Key 就发送 | 前端直接拦截，弹设置引导（不发请求） |
| `model_not_supported` | 选择了 Responses API 暂不支持的模型（当前为 `deepseek-v4-pro`） | 后端 501 语义返回；文案：「该模型暂不支持 Responses API，DeepSeek 官方预计 2026 年 8 月初开放，请先使用 Flash 模型」 |

## 2. 错误响应协议（后端 → 前端）

- **非流式错误**（请求校验失败、上游首事件前失败）：HTTP 非 200 + JSON：

```jsonc
{ "error": { "code": "invalid_api_key", "message": "…", "status": 401 } }
```

- **流中错误**：发送 SSE 事件 `data: {"type":"response.failed","response":{"status":"failed","error":{...}}}`（与官方事件格式一致），前端统一走 `response.failed` 分支。这样前端只有一个失败入口。

前端 `streamChat` 统一处理：

```ts
const res = await fetch("/api/chat", ...);
if (!res.ok) {
  const { error } = await res.json().catch(() => ({ error: { code: "upstream_error", message: "未知错误" } }));
  throw new ChatError(error.code, error.message);
}
// 流内失败由事件分发处理
```

## 3. 上下文超限（400 context_too_long）自动降级

1. 后端收到上游 400 且错误信息含 context/上下文/token 超限特征 → 返回 `{code:"context_too_long"}`；
2. 前端捕获后：调用 `truncateHistory`（丢最旧一半轮次）→ **自动重试一次**，并提示「上下文过长，已自动精简历史」；
3. 重试仍 400 → 停止，提示用户新建会话。

> 注意：截断会破坏前缀缓存（一次），但这是避免失败的唯一路径，符合 context-cache.md 第 5 节。

## 4. 429 限流退避

- 单次请求内不做自动重试（DeepSeek 限流按用户/分钟，重试大概率再 429）；
- 展示「请稍后重试」+ 可选 30s 倒计时；用户手动重试；
- `user` 参数传固定匿名 id（设置中生成并存 localStorage），避免不同会话分散限流配额（官方按用户隔离限速）。

## 5. 超时与悬挂

| 场景 | 处理 |
|---|---|
| 后端等待上游首事件 > 60s | abort + 返回 504 JSON（`upstream_timeout`） |
| 流中 60s 无任何事件 | 同上（发 `response.failed` 事件收尾） |
| 前端 fetch 无响应 > 90s | 前端本地 abort + 提示「生成超时」 |

## 6. 重试与恢复 UI

失败/停止的助手消息保留以下能力（消息卡片尾部操作）：

- **重试**：以相同输入重发（构造相同请求；若失败时已产生部分内容则清空重来）
- **复制**：复制已生成内容
- 保留已生成部分内容（不丢弃），失败文案以独立样式展示在内容下方

## 7. 日志与安全（后端）

- 后端**不记录**请求体、apiKey、响应内容（security.md 第 3 节）；
- 错误日志仅记录：时间、上游 status、错误 code（不含 message 原文中的用户内容——DeepSeek 错误 message 一般不含用户输入，但保持谨慎）。

## 8. 实现要点 Checklist

- [ ] `lib/errors.ts`：ChatError 类型 + code 枚举 + 文案表（唯一映射点）
- [ ] 后端 route：错误 → JSON 或 SSE failed 事件
- [ ] 前端：统一错误展示组件（消息内联 + toast）
- [ ] 前端：context_too_long 自动截断重试一次
- [ ] 单测：错误码映射表、truncate 重试逻辑
