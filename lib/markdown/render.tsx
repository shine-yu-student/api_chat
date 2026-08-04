"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import type { ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";

/**
 * Markdown 渲染（docs/04-frontend/markdown-rendering.md）
 * - react-markdown + remarkGfm + remarkMath + rehypeHighlight({detect:true}) + rehypeKatex
 * - code：行内 → inline-code；块级 → .code-block（语言标签 + 复制）
 * - a：新标签页 + rel="noopener noreferrer"
 * - table：外包 overflow-x-auto
 * - 不引入 rehype-raw（原始 HTML 按文本展示，安全）
 */

/** 高亮样式修正 + 深色模式覆盖（globals.css 不可改，这里以全局 <style> 补充） */
const hljsStyles = `
pre code.hljs { background: transparent; padding: 0; }
.inline-code.hljs { background: var(--muted); }
.dark .hljs { color: #c9d1d9; }
.dark .hljs-comment, .dark .hljs-quote, .dark .hljs-meta { color: #8b949e; }
.dark .hljs-keyword, .dark .hljs-selector-tag, .dark .hljs-doctag, .dark .hljs-template-tag, .dark .hljs-name { color: #ff7b72; }
.dark .hljs-string, .dark .hljs-regexp, .dark .hljs-addition, .dark .hljs-attr, .dark .hljs-attribute { color: #a5d6ff; }
.dark .hljs-title, .dark .hljs-title.class_, .dark .hljs-title.function_, .dark .hljs-section { color: #d2a8ff; }
.dark .hljs-number, .dark .hljs-literal, .dark .hljs-symbol, .dark .hljs-bullet { color: #79c0ff; }
.dark .hljs-variable, .dark .hljs-template-variable, .dark .hljs-type, .dark .hljs-built_in, .dark .hljs-builtin-name, .dark .hljs-params { color: #ffa657; }
.dark .hljs-emphasis { font-style: italic; }
.dark .hljs-strong { font-weight: 600; }
`;

type CodeProps = React.ComponentPropsWithoutRef<"code"> & ExtraProps;

/** 代码渲染：行内 vs 块级（markdown-rendering.md 第 2 节） */
function CodeBlock({ className, children, ...rest }: CodeProps) {
  const [copied, setCopied] = React.useState(false);
  const text = String(children ?? "").replace(/\n$/, "");

  // 行内：无语言类且无换行
  const isInline = !className && !text.includes("\n");
  if (isInline) {
    return <code className="inline-code">{children}</code>;
  }

  const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "text";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard 不可用时静默失败
    }
  };

  return (
    <div className="code-block my-3">
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        <span>{lang}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 transition-colors hover:bg-background hover:text-foreground"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check className="size-3.5" /> 已复制
            </>
          ) : (
            <>
              <Copy className="size-3.5" /> 复制
            </>
          )}
        </button>
      </div>
      <pre className="!rounded-t-none">
        <code className={className} {...rest}>
          {children}
        </code>
      </pre>
    </div>
  );
}

/** 链接：新标签页 + 安全 rel */
function Link({
  href,
  children,
  ...rest
}: React.ComponentPropsWithoutRef<"a">) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
      {...rest}
    >
      {children}
    </a>
  );
}

/** 表格：外包横向滚动容器 */
function TableWrapper({
  children,
  ...rest
}: React.ComponentPropsWithoutRef<"table">) {
  return (
    <div className="my-3 overflow-x-auto">
      <table
        className="w-full border-collapse border border-border text-sm"
        {...rest}
      >
        {children}
      </table>
    </div>
  );
}

/** 图片：仅渲染外部 http(s) URL（本地/数据 URI 不渲染，markdown-rendering.md 第 3 节） */
function SafeImage({
  src,
  alt,
  ...rest
}: React.ComponentPropsWithoutRef<"img">) {
  if (typeof src === "string" && !/^https?:\/\//i.test(src)) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt ?? ""} loading="lazy" className="my-2 max-w-full rounded-lg" {...rest} />;
}

export interface MarkdownProps {
  content: string;
  className?: string;
}

/** 助手消息正文 Markdown 渲染入口 */
export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn("min-w-0 text-[15px] leading-[1.7]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeHighlight, { detect: true }],
          rehypeKatex,
        ]}
        components={{
          code: CodeBlock,
          a: Link,
          table: TableWrapper,
          img: SafeImage,
        }}
      >
        {content}
      </ReactMarkdown>
      <style>{hljsStyles}</style>
    </div>
  );
}

export default Markdown;
