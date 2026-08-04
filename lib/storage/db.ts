import { openDB, type IDBPDatabase } from "idb";
import type { Session, SystemPrompt } from "@/lib/types";

/**
 * IndexedDB 封装（docs/06-storage/session-storage.md 第 2 节）
 * - DB: "deepseek-chat-db" version 3
 * - store "sessions"（keyPath id，index updatedAt）——会话全量对象（含 messages）
 * - store "prompts"（keyPath id，index updatedAt）——用户自定义 SystemPrompt（内置条目不落库）
 *
 * 版本历史：
 * - v1/v2：历史缺陷——upgrade 仅创建 prompts，sessions store 从未被创建，
 *   导致 putSession/getAllSessions 抛 NotFoundError 且被静默吞掉（刷新后对话"丢失"）
 * - v3：补建 sessions store（幂等：!contains 判断）
 */

const DB_NAME = "deepseek-chat-db";
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // 修复历史缺陷：任何旧版本（含全新创建 oldVersion=0）都确保 sessions 存在
      if (oldVersion < 3 && !db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      // v1 → v2：新增 prompts store（旧库升级时保留既有数据）
      if (oldVersion < 2 && !db.objectStoreNames.contains("prompts")) {
        const store = db.createObjectStore("prompts", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    },
  });
  return dbPromise;
}

// ---------- sessions ----------

export async function getAllSessions(): Promise<Session[]> {
  const db = await getDb();
  const list = await db.getAllFromIndex("sessions", "updatedAt"); // 升序
  return list.reverse(); // 倒序：最新更新在前
}

export async function putSession(session: Session): Promise<void> {
  const db = await getDb();
  await db.put("sessions", session);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("sessions", id);
}

export async function clearAllSessions(): Promise<void> {
  const db = await getDb();
  await db.clear("sessions");
}

// ---------- prompts ----------

export async function getAllPrompts(): Promise<SystemPrompt[]> {
  const db = await getDb();
  const list = await db.getAllFromIndex("prompts", "updatedAt"); // 升序
  return list.reverse(); // 倒序：最近修改在前
}

export async function putPrompt(prompt: SystemPrompt): Promise<void> {
  const db = await getDb();
  await db.put("prompts", prompt);
}

export async function deletePrompt(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("prompts", id);
}

export async function clearAllPrompts(): Promise<void> {
  const db = await getDb();
  await db.clear("prompts");
}
