import { describe, expect, it } from "vitest";
import { protect, cacheKey } from "../src/domain/protection";
import { NavigationStack } from "../src/domain/navigation";
import { retrieve, buildContext, citations } from "../src/domain/retrieval";
import { defaultPosition, type Block } from "../src/domain/models";
import { parsePage } from "../src/pdf/parser";
const block = (id: string, text: string): Block => ({
  id,
  text,
  page: 1,
  section: "Methods",
  kind: "paragraph",
  confidence: 0.8,
  box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
});
describe("translation protection", () => {
  it("keeps formula, citations and model names intact", () => {
    const p = protect(
      "Transformer uses y = softmax(Wx + b) as shown in Fig. 3 [12].",
    );
    expect(p.text).not.toContain("Transformer");
    expect(p.restore(p.text)).toBe(
      "Transformer uses y = softmax(Wx + b) as shown in Fig. 3 [12].",
    );
  });
  it("rejects omitted and duplicated protected tokens", () => {
    const p = protect("Transformer [1]");
    expect(() => p.restore("改写")).toThrow();
    expect(() => p.restore(p.text + " ⟦P0⟧")).toThrow();
  });
  it("applies a user terminology override", () => {
    const p = protect("novel module achieves results.", [
      { original: "novel module", preferred: "新型模块" },
    ]);
    expect(p.restore(p.text)).toBe("新型模块 achieves results.");
  });
  it("invalidates cache on content/model/terminology/endpoint changes", async () => {
    const key = await cacheKey("doc", "block", "hello", "openai", "a", []);
    expect(
      await cacheKey(
        "doc",
        "block",
        "hello",
        "openai",
        "a",
        [],
        "https://other.example/v1",
      ),
    ).not.toBe(key);
    expect(await cacheKey("doc", "block", "hello", "openai", "a", [])).toBe(
      key,
    );
    expect(
      await cacheKey("doc", "block", "hello!", "openai", "a", []),
    ).not.toBe(key);
    expect(await cacheKey("doc", "block", "hello", "openai", "b", [])).not.toBe(
      key,
    );
    expect(
      await cacheKey("doc", "block", "hello", "openai", "a", [
        { original: "hello", preferred: "你好" },
      ]),
    ).not.toBe(key);
  });
});
describe("navigation", () => {
  it("restores offset and zoom and discards forward after new branch", () => {
    const n = new NavigationStack();
    const first = { ...defaultPosition, page: 6, scroll: 6700, zoom: 1.2 };
    const last = { ...defaultPosition, page: 15, scroll: 16500 };
    n.push(first);
    expect(n.back(last)).toEqual(first);
    expect(n.forward(first)).toEqual(last);
    n.back(last);
    n.push(first);
    expect(n.canForward).toBe(false);
  });
});
describe("evidence retrieval", () => {
  it("prioritizes matching evidence and never accepts fabricated source ids", () => {
    const rows = [
      block("1", "loss function minimizes training error"),
      block("2", "dataset contains 100 images"),
    ];
    expect(retrieve(rows, "loss training")[0].id).toBe("1");
    const ctx = buildContext(rows, 55);
    expect(ctx.blocks).toHaveLength(1);
    expect(citations("result [S1] false [S999]", rows)).toHaveLength(1);
  });
  it("does not upload full paper for empty evidence", () => {
    expect(buildContext([]).text).toBe("");
  });
});
describe("bbox parser", () => {
  it("maps a normal paragraph to normalized page coordinates", () => {
    const content = {
      items: [
        {
          str: "1 Introduction",
          transform: [12, 0, 0, 12, 50, 700],
          width: 120,
          height: 12,
        },
        {
          str: "This paper studies",
          transform: [10, 0, 0, 10, 50, 660],
          width: 100,
          height: 10,
        },
        {
          str: "local reading workflows.",
          transform: [10, 0, 0, 10, 50, 646],
          width: 130,
          height: 10,
        },
      ],
      styles: {},
      lang: null,
    };
    const viewport = {
      width: 600,
      height: 800,
      scale: 1,
      convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
    };
    const blocks = parsePage(content as never, viewport as never, 1);
    expect(blocks[0].kind).toBe("heading");
    expect(blocks[1].text).toContain("local reading");
    expect(blocks[1].box.x).toBeCloseTo(50 / 600);
    expect(blocks[1].box.height).toBeGreaterThan(10 / 800);
  });
});
