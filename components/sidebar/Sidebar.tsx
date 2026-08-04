"use client";

import * as React from "react";
import {
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/lib/store/useChatStore";
import { useSettingsStore } from "@/lib/store/useSettingsStore";
import { openSettings } from "@/lib/store/ui";
import type { Session } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

/**
 * 左侧边栏（ui-design.md 4.6）：
 * - 桌面（md+）260px 常驻；移动端抽屉（open/onClose 由 page 层控制）
 * - NewChatButton / 搜索框 / ConversationList（updatedAt 倒序、当前高亮、
 *   hover 删除按钮带确认 Dialog、双击标题内联重命名）/ UserMenu
 */
export function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const setActiveSession = useChatStore((s) => s.setActiveSession);

  const [query, setQuery] = React.useState("");
  const [pendingDelete, setPendingDelete] = React.useState<Session | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  // 过滤 + 按 updatedAt 倒序
  const visibleSessions = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions
      .filter((s) => (q ? s.title.toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [sessions, query]);

  const startEdit = (session: Session) => {
    setEditingId(session.id);
    setDraft(session.title);
  };

  const commitEdit = () => {
    if (editingId && draft.trim()) {
      renameSession(editingId, draft.trim());
    }
    setEditingId(null);
  };

  const handleNewChat = () => {
    newSession();
    onClose(); // 移动端：新建后收起抽屉
  };

  return (
    <>
      {/* 移动端遮罩 */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[260px] shrink-0 flex-col border-r border-border bg-sidebar",
          "transition-transform duration-200 md:static md:z-auto md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* 新对话 */}
        <div className="p-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 bg-transparent"
            onClick={handleNewChat}
          >
            <Plus className="size-4" />
            新对话
          </Button>
        </div>

        {/* 搜索框 */}
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索会话"
              aria-label="搜索会话"
              className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        </div>

        {/* 会话列表 */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visibleSessions.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              暂无会话
            </p>
          ) : (
            <ul className="space-y-0.5">
              {visibleSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const isEditing = session.id === editingId;
                return (
                  <li
                    key={session.id}
                    className={cn(
                      "group flex items-center gap-1 rounded-lg px-2 py-2 transition-colors",
                      isActive
                        ? "bg-muted"
                        : "hover:bg-muted/60"
                    )}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        aria-label="重命名会话"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSession(session.id);
                            onClose();
                          }}
                          onDoubleClick={() => startEdit(session)}
                          className="min-w-0 flex-1 truncate text-left text-sm text-foreground/90"
                          title={session.title}
                        >
                          {session.title}
                        </button>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatTime(session.updatedAt)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(session)}
                          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                          aria-label="删除会话"
                          title="删除会话"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* 用户菜单 */}
        <div className="border-t border-border p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  D
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                  设置与偏好
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-52">
              <DropdownMenuLabel>用户菜单</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={openSettings}>
                <Settings />
                设置
              </DropdownMenuItem>
              <DarkModeMenuItem />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* 删除确认 */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除会话</DialogTitle>
            <DialogDescription>
              确定要删除「{pendingDelete?.title}」吗？此操作无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) deleteSession(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 用户菜单中的深色模式快捷切换 */
function DarkModeMenuItem() {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  return (
    <DropdownMenuItem onSelect={toggleDarkMode}>
      {darkMode ? <Sun /> : <Moon />}
      深色模式 {darkMode ? "开" : "关"}
    </DropdownMenuItem>
  );
}
