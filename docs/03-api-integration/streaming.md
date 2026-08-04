# 流式链路设计（SSE）

> 定义 DeepSeek → 后端代理 → 前端 的完整流式事件链路：事件表、转发协议、前端解析、取消与超时。
> 依据：[官方「使用 Responses API」流式输出章节](https://api-docs.deepseek.com/zh-cn/guides/responses_api)（2026-07 核实）。

## 1. 关键事实

- `stream: true` 时，DeepSeek 返回语义化的 SSE 事件序列，每行 `data: {json}`，**没有 `data: [DONE]`**。
- 每个事件对象含 `type` 字段与递增的 `sequence_number`。
- 流以 `response.completed` / `response.incomplete` / `response.failed` 之一结束（这三个事件携带完整 response 对象，含 usage）。
- openai SDK 的 `client.responses.create({...}, { stream: true })` 返回异步迭代器，每个元素即一个事件对象（已解析为 JSON）。

## 2. 事件全表（本应用关注的）

| 事件类型 | 触发时机 | 前端处理 |
|---|---|---|
| `response.created` | 首个事件；响应已创建，状态 in_progress | 标记「生成中」，记录开始时间 |
| `response.in_progress` | 响应正在生成 | （可忽略） |
| `response.output_item.added` | 一个输出 item 开始（reasoning / message / function_call / custom_tool_call / web_search_call） | 按 `item.type` 初始化对应 UI 区块 |
| `response.output_item.done` | 输出 item 完成 | 收尾区块（如思考折叠） |
| `response.content_part.added` / `response.content_part.done` | 输出 item 中一个内容块开始/完成 | （可忽略，块粒度太细） |
| `response.reasoning_text.delta` | 思维链文本增量（`delta` 字段） | 追加到思考面板 |
| `response.reasoning_text.done` | 思维链完整 | 记录完整推理文本、折叠 UI |
| `response.output_text.delta` | 输出文本增量（`delta` 字段） | 追加到回答正文 |
| `response.output_text.done` | 输出文本完整 | （可忽略） |
| `response.web_search_call.in_progress` | 服务端开始联网搜索 | 显示「正在搜索网络…」状态 |
| `response.web_search_call.searching` | 搜索进行中 | 状态动画（可轮播文案） |
| `response.web_search_call.completed` | 搜索完成 | 记录 `call id`（回传用），状态 →「已搜索」 |
| `response.completed` | **正常完成**，携带完整 response（含 usage） | 写入用量、结束流、持久化 |
| `response.incomplete` | 被截断（如 max_output_tokens） | 提示截断 + 保留已生成内容 |
| `response.failed` | 失败，携带含 `error` 详情的 response | 展示错误、保留已生成内容 |

事件对象形态示例：

```jsonc
// response.output_text.delta
{ "type": "response.output_text.delta", "sequence_number": 7, "delta": "你", "item_id": "msg_1", "output_index": 0, "content_index": 0 }

// response.web_search_call.searching
{ "type": "response.web_search_call.searching", "sequence_number": 3, "item_id": "ws_1" }

// response.completed
{ "type": "response.completed", "sequence_number": 12, "response": { "id": "resp_..", "status": "completed", "output": [...], "usage": { ... } } }
```

## 3. 链路总览

```
[DeepSeek] SSE 事件流
   │  openai SDK 异步迭代器
   ▼
[后端 Route Handler] 逐事件读取 → res.write(`data: ${JSON.stringify(event)}\n\n`)   ← 原样透传
   │  fetch Response.body (ReadableStream)
   ▼
[前端 client.ts] 解析 SSE → 按 type 分发 → zustand store 更新 → UI 增量渲染
```

## 4. 后端转发实现（app/api/chat/route.ts）

```ts
// 伪代码骨架，完整版见 05-backend/proxy-routes.md
export async function POST(req: Request) {
  const { apiKey, model, instructions, input, reasoning, tools, temperature } = await req.json();

  // 1. 模型可用性校验（MODEL_SUPPORT）
  // 2. 校验 apiKey 存在
  // 3. 创建上游 AbortController（与请求的 signal 联动，支持前端取消）
  const client = createClient(apiKey);
  const stream = await client.responses.create(
    { model, instructions, input, stream: true, reasoning, tools, temperature },
    { signal: controller.signal }
  );

  // 4. 构建 SSE 响应流
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller2) {
      try {
        for await (const event of stream) {
          controller2.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (e) {
        // 上游失败：若尚未发送任何内容，转为 JSON 错误响应；
        // 若已发送，则发送一条 error 事件（见第 6 节）
      } finally {
        controller2.close();
      }
    },
    cancel() { controller.abort(); } // 前端断开 → 取消上游请求
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // 防 Nginx 缓冲
    },
  });
}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

**透传原则**：后端不解析、不重排、不丢弃任何事件；错误处理只在外层兜底（第 6 节）。前端是唯一的事件建模层。

## 5. 前端解析与分发（lib/api/client.ts）

```ts
export async function* streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<DeepseekEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw await res.json(); // 非流式错误（{error:{code,message,status}}）

  // 方案 A（推荐，零依赖）：手工解析 SSE —— 本应用的事件只有 JSON 行，
  // 用 ReadableStream + TextDecoder 按 "\n\n" 切块即可，约 80 行：
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? "";
    for (const block of blocks) {
      for (const line of block.split("\n")) {
        if (line.startsWith("data: ")) {
          yield JSON.parse(line.slice(6)) as DeepseekEvent;
        }
      }
    }
  }
  // 方案 B：借用 npm 包 eventsource-parser（createParser），效果相同
}
```

> 注意：DeepSeek 流中无 `[DONE]`，结束即读尽；不要按 `[DONE]` 判断完成，应依赖 `response.completed/incomplete/failed` 事件。

### 前端事件分发（useChatStore 中的处理逻辑）

```ts
switch (event.type) {
  case "response.created":            setStreaming(true); startTime = Date.now(); break;
  case "response.output_item.added":  switch (event.item.type) { ... 初始化 reasoning 面板 / 消息块 / 搜索状态 } break;
  case "response.reasoning_text.delta": appendReasoning(event.delta); break;
  case "response.output_text.delta":    appendContent(event.delta); break;
  case "response.web_search_call.searching": setSearchStatus("searching"); break;
  case "response.web_search_call.completed": searchCallId = event.item_id; setSearchStatus("completed"); break;
  case "response.reasoning_text.done":  finalizeReasoning(); break;
  case "response.output_item.done":     if (item.type==="web_search_call") 记录 call id; break;
  case "response.completed":   finalize(event.response); break;  // usage、持久化
  case "response.incomplete":  finalize(event.response, { truncated: true }); break;
  case "response.failed":      fail(event.response.error); break;
}
```

### 流式 UI 更新节流

- `output_text.delta` 高频到达：React 每次 setState 都触发渲染会卡顿。策略：
  - 直接用 `store.getState().appendContent()` 追加，让 zustand 触发订阅者；
  - 正文渲染组件（MessageItem）用 `useSyncExternalStore` 或简单地在内容变化时 setState，React 18+ 自动批处理，实测每 token 一次更新在现代浏览器可接受；
  - 若发现卡顿，对 `output_text.delta` 做 16ms 节流合并（见 markdown-rendering.md 第 5 节）。

## 6. 错误与边界处理（后端）

| 场景 | 行为 |
|---|---|
| 上游在首个事件前失败（如 401） | SDK 抛错 → 返回 JSON 错误响应（`{error:{code,message,status}}`，非 SSE） |
| 上游中途失败（已发送部分事件） | 发送 `data: {"type":"response.failed","response":{...}}` 收尾（或 error 事件），前端按流内失败处理 |
| 前端断开（停止按钮/关页面） | `cancel()` → `controller.abort()` → 上游请求取消，不再产生费用 |
| 60s 无任何上游数据 | 定时器触发 abort + 发送失败事件（防悬挂） |
| 前端请求体非法（缺 apiKey/input 等） | 400 JSON 错误 |

## 7. 取消（停止生成）流程

1. 前端「停止」按钮 → `abortController.abort()` → fetch 断开
2. 后端 ReadableStream `cancel()` 回调 → 上游 controller.abort() → DeepSeek 请求取消
3. 前端 store 将当前消息状态置为 `stopped`，保留已生成内容，提供「重新生成」按钮
4. 若停止前已收到 `response.completed`，则正常收尾

## 8. 实现要点 Checklist

- [ ] `lib/api/client.ts`：`streamChat` 生成器 + SSE 解析 + 非 200 错误抛出
- [ ] `lib/api/parse-sse.ts`：解析逻辑抽成纯函数（输入 string 块 → 事件数组），单测覆盖
- [ ] `app/api/chat/route.ts`：透传 + 取消联动 + 60s 超时
- [ ] 单测：构造一段完整 SSE 文本（created → reasoning delta → output delta → completed），断言解析结果
