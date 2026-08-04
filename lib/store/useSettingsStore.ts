import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  BUILTIN_PROMPT_ID,
  STORAGE_KEYS,
  type ModelId,
  type ThinkingEffort,
} from "@/lib/types";
import { uuid } from "@/lib/utils";

/**
 * 设置 store（docs/04-frontend/settings.md、chat-state.md 第 2 节）。
 * - 持久化到 localStorage（key: STORAGE_KEYS.settings，即 deepseek-chat.settings）
 * - apiKey 独立存 STORAGE_KEYS.apiKey，不进入 store/持久化 JSON
 * - anonUserId 首次生成后存 STORAGE_KEYS.anonUserId
 * - darkMode 变化同步 document.documentElement.classList.toggle("dark")
 */
export interface SettingsStore {
  defaultModel: ModelId;
  thinkingEnabled: boolean;
  thinkingEffort: ThinkingEffort;
  webSearchEnabled: boolean;
  temperature: number;
  defaultSystemPromptId: string;
  darkMode: boolean;
  anonUserId: string;

  setDefaultModel: (model: ModelId) => void;
  setThinkingEnabled: (v: boolean) => void;
  setThinkingEffort: (effort: ThinkingEffort) => void;
  setWebSearchEnabled: (v: boolean) => void;
  setTemperature: (v: number) => void;
  setDefaultSystemPromptId: (id: string) => void;
  setDarkMode: (v: boolean) => void;
  toggleDarkMode: () => void;
}

/** 生成/读取匿名用户 id（限流隔离用），独立 localStorage key */
function ensureAnonUserId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEYS.anonUserId);
    if (existing) return existing;
    const id = uuid();
    window.localStorage.setItem(STORAGE_KEYS.anonUserId, id);
    return id;
  } catch {
    return "";
  }
}

/** API Key 独立存取（明文 localStorage，settings.md 第 3 节） */
export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEYS.apiKey) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(key: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEYS.apiKey, key.trim());
}

export function clearApiKey(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEYS.apiKey);
}

/** 深色模式：html.dark class 切换 */
function applyDarkMode(dark: boolean): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", dark);
  }
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      defaultModel: "deepseek-v4-flash",
      thinkingEnabled: true,
      thinkingEffort: "high",
      webSearchEnabled: false,
      temperature: 1.0,
      defaultSystemPromptId: BUILTIN_PROMPT_ID,
      darkMode: false,
      anonUserId: ensureAnonUserId(),

      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setThinkingEnabled: (thinkingEnabled) => set({ thinkingEnabled }),
      setThinkingEffort: (thinkingEffort) => set({ thinkingEffort }),
      setWebSearchEnabled: (webSearchEnabled) => set({ webSearchEnabled }),
      setTemperature: (temperature) =>
        set({ temperature: Math.min(2, Math.max(0, temperature)) }),
      setDefaultSystemPromptId: (defaultSystemPromptId) =>
        set({ defaultSystemPromptId }),
      setDarkMode: (darkMode) => {
        set({ darkMode });
        applyDarkMode(darkMode);
      },
      toggleDarkMode: () => {
        get().setDarkMode(!get().darkMode);
      },
    }),
    {
      name: STORAGE_KEYS.settings,
      storage: createJSONStorage(() => localStorage),
      // apiKey / anonUserId 不进设置 JSON（各自独立 key 存储）
      partialize: (s) => ({
        defaultModel: s.defaultModel,
        thinkingEnabled: s.thinkingEnabled,
        thinkingEffort: s.thinkingEffort,
        webSearchEnabled: s.webSearchEnabled,
        temperature: s.temperature,
        defaultSystemPromptId: s.defaultSystemPromptId,
        darkMode: s.darkMode,
      }),
      onRehydrateStorage: () => (state) => {
        // 持久化恢复后应用深色模式
        if (state) applyDarkMode(state.darkMode);
      },
    }
  )
);
