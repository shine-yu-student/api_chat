"use client";

import * as React from "react";
import { Menu, Pencil } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChatStore } from "@/lib/store/useChatStore";
import { useSettingsStore } from "@/lib/store/useSettingsStore";
import { PromptBadge } from "@/components/prompt/PromptBadge";
import { MODELS } from "@/lib/deepseek/models";
import type { ModelId } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 顶栏（ui-design.md 组件树）：
 * - 居中 ModelSelect（Flash / Pro）
 * - 右侧会话标题（可点击重命名）
 * - PromptBadge 预留（阶段 6 System Prompt 库时渲染）
 */
export function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const activeSession = useChatStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId)
  );
  const setModel = useChatStore((s) => s.setModel);
  const renameSession = useChatStore((s) => s.renameSession);

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const model: ModelId =
    activeSession?.model ?? useSettingsStore.getState().defaultModel;

  const startEdit = () => {
    if (!activeSession) return;
    setDraft(activeSession.title);
    setEditing(true);
  };

  const commitEdit = () => {
    if (editing && activeSession && draft.trim()) {
      renameSession(activeSession.id, draft.trim());
    }
    setEditing(false);
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
      {/* 移动端：打开侧栏抽屉 */}
      <button
        type="button"
        onClick={onOpenSidebar}
        className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
        aria-label="打开侧边栏"
        title="打开侧边栏"
      >
        <Menu className="size-5" />
      </button>

      {/* 模型选择器（居中） */}
      <div className="flex flex-1 items-center justify-center">
        <Select
          value={model}
          onValueChange={(v) => setModel(v as ModelId)}
        >
          <SelectTrigger
            className="h-8 w-auto gap-1.5 border-transparent bg-transparent shadow-none hover:bg-muted focus-visible:ring-0 sm:w-[190px]"
            aria-label="选择模型"
          >
            <SelectValue placeholder="选择模型" />
          </SelectTrigger>
          <SelectContent align="center">
            {Object.values(MODELS).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
                {m.id === "deepseek-v4-pro" && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    （即将支持）
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 会话标题（可点击重命名）+ System Prompt 标识 */}
      <div className="flex items-center gap-2">
        {activeSession &&
          (editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-40 rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="重命名会话"
            />
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="group hidden max-w-56 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
              title="点击重命名"
            >
              <span className="truncate">{activeSession.title}</span>
              <Pencil className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
            </button>
          ))}
        <PromptBadge />
      </div>
    </header>
  );
}
