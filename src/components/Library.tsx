import { useState } from "react";
import {
  BookOpen,
  FolderPlus,
  Pin,
  Search,
  Settings2,
  BarChart3,
  Trash2,
  FileText,
  ArrowUpRight,
} from "lucide-react";
import type { Paper } from "../domain/models";
import { IconButton } from "./Icons";
export function Library({
  papers,
  current,
  onOpen,
  onImport,
  onSettings,
  onUsage,
  onPin,
  onDelete,
}: {
  papers: Paper[];
  current?: string;
  onOpen: (paper: Paper) => void;
  onImport: () => void;
  onSettings: () => void;
  onUsage: () => void;
  onPin: (paper: Paper) => void;
  onDelete: (paper: Paper) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = papers
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    .sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        b.openedAt - a.openedAt,
    );
  return (
    <aside className="library">
      <div className="brand">
        <span className="brand-symbol">
          <BookOpen size={22} />
        </span>
        <span>
          passage<span className="brand-dot">.</span>
        </span>
      </div>
      <button className="import-button" onClick={onImport}>
        <FolderPlus size={17} />
        导入论文<span>⌘ O</span>
      </button>
      <div className="library-label">
        <span>我的文献库</span>
        <span>{papers.length}</span>
      </div>
      <label className="input-search">
        <Search size={15} />
        <input
          placeholder="搜索论文…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索文献库"
        />
      </label>
      <div className="paper-list">
        {filtered.map((paper) => (
          <div
            className={`paper-item ${current === paper.id ? "selected" : ""}`}
            key={paper.id}
          >
            <button className="paper-main" onClick={() => onOpen(paper)}>
              <FileText size={18} />
              <span>
                <strong>{paper.name}</strong>
                <small>
                  {paper.pages || "PDF"} {paper.pages ? "页" : ""} ·{" "}
                  {new Date(paper.addedAt).toLocaleDateString("zh-CN")}
                </small>
              </span>
            </button>
            <div className="paper-actions">
              <IconButton
                icon={Pin}
                label={paper.pinned ? "取消置顶" : "置顶论文"}
                active={paper.pinned}
                onClick={() => onPin(paper)}
              />
              <IconButton
                icon={Trash2}
                label="移出文献库"
                onClick={() => onDelete(paper)}
              />
            </div>
          </div>
        ))}
        {!filtered.length && (
          <div className="library-empty">
            <FileText size={26} />
            <p>{query ? "没有匹配的论文" : "从第一篇论文开始"}</p>
            <small>PDF 与阅读记录保存在本机</small>
          </div>
        )}
      </div>
      <div className="library-bottom">
        <div className="local-tag">
          <i />
          本地工作空间
          <ArrowUpRight size={13} />
        </div>
        <button onClick={onUsage}>
          <BarChart3 size={17} />
          用量与费用
        </button>
        <button onClick={onSettings}>
          <Settings2 size={17} />
          偏好设置<span>⌘ ,</span>
        </button>
        <small>PASSAGE 0.1 · DEVELOPMENT</small>
      </div>
    </aside>
  );
}
