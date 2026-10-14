import { useEffect, useRef, useState } from "react";
import {
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Block, Highlight } from "../domain/models";
import { parsePage } from "./parser";
import type { PageSize } from "./engine";
export function PdfPage({
  pdf,
  number,
  width,
  size,
  blocks,
  highlights,
  active,
  onBlock,
  onJump,
  onError,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  width: number;
  size: PageSize;
  blocks: Block[];
  highlights: Highlight[];
  active?: string;
  onBlock: (block: Block) => void;
  onJump: (page: number) => void;
  onError: (message: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [links, setLinks] = useState<{ box: number[]; destination: unknown }[]>(
    [],
  );
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { rootMargin: "900px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let dead = false;
    let task: RenderTask | undefined;
    let layer: TextLayer | undefined;
    let ownedCanvas: HTMLCanvasElement | null = null;
    (async () => {
      const page = await pdf.getPage(number);
      if (dead || !canvas.current || !text.current) return;
      ownedCanvas = canvas.current;
      const viewport = page.getViewport({ scale: width / size.width });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const node = canvas.current;
      node.width = Math.floor(viewport.width * pixelRatio);
      node.height = Math.floor(viewport.height * pixelRatio);
      node.style.width = `${viewport.width}px`;
      node.style.height = `${viewport.height}px`;
      text.current.replaceChildren();
      text.current.style.setProperty("--scale-factor", String(viewport.scale));
      text.current.style.setProperty(
        "--total-scale-factor",
        String(viewport.scale),
      );
      task = page.render({
        canvas: node,
        viewport,
        transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      const content = await page.getTextContent();
      if (dead) return;
      layer = new TextLayer({
        textContentSource: content,
        container: text.current,
        viewport,
      });
      await layer.render();
      await task.promise;
      if (dead) return;
      const parsed = blocks.length
        ? blocks
        : parsePage(content, page.getViewport({ scale: 1 }), number);
      layer.textDivs.forEach((div) => {
        div.addEventListener("click", () => {
          const rect = div.getBoundingClientRect(),
            base = root.current?.getBoundingClientRect();
          if (!base) return;
          const x = (rect.left - base.left) / base.width,
            y = (rect.top - base.top) / base.height;
          const block = parsed.find(
            (b) =>
              x >= b.box.x - 0.02 &&
              x < b.box.x + b.box.width + 0.02 &&
              y >= b.box.y - 0.02 &&
              y < b.box.y + b.box.height + 0.02,
          );
          if (block) onBlock(block);
        });
      });
      const annotations = await page.getAnnotations();
      if (dead) return;
      setLinks(
        annotations
          .filter((a) => a.subtype === "Link" && a.dest)
          .map((a) => ({
            box: [
              ...viewport.convertToViewportPoint(a.rect[0], a.rect[1]),
              ...viewport.convertToViewportPoint(a.rect[2], a.rect[3]),
            ].map(
              (v: number, i: number) =>
                v / (i % 2 ? viewport.height : viewport.width),
            ),
            destination: a.dest,
          })),
      );
    })().catch((error) => {
      if (!dead && error.name !== "RenderingCancelledException")
        onError("PDF 页面渲染失败：" + error.message);
    });
    return () => {
      dead = true;
      task?.cancel();
      layer?.cancel();
      if (ownedCanvas) {
        ownedCanvas.width = 0;
        ownedCanvas.height = 0;
      }
      text.current?.replaceChildren();
    };
  }, [pdf, number, width, size.width, visible]);
  const height = (width * size.height) / size.width;
  return (
    <div
      ref={root}
      className="pdf-page"
      id={`page-${number}`}
      data-page={number}
      style={{ width, height }}
    >
      <canvas ref={canvas} aria-label={`论文第 ${number} 页`} />
      <div ref={text} className="textLayer" />
      <div className="page-overlay">
        {highlights
          .filter((h) => h.page === number)
          .flatMap((h) =>
            h.boxes.map((box, i) => (
              <div
                key={h.id + i}
                className="highlight-box"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                  background: h.color,
                }}
              />
            )),
          )}
        {blocks
          .filter((b) => b.id === active)
          .map((b) => (
            <div
              key={b.id}
              className="active-block"
              style={{
                left: `${b.box.x * 100}%`,
                top: `${b.box.y * 100}%`,
                width: `${b.box.width * 100}%`,
                height: `${b.box.height * 100}%`,
              }}
            />
          ))}
      </div>
      {links.map((link, i) => (
        <button
          key={i}
          className="pdf-link"
          title="预览文献内部链接"
          aria-label="预览引用来源"
          style={{
            left: `${Math.min(link.box[0], link.box[2]) * 100}%`,
            top: `${Math.min(link.box[1], link.box[3]) * 100}%`,
            width: `${Math.abs(link.box[2] - link.box[0]) * 100}%`,
            height: `${Math.abs(link.box[3] - link.box[1]) * 100}%`,
          }}
          onClick={async () => {
            try {
              const destination =
                typeof link.destination === "string"
                  ? await pdf.getDestination(link.destination)
                  : link.destination;
              if (!Array.isArray(destination)) return;
              const index =
                typeof destination[0] === "number"
                  ? destination[0]
                  : await pdf.getPageIndex(destination[0]);
              onJump(index + 1);
            } catch {
              onError("此内部链接无法解析，可使用全文搜索定位引用。");
            }
          }}
        />
      ))}
      {!visible && <span className="page-placeholder">第 {number} 页</span>}
    </div>
  );
}
