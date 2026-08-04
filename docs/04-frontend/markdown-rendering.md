# Markdown 渲染（Markdown Rendering）

> 定义助手消息正文的 Markdown 渲染方案：依赖选型、组件配置、流式性能与代码块交互。

## 1. 依赖选型（不重复造轮子）

| 依赖 | 版本 | 用途 |
|---|---|---|
| `react-markdown` | ^9 | 核心渲染器（不依赖 dangerouslySetInnerHTML，安全） |
| `remark-gfm` | ^4 | GFM 扩展：表格、删除线、任务列表、自动链接 |
| `rehype-highlight` | ^7 + `highlight.js` | 代码块语法高亮（轻量、零配置，common 语言集即可） |
| `remark-math` + `rehype-katex` + `katex` | ^6 / ^7 / ^0.16 | LaTeX 公式（DeepSeek 输出常含公式） |
| `katex` CSS | — | 公式样式 |

> 备选：如追求代码高亮观感与 DeepSeek 网页端一致（VS Code 风格），可换 `shiki`（`rehype-shiki`），代价是打包体积（可动态加载）。默认用 rehype-highlight，实现后对比再定。

## 2. 组件配置（lib/markdown/render.tsx）

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkMath]}
  rehypePlugins={[[rehypeHighlight, { detect: true }], rehypeKatex]}
  components={{
    code: CodeBlock,          // 自定义：行内 vs 块级
    a: Link,                  // 新标签页打开 + rel="noopener noreferrer"
    table: ({children}) => <div className="overflow-x-auto"><table>{children}</table></div>,
  }}
>
  {content}
</ReactMarkdown>
```

### CodeBlock 组件（关键自定义）

```tsx
function CodeBlock(props) {
  const { className, children } = props;
  const isInline = !className && !String(children).includes("\n");
  if (isInline) return <code className="inline-code">{children}</code>;

  const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "text";
  return (
    <div className="code-block">                    // 圆角 + 边框 + 暗底
      <div className="code-header">                 // 右上角：语言名 + 复制按钮
        <span>{lang}</span>
        <button onClick={() => navigator.clipboard.writeText(codeText)}>
          <Copy /> 复制
        </button>
      </div>
      <pre><code className={className}>{children}</code></pre>
    </div>
  );
}
```

- 复制用 `navigator.clipboard.writeText`（HTTPS/localhost 可用），成功短暂显示「已复制」。
- 代码块样式：`bg-[#F6F8FA]`（亮）/ `bg-[#282C34]`（暗）、等宽字体 `ui-monospace, SFMono-Regular, Menlo, Consolas`。

## 3. 安全

- react-markdown 默认不渲染原始 HTML（`rehype-raw` 不引入）——DeepSeek 输出偶含 HTML 标签时按文本展示，安全且够用。
- 链接统一新窗口打开并 `rel="noopener noreferrer"`。
- 图片：外部 URL 图片渲染（`<img>` 带懒加载）；本地/数据 URI 图片**不渲染**（避免 XSS 面，官方输入也不支持图片）。

## 4. 流式渲染性能（打字机效果）

目标：每 token 更新不卡顿，且避免「整块闪烁」。

### 方案：增量文本 + 稳定 key

```tsx
// MessageItem 内
const content = useChatStore(s => currentMessage(sessionId, msgId)?.content ?? "");
// 直接渲染 <Markdown content={content} />
```

- 每次 delta 更新 store → 重渲染 → react-markdown 全量解析当前文本。**实测在 15px 字号、数千 token 内，react-markdown 单次解析 < 10ms，可接受**（React 18 批处理 + 现代浏览器）。
- 若长文本（>8K token）出现卡顿，优化路径（按需启用）：
  1. **节流**：`output_text.delta` 合并为 16ms 帧（`requestAnimationFrame` 节流）；
  2. **增量 DOM**：仅追加文本节点（自研轻量渲染，破坏 Markdown 结构，不推荐）；
  3. 推荐 1：rAF 节流已足够，实现简单且不破坏 Markdown。

```ts
// lib/utils/throttle.ts
export function rAFThrottle<T>(fn: (v: T) => void) {
  let pending = false;
  return (v: T) => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(v); });
  };
}
```

- 滚动：内容更新时若用户未上翻则 `scrollIntoView` 到底（chat-state.md 第 4.5 节规则）。

## 5. 引用角标（与 web-search.md 联动）

- 正文中的 `[1]`、`[2]` 等引用标记保持原文渲染；
- 消息末尾引用列表区由 `MessageItem` 在 `message.webSearch.citations` 存在时渲染（不经过 Markdown）。

## 6. 实现要点 Checklist

- [ ] 安装依赖并配置 render.tsx
- [ ] CodeBlock（语言标签 + 复制 + 行内/块级区分）
- [ ] 公式渲染验证：`$...$` 与 `$$...$$`
- [ ] 长文本 rAF 节流（先不加，实测卡顿再加，保持 KISS）
- [ ] 单元测试（Vitest + @testing-library/react）：表格/代码块/公式/链接快照
