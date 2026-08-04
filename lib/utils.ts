import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind 类名（clsx + tailwind-merge） */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 生成 uuid：优先 crypto.randomUUID，不可用时 Math.random 兜底 */
export function uuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 时间戳 → HH:mm */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** 毫秒 → "X.X 秒" */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  return `${(safe / 1000).toFixed(1)} 秒`;
}
