import { create } from "zustand";

/**
 * 全局 UI 标志（模块级 zustand store，避免跨组件回调直接依赖组件模块）。
 * 当前仅用于「打开设置对话框」：
 * - useChatStore.sendMessage 在未配置 API Key 时调用 openSettings()
 * - SettingsDialog 订阅 settingsOpen
 */
interface UiState {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));

export function openSettings(): void {
  useUiStore.getState().setSettingsOpen(true);
}

export function closeSettings(): void {
  useUiStore.getState().setSettingsOpen(false);
}
