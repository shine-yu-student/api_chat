# 后端代理（Proxy Routes）

> 定义唯一后端端点 `POST /api/chat` 的完整实现规格：请求校验、上游调用、SSE 转发、超时/取消、错误透传。
> 相关：02-architecture（数据流）、03-api-integration/streaming.md（事件转发）、error-handling.md（错误协议）。

## 1. 端点规格

```
POST /api/chat
Content-Type: application/json
Body: ChatRequest（见 responses-api.md 第 3 节，含 apiKey / model / instructions / input / reasoning / tools / temperature）
成功：200 text/event-stream（SSE，事件原样透传）
失败（校验/首事件前）：4xx JSON { error: { code, message, status } }
```

- `export const runtime = "nodejs"`（openai SDK 需要）；`export const dynamic = "force-dynamic"`（不缓存）。
- 请求体大小上限：默认 Next.js 限制即可（input 可能较大，若部署平台默认 1MB 限制需调大，如 Vercel 配置 `maxDuration`/body 限制；本应用 1M 上下文全量发送，必要时按 4MB 放宽）。

## 2. 处理流程（伪代码）

```ts
// app/api/chat/route.ts
export async function POST(req: NextRequest) {
  // 1. 解析并校验请求体
  const body = await req.json().catch(() => null);
  if (!body?.apiKey || !body?.model || !body?.input) {
    return jsonError(400, "bad_request", "缺少必填字段");
  }

  // 2. 模型可用性校验（MODEL_SUPPORT 唯一判定点）
  if (!MODEL_SUPPORT[body.model]) {
    return jsonError(501, "model_not_supported", `模型 ${body.model} 暂不支持 Responses API`);
  }

  // 3. 组装上游参数（白名单透传，避免多余字段）
  const params = {
    model: body.model,
    instructions: body.instructions,
    input: body.input,
    stream: true,
    ...(body.reasoning ? { reasoning: body.reasoning } : {}),
    ...(body.tools?.length ? { tools: body.tools } : {}),
    ...(body.temperature !== undefined && !body.reasoning?.effort || body.reasoning?.effort === "none"
        ? { temperature: body.temperature } : {}),
  };

  // 4. 上游 AbortController（联动前端断开）
  const upstream = new AbortController();
  req.signal.addEventListener("abort", () => upstream.abort());

  // 5. 调用 DeepSeek
  const client = createClient(body.apiKey);
  let stream;
  try {
    stream = await client.responses.create(params, { signal: upstream.signal });
  } catch (e) {
    return mapUpstreamError(e);   // 首事件前失败 → JSON 错误（见第 4 节）
  }

  // 6. 构造 SSE 响应（透传）
  const encoder = new TextEncoder();
  const body2 = new ReadableStream<Uint8Array>({
    async start(controller) {
      const timeout = setTimeout(() => upstream.abort(), 60_000); // 60s 无数据兜底
      try {
        for await (const event of stream) {
          clearTimeout(timeout);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: "response.failed", response: { status: "failed", error: mapError(e) } })}\n\n`
        ));
      } finally {
        clearTimeout(timeout);
        controller.close();
      }
    },
    cancel() { upstream.abort(); },   // 前端停止/断开 → 取消上游
  });

  return new Response(body2, { headers: SSE_HEADERS });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
```

> ⚠️ temperature 条件表达式注意：思考开启（effort ≠ none）时不发 temperature。上式为示意，实现时抽取纯函数 `resolveParams(body)` 便于单测。

## 3. 上游错误映射（首事件前失败）

```ts
function mapUpstreamError(e: unknown): Response {
  if (e instanceof OpenAI.APIError) {
    const code = mapHttpToCode(e.status);  // 401→invalid_api_key, 402→insufficient_balance,
                                           // 429→rate_limited, 400→bad_request(含 context_too_long 特征识别), 5xx→upstream_error
    return jsonError(e.status, code, e.message);
  }
  return jsonError(502, "upstream_error", "上游服务异常");
}
```

- 400 错误中检测上下文超限特征（message 含 "context" / "token" / "too long" 等）→ 返回 `context_too_long`，前端触发自动截断重试。
- 注意区分「模型不支持」：官方对不支持模型可能返回 400 或 404 类错误，本应用已在第 2 步本地拦截，不依赖上游判定。

## 4. 安全与无状态

- 本端点**不 import 任何存储/数据库**；apiKey 仅存在于本次请求的内存闭包中。
- 不写日志（或仅记录 status code 计数），见 security.md。
- 无 CSRF 风险面（GET 无副作用；POST 需要用户自备 Key；同源部署）。

## 5. 备选实现（无 openai SDK 环境）

若部署平台不支持 Node runtime（如纯 Edge），改用原生 fetch：

```ts
const upstream = await fetch("https://api.deepseek.com/v1/responses", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ ...params, stream: true }),
  signal: upstream.signal,
});
// 直接透传 upstream.body（ReadableStream）即可，错误分支按 upstream.status 映射
```

SDK 版本解析事件对象更省事，优先 SDK；fetch 直连为兜底。**推荐 SDK**。

## 6. 实现要点 Checklist

- [ ] route.ts 完整实现（校验 → 模型开关 → 透传 → 超时/取消）
- [ ] `resolveParams` 纯函数 + 单测（temperature 条件、tools/reasoning 拼接）
- [ ] `mapUpstreamError` + 单测（错误码映射表）
- [ ] curl 冒烟验证（见 testing.md 第 3 节）
