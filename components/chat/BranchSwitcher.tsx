"use client";

import * as React from "react";
import { GitBranch } from "lucide-react";
import { useChatStore } from "@/lib/store/useChatStore";
import { cn } from "@/lib/utils";
import type { BranchInfo } from "@/components/chat/MessageList";

/**
 * 分支切换行（FR-12，docs/04-frontend/ui-design.md）：
 * 渲染在父消息（有多个子节点）下方，展示各分支摘要；点击切换到该分支。
 * memo：branches/pathIds 引用在拓扑不变时稳定（MessageList 保证），
 * 流式 delta 期间不重渲染。
 */
export const BranchSwitcher = React.memo(function BranchSwitcher({
  branches,
  pathIds,
}: {
  branches: BranchInfo[];
  pathIds: Set<string>;
}) {
  const switchBranch = useChatStore((s) => s.switchBranch);
  if (branches.length < 2) return null;

  return (
    <div className="mb-1 mt-0.5 flex flex-wrap items-center gap-1.5 pl-1 text-xs">
      <GitBranch className="size-3 shrink-0 text-muted-foreground" />
      {branches.map((b, i) => {
        const active = pathIds.has(b.id);
        const label = b.preview || `分支 ${i + 1}`;
        return (
          <button
            key={b.id}
            type="button"
            disabled={active}
            onClick={() => switchBranch(b.id)}
            title={active ? "当前分支" : `切换到「${label}」分支`}
            className={cn(
              "max-w-48 truncate rounded-full border px-2 py-0.5 transition-colors",
              active
                ? "cursor-default border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            aria-pressed={active}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
});
