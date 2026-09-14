import { useEffect, useRef } from "react";
import type { Overview } from "../types";
import { StatusPill } from "./StatusPill";

type Answer = Overview["observations"]["answers"][number];

export function AnswerDrawer({ answer, onClose }: { answer: Answer | null; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!answer) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [answer, onClose]);

  if (!answer) return null;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="answer-title" onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeButtonRef} className="close" onClick={onClose} aria-label="关闭回答详情">×</button>
        <p className="eyebrow">原始回答证据</p>
        <h2 id="answer-title">第 {answer.round} 轮 · {answer.question}</h2>
        <div className="meta">
          <StatusPill value={answer.surface} tone="good" />
          <span>{answer.model}</span><span>{answer.tokens} tokens</span><span>{answer.attempts} 次尝试</span>
        </div>
        <div className="answer-text">{answer.answerText}</div>
        <dl className="evidence">
          <div><dt>采集时间</dt><dd>{new Date(answer.capturedAt).toLocaleString("zh-CN")}</dd></div>
          <div><dt>结束原因</dt><dd>{answer.finishReason}</dd></div>
          <div><dt>证据标识</dt><dd className="mono">{answer.id}</dd></div>
        </dl>
        <p className="notice">这是 DeepSeek API 文本回答，不代表 Web/App 搜索结果。回答中的网址尚未判定为引用。</p>
      </aside>
    </div>
  );
}
