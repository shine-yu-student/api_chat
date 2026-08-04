"use client";

import * as React from "react";
import { BookOpenText } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PromptSelectDialog } from "@/components/prompt/PromptSelectDialog";
import { useChatStore } from "@/lib/store/useChatStore";
import { usePromptStore } from "@/lib/store/usePromptStore";
import { cn } from "@/lib/utils";

/**
 * 顶栏 System Prompt 标识（docs/04-frontend/prompt-library.md 第 4.2 节、ui-design.md 4.8）：
 * - 空会话（未锁定）：可点击胶囊 → 打开 PromptSelectDialog 更换
 * - 已锁定（有 user 消息）：只读胶囊，tooltip 展示全文
 */
export function PromptBadge() {
  const [selectOpen, setSelectOpen] = React.useState(false);
  const session = useChatStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId)
  );
  const getPrompt = usePromptStore((s) => s.getPrompt);

  if (!session) return null;

  const locked = session.messages.some((m) => m.role === "user");
  const prompt = getPrompt(session.systemPromptId);
  const name = prompt?.name ?? "自定义";

  if (locked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="hidden max-w-40 cursor-default items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground select-none sm:flex">
            <BookOpenText className="size-3.5 shrink-0" />
            <span className="truncate">{name}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm">
          <p className="mb-1 font-medium">System Prompt（已锁定）</p>
          <p className="text-xs leading-relaxed whitespace-pre-wrap">
            {session.systemPromptText}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setSelectOpen(true)}
        className={cn(
          "hidden max-w-40 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs transition-colors sm:flex",
          "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
        title="更换 System Prompt"
      >
        <BookOpenText className="size-3.5 shrink-0" />
        <span className="truncate">{name}</span>
      </button>
      <PromptSelectDialog open={selectOpen} onOpenChange={setSelectOpen} />
    </>
  );
}
