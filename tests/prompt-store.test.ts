import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { BUILTIN_PROMPT_ID } from "@/lib/types";

// localStorage mock（useSettingsStore persist 依赖）
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
vi.stubGlobal("localStorage", localStorageMock);
vi.stubGlobal("window", { localStorage: localStorageMock });

const { usePromptStore } = await import("@/lib/store/usePromptStore");
const { useSettingsStore } = await import("@/lib/store/useSettingsStore");
const { getDb } = await import("@/lib/storage/db");
const { BUILTIN_DEFAULT_PROMPT } = await import("@/lib/prompts/builtin");

describe("usePromptStore（prompt-library.md 第 2/7 节）", () => {
  beforeEach(async () => {
    store.clear();
    const db = await getDb();
    await db.clear("prompts");
    // 重置为初始状态（内置恒在）
    usePromptStore.setState({ prompts: [BUILTIN_DEFAULT_PROMPT], loaded: false });
  });

  it("loadPrompts 后 = 内置 + 自定义（自定义倒序）", async () => {
    await usePromptStore.getState().createPrompt("P1", "内容1");
    await usePromptStore.getState().loadPrompts();
    const ids = usePromptStore.getState().prompts.map((p) => p.id);
    expect(ids[0]).toBe(BUILTIN_PROMPT_ID);
    expect(usePromptStore.getState().prompts).toHaveLength(2);
    // 内置恒在
    expect(usePromptStore.getState().getPrompt(BUILTIN_PROMPT_ID)?.isBuiltin).toBe(true);
  });

  it("内置条目不可编辑、不可删除", async () => {
    await usePromptStore.getState().loadPrompts();
    const builtin = usePromptStore.getState().getPrompt(BUILTIN_PROMPT_ID)!;
    await usePromptStore.getState().updatePrompt(builtin.id, "改名", "新内容");
    await usePromptStore.getState().deletePrompt(builtin.id);
    expect(usePromptStore.getState().getPrompt(BUILTIN_PROMPT_ID)?.name).toBe("基础助手");
    expect(usePromptStore.getState().prompts).toHaveLength(1);
  });

  it("删除自定义条目后从内存与 IndexedDB 移除", async () => {
    const p = await usePromptStore.getState().createPrompt("P1", "内容1");
    await usePromptStore.getState().deletePrompt(p.id);
    expect(usePromptStore.getState().getPrompt(p.id)).toBeUndefined();
    const db = await getDb();
    expect(await db.getAll("prompts")).toHaveLength(0);
  });

  it("删除默认条目时 defaultSystemPromptId 回退内置（prompt-library.md 第 7 节）", async () => {
    useSettingsStore.getState().setDefaultSystemPromptId(BUILTIN_PROMPT_ID);
    const p = await usePromptStore.getState().createPrompt("默认项", "内容");
    useSettingsStore.getState().setDefaultSystemPromptId(p.id);
    expect(useSettingsStore.getState().defaultSystemPromptId).toBe(p.id);
    await usePromptStore.getState().deletePrompt(p.id);
    expect(useSettingsStore.getState().defaultSystemPromptId).toBe(BUILTIN_PROMPT_ID);
  });

  it("createPrompt 置于列表第二位（内置之后）", async () => {
    const p = await usePromptStore.getState().createPrompt("P1", "内容1");
    expect(usePromptStore.getState().prompts[1].id).toBe(p.id);
  });
});
