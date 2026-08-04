import type { StoredMessage } from "@/lib/types";
import { estimateTokens } from "@/lib/utils/token-estimate";

/** 单条消息的估算 token 数（content + 可回传的 reasoning，review 修复） */
function msgTokens(m: StoredMessage): number {
  return (
    estimateTokens(m.content) +
    (m.reasoning ? estimateTokens(m.reasoning) : 0)
  );
}

/**
 * 长对话截断（docs/03-api-integration/context-cache.md 第 5 节）：
 * - 保留前缀（instructions 由调用方处理，不在此函数内）
 * - 从最旧开始成对丢弃完整轮次（user + assistant），绝不拆半轮
 * - 最后一条消息（通常是当前输入 user 消息）恒保留
 * - 丢弃后新前缀保持稳定，后续轮次重新享受缓存
 */
export interface TruncateResult {
  messages: StoredMessage[];
  droppedRounds: number; // 丢弃的完整轮次数
  estimatedTokens: number; // 截断后的估算 token 数
}

export function truncateHistory(
  history: StoredMessage[],
  budgetTokens: number
): TruncateResult {
  if (history.length <= 1) {
    return {
      messages: history,
      droppedRounds: 0,
      estimatedTokens: history.reduce((n, m) => n + msgTokens(m), 0),
    };
  }

  let total = history.reduce((n, m) => n + msgTokens(m), 0);
  let start = 0;
  let dropped = 0;

  // 从头成对丢弃（user + 紧随的 assistant），保证至少保留最后一条消息
  while (total > budgetTokens && start < history.length - 1) {
    // 防御：跳过开头的孤立 assistant
    if (history[start].role === "assistant") {
      start++;
      continue;
    }
    const userMsg = history[start];
    const next = history[start + 1];
    const pairLen = next ? 2 : 1;
    // 若丢弃这一对后剩余不足 1 条，停止丢弃（最后一条消息恒保留）
    if (history.length - (start + pairLen) < 1) break;
    const droppedTokens =
      msgTokens(userMsg) + (next ? msgTokens(next) : 0);
    total -= droppedTokens;
    start = next ? start + 2 : start + 1;
    dropped++;
  }

  return {
    messages: history.slice(start),
    droppedRounds: dropped,
    estimatedTokens: total,
  };
}

/** 上下文预算（tokens）。输入超出上下文窗口会 400，预算留 30% 余量（1M 窗口 → 700K） */
export const CONTEXT_BUDGET_TOKENS = 700_000;
