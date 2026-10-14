import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import type { PageViewport } from "pdfjs-dist";
import type { Block, Box } from "../domain/models";
type Run = { text: string; box: Box; size: number };
const heading =
  /^(?:\d+(?:\.\d+)*\s+)?(?:Abstract|Introduction|Related Work|Background|Methods?|Materials|Experiments?|Results?|Discussion|Conclusion|References|Appendix|Acknowledg)/i;
export function parsePage(
  content: TextContent,
  viewport: PageViewport,
  page: number,
  previousSection = "正文",
): Block[] {
  const runs: Run[] = content.items
    .filter(
      (item): item is TextItem => "str" in item && item.str.trim().length > 0,
    )
    .map((item) => {
      const [x, baseline] = viewport.convertToViewportPoint(
        item.transform[4],
        item.transform[5],
      );
      const size =
        Math.abs(item.height * viewport.scale) ||
        Math.hypot(item.transform[2], item.transform[3]) * viewport.scale;
      return {
        text: item.str,
        size,
        box: {
          x: x / viewport.width,
          y: (baseline - size) / viewport.height,
          width: Math.abs(item.width * viewport.scale) / viewport.width,
          height: size / viewport.height,
        },
      };
    });
  const left = runs.filter(
    (r) => r.box.x < 0.48 && r.box.x + r.box.width < 0.52,
  );
  const right = runs.filter((r) => r.box.x > 0.48);
  const twoColumns = left.length > 12 && right.length > 12;
  const full = twoColumns
    ? runs.filter((r) => !left.includes(r) && !right.includes(r))
    : [];
  const columns = twoColumns ? [full, left, right] : [runs];
  const lines: { text: string; box: Box; size: number; column: number }[] = [];
  columns.forEach((column, ci) => {
    const sorted = [...column].sort((a, b) =>
      Math.abs(a.box.y - b.box.y) < Math.min(a.box.height, b.box.height) * 0.5
        ? a.box.x - b.box.x
        : a.box.y - b.box.y,
    );
    for (const run of sorted) {
      const last = lines.at(-1);
      if (
        last &&
        last.column === ci &&
        Math.abs(last.box.y - run.box.y) <
          Math.min(last.box.height, run.box.height) * 0.55
      ) {
        last.text += " " + run.text;
        const rightEdge = Math.max(
          last.box.x + last.box.width,
          run.box.x + run.box.width,
        );
        last.box.width = rightEdge - last.box.x;
        last.size = Math.max(last.size, run.size);
      } else
        lines.push({
          text: run.text,
          box: { ...run.box },
          size: run.size,
          column: ci,
        });
    }
  });
  const blocks: Block[] = [];
  let section = previousSection;
  let previousLine: (typeof lines)[number] | undefined;
  const sizes = runs.map((r) => r.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 10;
  for (const line of lines) {
    const isHeading =
      (heading.test(line.text) && line.text.length < 120) ||
      (line.size > median * 1.4 && line.text.length < 150);
    if (isHeading) section = line.text;
    const kind: Block["kind"] = isHeading
      ? "heading"
      : /^(Fig(?:ure)?\.?|Table)\s*\d/i.test(line.text)
        ? "caption"
        : /[=∑∫λθ]/.test(line.text) && line.text.length < 140
          ? "equation"
          : "paragraph";
    const last = blocks.at(-1);
    const gap = previousLine
      ? line.box.y - previousLine.box.y - previousLine.box.height
      : 1;
    const sameParagraph =
      last &&
      previousLine?.column === line.column &&
      last.kind === "paragraph" &&
      kind === "paragraph" &&
      gap < line.box.height * 0.85 &&
      gap > -line.box.height &&
      Math.abs(line.box.x - previousLine.box.x) < 0.08 &&
      last.text.length < 1800;
    if (sameParagraph) {
      last.text = last.text.endsWith("-")
        ? last.text.slice(0, -1) + line.text
        : last.text + " " + line.text;
      const bottom = Math.max(
        last.box.y + last.box.height,
        line.box.y + line.box.height,
      );
      const edge = Math.max(
        last.box.x + last.box.width,
        line.box.x + line.box.width,
      );
      last.box.x = Math.min(last.box.x, line.box.x);
      last.box.width = edge - last.box.x;
      last.box.height = bottom - last.box.y;
    } else
      blocks.push({
        id: `p${page}-b${blocks.length}`,
        page,
        text: line.text,
        box: { ...line.box },
        section,
        kind,
        confidence: twoColumns ? 0.65 : 0.8,
      });
    previousLine = line;
  }
  return blocks;
}
