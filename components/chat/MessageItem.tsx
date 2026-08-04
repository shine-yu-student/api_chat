"use client";

import * as React from "react";
import {
  Check,
  Copy,
  Pencil,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import { ReasoningPanel } from "@/components/chat/ReasoningPanel";
import { Markdown } from "@/lib/markdown/render";
import { useChatStore } from "@/lib/store/useChatStore";
import type { StoredMessage } from "@/lib/types";

/**
 * 单条消息（ui-design.md 2.1 + FR-12 分支）：
 * - user：右侧气泡 + 编辑入口（编辑 → 创建分支并自动重新生成）
 * - assistant：左侧整宽（思考面板 + 正文 + 操作行 + 用量行）；重新生成常显（创建新分支）
 * 用 React.memo 浅比较 message 引用：流式 delta 期间仅目标消息重渲染（卡顿修复）。
 */
export const MessageItem = React.memo(function MessageItem({
  message,
}: {
  message: StoredMessage;
}) {
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const retryMessage = useChatStore((s) => s.retryMessage);
  const streaming = useChatStore((s) => s.streaming);

  if (message.role === "user") {
    return (
      <UserMessage
        message={message}
        streaming={streaming}
      />
    );
  }

  const isStreaming = message.status === "streaming";

  return (
    <div className="w-full py-2.5">
      {/* 深度思考面板 */}
      {message.reasoning !== undefined && (
        <ReasoningPanel
          content={message.reasoning}
          elapsedMs={message.reasoningElapsedMs}
          isStreaming={isStreaming}
        />
      )}

      {/* 联网搜索状态 */}
      {message.webSearch && (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-primary/60" />
          {message.webSearch.status === "searching" && "正在搜索网络…"}
          {message.webSearch.status === "completed" && "已搜索网络"}
          {message.webSearch.status === "failed" && "搜索失败"}
        </div>
      )}

      {/* 正文 */}
      <div className="min-w-0">
        <Markdown content={message.content} />
        {isStreaming && (
          <span className="cursor-blink text-primary" aria-hidden>
            ▍
          </span>
        )}
      </div>

      {/* 操作行：复制 / 停止 / 重新生成（创建新分支） */}
      <MessageActions
        content={message.content}
        isStreaming={isStreaming}
        onStop={stopStreaming}
        onRetry={() => retryMessage(message.id)}
      />

      {/* 用量行 */}
      {message.usage && <UsageLine message={message} />}
    </div>
  );
});

/** 用户消息：右侧气泡 + 编辑（FR-12） */
function UserMessage({
  message,
  streaming,
}: {
  message: StoredMessage;
  streaming: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(message.content);
  const editMessage = useChatStore((s) => s.editMessage);

  // 外部内容变化（如切换分支）时同步草稿
  React.useEffect(() => {
    setDraft(message.content);
  }, [message.content]);

  const cancel = () => {
    setDraft(message.content);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-1.5 py-2.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(6, Math.max(2, draft.split("\n").length))}
          disabled={streaming}
          autoFocus
          aria-label="编辑消息"
          className="max-w-[85%] resize-y rounded-[12px] border border-border bg-user-bubble px-4 py-2.5 text-[15px] leading-[1.7] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 sm:max-w-[75%]"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={cancel}
            className="flex items-center gap-1 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
            取消
          </button>
          <button
            type="button"
            disabled={!draft.trim() || streaming}
            onClick={() => {
              void editMessage(message.id, draft);
              setEditing(false);
            }}
            className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="size-3.5" />
            保存并重新生成
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end py-2.5">
      <div className="group flex max-w-[85%] flex-col items-end gap-1 sm:max-w-[75%]">
        <div className="rounded-[12px] bg-user-bubble px-4 py-2.5 text-[15px] leading-[1.7] whitespace-pre-wrap">
          {message.content}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={streaming}
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-0"
          title="编辑此消息（创建分支）"
        >
          <Pencil className="size-3" />
          编辑
        </button>
      </div>
    </div>
  );
}

function MessageActions({
  content,
  isStreaming,
  onStop,
  onRetry,
}: {
  content: string;
  isStreaming: boolean;
  onStop: () => void;
  onRetry: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mt-1.5 flex items-center gap-1">
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={copied ? "已复制" : "复制回答"}
        title={copied ? "已复制" : "复制回答"}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
          aria-label="停止生成"
          title="停止生成"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onRetry}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="重新生成（创建新分支）"
          title="重新生成（创建新分支）"
        >
          <RefreshCw className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** 用量行：输入 X（缓存命中 Y%）· 输出 Z · 思考 W */
function UsageLine({ message }: { message: StoredMessage }) {
  const usage = message.usage;
  if (!usage) return null;
  const hitRate =
    usage.inputTokens > 0
      ? Math.round((usage.cachedTokens / usage.inputTokens) * 100)
      : 0;
  return (
    <div className="mt-1 text-xs text-muted-foreground">
      输入 {usage.inputTokens}（缓存命中 {hitRate}%）· 输出{" "}
      {usage.outputTokens} · 思考 {usage.reasoningTokens}
    </div>
  );
}
