import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { openDB } from "idb";

// 动态 import（db.ts 的 getDb 首次调用时才 open DB）
const { getDb, putSession, getAllSessions } = await import("@/lib/storage/db");

/**
 * 回归测试：历史缺陷库（v2 仅 prompts、无 sessions）升级到 v3 后
 * sessions store 被补建，会话可持久化（修复：刷新后对话"丢失"）。
 * 模拟用户真实环境：应用早期版本已创建 v2 库。
 */
describe("IndexedDB 升级回归（sessions store 缺失修复）", () => {
  it("从 v2 缺陷库升级后 sessions 可用且 put/get 往返正常", async () => {
    // 1. 模拟历史缺陷：v2 库只创建 prompts（对应旧版 db.ts 的 bug）
    const legacy = await openDB("deepseek-chat-db", 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("prompts")) {
          db.createObjectStore("prompts", { keyPath: "id" });
        }
      },
    });
    legacy.close();

    // 2. 应用代码打开（DB_VERSION=3）→ upgrade 应补建 sessions
    const db = await getDb();
    expect(db.objectStoreNames.contains("sessions")).toBe(true);
    expect(db.objectStoreNames.contains("prompts")).toBe(true);

    // 3. 数据往返：写入后可读回（旧代码在此抛 NotFoundError）
    await putSession({
      id: "s1",
      title: "测试会话",
      model: "deepseek-v4-flash",
      systemPromptId: "builtin-default",
      systemPromptText: "你是助手",
      messages: [
        {
          id: "m1",
          role: "user",
          content: "你好",
          status: "completed",
          model: "deepseek-v4-flash",
          createdAt: 1,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    });
    const all = await getAllSessions();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("s1");
    expect(all[0].messages[0].content).toBe("你好");
  });
});
