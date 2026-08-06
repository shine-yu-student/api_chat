import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupData,
  type Session,
  type StoredMessage,
  type SystemPrompt,
} from "@/lib/types";
import {
  getAllPrompts,
  getAllSessions,
  putPrompt,
  putSession,
} from "@/lib/storage/db";

/**
 * 数据备份（导出/导入，FR-15；docs/06-storage/session-storage.md 第 8 节）。
 * - 导出：序列化全部会话 + 用户自定义 System Prompt（内置条目不导出）为 JSON 字符串
 * - 导入：解析/校验备份文件 → 逐条写库（同 id 跳过保留本地、内置条目忽略、畸形条目跳过）
 *
 * 序列化与校验为纯函数，可在 Node 环境单测；写库复用 db.ts（IndexedDB）。
 */

/** 侧边栏宽度取值范围（FR-14，ui-design.md 4.7） */
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 480;

/** 备份文件名：deepseek-chat-backup-YYYYMMDD-HHmmss.json */
export function backupFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `deepseek-chat-backup-${ymd}-${hms}.json`;
}

/** 导出：构建备份对象（内置 prompt 排除在外，FR-15） */
export function buildBackup(
  sessions: Session[],
  prompts: SystemPrompt[]
): BackupData {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    sessions: sessions.map((s) => JSON.parse(JSON.stringify(s)) as Session),
    prompts: prompts
      .filter((p) => !p.isBuiltin)
      .map((p) => JSON.parse(JSON.stringify(p)) as SystemPrompt),
  };
}

/** 导出：序列化为 JSON 字符串 */
export function serializeBackup(
  sessions: Session[],
  prompts: SystemPrompt[]
): string {
  return JSON.stringify(buildBackup(sessions, prompts), null, 2);
}

// ---------- 导入：解析与校验 ----------

/** 最小字段校验：一条可导入的会话（畸形条目跳过，session-storage.md 8.2） */
export function isValidSession(v: unknown): v is Session {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    Array.isArray(s.messages) &&
    s.messages.every(isValidMessage) &&
    (typeof s.systemPromptText === "string" || s.systemPromptText === undefined)
  );
}

/** 最小字段校验：一条消息 */
export function isValidMessage(v: unknown): v is StoredMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    (m.parentId === undefined || typeof m.parentId === "string")
  );
}

/** 最小字段校验：一条库条目（内置条目不落库，由调用方过滤） */
export function isValidPrompt(v: unknown): v is SystemPrompt {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.content === "string" &&
    typeof p.isBuiltin === "boolean"
  );
}

/** 解析并校验备份 JSON。非法格式/版本抛带可读文案的 Error（不写入任何数据） */
export function parseBackup(json: string): BackupData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("文件不是有效的 JSON，无法导入");
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("备份文件格式不正确");
  }
  const data = raw as Record<string, unknown>;
  if (data.format !== BACKUP_FORMAT) {
    throw new Error("该文件不是本应用导出的备份文件");
  }
  const version = typeof data.version === "number" ? data.version : NaN;
  if (!Number.isInteger(version) || version < 1 || version > BACKUP_VERSION) {
    throw new Error(`不支持该备份文件版本（当前支持 v1，文件为 v${String(data.version)}）`);
  }
  if (!Array.isArray(data.sessions) || !Array.isArray(data.prompts)) {
    throw new Error("备份文件缺少 sessions/prompts 数据");
  }
  return {
    format: BACKUP_FORMAT,
    version,
    exportedAt: typeof data.exportedAt === "number" ? data.exportedAt : Date.now(),
    sessions: data.sessions,
    prompts: data.prompts,
  } as BackupData;
}

export interface ImportResult {
  importedSessions: number;
  skippedSessions: number;
  importedPrompts: number;
  skippedPrompts: number;
}

/**
 * 导入：逐条写库。
 * - 同 id 的会话/条目跳过、保留本地（不覆盖，FR-15）
 * - 内置 prompt（isBuiltin）忽略（内置条目不落库）
 * - 畸形条目跳过并计数
 */
export async function importBackup(data: BackupData): Promise<ImportResult> {
  const result: ImportResult = {
    importedSessions: 0,
    skippedSessions: 0,
    importedPrompts: 0,
    skippedPrompts: 0,
  };

  // 会话：同 id 跳过
  for (const raw of data.sessions) {
    if (!isValidSession(raw)) {
      result.skippedSessions += 1;
      continue;
    }
    const exists = await hasSession(raw.id);
    if (exists) {
      result.skippedSessions += 1;
      continue;
    }
    await putSession(raw);
    result.importedSessions += 1;
  }

  // 库条目：内置忽略；同 id 跳过
  for (const raw of data.prompts) {
    if (!isValidPrompt(raw) || raw.isBuiltin) {
      result.skippedPrompts += 1;
      continue;
    }
    const exists = await hasPrompt(raw.id);
    if (exists) {
      result.skippedPrompts += 1;
      continue;
    }
    await putPrompt(raw);
    result.importedPrompts += 1;
  }

  return result;
}

/** 会话 id 是否已存在（导入冲突判定） */
async function hasSession(id: string): Promise<boolean> {
  const list = await getAllSessions();
  return list.some((s) => s.id === id);
}

/** 库条目 id 是否已存在（导入冲突判定） */
async function hasPrompt(id: string): Promise<boolean> {
  const list = await getAllPrompts();
  return list.some((p) => p.id === id);
}
