import { useState } from "react";
import { ArrowUpRight, Trash2, Plus } from "lucide-react";
import type { Note } from "../domain/models";
import { Modal } from "./Modal";
export function Notes({
  notes,
  source,
  page,
  close,
  onSave,
  onRemove,
  onJump,
}: {
  notes: Note[];
  source: string;
  page: number;
  close: () => void;
  onSave: (text: string) => Promise<void>;
  onRemove: (note: Note) => Promise<void>;
  onJump: (note: Note) => void;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal title="论文笔记" close={close}>
      <div className="notes-body">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            try {
              await onSave(text.trim());
              setText("");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <small>第 {page} 页 · 当前阅读上下文</small>
          {source && <blockquote>{source.slice(0, 350)}</blockquote>}
          <textarea
            rows={4}
            placeholder="记下你的理解或问题…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="新笔记"
          />
          <button className="primary" disabled={!text.trim()}>
            <Plus size={15} />
            添加笔记
          </button>
        </form>
        {notes.map((note) => (
          <article className="note" key={note.id}>
            <header>
              <button onClick={() => onJump(note)}>
                第 {note.page} 页<ArrowUpRight size={12} />
              </button>
              <button
                aria-label="删除笔记"
                onClick={() => onRemove(note).catch((e) => setError(e.message))}
              >
                <Trash2 size={14} />
              </button>
            </header>
            <p>{note.text}</p>
            <details>
              <summary>原文上下文</summary>
              <blockquote>{note.source}</blockquote>
            </details>
            <small>{new Date(note.createdAt).toLocaleString("zh-CN")}</small>
          </article>
        ))}
        {!notes.length && (
          <p className="muted">你的笔记会和论文位置一起保存在本机。</p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
