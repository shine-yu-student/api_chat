"use client";

import * as React from "react";
import { BookOpenText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PromptSelectDialog } from "@/components/prompt/PromptSelectDialog";
import { useChatStore } from "@/lib/store/useChatStore";
import { usePromptStore } from "@/lib/store/usePromptStore";
import { cn } from "@/lib/utils";

/**
 * 顶栏 System Prompt 标识（docs/04-frontend/prompt-library.md 第 4.2 节、ui-design.md 4.8）：
 * - 空会话（未锁定）：可点击胶囊 → 打开 PromptSelectDialog 更换
 * - 已锁定（有 user 消息）：只读胶囊，点击弹出居中对话框展示 System Prompt 全文（可滚动）
 */
export function PromptBadge() {
  const [selectOpen, setSelectOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
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
      <>
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className={cn(
            "hidden max-w-40 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground select-none transition-colors sm:flex",
            "hover:bg-muted hover:text-foreground"
          )}
          title="查看 System Prompt"
        >
          <BookOpenText className="size-3.5 shrink-0" />
          <span className="truncate">{name}</span>
        </button>

        {/* System Prompt 全文（居中对话框，可滚动，跟随主题；prompt-library.md 4.2） */}
        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>System Prompt（已锁定）</DialogTitle>
              <DialogDescription>{name}</DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {session.systemPromptText}
            </div>
          </DialogContent>
        </Dialog>
      </>
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
