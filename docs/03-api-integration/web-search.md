# 联网搜索（Web Search）

> 定义联网搜索开关到 Responses API `web_search` 工具参数的映射、搜索状态机、引用呈现与多轮回传。
> 依据：[官方「使用 Responses API」Tools 兼容性表](https://api-docs.deepseek.com/zh-cn/guides/responses_api)（2026-07 核实）。

## 1. 参数映射

| UI 状态 | 请求参数 |
|---|---|
| 联网搜索：**关**（默认） | 不传 `tools`、不传 `tool_choice` |
| 联网搜索：**开** | `tools: [{ "type": "web_search" }]`，`tool_choice` 不传（默认 auto，模型按需搜索） |

细节：

- 官方支持 `{"type": "web_search"}` 与 `{"type": "web_search_2025_08_26"}` 两种，本应用使用 **`web_search`**（官方示例默认形态）。
- `tool_choice` 支持 `none / auto / required / {"type":"web_search"}`。本应用**不强制**搜索（不传 tool_choice，即 auto）：用户开启开关只是授权模型可用搜索，是否真搜由模型决定（与 DeepSeek 网页端行为一致）。
- `search_context_size`、`user_location` 参数官方**忽略**，不传。
- 搜索由**服务端执行**，本应用不实现任何自有搜索逻辑（不重复造轮子）。

## 2. 搜索状态机（前端）

```
关闭开关时：无任何搜索 UI
开启开关时（一次轮次内）：
  idle ──response.web_search_call.in_progress──▶ searching
  searching ──response.web_search_call.searching（可多次）──▶ searching（状态动画）
  searching ──response.web_search_call.completed──▶ completed（记录 call id）
  任意时刻 response.failed / 用户停止 ──▶ error/stopped
```

UI 呈现（仿 DeepSeek 网页端）：
- searching：助手消息内显示「正在搜索网络…」+ 旋转/脉冲动画
- completed：替换为来源引用区——搜索到的网页以带角标链接展示（`[1] 来源标题`，可点击打开）。引用数据来源：模型回答中的 `annotations`（见第 4 节）
- 若模型本轮未发起搜索：无搜索 UI，正常输出

## 3. 事件与数据记录

流式事件：

| 事件 | 前端动作 |
|---|---|
| `response.output_item.added`（item.type === "web_search_call"） | 记录 `item.id`（= call id，回传用），显示搜索状态 |
| `response.web_search_call.in_progress` / `.searching` | 状态 → searching |
| `response.web_search_call.completed` | 状态 → completed |

每条助手消息持久化字段：

```ts
interface StoredMessage {
  // ...
  webSearch?: {
    callId: string;      // web_search_call item id（回传必需）
    status: "searching" | "completed" | "failed";
    citations?: Citation[]; // 从 completed 事件/annotations 提取的引用
  };
}
```

> 重要：`callId` 必须持久化。Responses API 要求历史 `web_search_call` item **原样回传**（服务端自动恢复搜索结果），丢了 id 就无法构造合法历史。

## 4. 引用（Citations）呈现

- 模型输出 message 的 `content[].annotations` 数组中可能含 `url_citation` 类型注解（结构同 OpenAI Responses API）：

```jsonc
{ "type": "url_citation", "url": "https://...", "title": "..." }
```

- 渲染规则（仿 DeepSeek 网页端）：
  1. 回答正文中的 `[n]` 引用标记保留，渲染为可点击角标；
  2. 回答末尾渲染引用列表（来源标题 + 域名 + 序号），点击新标签页打开；
  3. 若 `annotations` 缺失（官方未承诺一定返回），引用区隐藏，仅保留正文角标样式。

## 5. 多轮回传规则（build-input.ts）

```
遍历历史消息时，若消息.webSearch?.callId 存在：
  在对应 assistant message item 之前插入：
    { type: "web_search_call", id: <callId> }   // 原样回传
```

服务端自动恢复搜索结果，无需回传搜索原始结果文本。

## 6. 与深度思考的交互

- 两者独立开关、可同时开启：搜索发生在思维链之后、正文之前（模型先思考后决定搜索）。
- UI 顺序：思考面板 → 搜索状态/引用区 → 正文。
- 带搜索的轮次（工具调用场景）**必须回传 reasoning item**，规则见 thinking.md 第 4 节。

## 7. 实现要点 Checklist

- [ ] build-request：联网开启 → `tools: [{type:"web_search"}]`
- [ ] build-input：web_search_call 原样回传（callId）
- [ ] 前端：WebSearchStatus 组件（searching 动画 / completed 引用区）
- [ ] annotations 解析 → citations 渲染（角标 + 来源列表）
- [ ] 单测：开启/关闭时 tools 字段；历史含 callId 时 input 中插入 web_search_call item
