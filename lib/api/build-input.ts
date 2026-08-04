import type { InputItem, StoredMessage } from "@/lib/types";

/**
 * 会话历史 → Responses API input items（docs/03-api-integration/responses-api.md 3.2、
 * thinking.md 第 4 节、web-search.md 第 5 节）。
 *
 * 算法：
 * - user 消息 → { type: "message", role: "user", content }
 * - assistant 消息 → { type: "message", role: "assistant", content: 最终正文 }
 * - 若该轮有 web_search_call（msg.webSearch.callId 存在），在 assistant item 之前
 *   插入 { type: "web_search_call", id: callId }（原样回传，服务端自动恢复搜索结果）
 * - 若该轮发生了工具调用（hadToolCall）且存有 reasoning，在 assistant item 之前
 *   插入 { type: "reasoning", id, content }（仅带工具调用的轮次回传，thinking.md 第 4 节）
 * - 无工具轮次不回传 reasoning
 *
 * 注意：中间截断（context-cache.md 第 5 节：保留前缀、丢弃最旧）留待后续阶段实现，
 * 本阶段全量透传历史。
 */
export function buildInput(history: StoredMessage[]): InputItem[] {
  const items: InputItem[] = [];

  for (const msg of history) {
    if (msg.role === "user") {
      items.push({ type: "message", role: "user", content: msg.content });
      continue;
    }

    // assistant 消息：先 reasoning（仅带工具调用轮次），再 web_search_call，
    // 最后正文 message（顺序与官方 output items 一致：reasoning → web_search_call → message）
    if (msg.hadToolCall && msg.reasoning) {
      items.push({ type: "reasoning", id: msg.id, content: msg.reasoning });
    }
    if (msg.webSearch?.callId) {
      items.push({ type: "web_search_call", id: msg.webSearch.callId });
    }
    items.push({ type: "message", role: "assistant", content: msg.content });
  }

  return items;
}
