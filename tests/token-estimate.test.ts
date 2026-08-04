import { describe, expect, it } from "vitest";
import { estimateTokens } from "@/lib/utils/token-estimate";

describe("estimateTokens（context-cache.md 第 5 节）", () => {
  it("空串为 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("中文按 0.8 token/字 保守估算", () => {
    const n = estimateTokens("你好世界");
    expect(n).toBe(Math.ceil(4 * 0.8));
  });

  it("ASCII 按 0.3 token/字符 估算", () => {
    const n = estimateTokens("hello");
    expect(n).toBe(Math.ceil(5 * 0.3));
  });

  it("混合文本估算在合理区间（不大于字符数）", () => {
    const text = "你好 hello 世界 world";
    const n = estimateTokens(text);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(text.length);
  });
});
