## 背景

项目为 Next.js 15 + zustand 的 DeepSeek 对话应用，实现以 `docs/` 为唯一依据，**先更新文档、再实现、后测试**。

本次两项 UI 改动：

**A. System Prompt 全文展示改为居中对话框**
- 现状：锁定态顶栏胶囊用 Radix Tooltip（`bg-foreground text-background` 反色，暗色模式下即"白色浮窗"）悬浮展示全文，长文体验差、与主题不搭。
- 目标：改为点击胶囊 → 浏览器中央弹出 Dialog 显示全文（可滚动、跟随主题）。

**B. 输入框显示上下文大小 + 悬浮用量详情**
- 在输入区右下角发送/停止按钮左侧显示「上下文 1.2K」。
- 悬浮（hover）时弹出**与主题匹配**的浮窗（`bg-background + border-border`，非反色 Tooltip），展示**上一轮真实用量**：缓存输入、非缓存输入、输出、思考、缓存率。
- 已确认口径：主显示 = **本地估算**（`estimateTokens` 对当前路径消息 + System Prompt 快照求和，含 instructions，与发送前截断预算口径一致）；格式 = **K 缩写**（如 1.2K）。

---

## 第一步：文档更新

1. **docs/04-frontend/prompt-library.md**
   - 第 3 节生命周期「锁定」行：`tooltip 可查看全文` → `点击名称弹窗查看全文`。
   - 第 4.2 节「锁定标识」：改为「点击胶囊在居中对话框展示全文（可滚动，跟随主题）」，去掉 tooltip 描述。

2. **docs/04-frontend/ui-design.md**
   - 4.9「已锁定」行：`点击 tooltip 展示全文` → `点击弹出居中对话框展示全文（可滚动，跟随主题）`。
   - 组件树：ChatInput 子组件新增「上下文大小标签」（发送按钮左侧，悬浮显示上一轮用量）。
   - 4.1 输入区新增一条交互规范：发送按钮左侧显示当前对话上下文大小（本地估算、K 缩写）；悬浮浮窗跟随主题，展示上一轮缓存输入/非缓存输入/输出/思考/缓存率；无上一轮数据时显示占位。

3. **docs/07-implementation/testing.md**
   - 单元测试清单补充：`formatTokenCount`（<1000 原数、1000→1K、1234→1.2K、0→0）。

---

## 第二步：代码实现

### 功能 A：PromptBadge 弹窗

4. **components/prompt/PromptBadge.tsx**
   - 锁定态：`Tooltip/TooltipTrigger/TooltipContent` 替换为 `<button onClick={() => setDetailOpen(true)}>`（胶囊样式不变，加 `cursor-pointer`）+ 受控 `<Dialog>`。
   - Dialog 内容：`DialogHeader`（标题「System Prompt（已锁定）」+ 名称描述）→ 内容区 `<div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap">` 显示 `session.systemPromptText`（沿用 PromptSelectDialog 的滚动写法）。
   - 空会话态（PromptSelectDialog）保持不变；组件 docblock 注释同步更新。
   - 不删除 Tooltip 组件（B 功能仍使用）。

### 功能 B：上下文大小 + 悬浮详情

5. **lib/utils.ts**：新增 `formatTokenCount(n)` —— `<1000` 原样、`≥1000` 输出 `(n/1000).toFixed(1)` 去尾 `.0` + `K`（0→"0"、1000→"1K"、1234→"1.2K"）。

6. **components/chat/ChatInput.tsx**
   - 新增订阅：`activeSession`（`useChatStore`）、`getPathMessages`、`estimateTokens`、`formatTokenCount`、`Tooltip`。
   - `useMemo` 计算：
     - `contextTokens` = `Σ estimateTokens(路径消息 content + reasoning) + estimateTokens(systemPromptText)`。
     - `lastAssistant` = 路径中最后一条 assistant 消息（其 `usage` 即"上一轮真实用量"；可能为 `undefined`）。
   - JSX：将发送/停止按钮包进右侧 `<div className="flex items-center gap-2">`，其左侧放上下文标签：
     - 标签：`<button className="text-xs text-muted-foreground ...">上下文 {formatTokenCount(contextTokens)}</button>`（`cursor-default`）。
     - 悬浮：`<TooltipContent side="top" className="bg-background text-foreground border border-border shadow-lg">`（覆盖默认反色，主题匹配）：
       - 有 usage：标题「上一轮用量」+ 行：缓存输入、非缓存输入（= inputTokens − cachedTokens）、输出、思考、缓存率（沿用 UsageLine 的 `inputTokens>0 ? round(cached/input*100) : 0` 公式）。
       - 无 usage：占位「暂无上一轮用量数据」。
   - 空会话（无消息）时上下文标签仍显示（= System Prompt 快照估算）。

---

## 第三步：测试与验证

7. **tests/token-estimate.test.ts**（或新增 `tests/format-token-count.test.ts`）：`formatTokenCount` 边界用例。
8. **tests/tooltip-render.test.ts**：断言保持（锁定态渲染 Topbar 不抛错），更新测试名/描述（PromptBadge 不再使用 Tooltip，改验渲染含 Dialog 结构）。
9. 运行 `npm test`、`npx tsc --noEmit`、`npm run build` 全部通过。

---

## 涉及文件汇总

- 文档：`docs/04-frontend/prompt-library.md`、`docs/04-frontend/ui-design.md`、`docs/07-implementation/testing.md`
- 代码：`lib/utils.ts`、`components/prompt/PromptBadge.tsx`、`components/chat/ChatInput.tsx`
- 测试：`tests/token-estimate.test.ts`（或新文件）、`tests/tooltip-render.test.ts`

## 风险与边界

- 浮窗跟随主题：B 功能用 Radix Tooltip + 覆盖 className（`bg-background text-foreground border-border`），TooltipProvider 已全局包裹（layout.tsx），无需新增 Provider。
- 上一轮 `usage` 可能缺失（失败/停止/context_too_long 重试后），浮窗做占位处理，不崩溃。
- 上下文大小为本地估算（非真实 API 计数），与截断预算同口径，文档注明。
- PromptBadge 移除 Tooltip 后既有 tooltip-render 测试逻辑仍通过（它断言渲染不抛错），仅更新描述。