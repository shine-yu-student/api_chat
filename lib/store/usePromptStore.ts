import { create } from "zustand";
import { BUILTIN_PROMPT_ID, type SystemPrompt } from "@/lib/types";
import { BUILTIN_DEFAULT_PROMPT } from "@/lib/prompts/builtin";
import {
  deletePrompt as dbDeletePrompt,
  getAllPrompts,
  putPrompt,
} from "@/lib/storage/db";
import { useSettingsStore } from "@/lib/store/useSettingsStore";
import { uuid } from "@/lib/utils";

/**
 * System Prompt 库 store（docs/04-frontend/prompt-library.md 第 2 节、chat-state.md）
 * - prompts = [内置条目, ...用户自定义（updatedAt 倒序）]；内置条目恒在
 * - 删除/编辑只影响库与新建会话；已锁定会话持快照不受影响
 */
interface PromptStore {
  prompts: SystemPrompt[];
  loaded: boolean;
  loadPrompts(): Promise<void>;
  getPrompt(id: string): SystemPrompt | undefined;
  createPrompt(name: string, content: string): Promise<SystemPrompt>;
  updatePrompt(id: string, name: string, content: string): Promise<void>;
  deletePrompt(id: string): Promise<void>;
}

export const usePromptStore = create<PromptStore>()((set, get) => ({
  prompts: [BUILTIN_DEFAULT_PROMPT],
  loaded: false,

  loadPrompts: async () => {
    if (get().loaded) return;
    let customs: SystemPrompt[] = [];
    try {
      customs = await getAllPrompts();
    } catch {
      customs = [];
    }
    set({ prompts: [BUILTIN_DEFAULT_PROMPT, ...customs], loaded: true });
  },

  getPrompt: (id) => {
    const all = get().prompts;
    // 未加载完时也允许查询（内置恒在）
    if (all.length === 0 || !get().loaded) {
      return id === BUILTIN_PROMPT_ID ? BUILTIN_DEFAULT_PROMPT : undefined;
    }
    return all.find((p) => p.id === id);
  },

  createPrompt: async (name, content) => {
    const prompt: SystemPrompt = {
      id: uuid(),
      name: name.trim(),
      content: content.trim(),
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await putPrompt(prompt);
    // 内置恒在列表首位且不重复（防御：即使状态异常也保证结构正确）
    set((s) => ({
      prompts: [
        BUILTIN_DEFAULT_PROMPT,
        prompt,
        ...s.prompts.filter((p) => !p.isBuiltin && p.id !== prompt.id),
      ],
      loaded: true,
    }));
    return prompt;
  },

  updatePrompt: async (id, name, content) => {
    const existing = get().prompts.find((p) => p.id === id);
    if (!existing || existing.isBuiltin) return; // 内置禁止编辑
    const updated: SystemPrompt = {
      ...existing,
      name: name.trim(),
      content: content.trim(),
      updatedAt: Date.now(),
    };
    await putPrompt(updated);
    set((s) => ({
      prompts: s.prompts.map((p) => (p.id === id ? updated : p)),
    }));
  },

  deletePrompt: async (id) => {
    const existing = get().prompts.find((p) => p.id === id);
    if (!existing || existing.isBuiltin) return; // 内置禁止删除
    await dbDeletePrompt(id);
    set((s) => ({
      prompts: s.prompts.filter((p) => p.id !== id),
    }));
    // 若被删条目是默认项：回退内置（prompt-library.md 第 7 节）
    if (useSettingsStore.getState().defaultSystemPromptId === id) {
      useSettingsStore.getState().setDefaultSystemPromptId(BUILTIN_PROMPT_ID);
    }
  },
}));
