"use client";

import * as React from "react";
import { MessageItem } from "@/components/chat/MessageItem";
import { BranchSwitcher } from "@/components/chat/BranchSwitcher";
import { getPathMessages, useChatStore } from "@/lib/store/useChatStore";

export interface BranchInfo {
  id: string;
  preview: string;
}

/**
 * 消息流（ui-design.md 4.5 + FR-12 分支）：
 * - 只渲染当前路径（根 → activeLeafId）上的消息
 * - 自动滚动到底；用户上翻（距底部 > 80px）时暂停自动滚动
 * - 分支数据按拓扑键缓存：流式 delta 不改变拓扑 → childrenByParent 引用稳定，
 *   MessageItem 的 React.memo 得以生效（卡顿修复的关键之一）
 */
export function MessageList() {
  const session = useChatStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId)
  );
  const containerRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);

  const handleScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const pathMessages = React.useMemo(
    () => (session ? getPathMessages(session) : []),
    [session]
  );
  const pathIds = React.useMemo(
    () => new Set(pathMessages.map((m) => m.id)),
    [pathMessages]
  );

  // 拓扑签名：父→子关系序列。delta 不改变拓扑 → 签名不变 → childrenByParent 引用稳定
  const topoKey = React.useMemo(
    () =>
      session
        ? session.messages.map((m) => `${m.parentId ?? ""}->${m.id}`).join("|")
        : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.messages]
  );
  const childrenByParent = React.useMemo(() => {
    const map = new Map<string, BranchInfo[]>();
    if (!session) return map;
    for (const m of session.messages) {
      if (!m.parentId) continue;
      const arr = map.get(m.parentId) ?? [];
      arr.push({ id: m.id, preview: m.content.slice(0, 12) });
      map.set(m.parentId, arr);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoKey]);

  // 新消息/流式 delta 到达时滚到底（依赖 pathMessages 引用变化）
  React.useEffect(() => {
    const el = containerRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [pathMessages]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto overscroll-contain"
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {pathMessages.map((m) => {
          const branches = childrenByParent.get(m.id) ?? [];
          return (
            <div key={m.id}>
              <MessageItem message={m} />
              {branches.length > 1 && (
                <BranchSwitcher branches={branches} pathIds={pathIds} />
              )}
            </div>
          );
        })}
        <div className="h-4" />
      </div>
    </div>
  );
}
