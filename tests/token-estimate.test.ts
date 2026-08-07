import { describe, expect, it } from "vitest";
import { estimateTokens } from "@/lib/utils/token-estimate";
import { formatTokenCount } from "@/lib/utils";

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

describe("formatTokenCount（ui-design.md 4.1 上下文大小标签）", () => {
  it("0 与负数 → 0", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(-5)).toBe("0");
  });

  it("< 1000 原样显示", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(123)).toBe("123");
  });

  it("≥ 1000 使用 K 缩写并保留一位小数（去尾 .0）", () => {
    expect(formatTokenCount(1000)).toBe("1K");
    expect(formatTokenCount(1234)).toBe("1.2K");
    expect(formatTokenCount(9999)).toBe("10K");
    expect(formatTokenCount(1500)).toBe("1.5K");
  });
});
