import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  buildBackup,
  importBackup,
  isValidMessage,
  isValidPrompt,
  isValidSession,
  parseBackup,
  serializeBackup,
} from "@/lib/storage/export-import";
import {
  getAllPrompts,
  getAllSessions,
  putPrompt,
  putSession,
} from "@/lib/storage/db";
import { BACKUP_FORMAT, BACKUP_VERSION, type Session, type SystemPrompt } from "@/lib/types";
import { uuid } from "@/lib/utils";

/**
 * 数据备份（FR-15，docs/07-implementation/testing.md 单元测试清单 export-import 项）：
 * ① roundtrip 数据一致；② 非法 JSON/format/version 报错；③ 正常导入写库；
 * ④ 同 id 冲突跳过保留本地；⑤ 内置 prompt 不导入；⑥ 畸形条目跳过；⑦ 导出不含内置条目
 */

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    id: uuid(),
    title: "测试会话",
    model: "deepseek-v4-flash",
    systemPromptId: "builtin-default",
    systemPromptText: "你是助手",
    messages: [
      {
        id: uuid(),
        role: "user",
        content: "你好",
        status: "completed",
        model: "deepseek-v4-flash",
        createdAt: now,
      },
      {
        id: uuid(),
        role: "assistant",
        content: "你好！",
        status: "completed",
        model: "deepseek-v4-flash",
        createdAt: now + 1,
        parentId: undefined,
        usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 5, reasoningTokens: 0 },
      },
    ],
    activeLeafId: undefined,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePrompt(overrides: Partial<SystemPrompt> = {}): SystemPrompt {
  return {
    id: uuid(),
    name: "测试 Prompt",
    content: "你是测试助手",
    isBuiltin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("导出（serializeBackup / buildBackup）", () => {
  beforeEach(async () => {
    // 清空 IndexedDB（fake-indexeddb 跨用例共享）
    const [sessions, prompts] = await Promise.all([getAllSessions(), getAllPrompts()]);
    await Promise.all([
      ...sessions.map((s) => import("@/lib/storage/db").then((m) => m.deleteSession(s.id))),
      ...prompts.map((p) => import("@/lib/storage/db").then((m) => m.deletePrompt(p.id))),
    ]);
  });

  it("serializeBackup → parseBackup roundtrip 数据一致", () => {
    const sessions = [makeSession()];
    const prompts = [makePrompt()];
    const json = serializeBackup(sessions, prompts);
    const parsed = parseBackup(json);
    expect(parsed.format).toBe(BACKUP_FORMAT);
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.sessions).toEqual(sessions);
    expect(parsed.prompts).toEqual(prompts);
  });

  it("导出不含内置 System Prompt（FR-15）", () => {
    const data = buildBackup([makeSession()], [
      makePrompt(),
      makePrompt({ isBuiltin: true }),
    ]);
    expect(data.prompts).toHaveLength(1);
    expect(data.prompts[0]!.isBuiltin).toBe(false);
  });
});

describe("导入解析（parseBackup）", () => {
  it("非法 JSON → 报错", () => {
    expect(() => parseBackup("not json {")).toThrow(/JSON/);
  });

  it("format 不符 → 报错", () => {
    expect(() =>
      parseBackup(
        JSON.stringify({ format: "other-app", version: 1, sessions: [], prompts: [] })
      )
    ).toThrow(/不是本应用导出/);
  });

  it("version 不支持 → 报错", () => {
    expect(() =>
      parseBackup(
        JSON.stringify({ format: BACKUP_FORMAT, version: 99, sessions: [], prompts: [] })
      )
    ).toThrow(/版本/);
    // 缺 version 同样报错
    expect(() =>
      parseBackup(JSON.stringify({ format: BACKUP_FORMAT, sessions: [], prompts: [] }))
    ).toThrow(/版本/);
  });

  it("缺少 sessions/prompts 数组 → 报错", () => {
    expect(() =>
      parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1 }))
    ).toThrow(/sessions/);
  });

  it("最小字段校验：会话/消息/条目", () => {
    expect(isValidMessage({ id: "1", role: "user", content: "hi" })).toBe(true);
    expect(isValidMessage({ id: "1", role: "system", content: "hi" })).toBe(false);
    expect(isValidMessage({ id: "1", role: "user" })).toBe(false);
    expect(
      isValidSession({ id: "1", title: "t", messages: [{ id: "2", role: "user", content: "hi" }] })
    ).toBe(true);
    expect(isValidSession({ id: "1", title: "t", messages: [{ id: "2", role: "x", content: "hi" }] })).toBe(false);
    expect(isValidPrompt({ id: "1", name: "n", content: "c", isBuiltin: false })).toBe(true);
    expect(isValidPrompt({ id: "1", name: "n", content: "c" })).toBe(false);
  });
});

describe("导入写库（importBackup）", () => {
  beforeEach(async () => {
    const [sessions, prompts] = await Promise.all([getAllSessions(), getAllPrompts()]);
    await Promise.all([
      ...sessions.map((s) => import("@/lib/storage/db").then((m) => m.deleteSession(s.id))),
      ...prompts.map((p) => import("@/lib/storage/db").then((m) => m.deletePrompt(p.id))),
    ]);
  });

  it("正常导入：会话与自定义 prompt 写入 IndexedDB", async () => {
    const session = makeSession();
    const prompt = makePrompt();
    const result = await importBackup({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: Date.now(),
      sessions: [session],
      prompts: [prompt],
    });
    expect(result).toEqual({
      importedSessions: 1,
      skippedSessions: 0,
      importedPrompts: 1,
      skippedPrompts: 0,
    });
    const sessions = await getAllSessions();
    const prompts = await getAllPrompts();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(session.id);
    expect(sessions[0]!.messages).toHaveLength(2);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.id).toBe(prompt.id);
  });

  it("同 id 冲突：跳过并保留本地（不覆盖）", async () => {
    const local = makeSession({ title: "本地会话" });
    await putSession(local);
    // 备份里同 id 但内容不同的会话
    const remote = makeSession({ id: local.id, title: "备份会话" });
    const result = await importBackup({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: Date.now(),
      sessions: [remote],
      prompts: [],
    });
    expect(result.importedSessions).toBe(0);
    expect(result.skippedSessions).toBe(1);
    const sessions = await getAllSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.title).toBe("本地会话"); // 本地未被覆盖
  });

  it("内置 prompt（isBuiltin）不导入", async () => {
    const result = await importBackup({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: Date.now(),
      sessions: [],
      prompts: [makePrompt({ isBuiltin: true })],
    });
    expect(result.importedPrompts).toBe(0);
    expect(result.skippedPrompts).toBe(1);
    expect(await getAllPrompts()).toHaveLength(0);
  });

  it("畸形条目跳过并计数", async () => {
    const result = await importBackup({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: Date.now(),
      sessions: [
        makeSession(),
        { id: 123 } as unknown as Session, // 畸形（模拟外部 JSON 中的坏数据）
      ],
      prompts: [
        makePrompt(),
        { name: "缺 id" } as unknown as SystemPrompt, // 畸形
      ],
    });
    expect(result).toEqual({
      importedSessions: 1,
      skippedSessions: 1,
      importedPrompts: 1,
      skippedPrompts: 1,
    });
  });
});
