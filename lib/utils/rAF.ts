/**
 * requestAnimationFrame 封装（docs/04-frontend/markdown-rendering.md 第 4 节）：
 * 流式 delta 帧级节流。Node 环境（测试）无 rAF，回退到 16ms setTimeout。
 */
export function raf(cb: () => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(cb);
  }
  return setTimeout(cb, 16) as unknown as number;
}

export function cancelRaf(handle: number): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle);
  }
}
