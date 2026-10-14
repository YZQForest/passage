import type { Term } from "./models";
const preserved =
  /(?:\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\b\w+\s*=\s*(?:softmax|sigmoid|log|exp)\([^\n]+?\)|\[[\d,;\s–-]+\]|\b(?:Fig\.|Table|Eq\.|Sec\.)\s*\(?[\d.]+\)?|\b(?:Mamba|KAN|Transformer|ResNet|YOLO|ViT|ImageNet|COCO|F1-score|mAP|IoU|token|embedding|benchmark|API)\b)/g;
export function protect(source: string, terms: Term[] = []) {
  const values: string[] = [];
  let text = source.replace(preserved, (part) => {
    values.push(terms.find((t) => t.original === part)?.preferred || part);
    return `⟦P${values.length - 1}⟧`;
  });
  for (const term of [...terms].sort(
    (a, b) => b.original.length - a.original.length,
  )) {
    if (!term.original.trim()) continue;
    const escaped = term.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "g"), () => {
      values.push(term.preferred || term.original);
      return `⟦P${values.length - 1}⟧`;
    });
  }
  return {
    text,
    restore(translated: string) {
      for (let i = 0; i < values.length; i++)
        if (translated.split(`⟦P${i}⟧`).length !== 2)
          throw new Error(
            "译文改变了公式或引用保护标记，请重试。结果未写入缓存。",
          );
      const unknown = [...translated.matchAll(/⟦P(\d+)⟧/g)].some(
        (m) => Number(m[1]) >= values.length,
      );
      if (unknown) throw new Error("译文含未知保护标记，请重试。");
      return translated.replace(
        /⟦P(\d+)⟧/g,
        (_, i: string) => values[Number(i)],
      );
    },
  };
}
export async function hash(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function cacheKey(
  documentId: string,
  blockId: string,
  text: string,
  provider: string,
  model: string,
  terms: Term[],
  endpoint = "",
) {
  return hash(
    JSON.stringify([
      documentId,
      blockId,
      await hash(text),
      "zh-CN",
      provider,
      model,
      "translate-v2",
      endpoint.replace(/\/+$/, ""),
      await hash(JSON.stringify(terms)),
    ]),
  );
}
