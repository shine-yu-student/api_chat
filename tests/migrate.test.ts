import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { STORAGE_KEYS } from "@/lib/types";

// localStorage mock（Node 环境无 localStorage；useSettingsStore 的 persist 依赖它）
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
vi.stubGlobal("localStorage", localStorageMock);
vi.stubGlobal("window", { localStorage: localStorageMock });

// 被测模块动态 import（必须在 stub 之后）
const { migrateLegacyCustomInstruction } = await import(
  "@/lib/storage/settings"
);
const { getDb } = await import("@/lib/storage/db");

describe("migrateLegacyCustomInstruction（session-storage.md 第 4 节）", () => {
  beforeEach(async () => {
    store.clear();
    const db = await getDb();
    await db.clear("prompts");
  });

  it("旧版 settings.systemPrompt 迁移为库条目并设为默认", async () => {
    store.set(
      STORAGE_KEYS.settings,
      JSON.stringify({
        defaultModel: "deepseek-v4-flash",
        systemPrompt: "你是一个旧版自定义指令",
      })
    );

    await migrateLegacyCustomInstruction();

    // 库中出现「我的自定义指令」
    const db = await getDb();
    const prompts = await db.getAll("prompts");
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe("我的自定义指令");
    expect(prompts[0].content).toBe("你是一个旧版自定义指令");

    // settings JSON：systemPrompt 字段删除，defaultSystemPromptId 指向新条目
    const saved = JSON.parse(store.get(STORAGE_KEYS.settings) ?? "{}");
    expect("systemPrompt" in saved).toBe(false);
    expect(saved.defaultSystemPromptId).toBe(prompts[0].id);
  });

  it("无旧字段时无副作用", async () => {
    store.set(STORAGE_KEYS.settings, JSON.stringify({ defaultModel: "deepseek-v4-flash" }));
    await migrateLegacyCustomInstruction();
    const db = await getDb();
    expect(await db.getAll("prompts")).toHaveLength(0);
  });

  it("幂等：重复调用不重复创建条目", async () => {
    store.set(
      STORAGE_KEYS.settings,
      JSON.stringify({ systemPrompt: "旧指令" })
    );
    await migrateLegacyCustomInstruction();
    await migrateLegacyCustomInstruction();
    const db = await getDb();
    expect(await db.getAll("prompts")).toHaveLength(1);
  });
});
