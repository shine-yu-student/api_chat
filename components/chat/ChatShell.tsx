"use client";

import * as React from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Topbar } from "@/components/chat/Topbar";
import { WelcomeView } from "@/components/chat/WelcomeView";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useChatStore } from "@/lib/store/useChatStore";

/**
 * 整体布局（ui-design.md 第 1 节）：
 * Sidebar + 主区（Topbar + ChatView + 输入区）
 */
export function ChatShell() {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const activeSession = useChatStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId)
  );
  const sendMessage = useChatStore((s) => s.sendMessage);

  const hasMessages = (activeSession?.messages.length ?? 0) > 0;

  const handleAsk = (question: string) => {
    void sendMessage(question);
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setSidebarOpen(true)} />
        <div className="min-h-0 flex-1 overflow-hidden">
          {hasMessages ? (
            <MessageList />
          ) : (
            <WelcomeView onAsk={handleAsk} />
          )}
        </div>
        <ChatInput />
      </div>
      <SettingsDialog />
    </div>
  );
}
