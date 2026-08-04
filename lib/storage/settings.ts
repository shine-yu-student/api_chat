import { STORAGE_KEYS, type SystemPrompt } from "@/lib/types";
import {
  clearAllPrompts,
  clearAllSessions,
  putPrompt,
} from "@/lib/storage/db";
import { uuid } from "@/lib/utils";

/**
 * localStorage 设置层辅助（docs/06-storage/session-storage.md 第 4 节）。
 * 注意：常规设置读写由 useSettingsStore（zustand persist）负责；
 * 本文件只承载「一次性迁移」与「数据清理」等跨层操作。
 */

/**
 * 旧版「自定义指令」（v0 settings.systemPrompt）一次性迁移（FR-11）：
 * - 若 localStorage settings JSON 中存在非空 systemPrompt 字段：
 *   导入为库条目「我的自定义指令」，defaultSystemPromptId 指向它，随后删除该字段。
 * 幂等：执行后字段不存在，重复调用无副作用。
 */
export async function migrateLegacyCustomInstruction(): Promise<void> {
  if (typeof window === "undefined") return;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEYS.settings);
  } catch {
    return;
  }
  if (!raw) return;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return; // JSON 损坏：留给 store 默认值兜底
  }

  const legacy = data.systemPrompt;
  if (typeof legacy !== "string" || legacy.trim() === "") return;

  const prompt: SystemPrompt = {
    id: uuid(),
    name: "我的自定义指令",
    content: legacy.trim(),
    isBuiltin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  try {
    await putPrompt(prompt);
    data.defaultSystemPromptId = prompt.id;
    delete data.systemPrompt;
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(data));
  } catch {
    // 迁移失败不阻断启动（下次启动重试）
  }
}

/**
 * 清除全部本地数据（settings.md 第 3 节 / session-storage.md 第 6 节）：
 * IndexedDB 全部记录 + localStorage 全部 deepseek-chat.* key。
 */
export async function clearAllLocalData(): Promise<void> {
  await clearAllSessions();
  await clearAllPrompts();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.apiKey);
      window.localStorage.removeItem(STORAGE_KEYS.settings);
      window.localStorage.removeItem(STORAGE_KEYS.anonUserId);
    } catch {
      // ignore
    }
  }
}
