# 实现顺序（Implementation Order）

> 分阶段实现指南：每阶段有明确产出与验收标准，前一阶段验收通过再进入下一阶段。
> 全程遵循「不重复造轮子」：只写业务胶水代码，基础设施全部用文档列出的成熟库。

## 阶段 0：项目脚手架

- `npx create-next-app@latest .`（TypeScript + Tailwind + App Router + ESLint，App 名 `api_chat`）
- 安装依赖：`openai`、`zustand`、`idb`、`react-markdown`、`remark-gfm`、`rehype-highlight`、`highlight.js`、`remark-math`、`rehype-katex`、`katex`、`lucide-react`
- `npx shadcn@latest init` + 添加组件：`button` `dialog` `dropdown-menu` `select` `switch` `tooltip` `textarea` `scroll-area` `radio-group` `slider`
- 配置 `globals.css` 主题变量（ui-design.md 第 3.1 节）、`next.config.ts` CSP（security.md 第 4 节）
- `lib/types.ts` 全部类型（chat-state.md 第 1 节）

**验收**：`npm run dev` 启动，空白页正常渲染，`npm run build` 通过。

## 阶段 1：后端代理 + 最小流式对话（端到端打通）

- `lib/deepseek/sdk.ts`、`lib/deepseek/models.ts`（MODEL_SUPPORT）
- `app/api/chat/route.ts`（proxy-routes.md 完整实现）
- `lib/api/build-request.ts`（含 build-input 初版：仅 message items）
- `lib/api/client.ts`（streamChat + SSE 解析）
- 临时测试页：一个输入框 + 一个输出区，写死 API Key（env），验证流式

**验收**：
- [ ] curl 冒烟（testing.md 第 3 节）通过：流式事件完整到达，以 response.completed 收尾
- [ ] 多轮对话正确（连续两条消息，上下文一致）
- [ ] 停止按钮可中断（前端 abort → 上游取消）
- [ ] 401/402 错误按 JSON 错误协议返回

## 阶段 2：UI 骨架（仿 DeepSeek 布局）

- Sidebar（新对话/会话列表/用户菜单）、Topbar（模型选择器）、ChatView（欢迎视图 + 消息列表 + ChatInput）
- 组件按 ui-design.md 组件树拆分
- 纯 UI 交互（无真实请求）：新建/切换会话（内存态）、输入区开关交互

**验收**：桌面与移动端布局符合 ui-design.md；欢迎视图/对话视图切换正确。

## 阶段 3：对话闭环（store + 流式 UI）

- `useChatStore`（sendMessage 状态机 + 事件分发 + 停止/重试）
- MessageItem：思考面板（ReasoningPanel）、正文渲染（react-markdown 初版）、用量行
- 设置页第一版（API Key + 模型默认）

**验收**：
- [ ] 完整一轮对话：发送 → 思考流式 → 正文流式 → usage 显示
- [ ] 深度思考开关生效（reasoning.effort 变化在请求中可见；关闭时无思考面板）
- [ ] 未配置 Key 拦截引导；401 错误内联提示
- [ ] 停止/重试/失败保留已生成内容

## 阶段 4：联网搜索

- build-request 加 tools；build-input 回传 web_search_call（web-search.md）
- WebSearchStatus 组件（searching 动画 / 引用列表 + annotations 解析）

**验收**：开启联网搜索后提问时事性问题（如「今天北京天气」），可见搜索状态与引用；关闭后请求无 tools。

## 阶段 5：会话持久化

- `lib/storage/db.ts`（IndexedDB）+ settings.ts（localStorage）
- 启动恢复（loadAll）、删除/重命名/搜索会话、深色模式
- 长对话截断（truncate-history + token 估算）

**验收**：刷新后会话完整恢复；删除有确认；截断逻辑单测通过。

## 阶段 6：System Prompt 库（FR-11）

- `lib/prompts/builtin.ts`：BUILTIN_DEFAULT_PROMPT 常量；`lib/types.ts` 加 SystemPrompt 类型
- `lib/storage/db.ts`：prompts store（v1→v2）+ 旧版「自定义指令」一次性迁移（session-storage.md 第 4 节）
- `usePromptStore`（chat-state.md）；Settings 加 `defaultSystemPromptId`（废弃 `systemPrompt`）
- `PromptSelectDialog`（新会话选择器）、`PromptBadge`（锁定只读标识）、`PromptManager`（库 CRUD + 设为默认）
- sendMessage 冻结步骤 0（快照写入与首条 user 消息原子完成）与锁定规则（prompt-library.md 第 3 节）

**验收**：
- [ ] 新建会话默认选中内置基础 Prompt；空会话可随意更换；发送首条消息后选择器消失、只读标识出现
- [ ] 修改/删除库条目不影响已开始会话的 instructions（DevTools 网络面板核对请求前缀不变）
- [ ] 库 CRUD 正常；内置条目无编辑/删除入口；默认条目删除后回退内置
- [ ] 旧版自定义指令迁移（若有存量数据）与 FR-11 其余验收标准全部通过

## 阶段 7：缓存优化与用量展示

- 用量行完整化：`输入 X（缓存命中 Y%）· 输出 Z · 思考 W`
- 按 context-cache.md 第 3 节审查 build-input（前缀稳定性规则注释）
- 手工验证缓存命中（testing.md 第 5 节）

**验收**：连续 3 轮对话后命中率 > 90%（flash 模型）。

## 阶段 8：Markdown 完善与打磨

- CodeBlock（语言标签 + 复制）、公式、表格、链接安全
- 长文本 rAF 节流（如实测卡顿）
- 欢迎页推荐卡片、移动端抽屉、主题切换、加载/空态细节
- 设置页完整（强度选择、温度、默认 System Prompt 选择、清除数据）

**验收**：testing.md 第 2 节全部手工用例通过。

## 阶段 9：收尾

- 自动化测试补充（testing.md 第 4 节）、security.md 第 6 节核查项全部执行
- `npm run build` + 生产模式冒烟（`npm run start`）
- 清理临时测试页与调试代码

**验收**：全部测试清单通过，无 TODO/FIXME 遗留。

## 各阶段依赖关系

```
阶段0 → 阶段1 → 阶段3 → 阶段4 → 阶段5 → 阶段6(SP库) → 阶段7(缓存) → 阶段8(打磨)
            ↘ 阶段2 ↗（阶段2 可并行于 1/3）
阶段9（收尾）
```

> 原则：先打通最小端到端（1），再铺 UI（2），再闭环（3），再逐个功能叠加（4~7），最后打磨收尾（8）。
