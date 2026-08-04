import { NextRequest } from "next/server";
import OpenAI, { APIError } from "openai";
import { createClient } from "@/lib/deepseek/sdk";
import { MODEL_SUPPORT } from "@/lib/deepseek/models";
import type {
  ApiErrorBody,
  ChatRequest,
  DeepseekEvent,
  ErrorCodeName,
  ModelId,
} from "@/lib/types";
import {
  formatErrorMessage,
  isContextTooLongError,
  mapHttpToCode,
} from "@/lib/errors";

/**
 * POST /api/chat —— 唯一后端端点：DeepSeek Responses API SSE 代理
 * （docs/05-backend/proxy-routes.md、docs/03-api-integration/streaming.md）。
 *
 * 流程：请求校验 → 模型开关（MODEL_SUPPORT）→ 白名单透传组装上游参数 →
 * openai SDK 流式调用 → SSE 事件原样透传 → 60s 无数据超时 / 前端断开取消。
 *
 * 安全：apiKey 仅存在于本次请求的内存闭包，不落盘、不打日志（security.md）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no", // 防 Nginx 等反向代理缓冲
};

/** 60s 无任何上游数据视为悬挂，abort 上游并收尾（error-handling.md 第 5 节） */
const IDLE_TIMEOUT_MS = 60_000;

type UpstreamParams = OpenAI.Responses.ResponseCreateParamsStreaming;

// ---------- 辅助函数（纯函数，便于单测） ----------

function jsonError(status: number, code: ErrorCodeName, message: string): Response {
  const body: ApiErrorBody = { error: { code, message, status } };
  return Response.json(body, { status });
}

/**
 * 白名单透传组装上游参数（proxy-routes.md 第 2 节第 3 步）。
 * 仅发送 model / instructions / input / stream:true / reasoning / tools / temperature，
 * 与 lib/api/build-request.ts 的规则保持一致：
 * - reasoning 有则透传（恒有：开→effort，关→effort:"none"）
 * - tools 非空才透传
 * - temperature 仅在思考关闭（reasoning 缺失或 effort === "none"）时发送
 */
function resolveParams(body: ChatRequest): UpstreamParams {
  const params: UpstreamParams = {
    model: body.model,
    instructions: body.instructions,
    input: body.input as unknown as OpenAI.Responses.ResponseInput,
    stream: true,
  };

  if (body.reasoning) {
    params.reasoning = body.reasoning as UpstreamParams["reasoning"];
  }
  if (body.tools?.length) {
    params.tools = body.tools as UpstreamParams["tools"];
  }
  if (
    body.temperature !== undefined &&
    (!body.reasoning || body.reasoning.effort === "none")
  ) {
    params.temperature = body.temperature;
  }

  return params;
}

/**
 * 归一化未知错误 → { status?, message? }。
 * 优先 instanceof APIError（openai v7 命名导出）；SDK 版本差异时用 duck typing 兜底。
 */
function toAPIError(e: unknown): { status?: number; message?: string } | null {
  if (e instanceof APIError) {
    return {
      status: typeof e.status === "number" ? e.status : undefined,
      message: e.message,
    };
  }
  if (e !== null && typeof e === "object" && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    const status = (e as { status?: unknown }).status;
    if (typeof msg === "string") {
      return {
        status: typeof status === "number" ? status : undefined,
        message: msg,
      };
    }
  }
  return null;
}

/** 错误 → { code, message, status }（含 400 上下文超限特征识别） */
function toErrorInfo(e: unknown): { code: ErrorCodeName; message: string; status: number } {
  const apiErr = toAPIError(e);
  if (apiErr) {
    const status = apiErr.status ?? 502;
    let code = mapHttpToCode(status);
    const detail = apiErr.message ?? "";
    if (code === "bad_request" && isContextTooLongError(detail)) {
      code = "context_too_long";
    }
    return { code, message: formatErrorMessage(code, detail), status };
  }
  return { code: "upstream_error", message: formatErrorMessage("upstream_error"), status: 502 };
}

/** 首事件前失败 → 非流式 JSON 错误响应 */
function mapUpstreamError(e: unknown): Response {
  const { code, message, status } = toErrorInfo(e);
  return jsonError(status, code, message);
}

/** 流中途失败收尾事件（与官方 response.failed 格式一致，前端唯一失败入口） */
function failedEvent(code: ErrorCodeName, message: string): DeepseekEvent {
  return {
    type: "response.failed",
    sequence_number: 0,
    response: {
      id: "resp_failed",
      status: "failed",
      model: "",
      output: [],
      error: { code, message },
    },
  };
}

// ---------- Route Handler ----------

export async function POST(req: NextRequest): Promise<Response> {
  // 1. 解析并校验请求体
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, "bad_request", formatErrorMessage("bad_request", "请求体不是合法 JSON"));
  }
  const body = raw as Partial<ChatRequest> | null;
  if (!body || typeof body !== "object") {
    return jsonError(400, "bad_request", formatErrorMessage("bad_request", "请求体为空"));
  }
  if (!body.apiKey || !body.model || !body.input) {
    return jsonError(
      400,
      "bad_request",
      formatErrorMessage("bad_request", "缺少必填字段（apiKey / model / input）")
    );
  }

  // 2. 模型可用性校验（MODEL_SUPPORT 是唯一判定点）
  if (!MODEL_SUPPORT[body.model as ModelId]) {
    return jsonError(501, "model_not_supported", formatErrorMessage("model_not_supported"));
  }

  const chatReq = body as ChatRequest;

  // 3. 上游 AbortController：联动前端断开（req.signal abort → 取消上游，不再产生费用）
  const upstream = new AbortController();
  const onAbort = () => upstream.abort();
  if (req.signal.aborted) {
    upstream.abort();
  } else {
    req.signal.addEventListener("abort", onAbort);
  }

  // 4. 调用 DeepSeek（首事件前失败 → JSON 错误）
  const client = createClient(chatReq.apiKey);
  let stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>;
  try {
    stream = await client.responses.create(resolveParams(chatReq), {
      signal: upstream.signal,
    });
  } catch (e) {
    req.signal.removeEventListener("abort", onAbort);
    return mapUpstreamError(e);
  }

  // 5. 构造 SSE 响应流（事件原样透传，不解析不重排不丢弃）
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false; // idle 超时标志：显式发送 upstream_timeout（review 修复）
      const resetTimer = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timedOut = true;
          upstream.abort();
        }, IDLE_TIMEOUT_MS);
      };

      try {
        resetTimer();
        for await (const event of stream) {
          resetTimer();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (e) {
        // 流中途失败（已发送内容）：response.failed 事件收尾
        // idle 超时 → upstream_timeout；前端断开（controller 已取消）→ 静默
        const info = timedOut
          ? {
              code: "upstream_timeout" as ErrorCodeName,
              message: formatErrorMessage("upstream_timeout"),
            }
          : toErrorInfo(e);
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(failedEvent(info.code, info.message))}\n\n`
            )
          );
        } catch {
          // controller 已取消（前端断开），忽略
        }
      } finally {
        if (timer) clearTimeout(timer);
        // 请求结束，移除上游联动监听（review 修复：避免泄漏）
        req.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // 已取消，忽略
        }
      }
    },
    cancel() {
      // 前端停止/断开 → 取消上游请求
      upstream.abort();
    },
  });

  return new Response(readable, { headers: SSE_HEADERS });
}
