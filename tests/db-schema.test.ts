import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";

const { getDb, putSession, getAllSessions } = await import("@/lib/storage/db");

/**
 * 全新创建路径（oldVersion=0）：sessions 与 prompts 都应被创建。
 */
describe("IndexedDB 全新创建（schema 完整性）", () => {
  it("首次打开即包含 sessions 与 prompts 两个 store", async () => {
    const db = await getDb();
    expect(db.objectStoreNames.contains("sessions")).toBe(true);
    expect(db.objectStoreNames.contains("prompts")).toBe(true);

    // 读写往返
    await putSession({
      id: "s1",
      title: "t",
      model: "deepseek-v4-flash",
      systemPromptId: "builtin-default",
      systemPromptText: "p",
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const all = await getAllSessions();
    expect(all).toHaveLength(1);
  });
});
