import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { BUILTIN_PROMPT_ID } from "@/lib/types";

// localStorage stub（useSettingsStore persist 依赖）
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
vi.stubGlobal("localStorage", localStorageMock);
vi.stubGlobal("window", { localStorage: localStorageMock });

const { TooltipProvider } = await import("@/components/ui/tooltip");
const { Topbar } = await import("@/components/chat/Topbar");
const { useChatStore } = await import("@/lib/store/useChatStore");

describe("Tooltip Provider 回归（修复：Tooltip must be used within TooltipProvider）", () => {
  it("锁定态会话渲染 Topbar（含 PromptBadge Tooltip）不抛错", () => {
    useChatStore.setState({
      sessions: [
        {
          id: "s1",
          title: "测试会话",
          model: "deepseek-v4-flash",
          systemPromptId: BUILTIN_PROMPT_ID,
          systemPromptText: "你是助手",
          messages: [
            {
              id: "m1",
              role: "user",
              content: "hi",
              status: "completed",
              model: "deepseek-v4-flash",
              createdAt: 1,
            },
            {
              id: "m2",
              role: "assistant",
              content: "hello",
              status: "completed",
              model: "deepseek-v4-flash",
              createdAt: 2,
            },
          ],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      activeSessionId: "s1",
    });

    // 与 app/layout.tsx 相同的结构：TooltipProvider 包裹组件树
    // （用 React.createElement 而非 JSX，避免 vitest/rolldown 的 JSX 转换差异）
    expect(() =>
      renderToString(
        React.createElement(TooltipProvider, {
          delayDuration: 200,
          children: React.createElement(Topbar, { onOpenSidebar: () => {} }),
        })
      )
    ).not.toThrow();
  });
});
