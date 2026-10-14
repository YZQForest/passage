import { useState } from "react";
import type { Term } from "../domain/models";
import { Modal } from "./Modal";
export function Terms({
  terms,
  save,
  close,
}: {
  terms: Term[];
  save: (terms: Term[]) => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState(terms),
    [original, setOriginal] = useState(""),
    [preferred, setPreferred] = useState(""),
    [message, setMessage] = useState("");
  return (
    <Modal title="论文术语字典" close={close}>
      <div className="terms-body">
        <p className="muted">
          你指定的译法优先用于后续翻译；修改字典后旧翻译缓存自动失效。
        </p>
        <form
          className="term-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!original.trim()) return;
            setDraft((items) => [
              ...items.filter((t) => t.original !== original.trim()),
              {
                original: original.trim(),
                preferred: preferred.trim() || original.trim(),
              },
            ]);
            setOriginal("");
            setPreferred("");
          }}
        >
          <input
            aria-label="原文术语"
            placeholder="Original term"
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
          />
          <input
            aria-label="优先译法"
            placeholder="优先译法（留空保留原文）"
            value={preferred}
            onChange={(e) => setPreferred(e.target.value)}
          />
          <button className="secondary">添加</button>
        </form>
        {draft.map((term) => (
          <div className="term-row" key={term.original}>
            <strong>{term.original}</strong>
            <span>{term.preferred}</span>
            <button
              onClick={() =>
                setDraft((items) =>
                  items.filter((t) => t.original !== term.original),
                )
              }
            >
              删除
            </button>
          </div>
        ))}
        {!draft.length && (
          <div className="empty-small">
            尚未添加术语。常见模型名、公式和引用默认保护。
          </div>
        )}
        <button
          className="primary"
          onClick={async () => {
            try {
              await save(draft);
              close();
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          保存术语
        </button>
        {message && <p role="alert">{message}</p>}
      </div>
    </Modal>
  );
}
