import type { ChatRequest, ModelId, ThinkingEffort } from "@/lib/types";

export interface BuildRequestParams {
  apiKey: string;
  model: ModelId;
  instructions: string;
  input: ChatRequest["input"];
  thinkingEnabled: boolean;
  thinkingEffort: ThinkingEffort;
  webSearchEnabled: boolean;
  temperature: number;
}

/**
 * 构造 ChatRequest（docs/03-api-integration/responses-api.md 第 3 节）。
 * 规则：
 * - reasoning 恒发送：思考关 → { effort: "none" }，思考开 → { effort: thinkingEffort }
 * - webSearchEnabled 时发送 tools: [{ type: "web_search" }]，否则省略
 * - temperature 仅思考关闭（effort none）时发送，开启时不发（官方：思考模式下不生效）
 * - stream 恒为 true
 * - 不发送任何官方不支持/忽略的参数（previous_response_id / conversation /
 *   store / prompt_cache_key / truncation 等一律不出现）
 */
export function buildChatRequest(params: BuildRequestParams): ChatRequest {
  const {
    apiKey,
    model,
    instructions,
    input,
    thinkingEnabled,
    thinkingEffort,
    webSearchEnabled,
    temperature,
  } = params;

  const request: ChatRequest = {
    apiKey,
    model,
    instructions,
    input,
    stream: true,
    reasoning: thinkingEnabled
      ? { effort: thinkingEffort }
      : { effort: "none" },
  };

  if (webSearchEnabled) {
    request.tools = [{ type: "web_search" }];
  }

  // 思考关闭时 temperature 才生效，开启时不发送
  if (!thinkingEnabled) {
    request.temperature = temperature;
  }

  return request;
}
