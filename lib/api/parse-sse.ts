import type { DeepseekEvent } from "@/lib/types";

/**
 * SSE 块解析（docs/03-api-integration/streaming.md 第 5 节）。
 * 输入一个以 "\n\n" 分隔的块（可含多行），解析其中所有 "data: {json}" 行。
 * - 仅处理以 "data: " 开头的行（忽略注释行 / 空行 / event: / id: 等）
 * - JSON.parse 失败的行直接跳过（不抛错），如无 [DONE] 结尾或脏数据
 * - 解析成功后按 DeepseekEvent 类型断言返回
 */
export function parseSSEBlock(block: string): DeepseekEvent[] {
  const events: DeepseekEvent[] = [];

  for (const line of block.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice("data: ".length).trim();
    if (!raw) continue;
    try {
      events.push(JSON.parse(raw) as DeepseekEvent);
    } catch {
      // 该行不是合法 JSON，跳过，不影响其余行
    }
  }

  return events;
}
