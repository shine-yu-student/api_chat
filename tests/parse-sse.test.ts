import { describe, expect, it } from "vitest";
import { parseSSEBlock } from "@/lib/api/parse-sse";

describe("parseSSEBlock（streaming.md 第 5 节）", () => {
  it("解析 data: 行中的事件对象", () => {
    const block = 'data: {"type":"response.created","sequence_number":1}\n\n';
    const events = parseSSEBlock(block);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "response.created" });
  });

  it("一个块中可含多个事件", () => {
    const block =
      'data: {"type":"response.created"}\n\ndata: {"type":"response.output_text.delta","delta":"你"}\n\n';
    const events = parseSSEBlock(block);
    expect(events.map((e) => e.type)).toEqual([
      "response.created",
      "response.output_text.delta",
    ]);
  });

  it("跨块边界：事件被 \\n\\n 切分时，块内含不完整 JSON 也不抛错", () => {
    // 模拟流式切块：块 1 是不完整事件，块 2 是完整事件
    const part1 = 'data: {"type":"response.output_text.delta","de';
    const part2 = 'lta":"好"}\n\n';
    expect(() => parseSSEBlock(part1)).not.toThrow();
    const events = parseSSEBlock(part1 + part2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "response.output_text.delta",
      delta: "好",
    });
  });

  it("忽略非 data: 行（如注释行）", () => {
    const block = ': keep-alive\n\ndata: {"type":"response.created"}\n\n';
    const events = parseSSEBlock(block);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("response.created");
  });

  it("JSON 解析失败的行静默跳过，不抛错", () => {
    expect(() => parseSSEBlock("data: {broken json}\n\n")).not.toThrow();
    expect(parseSSEBlock("data: {broken json}\n\n")).toHaveLength(0);
  });

  it("空块返回空数组", () => {
    expect(parseSSEBlock("")).toHaveLength(0);
  });
});
