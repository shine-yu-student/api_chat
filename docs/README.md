# DeepSeek 网页版对话应用 — 实现文档

本目录是「仿 DeepSeek 网页端对话界面、基于 DeepSeek Responses API 的网页对话应用」的完整实现文档。
**当前阶段只写文档、不写代码**，本文档是后续实现的唯一参考，实现时应严格按本文档执行。

## 1. 项目目标

在 `/home/rshine/api_chat` 下构建一个网页应用：

- 界面整体设计与 DeepSeek 网页端（https://chat.deepseek.com）类似；
- 允许用户选择 **DeepSeek-V4 Flash** 或 **DeepSeek-V4 Pro** 模型；
- 包含设置界面，让用户输入自己的 **API Key**；
- 基于 **OpenAI Responses API**（DeepSeek 官方支持，base_url 为 `https://api.deepseek.com`）；
- 支持**深度思考**开关与**联网搜索**开关（联网搜索使用 Responses API 服务端 `web_search` 工具）；
- 充分利用 DeepSeek 的**上下文前缀缓存**（硬盘缓存）机制降低成本；
- 不重复造轮子：UI 组件、Markdown 渲染、SSE 解析、状态管理等均借用成熟开源库。

## 2. 已确认的技术决策

| 决策项 | 结论 | 理由 |
|---|---|---|
| 技术栈 | **Next.js 15（App Router）+ React 19 + TypeScript + Tailwind CSS** | 单仓库全栈，Route Handler 天然支持 SSE 流式代理，生态成熟 |
| UI 组件 | **shadcn/ui**（基于 Tailwind 与 Radix） | 可直接借用的高质量无头组件 |
| API 客户端 | **openai npm SDK**（官方，支持 Responses API） | 官方维护，`client.responses.create()` 一行调用 |
| Markdown 渲染 | **react-markdown + remark-gfm + rehype-highlight（或 shiki）+ KaTeX** | 成熟组合，支持 GFM 表格、代码高亮、公式 |
| 状态管理 | **zustand**（轻量） | 对话流式更新场景友好，避免 Provider 嵌套 |
| SSE 前端解析 | **原生 fetch + ReadableStream**（自行封装 ~80 行）或 `eventsource-parser` | 事件格式简单，两者皆可，文档给出推荐实现 |
| 会话/消息持久化 | **IndexedDB（通过 `idb` 库）** 存会话与消息，**localStorage** 存设置 | 会话数据量可能超 localStorage 5MB 上限 |
| API Key | 用户输入 → **localStorage** 持久保存 → 每次请求经**自有后端代理**转发给 DeepSeek | 后端代理不落盘 Key，浏览器不直连第三方 |
| 后端代理 | Next.js Route Handler `POST /api/chat`（Node.js runtime） | 隐藏 Key、统一错误处理、SSE 转发 |
| 模型 ID | `deepseek-v4-flash` / `deepseek-v4-pro` | 官方模型 ID，见官方「模型 & 价格」页 |

## 3. 重要外部事实（官方文档核实，2026-07）

> ⚠️ 以下事实直接决定实现细节，实现前请再次核对 [官方文档](https://api-docs.deepseek.com/zh-cn/)。

1. **Responses API 目前仅支持 `deepseek-v4-flash`，暂不支持 `deepseek-v4-pro`**（官方称 2026 年 8 月初增加支持）。
   实现策略：UI 两个模型都可选；后端对 Pro 模型在 Responses API 不支持期间，返回明确的「暂不支持」错误提示，并在代码中预留 `MODEL_SUPPORT` 开关表，官方开放后只需改一行配置。
2. **Responses API 是无状态 API**：`previous_response_id`、`conversation`、`store` 均不支持，多轮对话必须由客户端**自行维护完整 input items 列表**，每次请求全量发送。
3. **上下文缓存自动管理**：`prompt_cache_key` / `prompt_cache_retention` 不支持；命中情况通过响应 `usage.input_tokens_details.cached_tokens` 观察。**客户端的缓存优化手段只有一种：保持请求前缀稳定不变**。
4. **思考模式（深度思考）**：Responses API 格式通过 `reasoning: {"effort": "none"}` 关闭、`{"effort": "low|high|max"}` 开启；思考模式下 `temperature`/`top_p` 不生效。
5. **联网搜索**：`tools: [{"type": "web_search"}]`，服务端执行，流式事件为 `response.web_search_call.*`。
6. **流式响应没有 `data: [DONE]`**，以 `response.completed` / `response.incomplete` / `response.failed` 收尾。
7. 输入超出上下文窗口（1M tokens）时返回 **400**（`truncation` 参数不支持）。

## 4. 文档目录导航

```
docs/
├── README.md                      # 本文档：总览 + 决策 + 事实 + 索引
├── 01-requirements/
│   └── requirements.md            # 功能/非功能需求规格（验收标准）
├── 02-architecture/
│   └── architecture.md            # 总体架构、请求数据流、目录结构、依赖清单
├── 03-api-integration/            # DeepSeek Responses API 集成（核心）
│   ├── responses-api.md           # API 端点、请求/响应结构、兼容性明细
│   ├── streaming.md               # SSE 流式事件全表 + 前后端流式链路设计
│   ├── thinking.md                # 深度思考开关与 reasoning 处理
│   ├── web-search.md              # 联网搜索工具与状态呈现
│   ├── context-cache.md           # 前缀缓存机制与利用策略
│   └── error-handling.md          # 错误码、流式失败、重试与降级
├── 04-frontend/                   # 前端设计
│   ├── ui-design.md               # 仿 DeepSeek 网页端界面（布局/组件树/交互/配色）
│   ├── chat-state.md              # 对话状态模型与流式更新流程
│   ├── markdown-rendering.md      # Markdown/代码块/公式渲染与流式性能
│   ├── prompt-library.md          # System Prompt 库：会话级快照、锁定规则、库管理（FR-11）
│   └── settings.md                # 设置界面与 API Key 管理
├── 05-backend/                    # 后端代理
│   ├── proxy-routes.md            # /api/chat 代理端点设计与 SSE 转发实现
│   └── security.md                # API Key 安全边界、日志与速率限制
├── 06-storage/
│   └── session-storage.md         # 会话/消息持久化（IndexedDB）与设置存储（localStorage）
└── 07-implementation/
    ├── implementation-order.md    # 分阶段实现顺序（每阶段的验收标准）
    └── testing.md                 # 手工测试清单与自动化测试方案
```

阅读顺序建议：`01-requirements` → `02-architecture` → `03-api-integration/*`（核心）→ `04-frontend/*` → `05-backend/*` → `06-storage` → `07-implementation/*`。

## 5. 各模块文档要点速览

| 模块 | 关键产出 |
|---|---|
| 01-requirements | 15 项功能需求 + 7 项非功能需求，每条带验收标准 |
| 02-architecture | 三层结构（前端 → 代理 → DeepSeek）、SSE 数据流图、TypeScript 依赖清单 |
| 03-api-integration | 完整请求体构造规则、事件表、思考/联网/缓存的参数映射与边界 |
| 04-frontend | 组件树、zustand store 结构、流式 UI 更新协议、设置页表单、System Prompt 库（FR-11） |
| 05-backend | Route Handler 完整实现思路、超时/取消/错误透传 |
| 06-storage | IndexedDB schema 与迁移策略、localStorage 设置 schema |
| 07-implementation | 8 个实现阶段 + 每阶段验收清单、端到端手工测试清单 |
