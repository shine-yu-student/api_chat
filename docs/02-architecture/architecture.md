# 架构设计（Architecture）

## 1. 总体架构

三层结构，浏览器直连自有 Next.js 代理，代理转发 DeepSeek API：

```
┌───────────────────────┐         ┌──────────────────────────┐         ┌──────────────────────┐
│  浏览器（Next.js 前端） │  fetch  │ Next.js Route Handler    │  openai SDK  │  DeepSeek API         │
│  React 19 + zustand   │ ──────▶ │  POST /api/chat (SSE)    │ ──────────▶ │  https://api.deepseek. │
│  IndexedDB/localStorage│ ◀────── │  Node.js runtime         │ ◀────────── │  com/v1/responses      │
└───────────────────────┘   SSE   └──────────────────────────┘             └──────────────────────┘
```

- **前端**：负责 UI、会话状态、流式渲染、设置与本地持久化。API Key 从 localStorage 读取，随请求头发给自有代理。
- **后端代理**：单一端点 `POST /api/chat`，接收前端构造好的完整请求参数 + API Key，用 openai SDK 调用 Responses API（`stream: true`），将 SSE 事件流原样转发回前端。代理不解析、不落盘、不打日志。
- **DeepSeek**：无状态 API，每次请求携带完整上下文（input items）。

> **为什么需要代理？**
> 1. 避免浏览器 CORS 直连问题；
> 2. API Key 不暴露在浏览器到第三方网络的请求中；
> 3. 统一错误处理与超时/取消控制；
> 4. 后续可平滑加限流、统计等能力。

## 2. 核心请求数据流（一次对话轮次）

```
1. 用户在输入框输入文字，点击发送（或 Ctrl+Enter）
2. 前端校验：API Key 已配置？模型可用？→ 构造请求
3. 前端构造请求体（见 03-api-integration/responses-api.md）：
   { apiKey, model, instructions, input: [...items], stream: true,
     reasoning: {effort}, tools?: [{type:"web_search"}], temperature? }
4. fetch POST /api/chat，携带 AbortSignal
5. 后端用 openai SDK client.responses.create({...}, stream: true)
6. 后端将上游 SSE 事件流逐条转发（保持事件对象原样，见 streaming.md）
7. 前端按事件类型增量更新 UI：
   - reasoning_text.delta → 思考面板
   - output_text.delta → 回答正文
   - web_search_call.* → 搜索状态
   - completed → 收尾，读取 usage 更新用量统计
8. 轮次结束：将最终 items（assistant message / web_search_call / usage）写入会话存储
```

## 3. 目录结构（目标态）

```
api_chat/
├── docs/                          # 本文档（实现依据）
├── app/
│   ├── layout.tsx                 # 根布局（字体、主题）
│   ├── page.tsx                   # 主页（聊天界面，客户端组件）
│   ├── globals.css                # Tailwind 入口 + 主题变量
│   └── api/
│       └── chat/route.ts          # POST /api/chat SSE 代理（唯一后端端点）
├── components/
│   ├── sidebar/                   # Sidebar, NewChatButton, ConversationList, UserMenu
│   ├── chat/                      # ChatView, MessageList, MessageItem, WelcomeView,
│   │                              # ReasoningPanel, WebSearchStatus, Markdown, CodeBlock
│   ├── input/                     # ChatInput, ThinkingToggle, WebSearchToggle, SendButton
│   ├── settings/                  # SettingsDialog, ApiKeyField, ModelSelect, EffortSelect
│   └── ui/                        # shadcn/ui 组件（button, dialog, dropdown-menu,
│                                  #   select, switch, tooltip, textarea, scroll-area）
├── lib/
│   ├── types.ts                   # 全部共享类型（见 04-frontend/chat-state.md）
│   ├── api/
│   │   ├── client.ts              # 前端 fetch 封装（含 SSE 解析，见 streaming.md）
│   │   └── build-request.ts       # 请求体构造（纯函数，可单测）
│   ├── deepseek/
│   │   ├── sdk.ts                 # 后端 openai SDK 客户端初始化
│   │   ├── proxy.ts               # 代理转发核心（事件透传、超时、取消）
│   │   └── models.ts              # MODEL_SUPPORT 开关表、模型常量
│   ├── store/
│   │   ├── useChatStore.ts        # zustand：会话/消息/流式状态
│   │   └── useSettingsStore.ts    # zustand + localStorage 持久化：设置
│   ├── storage/
│   │   ├── db.ts                  # IndexedDB 封装（idb）
│   │   └── settings.ts            # localStorage 读写
│   ├── markdown/
│   │   └── render.tsx             # Markdown 渲染配置（react-markdown 等）
│   ├── prompts/
│   │   └── builtin.ts             # BUILTIN_DEFAULT_PROMPT 内置基础 System Prompt 常量（FR-11）
│   └── utils.ts                   # 工具函数（token 估算、时间格式化等）
└── types/ 或直接在 lib/types.ts 中
```

## 4. 技术选型与依赖清单

### 运行时与框架

| 依赖 | 版本建议 | 用途 |
|---|---|---|
| `next` | 15.x | App Router、Route Handler |
| `react` / `react-dom` | 19.x | UI |
| `typescript` | 5.x | 类型安全（strict） |
| `tailwindcss` + `postcss` + `autoprefixer` | 4.x | 样式（shadcn/ui 兼容 v4） |
| `openai` | 最新（≥5.x，支持 Responses API） | 后端 API 客户端 |

### UI 与渲染

| 依赖 | 用途 |
|---|---|
| `shadcn/ui`（含 `radix-ui/*`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react` 图标） | 按钮/对话框/下拉/开关等基础组件 |
| `zustand` | 全局状态 |
| `react-markdown` + `remark-gfm` | Markdown + GFM 表格 |
| `rehype-highlight` + `highlight.js`（CSS 主题） | 代码高亮（轻量）；如追求极致可换 `shiki`（见 markdown-rendering.md） |
| `remark-math` + `rehype-katex` + `katex` | LaTeX 公式 |
| `idb` | IndexedDB Promise 封装 |
| `eventsource-parser`（可选） | SSE 解析（若不自写解析器） |

### 明确不引入

- 不用 `socket.io` / WebSocket（SSE 足够且实现简单）
- 不用重型 UI 框架（Ant Design 等），shadcn/ui 足够且更贴合 DeepSeek 简洁风格
- 不用后端数据库 / ORM（无服务端存储需求）

## 5. 关键设计原则

1. **请求构造与事件解析必须是纯函数**（`build-request.ts`、`parse-sse.ts`），便于单元测试，这是测试文档的基础。
2. **后端代理无状态**：不做任何缓存、不存储任何用户数据，所有状态（Key、历史）都在浏览器。
3. **事件透传而非重新建模**：后端把 DeepSeek 的 SSE 事件对象原样转发，前端统一在 `parse-sse.ts` 中建模，避免两处维护协议。
4. **前缀稳定**：任何会改变请求前缀的功能（改 System Prompt 快照、插消息、重排）都必须经过 context-cache.md 的规则审查。System Prompt 采用「会话级快照 + 首条消息锁定」（FR-11，见 prompt-library.md）：锁定后 instructions 恒冻结，把前缀失效面收敛到单个新会话。
5. **模型可用性开关集中管理**：`lib/deepseek/models.ts` 中的 `MODEL_SUPPORT` 是唯一判定点，避免散落判断。

## 6. 运行时与部署

- 后端 Route Handler 使用 **Node.js runtime**（`export const runtime = "nodejs"`），openai SDK 需要 Node 环境；若部署平台限制可改用 `fetch` 直连（见 proxy-routes.md 备选方案）。
- 开发：`npm run dev`（默认 3000 端口）。
- 部署：`next build && next start`；或 Vercel（Node runtime 兼容）。
- 环境变量：无必填项（API Key 由用户在设置页输入）；可预留 `DEEPSEEK_BASE_URL` 覆盖测试环境。

## 7. 架构决策记录（ADR 摘要）

| 决策 | 备选 | 结论原因 |
|---|---|---|
| 无状态代理 + 全量上下文 | 服务端维护会话（previous_response_id） | DeepSeek Responses API 不支持服务端会话，客户端全量发送是唯一正确姿势，且天然利于前缀缓存 |
| SSE 透传 | 后端解析后重发自定义事件 | 透传零损耗、协议单一；前端有唯一解析层 |
| IndexedDB 存会话 | localStorage 全存 | 会话消息量大，localStorage 5MB 上限不够；设置这类小数据用 localStorage |
| 前端发 Key 给代理 | Key 仅存后端 .env | 产品需求是「用户给出 API Key」，多用户自备 Key 场景 |
