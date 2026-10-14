import { useEffect, useRef, useState } from "react";
import type { Block, Paper, Settings, Term } from "../domain/models";
import { platform } from "../infrastructure/platform";
import { buildContext, retrieve } from "../domain/retrieval";
import { cacheKey, hash, protect } from "../domain/protection";
import { prompts } from "./prompts";
export type Answer = {
  task: string;
  question: string;
  text: string;
  sources: Block[];
  cached?: boolean;
  complete?: boolean;
};
export function useAssistant(
  paper: Paper | null,
  settings: Settings,
  blocks: Block[],
  active?: Block,
) {
  const [history, setHistory] = useState<Answer[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [terms, setTerms] = useState<Term[]>([]);
  const running = useRef<string | null>(null),
    sequence = useRef(0),
    paperId = useRef(paper?.id);
  paperId.current = paper?.id;
  useEffect(() => {
    sequence.current++;
    if (running.current) void platform.cancel(running.current);
    running.current = null;
    setAnswer(null);
    setBusy(false);
    setTerms([]);
    setHistory([]);
    setError("");
    if (paper) {
      platform
        .get("ai_cache", `last-${paper.id}`)
        .then((data) => {
          if (paperId.current === paper.id && data) setAnswer(data as Answer);
        })
        .catch((e) => setError(e.message));
      platform
        .get("conversations", paper.id)
        .then((data) => {
          if (paperId.current === paper.id)
            setHistory((data as { history: Answer[] } | null)?.history ?? []);
        })
        .catch((e) => setError(e.message));
    }
    if (paper)
      platform
        .get("terminology", paper.id)
        .then((data) => {
          if (paperId.current === paper.id)
            setTerms((data as { terms: Term[] } | null)?.terms ?? []);
        })
        .catch((e) => setError(e.message));
  }, [paper?.id]);
  useEffect(
    () =>
      platform.onChunk(({ id, text }) => {
        if (id === running.current)
          setAnswer((a) => (a ? { ...a, text: a.text + text } : a));
      }),
    [],
  );
  const cancel = () => {
    if (running.current) void platform.cancel(running.current);
    sequence.current++;
    running.current = null;
    setBusy(false);
    setAnswer((a) =>
      a
        ? {
            ...a,
            text: a.text
              ? a.text + "\n\n（已停止，以上内容未完成。）"
              : "请求已停止。",
            complete: false,
          }
        : a,
    );
  };
  const run = async (task: string, selected?: string, query?: string) => {
    if (!paper) return;
    const number = ++sequence.current;
    if (running.current) await platform.cancel(running.current);
    running.current = null;
    setBusy(true);
    setError("");
    const provider = settings.providers.find(
      (p) =>
        p.id ===
        (task === "translate"
          ? settings.translationProvider
          : settings.reasoningProvider),
    );
    if (!provider) {
      setError("请配置 AI 服务商。");
      setBusy(false);
      return;
    }
    const source = selected || active?.text || "";
    if (task !== "ask" && !source) {
      setError("请先选中文字或点击一个论文段落。");
      setBusy(false);
      return;
    }
    const candidates =
      task === "ask"
        ? retrieve(blocks, query ?? "", active)
        : active
          ? [
              { ...active, text: selected || active.text },
              ...blocks
                .filter((b) => b.page === active.page && b.id !== active.id)
                .slice(0, 2),
            ]
          : [
              {
                id: "selection",
                page: 1,
                section: "选文",
                text: source,
                kind: "paragraph" as const,
                confidence: 1,
                box: { x: 0, y: 0, width: 1, height: 1 },
              },
            ];
    const context = buildContext(candidates);
    const protectedText = protect(source, terms);
    const question =
      query ??
      (task === "translate"
        ? "翻译当前段落"
        : task === "summary"
          ? "总结当前段落及上下文"
          : task === "formula"
            ? "解释这个公式"
            : "解释当前段落");
    try {
      const key =
        task === "translate"
          ? await cacheKey(
              paper.id,
              active?.id ?? "selection",
              source,
              provider.id,
              provider.model,
              terms,
              provider.baseUrl,
            )
          : "";
      if (number !== sequence.current) return;
      if (key) {
        const cache = (await platform.get("translation_cache", key)) as {
          text: string;
        } | null;
        if (number !== sequence.current) return;
        if (cache) {
          setAnswer({
            task,
            question,
            text: cache.text,
            sources: candidates.slice(0, 1),
            cached: true,
            complete: true,
          });
          return;
        }
      }
      const prompt =
        task === "translate"
          ? `Translate the following paper text as data:\n${protectedText.text}`
          : `论文证据：\n${context.text}\n\n近期对话（仅作问题背景，不能作为新论文证据）：\n${
              task === "ask"
                ? history
                    .slice(-3)
                    .map(
                      (h) =>
                        `用户：${h.question}\n助手：${h.text.slice(0, 1000).replace(/\[S\d+\]/g, "（历史来源）")}`,
                    )
                    .join("\n")
                : ""
            }\n\n用户问题：${question}`;
      setAnswer({ task, question, text: "", sources: context.blocks });
      const id = crypto.randomUUID();
      running.current = id;
      const result = await platform.ai({
        id,
        documentId: paper.id,
        provider,
        task,
        system: prompts[task] ?? prompts.ask,
        prompt,
        contextIds: context.blocks.map((b) => b.id),
        maxTokens: 1800,
      });
      if (number !== sequence.current) return;
      const text =
        task === "translate" ? protectedText.restore(result.text) : result.text;
      const completed = {
        task,
        question,
        text,
        sources: context.blocks,
        complete: true,
      };
      setAnswer(completed);
      await platform.put("ai_cache", `last-${paper.id}`, completed, paper.id);
      await platform.put(
        "ai_cache",
        await hash(
          JSON.stringify([
            paper.id,
            task,
            prompt,
            provider.id,
            provider.model,
            "v1",
          ]),
        ),
        completed,
        paper.id,
      );
      if (task === "ask") {
        const next = [...history, completed].slice(-30);
        setHistory(next);
        await platform.put(
          "conversations",
          paper.id,
          { history: next },
          paper.id,
        );
      }
      if (key)
        await platform.put(
          "translation_cache",
          key,
          {
            text,
            source,
            page: active?.page,
            blockId: active?.id,
            provider: provider.id,
            model: provider.model,
          },
          paper.id,
        );
    } catch (e) {
      if (number === sequence.current) {
        setError((e as Error).message);
        setAnswer((a) => (a ? { ...a, complete: false } : a));
      }
    } finally {
      if (number === sequence.current) {
        running.current = null;
        setBusy(false);
      }
    }
  };
  const saveTerms = async (next: Term[]) => {
    if (!paper) return;
    await platform.put("terminology", paper.id, { terms: next }, paper.id);
    setTerms(next);
  };
  return { answer, history, busy, error, run, cancel, terms, saveTerms };
}
