import type { ModelId } from "@/lib/types";

// 模型常量与 Responses API 可用性开关（docs/03-api-integration/responses-api.md 第 2 节）
export const MODELS: Record<
  "flash" | "pro",
  { id: ModelId; label: string }
> = {
  flash: { id: "deepseek-v4-flash", label: "DeepSeek-V4 Flash" },
  pro: { id: "deepseek-v4-pro", label: "DeepSeek-V4 Pro" },
};

// Responses API 支持开关表：官方开放 Pro 后把 false 改为 true 即可
export const MODEL_SUPPORT: Record<ModelId, boolean> = {
  "deepseek-v4-flash": true,
  "deepseek-v4-pro": false, // 官方：2026 年 8 月初增加支持
};
