"use client";

import * as React from "react";
import { Brain, ChevronDown } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";

/**
 * 深度思考面板（ui-design.md 2.1 / 4.5）：
 * - 流式中：展开显示实时思维链
 * - 完成后：折叠为一行「已深度思考（X.X 秒）」，点击展开全文
 */
export function ReasoningPanel({
  content,
  elapsedMs,
  isStreaming,
}: {
  content: string;
  elapsedMs?: number;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = React.useState(true);

  // 流式期间保持展开
  React.useEffect(() => {
    if (isStreaming) setExpanded(true);
  }, [isStreaming]);

  if (isStreaming) {
    return (
      <div className="mb-2 overflow-hidden rounded-lg bg-reasoning-bg">
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
          <Brain className="size-3.5" />
          深度思考中
        </div>
        <div className="px-3 pb-3 text-[13px] leading-[1.7] text-muted-foreground">
          {content}
          <span className="cursor-blink" aria-hidden>
            ▍
          </span>
        </div>
      </div>
    );
  }

  // 完成后：默认折叠为一行
  const summary = `已深度思考（${formatDuration(elapsedMs ?? 0)}）`;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mb-2 flex items-center gap-1.5 rounded-lg bg-reasoning-bg px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain className="size-3.5" />
        {summary}
        <ChevronDown className="size-3.5" />
      </button>
    );
  }

  return (
    <div className="mb-2 overflow-hidden rounded-lg bg-reasoning-bg">
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className={cn(
          "flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        )}
      >
        <Brain className="size-3.5" />
        {summary}
        <ChevronDown className="ml-auto size-3.5 rotate-180 transition-transform" />
      </button>
      <div className="border-t border-border/50 px-3 pb-3 pt-2 text-[13px] leading-[1.7] text-muted-foreground">
        {content}
      </div>
    </div>
  );
}
