import { useState } from "react";
import {
  ArrowUp,
  Sparkles,
  Languages,
  Square,
  StickyNote,
  ArrowUpRight,
  RefreshCw,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import type { Block } from "../domain/models";
import type { Answer } from "../application/useAssistant";
import { citations } from "../domain/retrieval";
export function Assistant({
  active,
  answer,
  busy,
  error,
  onRun,
  onCancel,
  onSource,
  onSave,
  onTerms,
  provider,
}: {
  active?: Block;
  answer: Answer | null;
  busy: boolean;
  error: string;
  onRun: (task: string, selected?: string, query?: string) => void;
  onCancel: () => void;
  onSource: (block: Block) => void;
  onSave: () => void;
  onTerms: () => void;
  provider: string;
}) {
  const [tab, setTab] = useState<"translate" | "ask">("translate"),
    [query, setQuery] = useState(""),
    [contextOpen, setContextOpen] = useState(false);
  const refs =
    answer && answer.task !== "translate"
      ? citations(answer.text, answer.sources)
      : [];
  return (
    <aside className="assistant">
      <header className="assistant-header">
        <Sparkles size={18} />
        <strong>阅读助手</strong>
        <span>按需陪伴</span>
      </header>
      <div className="assistant-tabs">
        <button
          className={tab === "translate" ? "active" : ""}
          onClick={() => setTab("translate")}
        >
          译文与理解
        </button>
        <button
          className={tab === "ask" ? "active" : ""}
          onClick={() => setTab("ask")}
        >
          论文问答
        </button>
      </div>
      <div className="assistant-content">
        <button
          className="context-chip"
          onClick={() => setContextOpen(!contextOpen)}
        >
          <i />
          {active
            ? `第 ${active.page} 页 · ${active.section.slice(0, 26)}`
            : "选中或点击论文段落"}
          <ChevronDown size={13} />
        </button>
        {contextOpen && (
          <div className="context-preview">
            <small>即将使用的本地来源 · 发送至 {provider}</small>
            <p>
              {active?.text || "选中文字后，调用 AI 时只发送选文及必要上下文。"}
            </p>
          </div>
        )}
        {tab === "translate" && (
          <div className="assistant-actions">
            <button
              onClick={() => onRun("translate")}
              disabled={!active || busy}
            >
              <Languages size={16} />
              翻译
            </button>
            <button
              onClick={() =>
                onRun(active?.kind === "equation" ? "formula" : "explain")
              }
              disabled={!active || busy}
            >
              <Sparkles size={16} />
              解释
            </button>
            <button onClick={onTerms}>术语</button>
          </div>
        )}
        {!answer && !busy && (
          <div className="assistant-empty">
            <span className="assistant-orbit">
              <Sparkles size={27} strokeWidth={1.2} />
            </span>
            <h3>理解，然后继续阅读。</h3>
            <p>
              选中难句，查看译文。
              <br />
              点击段落，获得简短解释。
              <br />
              你的论文始终是主角。
            </p>
            <div className="hint">
              <span>alt</span> 按住，临时查看译文
            </div>
          </div>
        )}
        {answer && (
          <article className="answer">
            <div className="answer-meta">
              <span>
                {answer.task === "translate"
                  ? "学术翻译"
                  : answer.task === "ask"
                    ? "论文问答"
                    : "概念解释"}
              </span>
              <small>{answer.cached ? "本地缓存" : provider}</small>
            </div>
            {answer.task === "ask" && <h3>{answer.question}</h3>}
            <div className="answer-text">
              {answer.text || (
                <span className="thinking">
                  正在生成回答<span>•••</span>
                </span>
              )}
            </div>
            {!busy && answer.complete && (
              <>
                <div className="source-list">
                  {(answer.task === "translate"
                    ? answer.sources
                        .slice(0, 1)
                        .map((block) => ({ label: "原文", block }))
                    : refs
                  ).map(({ label, block }) => (
                    <button key={label} onClick={() => onSource(block)}>
                      <FileSource />
                      {label} · 第 {block.page} 页<ArrowUpRight size={12} />
                    </button>
                  ))}
                </div>
                {answer.task !== "translate" && !refs.length && (
                  <small className="source-warning">
                    回答没有有效来源标记，请核验后再使用。
                  </small>
                )}
                <div className="answer-footer">
                  <button onClick={onSave}>
                    <StickyNote size={14} />
                    保存笔记
                  </button>
                  <button
                    onClick={() =>
                      onRun(answer.task, undefined, answer.question)
                    }
                  >
                    <RefreshCw size={13} />
                    重试
                  </button>
                </div>
              </>
            )}
          </article>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {busy && (
          <button className="stop-button" onClick={onCancel}>
            <Square size={12} />
            停止生成
          </button>
        )}
      </div>
      <footer className="assistant-footer">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) {
              onRun("ask", undefined, query);
              setTab("ask");
              setQuery("");
            }
          }}
        >
          <textarea
            rows={2}
            placeholder="向这篇论文提问…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="论文问题"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            className="send-button"
            title="发送问题"
            aria-label="发送问题"
            disabled={busy || !query.trim()}
          >
            <ArrowUp size={17} />
          </button>
        </form>
        <small>
          <ShieldCheck size={12} />
          仅在调用时发送必要上下文
        </small>
      </footer>
    </aside>
  );
}
function FileSource() {
  return <span className="source-square" />;
}
