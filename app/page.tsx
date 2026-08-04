"use client";

import * as React from "react";
import { ChatShell } from "@/components/chat/ChatShell";
import { useChatStore } from "@/lib/store/useChatStore";
import { useSettingsStore } from "@/lib/store/useSettingsStore";

/**
 * 主页：挂载 ChatShell；启动时恢复会话（loadAll，阶段 5 接 IndexedDB）
 * 并应用深色模式。
 */
export default function Home() {
  React.useEffect(() => {
    // 深色模式初始化（持久化恢复后 onRehydrateStorage 也会应用一次）
    document.documentElement.classList.toggle(
      "dark",
      useSettingsStore.getState().darkMode
    );
    void useChatStore.getState().loadAll();
  }, []);

  return <ChatShell />;
}
