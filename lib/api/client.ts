import type { ChatRequest, DeepseekEvent, ErrorCodeName } from "@/lib/types";
import { ChatError } from "@/lib/types";
import { parseSSEBlock } from "@/lib/api/parse-sse";
import {
  isContextTooLongError,
  mapHttpToCode,
} from "@/lib/errors";

/**
 * 前端流式对话入口（docs/03-api-integration/streaming.md 第 5 节）。
 *
 * 两种模式（README「部署」章节）：
 * 1. 代理模式（默认）：POST /api/chat，自有后端转发 DeepSeek（Key 不离开自有服务）
 * 2. 直连模式（NEXT_PUBLIC_DIRECT_API=1，GitHub Pages 等纯静态托管）：
 *    浏览器直接 POST DeepSeek `https://api.deepseek.com/v1/responses`，
 *    Key 经 Authorization 头发送（DeepSeek CORS 已验证支持）；
 *    请求体去掉 apiKey 字段，错误按 OpenAI 风格映射
 */
const DIRECT_API = process.env.NEXT_PUBLIC_DIRECT_API === "1";
const DEEPSEEK_BASE_URL =
  process.env.NEXT_PUBLIC_DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

export async function* streamChat(
  req: ChatRequest,
  signal?: AbortSignal
): AsyncGenerator<DeepseekEvent> {
  // 首字节超时（error-handling.md 第 5 节）：90s 无响应 → 本地 abort 并抛 upstream_timeout
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), 90_000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  const url = DIRECT_API ? `${DEEPSEEK_BASE_URL}/v1/responses` : "/api/chat";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: string;
  if (DIRECT_API) {
    headers.Authorization = `Bearer ${req.apiKey}`;
    const { apiKey: _apiKey, ...directBody } = req;
    body = JSON.stringify(directBody);
  } else {
    body = JSON.stringify(req);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: combinedSignal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new ChatError("upstream_timeout", "生成超时，请重试");
    }
    throw e;
  }
  clearTimeout(timer); // 首响应已到达

  if (!res.ok) {
    throw parseErrorResponse(res);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new ChatError("network_error", "无法读取响应流", res.status);
  }

  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? ""; // 最后一段可能不完整，留到下一轮
    for (const block of blocks) {
      for (const event of parseSSEBlock(block)) {
        yield event;
      }
    }
  }

  // 流结尾若没有 "\n\n" 分隔，处理残留缓冲
  if (buf.trim()) {
    for (const event of parseSSEBlock(buf)) {
      yield event;
    }
  }
}

/**
 * 非 200 响应 → ChatError。
 * - 代理模式：{ error: { code, message, status } }
 * - 直连模式：OpenAI 风格 { error: { message, type, code } } + HTTP 状态码
 */
async function parseErrorResponse(res: Response): Promise<ChatError> {
  let payload: {
    error?: { code?: ErrorCodeName | string; message?: string; status?: number };
  } = {};
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    payload = {};
  }
  const err = payload.error ?? {};

  if (DIRECT_API) {
    // 直连：以 HTTP 状态码映射（401→invalid_api_key 等），message 用上游原文
    let code: ErrorCodeName = mapHttpToCode(res.status);
    const message = err.message ?? "请求失败";
    if (code === "bad_request" && isContextTooLongError(message)) {
      code = "context_too_long";
    }
    return new ChatError(code, message, res.status);
  }

  // 代理：优先使用后端已映射的 code
  return new ChatError(
    (err.code as ErrorCodeName | undefined) ?? "upstream_error",
    err.message ?? "请求失败",
    err.status ?? res.status
  );
}
