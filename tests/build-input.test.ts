import { describe, expect, it } from "vitest";
import { buildInput } from "@/lib/api/build-input";
import type { StoredMessage } from "@/lib/types";

function msg(partial: Partial<StoredMessage> & { role: "user" | "assistant" }): StoredMessage {
  return {
    id: partial.id ?? "m1",
    content: partial.content ?? "",
    status: partial.status ?? "completed",
    model: partial.model ?? "deepseek-v4-flash",
    createdAt: partial.createdAt ?? 0,
    ...partial,
  };
}

describe("buildInput（responses-api.md 3.2 / thinking.md 第 4 节 / web-search.md 第 5 节）", () => {
  it("user/assistant 顺序映射为 message items", () => {
    const items = buildInput([
      msg({ role: "user", content: "Q1" }),
      msg({ role: "assistant", content: "A1" }),
      msg({ role: "user", content: "Q2" }),
    ]);
    expect(items).toEqual([
      { type: "message", role: "user", content: "Q1" },
      { type: "message", role: "assistant", content: "A1" },
      { type: "message", role: "user", content: "Q2" },
    ]);
  });

  it("无工具调用的轮次不回传 reasoning", () => {
    const items = buildInput([
      msg({ role: "user", content: "Q" }),
      msg({ role: "assistant", content: "A", reasoning: "思考过程", hadToolCall: false }),
    ]);
    expect(items.filter((i) => i.type === "reasoning")).toHaveLength(0);
  });

  it("带工具调用（hadToolCall）的轮次回传 reasoning item", () => {
    const items = buildInput([
      msg({ role: "user", content: "Q" }),
      msg({
        id: "m2",
        role: "assistant",
        content: "A",
        reasoning: "思考过程",
        hadToolCall: true,
      }),
    ]);
    expect(items[1]).toEqual({
      type: "reasoning",
      id: "m2",
      content: "思考过程",
    });
    expect(items[2]).toEqual({ type: "message", role: "assistant", content: "A" });
  });

  it("存在 webSearch.callId 时插入 web_search_call item（原 id）且位于 assistant 之前", () => {
    const items = buildInput([
      msg({ role: "user", content: "Q" }),
      msg({
        role: "assistant",
        content: "A",
        webSearch: { callId: "ws_1", status: "completed" },
      }),
    ]);
    expect(items[1]).toEqual({ type: "web_search_call", id: "ws_1" });
    expect(items[2]).toEqual({ type: "message", role: "assistant", content: "A" });
  });

  it("reasoning + web_search_call + message 顺序正确（与官方 output items 一致）", () => {
    const items = buildInput([
      msg({ role: "user", content: "Q" }),
      msg({
        role: "assistant",
        content: "A",
        reasoning: "R",
        hadToolCall: true,
        webSearch: { callId: "ws_9", status: "completed" },
      }),
    ]);
    expect(items.map((i) => i.type)).toEqual([
      "message",
      "reasoning",
      "web_search_call",
      "message",
    ]);
  });
});
