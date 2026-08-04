# 深度思考（Thinking Mode）

> 定义深度思考开关/强度的 UI 状态到 Responses API 参数的映射，以及思维链内容在多轮对话中的处理。
> 依据：[官方「思考模式」文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode) + 「使用 Responses API」兼容性表（2026-07 核实）。

## 1. 参数映射

Responses API 格式下，思考模式由 `reasoning.effort` 控制（与 Chat Completion 的 `thinking`/`reasoning_effort` 不同）：

| UI 状态 | 请求参数 | 说明 |
|---|---|---|
| 深度思考：**关** | `reasoning: {"effort": "none"}` | none = 关闭思考模式 |
| 深度思考：**开 · 低** | `reasoning: {"effort": "low"}` | 快思考 |
| 深度思考：**开 · 高**（默认） | `reasoning: {"effort": "high"}` | 默认值 |
| 深度思考：**开 · 最高** | `reasoning: {"effort": "max"}` | 最慢最细 |

- 思考模式**默认开启**、effort 默认 `high`——即用户不操作时按「开 · 高」发送。
- 官方 effort 映射（请求值 → 模型实际值）：`low→low`（flash）/`high`（pro）；`high→high`/`high`；`xhigh→high`/`max`；`max→max`/`max`（pro 映射 2026-08 初更新）。本应用只发 `low|high|max`，无需关心映射细节。
- **思考模式下 `temperature`、`top_p` 不生效**：本应用在思考开启时**不发送** temperature 字段；思考关闭时发送用户可配温度（默认 1.0）。

## 2. 请求构造

```ts
// lib/api/build-request.ts 中的片段
const reasoning =
  settings.thinkingEnabled === false
    ? { effort: "none" as const }
    : { effort: settings.thinkingEffort ?? "high" as const }; // "low" | "high" | "max"
```

## 3. 流式呈现（前端）

思维链通过 `response.reasoning_text.delta` 事件增量到达（`reasoning` 类型 output item）：

1. `response.output_item.added`（item.type === "reasoning"）→ 创建思考面板容器
2. `response.reasoning_text.delta` → 追加文本（store 中 `reasoning` 字段）
3. `response.reasoning_text.done` → 完成；记录用时，UI 折叠为一行：`已深度思考（X.X 秒）`，点击可展开查看全文（仿 DeepSeek 网页端）
4. 思考中若发生 `web_search_call`，思考面板下方显示搜索状态（二者独立区块）

UI 规范（详见 04-frontend/ui-design.md）：
- 思考面板位于助手消息正文**上方**，折叠态一行摘要，展开态灰底小字号正文
- 折叠/展开状态存组件局部 state 即可，不落库

## 4. 思维链在多轮对话中的处理（关键）

**Responses API 的规则（与 Chat Completion 不同，更宽松）：**

- 输入 items 中的 `reasoning` 类型：**支持**，明文 `content` 会被**归并到相邻 assistant 消息**；`summary`、`encrypted_content` 不支持。
- 不带 tools 的纯对话：**无需回传** reasoning item；服务端忽略多余 reasoning（官方明确：两 user 消息之间若无工具调用，中间 assistant 的 reasoning 无需参与拼接）。
- 本应用**默认不回传** reasoning item（保持前缀稳定、减少传输量）；唯一例外：若该轮发生了 `web_search_call`（即带工具调用），则按官方要求**必须回传** reasoning——此时把该轮 reasoning 明文作为 `{type:"reasoning", id: 原id, content: 原文}` 插入到对应 assistant message 之前（官方承诺明文 content 归并到相邻 assistant 消息，等价于回传）。

```ts
// build-input.ts 中处理 reasoning 的规则：
// 该轮无工具调用  → 不插入 reasoning item
// 该轮有工具调用  → 插入 {type:"reasoning", id: <原item id>, content: <完整思维链>}
```

> ⚠️ 注意：官方「必须回传 reasoning_content」的 400 报错约束是针对 **Chat Completion 格式**（tools 场景）。Responses API 格式下 reasoning 输入项被兼容，上述规则已在官方兼容性表核实。实现时若遇到 400，优先检查是否漏回传了带搜索轮次的 reasoning item。

## 5. 会话存储

每条助手消息持久化字段（见 06-storage/session-storage.md）：

```ts
interface StoredMessage {
  // ...
  reasoning?: string;      // 完整思维链（用于展示 + 必要时回传）
  reasoningElapsedMs?: number;
  hadToolCall?: boolean;   // 该轮是否发生 web_search_call（决定是否需回传 reasoning）
}
```

## 6. 与温度的关系

| 深度思考 | temperature | 说明 |
|---|---|---|
| 开 | 不发送 | 官方：思考模式下不生效 |
| 关 | 发送 settings.temperature（默认 1.0） | 非思考模式生效 |

## 7. 实现要点 Checklist

- [ ] settings：thinkingEnabled（默认 true）+ thinkingEffort（默认 "high"）
- [ ] build-request：reasoning 字段映射
- [ ] build-input：按「是否 hadToolCall」决定是否回传 reasoning item
- [ ] 前端：ReasoningPanel 组件（流式展开 → 完成折叠，含用时）
- [ ] 单测：thinking off → effort "none"；thinking on → 对应 effort；带搜索轮次 → reasoning item 被回传
