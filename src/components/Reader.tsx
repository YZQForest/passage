import { useEffect, useRef, useState } from "react";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Maximize,
  Columns2,
  PanelLeftClose,
  StickyNote,
  Bookmark,
  Focus,
  Undo2,
  ChevronDown,
  FileText,
  X,
  Sparkles,
} from "lucide-react";
import type { Block, Paper, Selection } from "../domain/models";
import type { useReader } from "../application/useReader";
import { PdfPage } from "../pdf/PdfPage";
import { IconButton } from "./Icons";
import { platform } from "../infrastructure/platform";
type ReaderState = ReturnType<typeof useReader>;
export function Reader({
  paper,
  reader,
  onSelection,
  onSource,
  onNotes,
  onAI,
  onError,
  onImport,
  searchOpen,
  setSearchOpen,
}: {
  paper: Paper | null;
  reader: ReaderState;
  onSelection: (selection: Selection | null) => void;
  onSource: (block: Block) => void;
  onNotes: () => void;
  onAI: () => void;
  onError: (message: string) => void;
  onImport: () => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}) {
  const [width, setWidth] = useState(700),
    [query, setQuery] = useState(""),
    [contents, setContents] = useState(false),
    [bookmarks, setBookmarks] = useState<number[]>([]);
  const container = useRef<HTMLDivElement>(null);
  const {
    pdf,
    blocks,
    sizes,
    position,
    setPosition,
    loading,
    indexed,
    scroller,
  } = reader;
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(
        Math.max(260, Math.min(1000, entries[0].contentRect.width - 64)),
      ),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setBookmarks([]);
    if (paper)
      platform
        .get("reading_positions", `bookmarks-${paper.id}`)
        .then((value) =>
          setBookmarks((value as { pages: number[] } | null)?.pages ?? []),
        )
        .catch((e) => onError(e.message));
  }, [paper?.id]);
  const bookmark = async () => {
    if (!paper) return;
    const pages = bookmarks.includes(position.page)
      ? bookmarks.filter((p) => p !== position.page)
      : [...bookmarks, position.page];
    try {
      await platform.put(
        "reading_positions",
        `bookmarks-${paper.id}`,
        { pages },
        paper.id,
      );
      setBookmarks(pages);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const select = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.toString().trim()) {
      onSelection(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const start =
      range.startContainer.parentElement?.closest<HTMLElement>("[data-page]");
    const end =
      range.endContainer.parentElement?.closest<HTMLElement>("[data-page]");
    if (!start || start !== end) {
      onSelection(null);
      return;
    }
    const rect = start.getBoundingClientRect();
    const boxes = [...range.getClientRects()]
      .filter((b) => b.width > 0 && b.height > 0)
      .map((b) => ({
        x: Math.max(0, (b.left - rect.left) / rect.width),
        y: Math.max(0, (b.top - rect.top) / rect.height),
        width: Math.min(b.width / rect.width, 1),
        height: Math.min(b.height / rect.height, 1),
      }));
    const bounds = range.getBoundingClientRect();
    const page = Number(start.dataset.page);
    const text = selection.toString().trim();
    const block =
      blocks.find(
        (b) => b.page === page && b.text.includes(text.slice(0, 30)),
      ) ??
      blocks.find(
        (b) =>
          b.page === page &&
          boxes[0] &&
          Math.abs(b.box.y - boxes[0].y) < b.box.height,
      );
    if (block) reader.setActive(block);
    else
      reader.setActive({
        id: `selection-p${page}`,
        page,
        text,
        section: "选文",
        kind: "paragraph",
        confidence: 1,
        box: boxes[0] ?? { x: 0, y: 0, width: 1, height: 1 },
      });
    onSelection({
      text,
      page,
      boxes,
      x: Math.min(window.innerWidth - 360, Math.max(12, bounds.left)),
      y: Math.max(74, Math.min(window.innerHeight - 60, bounds.top - 48)),
    });
  };
  const results = query.trim()
    ? blocks
        .filter((b) =>
          b.text.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .slice(0, 100)
    : [];
  const headings = blocks.filter((b) => b.kind === "heading");
  if (!paper)
    return (
      <main className="welcome" ref={container}>
        <div className="welcome-top">
          <span>YOUR RESEARCH, IN FOCUS</span>
          <span>本地优先 · 安静阅读</span>
        </div>
        <div className="welcome-inner">
          <div className="welcome-mark">
            <FileText size={40} strokeWidth={1} />
            <Sparkles size={18} />
          </div>
          <span className="eyebrow">A LITTLE CLARITY. A LOT MORE READING.</span>
          <h1>
            让理解跟上
            <br />
            你的阅读。
          </h1>
          <p>
            保留论文原貌，把翻译、解释与证据
            <br />
            放在你需要它们的地方。
          </p>
          <button className="primary large" onClick={onImport}>
            <Plus size={18} />
            打开第一篇论文<span>⌘ O</span>
          </button>
          <small>PDF 不上传 · 无需账户 · API 由你选择</small>
        </div>
        <footer className="welcome-bottom">
          <span>01 / 原版 PDF</span>
          <span>02 / 按需 AI</span>
          <span>03 / 连续阅读</span>
        </footer>
      </main>
    );
  return (
    <main className="reader" ref={container}>
      <header className="reader-title">
        <span className="paper-breadcrumb">
          <FileText size={15} />
          <span>{paper.name}</span>
          <small>PDF</small>
        </span>
        <div>
          <IconButton
            icon={PanelLeftClose}
            label="专注阅读"
            active={position.focus}
            onClick={() => setPosition((p) => ({ ...p, focus: !p.focus }))}
          />
          <IconButton
            icon={Columns2}
            label="双语辅助栏"
            active={position.bilingual}
            onClick={() =>
              setPosition((p) => ({ ...p, bilingual: !p.bilingual }))
            }
          />
          <IconButton icon={StickyNote} label="论文笔记" onClick={onNotes} />
        </div>
      </header>
      <div className="reader-toolbar">
        <div className="toolbar-group">
          <IconButton
            icon={ChevronLeft}
            label="返回阅读位置"
            onClick={() => reader.travel("back")}
          />
          <IconButton
            icon={ChevronRight}
            label="前进阅读位置"
            onClick={() => reader.travel("forward")}
          />
          <span className="toolbar-divider" />
          <button
            className="outline-toggle"
            onClick={() => setContents(!contents)}
          >
            <FileText size={15} />
            目录
            <ChevronDown size={12} />
          </button>
          <IconButton
            icon={Search}
            label="搜索论文（⌘ F）"
            active={searchOpen}
            onClick={() => setSearchOpen(!searchOpen)}
          />
        </div>
        <div className="toolbar-group page-control">
          <IconButton
            icon={ChevronLeft}
            label="上一页"
            disabled={position.page <= 1}
            onClick={() => reader.jump(position.page - 1)}
          />
          <input
            aria-label="当前页码"
            type="number"
            min="1"
            max={pdf?.numPages ?? 1}
            value={position.page}
            onChange={(e) => reader.jump(Number(e.target.value))}
          />
          <span>/ {pdf?.numPages ?? "—"}</span>
          <IconButton
            icon={ChevronRight}
            label="下一页"
            disabled={!pdf || position.page >= pdf.numPages}
            onClick={() => reader.jump(position.page + 1)}
          />
        </div>
        <div className="toolbar-group">
          <IconButton
            icon={Minus}
            label="缩小"
            onClick={() =>
              setPosition((p) => ({ ...p, zoom: Math.max(0.5, p.zoom - 0.1) }))
            }
          />
          <button
            className="zoom-label"
            onClick={() => setPosition((p) => ({ ...p, zoom: 1 }))}
          >
            {Math.round(position.zoom * 100)}%
          </button>
          <IconButton
            icon={Plus}
            label="放大"
            onClick={() =>
              setPosition((p) => ({ ...p, zoom: Math.min(2.5, p.zoom + 0.1) }))
            }
          />
          <IconButton
            icon={Maximize}
            label="适合页面"
            onClick={() => {
              const height = scroller.current?.clientHeight ?? 800;
              const size = sizes[position.page - 1];
              if (size)
                setPosition((p) => ({
                  ...p,
                  zoom: Math.min(
                    1,
                    (height - 70) / ((width * size.height) / size.width),
                  ),
                }));
            }}
          />
          <span className="toolbar-divider" />
          <IconButton
            icon={Bookmark}
            label="切换书签"
            active={bookmarks.includes(position.page)}
            onClick={() => void bookmark()}
          />
          <IconButton
            icon={Undo2}
            label="撤销最近高亮"
            disabled={!reader.highlights.length}
            onClick={() =>
              reader.undoHighlight().catch((e) => onError(e.message))
            }
          />
        </div>
      </div>
      {searchOpen && (
        <div className="search-bar">
          <Search size={17} />
          <input
            autoFocus
            placeholder="搜索论文中的文字…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="论文全文搜索"
          />
          <small>{results.length} 个结果</small>
          <IconButton
            icon={X}
            label="关闭搜索"
            onClick={() => setSearchOpen(false)}
          />
        </div>
      )}
      <div className="reader-stage">
        {(contents || (searchOpen && query)) && (
          <aside className="reader-outline">
            {searchOpen && query ? (
              <>
                <h4>搜索结果</h4>
                {results.map((b) => (
                  <button key={b.id} onClick={() => reader.jump(b.page, b)}>
                    <small>第 {b.page} 页</small>
                    <span>
                      {b.text.slice(
                        Math.max(
                          0,
                          b.text.toLowerCase().indexOf(query.toLowerCase()) -
                            35,
                        ),
                        Math.max(
                          0,
                          b.text.toLowerCase().indexOf(query.toLowerCase()) -
                            35,
                        ) + 160,
                      )}
                    </span>
                  </button>
                ))}
              </>
            ) : (
              <>
                <h4>论文结构</h4>
                {headings.length ? (
                  headings.map((b) => (
                    <button key={b.id} onClick={() => reader.jump(b.page, b)}>
                      <span>{b.text}</span>
                      <small>第 {b.page} 页</small>
                    </button>
                  ))
                ) : (
                  <p className="muted">未识别到目录标题，可用页码导航。</p>
                )}
                <h4>书签</h4>
                {bookmarks.map((p) => (
                  <button key={p} onClick={() => reader.jump(p)}>
                    第 {p} 页
                  </button>
                ))}
                <h4>阅读模式</h4>
                <button
                  onClick={() =>
                    setPosition((p) => ({
                      ...p,
                      mode: p.mode === "continuous" ? "single" : "continuous",
                    }))
                  }
                >
                  {position.mode === "continuous"
                    ? "切换单页模式"
                    : "切换连续滚动"}
                </button>
              </>
            )}
          </aside>
        )}
        <div
          className="pdf-scroller"
          ref={scroller}
          onScroll={reader.onScroll}
          onMouseUp={select}
          onTouchEnd={select}
        >
          {pdf &&
            sizes.map(
              (size, i) =>
                (position.mode === "continuous" || position.page === i + 1) && (
                  <PdfPage
                    key={`${paper.id}-${i}`}
                    pdf={pdf}
                    number={i + 1}
                    width={width * position.zoom}
                    size={size}
                    blocks={blocks.filter((b) => b.page === i + 1)}
                    highlights={reader.highlights}
                    active={position.active}
                    onBlock={reader.setActive}
                    onJump={(page) => {
                      const block = blocks.find((b) => b.page === page);
                      if (block) onSource(block);
                      else
                        onSource({
                          id: `page-${page}`,
                          page,
                          section: "内部链接",
                          text: "前往此 PDF 内部链接的目标页面。",
                          box: { x: 0, y: 0, width: 1, height: 1 },
                          kind: "paragraph",
                          confidence: 1,
                        });
                    }}
                    onError={onError}
                  />
                ),
            )}
          {loading && !pdf && (
            <div className="loading-paper">正在打开本地论文…</div>
          )}
        </div>
      </div>
      <footer className="reader-status">
        <span>
          <i />
          {loading || !pdf
            ? `正在索引 ${indexed} / ${pdf?.numPages ?? "…"} 页`
            : "已保存在本机"}
          {!loading &&
            !blocks.length &&
            " · 扫描 PDF 暂不支持选文，OCR 尚未接入"}
        </span>
        <span>
          {Math.round((position.page / (pdf?.numPages || 1)) * 100)}%{" "}
          <span className="status-line" />{" "}
          <button onClick={onAI}>
            <Sparkles size={13} />
            阅读助手
          </button>
          <IconButton
            icon={Focus}
            label="专注模式"
            onClick={() => setPosition((p) => ({ ...p, focus: !p.focus }))}
          />
        </span>
      </footer>
    </main>
  );
}
