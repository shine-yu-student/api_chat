/**
 * 轻量 token 估算（docs/03-api-integration/context-cache.md 第 5 节）。
 * 精度不需要高：中文约 0.6~0.8 token/字，取保守系数 0.8，并预留余量。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ASCII 字符 ≈ 0.3 token/字符，CJK 等宽字符 ≈ 0.8 token/字符（保守）
  let ascii = 0;
  let wide = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) ascii++;
    else wide++;
  }
  return Math.ceil(ascii * 0.3 + wide * 0.8);
}
