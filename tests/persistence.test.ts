import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import type { DeepseekEvent } from "@/lib/types";

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

const { useChatStore } = await import("@/lib/store/useChatStore");
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

/**
 * 端到端持久化链路：发送消息 → 模拟刷新（内存清空）→ loadAll 恢复。
 * 回归：sessions store 缺失时刷新后对话全部丢失（db.ts v3 已修复）。
 */
describe("会话持久化链路（刷新后恢复）", () => {
  beforeEach(() => {
    store.clear();
    setApiKey("sk-test");
    useChatStore.setState({
      sessions: [],
      activeSessionId: null,
      streaming: false,
      streamError: null,
    });
    streamChatMock.mockReset();
  });

  it("发送消息后刷新（loadAll）会话与消息完整恢复", async () => {
    streamChatMock.mockImplementation(async function* () {
      yield completedEvent();
    });

    // 1. 新建会话并发送消息（persistSession 写入 IndexedDB）
    useChatStore.getState().newSession();
    await useChatStore.getState().sendMessage("你好，世界");
    const before = useChatStore.getState().sessions[0];
    expect(before.messages).toHaveLength(2); // user + assistant

    // 2. 模拟刷新：内存态清空（等价于页面重新加载）
    useChatStore.setState({
      sessions: [],
      activeSessionId: null,
      streaming: false,
    });

    // 3. 恢复
    await useChatStore.getState().loadAll();

    const sessions = useChatStore.getState().sessions;
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    const restored = sessions.find((s) => s.id === before.id);
    expect(restored).toBeDefined();
    expect(restored!.messages).toHaveLength(2);
    expect(restored!.messages[0].content).toBe("你好，世界");
    expect(restored!.messages[1].status).toBe("completed");
    expect(restored!.systemPromptText.length).toBeGreaterThan(0);
  });
});
