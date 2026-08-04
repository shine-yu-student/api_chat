import { describe, expect, it } from "vitest";
import { truncateHistory, CONTEXT_BUDGET_TOKENS } from "@/lib/utils/truncate-history";
import { estimateTokens } from "@/lib/utils/token-estimate";
import type { StoredMessage } from "@/lib/types";

function round(q: string, a: string, id: number): StoredMessage[] {
  return [
    {
      id: `u${id}`,
      role: "user",
      content: q,
      status: "completed",
      model: "deepseek-v4-flash",
      createdAt: id,
    },
    {
      id: `a${id}`,
      role: "assistant",
      content: a,
      status: "completed",
      model: "deepseek-v4-flash",
      createdAt: id,
    },
  ];
}

describe("truncateHistory（context-cache.md 第 5 节）", () => {
  it("预算充足时不截断", () => {
    const history = [...round("Q1", "A1", 1), ...round("Q2", "A2", 2)];
    const r = truncateHistory(history, CONTEXT_BUDGET_TOKENS);
    expect(r.messages).toHaveLength(4);
    expect(r.droppedRounds).toBe(0);
  });

  it("超预算时从最旧成对丢弃（user+assistant），保留最新", () => {
    const longText = "字".repeat(1000);
    const history = [
      ...round(longText, longText, 1),
      ...round(longText, longText, 2),
      ...round(longText, longText, 3),
      { id: "u9", role: "user" as const, content: "当前问题", status: "completed" as const, model: "deepseek-v4-flash" as const, createdAt: 9 },
    ];
    // 预算 = 2 轮的量，迫使丢弃前 2 轮
    const budget = estimateTokens(longText) * 2 + estimateTokens("当前问题") + 10;
    const r = truncateHistory(history, budget);
    expect(r.droppedRounds).toBe(2);
    expect(r.messages[0].id).toBe("u3");
    // 最后一对（u3/a3）+ 当前输入保留，且最后一条恒为当前输入
    expect(r.messages[r.messages.length - 1].content).toBe("当前问题");
    // 不拆半轮：消息数 = 2*1 + 1
    expect(r.messages).toHaveLength(3);
  });

  it("预算极小也至少保留最后一条消息（最新轮次不丢）", () => {
    const history = [...round("Q1", "A1", 1), ...round("Q2", "A2", 2)];
    const r = truncateHistory(history, 1);
    expect(r.messages.length).toBeGreaterThanOrEqual(1);
    // 丢弃从最旧开始：最新轮次（u2/a2）保留
    expect(r.messages[0].id).toBe("u2");
    expect(r.messages).toHaveLength(2);
  });

  it("单条历史不截断", () => {
    const history = [round("Q1", "A1", 1)[0]];
    const r = truncateHistory(history, 1);
    expect(r.messages).toHaveLength(1);
    expect(r.droppedRounds).toBe(0);
  });
});
