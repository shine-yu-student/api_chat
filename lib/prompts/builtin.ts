import { BUILTIN_PROMPT_ID, type SystemPrompt } from "@/lib/types";

// 内置基础 System Prompt：不可编辑、不可删除（FR-11，见 docs/04-frontend/prompt-library.md）
export const BUILTIN_DEFAULT_PROMPT: SystemPrompt = {
  id: BUILTIN_PROMPT_ID,
  name: "基础助手",
  isBuiltin: true,
  content: [
    "你是 DeepSeek 网页版助手，请用简洁、准确、友好的中文回答用户问题。",
    "回答结构清晰，适当使用 Markdown（列表、代码块、表格）组织内容；",
    "涉及代码时给出可直接运行的完整示例；",
    "遇到不确定的信息请如实说明，不要编造。",
  ].join("\n"),
  createdAt: 0,
  updatedAt: 0,
};
