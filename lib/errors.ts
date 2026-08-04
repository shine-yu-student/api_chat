import type { ErrorCodeName } from "@/lib/types";

/**
 * 错误码 → 用户文案映射、HTTP 状态 → ErrorCodeName 映射、
 * 上下文超限特征识别（docs/03-api-integration/error-handling.md 第 1 节）。
 */
export const ERROR_MESSAGES: Record<ErrorCodeName, string> = {
  missing_api_key: "请先在设置中配置 API Key",
  model_not_supported: "该模型暂不支持 Responses API，请先使用 Flash 模型",
  invalid_api_key: "API Key 无效，请检查设置中的 Key",
  insufficient_balance: "账户余额不足，请前往 DeepSeek 平台充值",
  rate_limited: "请求过于频繁，请稍后重试",
  bad_request: "请求有误：{detail}",
  context_too_long: "上下文过长，正在自动精简历史后重试",
  validation_error: "参数校验失败：{detail}",
  upstream_error: "DeepSeek 服务暂时不可用，请稍后重试",
  upstream_timeout: "生成超时，请重试",
  network_error: "网络连接中断，已保留已生成内容",
};

/**
 * HTTP 状态 → 错误码（error-handling.md 1.1 映射表）。
 * 400→bad_request、401→invalid_api_key、402→insufficient_balance、
 * 422→validation_error、429→rate_limited、5xx 及其他→upstream_error。
 */
export function mapHttpToCode(status: number): ErrorCodeName {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "invalid_api_key";
    case 402:
      return "insufficient_balance";
    case 422:
      return "validation_error";
    case 429:
      return "rate_limited";
    default:
      return "upstream_error"; // 含全部 5xx 与未识别状态
  }
}

/**
 * 上下文超限特征识别（error-handling.md 第 3 节）：
 * 上游 400 错误 message 含 context/上下文/token/too long/length 等关键词 → context_too_long。
 */
export function isContextTooLongError(message: string): boolean {
  const text = message.toLowerCase();
  const keywords = [
    "context",
    "上下文",
    "token",
    "too long",
    "length",
    "exceed",
    "超长",
    "超限",
    "limit",
  ];
  return keywords.some((kw) => text.includes(kw.toLowerCase()));
}

/**
 * 把 {detail} 占位符替换为具体信息（用于 bad_request / validation_error 等模板）。
 * 无占位符的文案原样返回；detail 缺省时替换为空串。
 */
export function formatErrorMessage(code: ErrorCodeName, detail?: string): string {
  const template = ERROR_MESSAGES[code];
  if (!template.includes("{detail}")) return template;
  return template.replace("{detail}", detail ?? "");
}
