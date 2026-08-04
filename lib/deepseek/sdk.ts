import OpenAI from "openai";

// DeepSeek API 客户端工厂（docs/03-api-integration/responses-api.md 第 1 节）
export function createClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  });
}
