"use client";

import * as React from "react";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChatStore } from "@/lib/store/useChatStore";
import { usePromptStore } from "@/lib/store/usePromptStore";
import { openSettings } from "@/lib/store/ui";
import { cn } from "@/lib/utils";

/**
 * System Prompt 选择器（docs/04-frontend/prompt-library.md 第 4.1 节）：
 * - 列出库中全部条目（内置徽标 + 2 行预览），点选即生效（空会话，无副作用）
 * - 底部「管理 System Prompt 库…」入口 → 打开设置对话框
 */
export function PromptSelectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const prompts = usePromptStore((s) => s.prompts);
  const getPrompt = usePromptStore((s) => s.getPrompt);
  const selectSystemPrompt = useChatStore((s) => s.selectSystemPrompt);
  const activeSession = useChatStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId)
  );

  const currentId = activeSession?.systemPromptId ?? "";

  const handleSelect = (id: string) => {
    selectSystemPrompt(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>选择 System Prompt</DialogTitle>
          <DialogDescription>
            仅在对话开始前可更换；发送第一条消息后将锁定
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[320px] space-y-1.5 overflow-y-auto py-1">
          {prompts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p.id)}
              className={cn(
                "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                p.id === currentId
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:bg-muted"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm font-medium">
                  {p.name}
                </span>
                {p.isBuiltin && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    内置
                  </span>
                )}
                {p.id === currentId && (
                  <Check className="size-3.5 shrink-0 text-primary" />
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {p.content}
              </p>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            openSettings();
          }}
          className="mt-1 w-full rounded-lg border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          管理 System Prompt 库…
        </button>
      </DialogContent>
    </Dialog>
  );
}
