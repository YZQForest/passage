import type { Block } from "./models";
const stop = new Set([
  "the",
  "a",
  "an",
  "is",
  "of",
  "to",
  "in",
  "and",
  "this",
  "what",
  "how",
  "does",
  "paper",
  "研究",
  "论文",
  "什么",
  "作者",
]);
export function tokenize(text: string) {
  return (
    text.toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]{1,2}/g) ?? []
  ).filter((x) => !stop.has(x));
}
export function retrieve(
  blocks: Block[],
  query: string,
  active?: Block,
  limit = 6,
): Block[] {
  const words = [...new Set(tokenize(query))];
  const scored = blocks
    .map((b) => {
      const tokens = tokenize(b.text);
      const score = words.reduce(
        (s, w) =>
          s +
          tokens.filter((t) => t === w).length /
            (1 + Math.log(1 + tokens.length)),
        0,
      );
      return { b, score };
    })
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score);
  const chosen = scored.slice(0, limit).map((x) => x.b);
  if (active && !chosen.some((b) => b.id === active.id)) chosen.unshift(active);
  return chosen.slice(0, limit);
}
export function buildContext(blocks: Block[], maxChars = 14000) {
  let length = 0;
  const included: Block[] = [];
  for (const block of blocks) {
    if (length + block.text.length > maxChars) break;
    included.push(block);
    length += block.text.length;
  }
  return {
    blocks: included,
    text: included
      .map((b, i) => `[S${i + 1}] Page ${b.page} · ${b.section}\n${b.text}`)
      .join("\n\n"),
  };
}
export function citations(text: string, sources: Block[]) {
  return [
    ...new Set([...text.matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1]) - 1)),
  ]
    .filter((n) => n >= 0 && n < sources.length)
    .map((n) => ({ label: `S${n + 1}`, block: sources[n] }));
}
