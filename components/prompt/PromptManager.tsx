"use client";

import * as React from "react";
import { Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePromptStore } from "@/lib/store/usePromptStore";
import { useSettingsStore } from "@/lib/store/useSettingsStore";
import type { SystemPrompt } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * System Prompt 库管理（docs/04-frontend/prompt-library.md 第 4.3 节）：
 * - 列表：内置恒置顶（无编辑/删除）、自定义按 updatedAt 倒序
 * - 新建/编辑：内联展开表单（名称 + 内容）
 * - 删除：二次确认（window.confirm）；内置禁止
 * - 设为默认：写入 settings.defaultSystemPromptId
 */
export function PromptManager() {
  const prompts = usePromptStore((s) => s.prompts);
  const createPrompt = usePromptStore((s) => s.createPrompt);
  const updatePrompt = usePromptStore((s) => s.updatePrompt);
  const deletePrompt = usePromptStore((s) => s.deletePrompt);
  const defaultId = useSettingsStore((s) => s.defaultSystemPromptId);
  const setDefaultSystemPromptId = useSettingsStore(
    (s) => s.setDefaultSystemPromptId
  );

  // 编辑态：null = 未编辑；{id:null} = 新建；{id} = 编辑既有
  const [editing, setEditing] = React.useState<{ id: string | null } | null>(
    null
  );
  const [name, setName] = React.useState("");
  const [content, setContent] = React.useState("");

  const startCreate = () => {
    setName("");
    setContent("");
    setEditing({ id: null });
  };

  const startEdit = (p: SystemPrompt) => {
    setName(p.name);
    setContent(p.content);
    setEditing({ id: p.id });
  };

  const cancelEdit = () => setEditing(null);

  const save = async () => {
    if (!name.trim() || !content.trim()) return;
    try {
      if (editing?.id === null) {
        await createPrompt(name, content);
      } else if (editing?.id) {
        await updatePrompt(editing.id, name, content);
      }
      setEditing(null);
    } catch {
      // 写入失败：保留编辑态供重试
    }
  };

  const handleDelete = async (p: SystemPrompt) => {
    if (!window.confirm(`确定删除 System Prompt「${p.name}」？`)) return;
    try {
      await deletePrompt(p.id);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-2">
      {/* 列表 */}
      <div className="max-h-52 space-y-1.5 overflow-y-auto">
        {prompts.map((p) => (
          <div
            key={p.id}
            className="group rounded-lg border border-border px-3 py-2"
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
              {defaultId === p.id && (
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
              )}
              {!p.isBuiltin && (
                <span className="hidden items-center gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={`编辑 ${p.name}`}
                    title="编辑"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(p)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                    aria-label={`删除 ${p.name}`}
                    title="删除"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              )}
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {p.content}
            </p>
            {!p.isBuiltin && defaultId !== p.id && (
              <button
                type="button"
                onClick={() => setDefaultSystemPromptId(p.id)}
                className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
              >
                设为默认
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 新建 / 编辑表单 */}
      {editing ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {editing.id === null ? "新建 System Prompt" : "编辑 System Prompt"}
            </span>
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              aria-label="取消"
            >
              <X className="size-4" />
            </button>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名称（必填）"
            maxLength={50}
            className="h-8 w-full rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-ring"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="System Prompt 内容（必填）"
            rows={4}
            maxLength={8000}
            className="w-full resize-y rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none focus:border-ring"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={cancelEdit}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={!name.trim() || !content.trim()}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startCreate}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border",
            "px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          )}
        >
          <Plus className="size-3.5" />
          新建 System Prompt
        </button>
      )}
    </div>
  );
}
