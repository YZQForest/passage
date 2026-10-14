import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  defaultPosition,
  type Block,
  type Highlight,
  type Note,
  type Paper,
  type Position,
} from "../domain/models";
import { platform } from "../infrastructure/platform";
import { indexPdf, openPdf, type PageSize } from "../pdf/engine";
import { NavigationStack } from "../domain/navigation";
export function useReader(
  paper: Paper | null,
  error: (message: string) => void,
) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [blocks, setBlocks] = useState<Block[]>([]),
    [sizes, setSizes] = useState<PageSize[]>([]),
    [position, setPosition] = useState<Position>(defaultPosition),
    [indexed, setIndexed] = useState(0),
    [loading, setLoading] = useState(false),
    [notes, setNotes] = useState<Note[]>([]),
    [highlights, setHighlights] = useState<Highlight[]>([]);
  const scroller = useRef<HTMLDivElement>(null),
    navigation = useRef(new NavigationStack()),
    positionRef = useRef(position),
    savedPosition = useRef<Position | null>(null),
    dwell = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    errorRef = useRef(error),
    currentPaper = useRef(paper);
  errorRef.current = error;
  positionRef.current = position;
  currentPaper.current = paper;
  useEffect(() => {
    if (!paper) {
      setPdf(null);
      return;
    }
    let dead = false;
    let document: PDFDocumentProxy | null = null;
    setLoading(true);
    setBlocks([]);
    setSizes([]);
    setIndexed(0);
    setPdf(null);
    setNotes([]);
    setHighlights([]);
    navigation.current = new NavigationStack();
    savedPosition.current = null;
    (async () => {
      const [bytes, stored, noteRows, highlightRows] = await Promise.all([
        platform.pdf(paper.id),
        platform.get("reading_positions", paper.id),
        platform.list("notes", paper.id),
        platform.list("highlights", paper.id),
      ]);
      if (dead) return;
      const resumed = stored as Position | null;
      savedPosition.current = resumed;
      setPosition(resumed ?? { ...defaultPosition });
      setNotes(noteRows as unknown as Note[]);
      setHighlights(highlightRows as unknown as Highlight[]);
      document = await openPdf(new Uint8Array(bytes));
      if (dead) {
        await document.loadingTask.destroy();
        return;
      }
      setPdf(document);
      const first = await document.getPage(1);
      const firstView = first.getViewport({ scale: 1 });
      const pageSizes = Array.from({ length: document.numPages }, () => ({
        width: firstView.width,
        height: firstView.height,
      }));
      setSizes(pageSizes);
      await platform.put("documents", paper.id, {
        ...paper,
        pages: document.numPages,
        openedAt: Date.now(),
      });
      const all: Block[] = [];
      await indexPdf(
        document,
        (n, pageBlocks, size) => {
          all.push(...pageBlocks);
          pageSizes[n - 1] = size;
          setSizes([...pageSizes]);
          setBlocks([...all]);
          setIndexed(n);
        },
        () => dead,
      );
      if (dead) return;
      await platform.put(
        "blocks",
        paper.id,
        { blocks: all, parserVersion: 1 },
        paper.id,
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (dead) return;
          if (scroller.current && resumed)
            scroller.current.scrollTop = resumed.scroll;
          setLoading(false);
        }),
      );
    })().catch((e) => {
      if (!dead) {
        setLoading(false);
        errorRef.current(
          e.name === "PasswordException"
            ? "此 PDF 受密码保护，请先导入解密后的副本。"
            : "无法打开论文：" + e.message,
        );
      }
    });
    return () => {
      dead = true;
      clearTimeout(dwell.current);
      clearTimeout(saveTimer.current);
      document?.loadingTask.destroy();
    };
  }, [paper?.id]);
  useEffect(() => {
    if (!paper || loading || !pdf) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      platform
        .put("reading_positions", paper.id, position, paper.id)
        .catch((e) => errorRef.current("阅读位置保存失败：" + e.message));
    }, 350);
    return () => clearTimeout(saveTimer.current);
  }, [position, loading, paper?.id, pdf]);
  const setActive = useCallback((block: Block) => {
    clearTimeout(dwell.current);
    setPosition((p) => ({ ...p, active: block.id, page: block.page }));
  }, []);
  const onScroll = useCallback(() => {
    const root = scroller.current;
    if (!root) return;
    const view = root.getBoundingClientRect();
    if (!view.height) return;
    const pages = [...root.querySelectorAll<HTMLElement>("[data-page]")];
    const page = pages.find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > view.top + 100 && rect.top < view.bottom;
    });
    const pageNo = Number(page?.dataset.page ?? 1);
    setPosition((p) => ({ ...p, scroll: root.scrollTop, page: pageNo }));
    clearTimeout(dwell.current);
    dwell.current = setTimeout(() => {
      if (!page || !root.clientHeight || window.getSelection()?.toString())
        return;
      const rect = page.getBoundingClientRect();
      const center = Math.max(
        view.top + 120,
        Math.min(view.top + view.height * 0.4, rect.bottom - 20),
      );
      const y = (center - rect.top) / rect.height;
      const candidates = blocks.filter(
        (b) => b.page === pageNo && b.kind !== "heading",
      );
      const nearest = [...candidates].sort(
        (a, b) =>
          Math.abs(a.box.y + a.box.height / 2 - y) -
          Math.abs(b.box.y + b.box.height / 2 - y),
      )[0];
      if (nearest) setActive(nearest);
    }, 650);
  }, [blocks, setActive]);
  const jump = useCallback(
    (page: number, block?: Block, push = true) => {
      if (!pdf) return;
      const bounded = Math.max(1, Math.min(pdf.numPages, page));
      if (push) navigation.current.push(positionRef.current);
      setPosition((p) => ({ ...p, page: bounded, active: block?.id }));
      requestAnimationFrame(() => {
        const root = scroller.current;
        const node = root?.querySelector<HTMLElement>(
          `[data-page="${bounded}"]`,
        );
        if (!root || !node) return;
        root.scrollTop =
          node.offsetTop + (block ? block.box.y * node.offsetHeight - 50 : 0);
      });
    },
    [pdf],
  );
  const travel = (direction: "back" | "forward") => {
    const target = navigation.current[direction](positionRef.current);
    if (!target) return;
    setPosition(target);
    requestAnimationFrame(() => {
      if (scroller.current) scroller.current.scrollTop = target.scroll;
    });
  };
  const saveNote = async (
    source: string,
    text: string,
    page: number,
    blockId?: string,
  ) => {
    if (!paper) return;
    const note: Note = {
      id: crypto.randomUUID(),
      documentId: paper.id,
      page,
      blockId,
      source,
      text,
      createdAt: Date.now(),
    };
    await platform.put("notes", note.id, note, paper.id);
    setNotes((items) => [note, ...items]);
  };
  const removeNote = async (note: Note) => {
    await platform.remove("notes", note.id);
    setNotes((items) => items.filter((n) => n.id !== note.id));
  };
  const addHighlight = async (highlight: Highlight) => {
    await platform.put("highlights", highlight.id, highlight, paper?.id);
    setHighlights((items) => [...items, highlight]);
  };
  const undoHighlight = async () => {
    const last = highlights.at(-1);
    if (!last) return;
    await platform.remove("highlights", last.id);
    setHighlights((items) => items.slice(0, -1));
  };
  return {
    pdf,
    blocks,
    sizes,
    position,
    setPosition,
    indexed,
    loading,
    notes,
    highlights,
    scroller,
    onScroll,
    setActive,
    jump,
    travel,
    saveNote,
    removeNote,
    addHighlight,
    undoHighlight,
  };
}
