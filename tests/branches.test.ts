import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeepseekEvent, Session } from "@/lib/types";

// localStorage stub（useSettingsStore persist 依赖）
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
vi.stubGlobal("localStorage", localStorageMock);
vi.stubGlobal("window", { localStorage: localStorageMock });

const { streamChatMock } = vi.hoisted(() => ({ streamChatMock: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ streamChat: streamChatMock }));

const { useChatStore, getPathMessages, migrateSessionGraph } = await import(
  "@/lib/store/useChatStore"
);
const { setApiKey } = await import("@/lib/store/useSettingsStore");

function completedEvent(): DeepseekEvent {
  return {
    type: "response.completed",
    sequence_number: 1,
    response: {
      id: "resp_1",
      status: "completed",
      model: "deepseek-v4-flash",
      output: [],
      usage: { input_tokens: 5, output_tokens: 3 },
    },
  };
}

function resetStore() {
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    streaming: false,
    streamError: null,
  });
}

/** 建立一条基础对话：u1 → a1 → u2 → a2（当前路径末端 a2）；assistant 回复内容为「回复」 */
async function seedTwoRounds() {
  streamChatMock.mockImplementation(async function* () {
    yield {
      type: "response.created",
      sequence_number: 0,
      response: { id: "r", status: "in_progress", model: "deepseek-v4-flash", output: [] },
    } satisfies DeepseekEvent;
    yield {
      type: "response.output_text.delta",
      sequence_number: 1,
      delta: "回复",
      item_id: "m",
    } satisfies DeepseekEvent;
    yield completedEvent();
  });
  useChatStore.getState().newSession();
  await useChatStore.getState().sendMessage("问题1");
  await useChatStore.getState().sendMessage("问题2");
  return useChatStore.getState().sessions[0];
}

describe("对话分支（FR-12）", () => {
  beforeEach(() => {
    store.clear();
    setApiKey("sk-test");
    resetStore();
    streamChatMock.mockReset();
  });

  it("getPathMessages：按 parentId 回溯到根", async () => {
    const session = await seedTwoRounds();
    const path = getPathMessages(session);
    expect(path.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(path.map((m) => m.content)).toEqual(["问题1", "回复", "问题2", "回复"]);
    expect(path[path.length - 1].id).toBe(session.activeLeafId);
  });

  it("编辑中间 user 消息 → 创建新分支（旧分支保留、路径切换、自动重新生成）", async () => {
    const session = await seedTwoRounds();
    const u2 = session.messages.find((m) => m.content === "问题2")!;
    const a2 = session.messages.find((m) => m.parentId === u2.id)!;
    const oldCount = session.messages.length;

    // 捕获编辑后请求的 input
    let editInput: unknown = null;
    streamChatMock.mockImplementationOnce(async function* (req: { input: unknown }) {
      editInput = req.input;
      yield completedEvent();
    });

    await useChatStore.getState().editMessage(u2.id, "问题2（已编辑）");

    const s = useChatStore.getState().sessions[0];
    // 旧分支消息全部保留
    expect(s.messages.length).toBe(oldCount + 2); // 新 user + 新 assistant
    expect(s.messages.some((m) => m.id === a2.id)).toBe(true);
    expect(s.messages.some((m) => m.content === "问题2")).toBe(true);
    // 新 user 消息：parentId 指向原 u2 的父（u1 的 assistant a1）
    const newUser = s.messages.find((m) => m.content === "问题2（已编辑）")!;
    expect(newUser.parentId).toBe(u2.parentId);
    // 新 assistant：父 = 新 user；activeLeaf 指向它
    const newAssistant = s.messages.find((m) => m.parentId === newUser.id)!;
    expect(newAssistant.role).toBe("assistant");
    expect(s.activeLeafId).toBe(newAssistant.id);
    // 请求 input = 根..新 user（不含旧 u2/a2 及其后代）
    const items = editInput as { type: string; role?: string; content?: string }[];
    const userItems = items.filter(
      (i) => i.type === "message" && i.role === "user"
    );
    expect(userItems.map((i) => i.content)).toEqual(["问题1", "问题2（已编辑）"]);
  });

  it("switchBranch：切换到旧分支末端，路径随之变化", async () => {
    const session = await seedTwoRounds();
    const u2 = session.messages.find((m) => m.content === "问题2")!;
    const a2 = session.messages.find((m) => m.parentId === u2.id)!;

    // 编辑制造分支
    streamChatMock.mockImplementationOnce(async function* () {
      yield completedEvent();
    });
    await useChatStore.getState().editMessage(u2.id, "问题2（已编辑）");

    // 切换到旧分支（点击 u2 摘要）→ 路径应回到 问题1 → a1 → 问题2 → a2
    useChatStore.getState().switchBranch(u2.id);
    const s = useChatStore.getState().sessions[0];
    expect(s.activeLeafId).toBe(a2.id);
    const path = getPathMessages(s);
    expect(path.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(path[path.length - 1].id).toBe(a2.id);
  });

  it("migrateSessionGraph：旧版线性会话（无 parentId/activeLeafId）补链", () => {
    const legacy: Session = {
      id: "s1",
      title: "t",
      model: "deepseek-v4-flash",
      systemPromptId: "builtin-default",
      systemPromptText: "p",
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Q1",
          status: "completed",
          model: "deepseek-v4-flash",
          createdAt: 1,
        },
        {
          id: "m2",
          role: "assistant",
          content: "A1",
          status: "completed",
          model: "deepseek-v4-flash",
          createdAt: 2,
        },
        {
          id: "m3",
          role: "user",
          content: "Q2",
          status: "completed",
          model: "deepseek-v4-flash",
          createdAt: 3,
        },
      ],
      createdAt: 1,
      updatedAt: 3,
    };
    const migrated = migrateSessionGraph(legacy);
    expect(migrated.messages[0].parentId).toBeUndefined();
    expect(migrated.messages[1].parentId).toBe("m1");
    expect(migrated.messages[2].parentId).toBe("m2");
    expect(migrated.activeLeafId).toBe("m3");
    // 幂等：已有 activeLeafId 的会话原样返回
    const again = migrateSessionGraph(migrated);
    expect(again).toBe(migrated);
  });

  it("编辑/重新生成后继续发送：新消息追加在当前分支末端", async () => {
    const session = await seedTwoRounds();
    const u2 = session.messages.find((m) => m.content === "问题2")!;
    streamChatMock.mockImplementationOnce(async function* () {
      yield completedEvent();
    });
    await useChatStore.getState().editMessage(u2.id, "问题2（已编辑）");

    // 在编辑后的分支继续提问
    streamChatMock.mockImplementation(async function* () {
      yield completedEvent();
    });
    await useChatStore.getState().sendMessage("问题3");

    const s = useChatStore.getState().sessions[0];
    const path = getPathMessages(s);
    expect(path.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
    expect(
      path.filter((m) => m.role === "user").map((m) => m.content)
    ).toEqual(["问题1", "问题2（已编辑）", "问题3"]);
  });
});
