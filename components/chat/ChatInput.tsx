"use client";

import * as React from "react";
import {
  Brain,
  ChevronDown,
  Globe,
  Send,
  Square,
  X,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getPathMessages, useChatStore } from "@/lib/store/useChatStore";
import { useSettingsStore } from "@/lib/store/useSettingsStore";
import { estimateTokens } from "@/lib/utils/token-estimate";
import type { ThinkingEffort, UsageInfo } from "@/lib/types";
import { cn, formatTokenCount } from "@/lib/utils";

const EFFORT_OPTIONS: { value: ThinkingEffort; label: string }[] = [
  { value: "low", label: "低" },
  { value: "high", label: "高" },
  { value: "max", label: "最高" },
];

/**
 * 输入区（ui-design.md 4.1-4.3）：
 * - textarea 自动增高（1 ~ 8 行），Enter 发送 / Shift+Enter 换行（中文输入法 isComposing 保护）
 * - 深度思考胶囊（激活后点击弹出强度 RadioGroup）
 * - 联网搜索胶囊
 * - streaming 时：输入区禁用、发送按钮变红色停止按钮
 * - streamError 提示条（model_not_supported 琥珀色，其余红/橙色，可关闭）
 */
export function ChatInput() {
  const [text, setText] = React.useState("");
  const [effortOpen, setEffortOpen] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const effortRef = React.useRef<HTMLDivElement>(null);

  const streaming = useChatStore((s) => s.streaming);
  const streamError = useChatStore((s) => s.streamError);
  const clearStreamError = useChatStore((s) => s.clearStreamError);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const activeSession = useChatStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId)
  );

  const thinkingEnabled = useSettingsStore((s) => s.thinkingEnabled);
  const setThinkingEnabled = useSettingsStore((s) => s.setThinkingEnabled);
  const thinkingEffort = useSettingsStore((s) => s.thinkingEffort);
  const setThinkingEffort = useSettingsStore((s) => s.setThinkingEffort);
  const webSearchEnabled = useSettingsStore((s) => s.webSearchEnabled);
  const setWebSearchEnabled = useSettingsStore((s) => s.setWebSearchEnabled);

  // textarea 自动增高（rows=1 → max 8 行）
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 8 * 24 + 8)}px`;
  }, [text]);

  // 点击外部关闭 effort 面板
  React.useEffect(() => {
    if (!effortOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        effortRef.current &&
        !effortRef.current.contains(e.target as Node)
      ) {
        setEffortOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [effortOpen]);

  const handleSend = async () => {
    const value = text.trim();
    if (!value || streaming) return;
    setText("");
    setEffortOpen(false);
    await sendMessage(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送 / Shift+Enter 换行；中文输入法组词中不触发
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  // 上下文大小（ui-design.md 4.1）：当前会话路径消息 + System Prompt 快照的本地估算，
  // 与发送前截断预算口径一致（不含则可能低估 instructions 部分）
  const pathMessages = React.useMemo(
    () => (activeSession ? getPathMessages(activeSession) : []),
    [activeSession]
  );
  const contextTokens = React.useMemo(
    () =>
      (activeSession ? estimateTokens(activeSession.systemPromptText) : 0) +
      pathMessages.reduce(
        (n, m) =>
          n +
          estimateTokens(m.content) +
          (m.reasoning ? estimateTokens(m.reasoning) : 0),
        0
      ),
    [activeSession, pathMessages]
  );
  // 上一轮真实用量（悬浮详情）：当前路径最后一条 assistant 消息；无则显示占位
  const lastAssistant = React.useMemo(
    () => [...pathMessages].reverse().find((m) => m.role === "assistant"),
    [pathMessages]
  );

  const isModelError =
    streamError?.includes("暂不支持") ?? false;
  const canSend = text.trim().length > 0 && !streaming;

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      {/* 错误提示条（输入区上方） */}
      {streamError && (
        <div className="mx-auto mb-2 max-w-3xl">
          <div
            className={cn(
              "flex items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-sm",
              isModelError
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            )}
            role="alert"
          >
            <span className="min-w-0 flex-1">{streamError}</span>
            <button
              type="button"
              onClick={clearStreamError}
              className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
              aria-label="关闭提示"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl">
        {/* 输入容器 */}
        <div className="rounded-xl border border-border bg-background shadow-sm transition-colors focus-within:border-ring">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            disabled={streaming}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="给 DeepSeek 发送消息"
            aria-label="消息输入框"
            className="max-h-[200px] w-full resize-none overflow-y-auto bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />

          {/* 底部工具行 */}
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <div className="flex items-center gap-1">
              {/* 深度思考胶囊 */}
              <div className="relative" ref={effortRef}>
                <button
                  type="button"
                  onClick={() => {
                    if (!thinkingEnabled) {
                      setThinkingEnabled(true);
                    } else {
                      setEffortOpen((o) => !o);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
                    thinkingEnabled
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  aria-pressed={thinkingEnabled}
                  title="深度思考"
                >
                  <Brain className="size-4" />
                  深度思考
                  {thinkingEnabled && (
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform",
                        effortOpen && "rotate-180"
                      )}
                    />
                  )}
                </button>

                {/* 思考强度选择 */}
                {effortOpen && thinkingEnabled && (
                  <div className="absolute bottom-full left-0 z-30 mb-2 rounded-lg border border-border bg-background p-3 shadow-lg">
                    <p className="mb-2 text-xs text-muted-foreground">
                      思考强度
                    </p>
                    <RadioGroup
                      value={thinkingEffort}
                      onValueChange={(v) => setThinkingEffort(v as ThinkingEffort)}
                    >
                      {EFFORT_OPTIONS.map((o) => (
                        <div
                          key={o.value}
                          className="flex items-center gap-2 py-0.5"
                        >
                          <RadioGroupItem
                            value={o.value}
                            id={`effort-${o.value}`}
                          />
                          <Label htmlFor={`effort-${o.value}`}>{o.label}</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </div>

              {/* 联网搜索胶囊 */}
              <button
                type="button"
                onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
                  webSearchEnabled
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
                aria-pressed={webSearchEnabled}
                title="联网搜索"
              >
                <Globe className="size-4" />
                联网搜索
              </button>
            </div>

            {/* 发送 / 停止（左侧为上下文大小，悬浮显示上一轮用量，ui-design.md 4.1） */}
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="cursor-default text-xs text-muted-foreground select-none"
                    title="查看上一轮用量"
                  >
                    上下文 {formatTokenCount(contextTokens)}
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="border border-border bg-background text-foreground shadow-lg"
                >
                  {lastAssistant?.usage ? (
                    <div className="min-w-44">
                      <p className="mb-1.5 font-medium">上一轮用量</p>
                      <UsageDetail usage={lastAssistant.usage} />
                    </div>
                  ) : (
                    <span>暂无上一轮用量数据</span>
                  )}
                </TooltipContent>
              </Tooltip>

              {streaming ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  className="flex size-10 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
                  aria-label="停止生成"
                  title="停止生成"
                >
                  <Square className="size-4 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!canSend}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full transition-colors",
                    canSend
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "cursor-not-allowed bg-muted text-muted-foreground"
                  )}
                  aria-label="发送"
                  title="发送"
                >
                  <Send className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 免责小字 */}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          内容由 AI 生成，仅供学习参考
        </p>
      </div>
    </div>
  );
}

/**
 * 上一轮真实用量明细（ui-design.md 4.1 上下文大小悬浮浮窗）：
 * 缓存输入 / 非缓存输入 / 输出 / 思考 / 缓存率（公式与 MessageItem UsageLine 一致）
 */
function UsageDetail({ usage }: { usage: UsageInfo }) {
  const hitRate =
    usage.inputTokens > 0
      ? Math.round((usage.cachedTokens / usage.inputTokens) * 100)
      : 0;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens);
  const rows: { label: string; value: string }[] = [
    { label: "缓存输入", value: String(usage.cachedTokens) },
    { label: "非缓存输入", value: String(uncached) },
    { label: "输出", value: String(usage.outputTokens) },
    { label: "思考", value: String(usage.reasoningTokens) },
    { label: "缓存率", value: `${hitRate}%` },
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
      {rows.map((r) => (
        <React.Fragment key={r.label}>
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="text-right font-medium tabular-nums">{r.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
