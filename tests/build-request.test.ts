import { describe, expect, it } from "vitest";
import { buildChatRequest } from "@/lib/api/build-request";

describe("buildChatRequest（responses-api.md 第 3 节）", () => {
  const base = {
    apiKey: "sk-test",
    model: "deepseek-v4-flash" as const,
    instructions: "你是助手",
    input: [{ type: "message" as const, role: "user" as const, content: "hi" }],
    thinkingEnabled: true,
    thinkingEffort: "high" as const,
    webSearchEnabled: false,
    temperature: 0.7,
  };

  it("思考开启 → reasoning.effort 为对应强度", () => {
    const req = buildChatRequest(base);
    expect(req.reasoning).toEqual({ effort: "high" });
  });

  it("思考开启时不发送 temperature（官方：思考模式下不生效）", () => {
    const req = buildChatRequest(base);
    expect(req.temperature).toBeUndefined();
  });

  it("思考关闭 → effort none 且发送 temperature", () => {
    const req = buildChatRequest({
      ...base,
      thinkingEnabled: false,
      temperature: 0.7,
    });
    expect(req.reasoning).toEqual({ effort: "none" });
    expect(req.temperature).toBe(0.7);
  });

  it("联网开启 → tools 含 web_search；关闭 → 无 tools", () => {
    const on = buildChatRequest({ ...base, webSearchEnabled: true });
    expect(on.tools).toEqual([{ type: "web_search" }]);
    const off = buildChatRequest(base);
    expect(off.tools).toBeUndefined();
  });

  it("stream 恒为 true，且不携带官方不支持/忽略的参数", () => {
    const req = buildChatRequest(base) as unknown as Record<string, unknown>;
    expect(req.stream).toBe(true);
    for (const key of [
      "previous_response_id",
      "conversation",
      "store",
      "prompt_cache_key",
      "prompt_cache_retention",
      "truncation",
      "metadata",
      "include",
      "background",
    ]) {
      expect(key in req).toBe(false);
    }
  });

  it("最小字段完整：model/instructions/input/stream", () => {
    const req = buildChatRequest({ ...base, webSearchEnabled: true });
    expect(req.model).toBe("deepseek-v4-flash");
    expect(req.instructions).toBe("你是助手");
    expect(req.input).toHaveLength(1);
    expect(req.stream).toBe(true);
  });
});
