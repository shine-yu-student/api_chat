"use client";

import { cn } from "@/lib/utils";

/** 欢迎视图推荐问题（静态数组，点击直接发送） */
const SUGGESTIONS = [
  "帮我写一份周报",
  "解释一下什么是闭包",
  "推荐 3 本前端入门书",
  "用一句话总结量子计算",
];

/**
 * 欢迎视图（ui-design.md 1.1）：居中 Logo + 欢迎语 + 推荐问题卡片
 */
export function WelcomeView({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 overflow-y-auto px-6 py-10">
      {/* Logo */}
      <div className="flex size-16 items-center justify-center rounded-[20px] bg-primary text-3xl font-bold text-primary-foreground shadow-sm">
        D
      </div>

      <h1 className="text-center text-xl font-medium sm:text-2xl">
        我是 DeepSeek，很高兴见到你！
      </h1>

      {/* 推荐问题卡片 */}
      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((q, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onAsk(q)}
            className={cn(
              "rounded-xl border border-border bg-background p-4 text-left text-sm text-foreground transition-colors",
              "hover:border-primary/40 hover:bg-muted"
            )}
          >
            {q}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        提示：点击推荐问题可直接发送
      </p>
    </div>
  );
}
