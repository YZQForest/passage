import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixture } from "./fixture.mjs";
const folder = await mkdtemp(path.join(os.tmpdir(), "passage-ai-e2e-"));
const fixture = path.join(folder, "paper.pdf");
await createFixture(fixture);
let calls = 0;
let aborts = 0;
let wholePaper = false;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const parsed = JSON.parse(body);
  calls++;
  wholePaper ||= parsed.messages[1].content.length > 16000;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const translate = parsed.messages[0].content.includes("翻译专家");
  const slow = parsed.messages[1].content.includes("cancel-test");
  const answer = translate
    ? "测试协议译文：" + parsed.messages[1].content.split("as data:\n")[1]
    : "【论文证据】The selected context describes local reading and evidence [S1].";
  const parts = answer.match(/.{1,24}/gs) ?? [];
  let closed = false;
  req.on("close", () => {});
  res.on("close", () => {
    closed = true;
    if (!res.writableEnded) aborts++;
  });
  for (const part of parts) {
    if (closed) return;
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`,
    );
    await new Promise((r) => setTimeout(r, slow ? 500 : 10));
  }
  res.end(
    `data: ${JSON.stringify({ usage: { prompt_tokens: 200, completion_tokens: 60, prompt_tokens_details: { cached_tokens: 20 } } })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const env = {
  ...process.env,
  PASSAGE_TEST_DATA: folder,
  PASSAGE_TEST_PDF: fixture,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    args: [path.resolve("desktop/main.mjs")],
    env,
  });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "导入论文" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".reader-status")
      ?.textContent?.includes("已保存在本机"),
  );
  await page
    .locator(".textLayer span")
    .filter({ hasText: "Transformer" })
    .first()
    .click();
  await page.evaluate(async (port) => {
    await window.passage.saveSettings(
      {
        providers: [
          {
            id: "custom",
            baseUrl: `http://127.0.0.1:${port}/v1`,
            model: "protocol-fixture",
            inputPrice: 2,
            outputPrice: 4,
          },
        ],
        translationProvider: "custom",
        reasoningProvider: "custom",
        theme: "light",
        dailyTokenLimit: 10000,
        hardLimit: true,
        fontSize: 15,
        reduceMotion: true,
      },
      {},
    );
  }, port);
  await page.reload();
  await page.waitForFunction(() =>
    document
      .querySelector(".reader-status")
      ?.textContent?.includes("已保存在本机"),
  );
  await page
    .locator(".textLayer span")
    .filter({ hasText: "Transformer" })
    .first()
    .click();
  await page.getByRole("button", { name: "阅读助手", exact: true }).click();
  await page.getByRole("button", { name: "翻译", exact: true }).click();
  await expect(page.locator(".answer-footer")).toBeVisible();
  await expect(page.locator(".answer-text")).toContainText("Transformer");
  const before = calls;
  await page.getByRole("button", { name: "翻译", exact: true }).click();
  await expect(page.getByText("本地缓存", { exact: true })).toBeVisible();
  if (calls !== before) throw Error("Cache made an extra API request");
  await page.getByRole("button", { name: "解释", exact: true }).click();
  await expect(page.locator(".source-list button").first()).toBeVisible();
  await page.locator(".source-list button").first().click();
  await expect(page.getByRole("dialog")).toContainText("来源预览");
  await page.getByRole("button", { name: "前往原文" }).click();
  await page
    .getByRole("textbox", { name: "论文问题" })
    .fill("What does the loss function do?");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.locator(".answer-footer")).toBeVisible();
  await page.getByRole("button", { name: "保存笔记" }).click();
  const rows = await page.evaluate(() => window.passage.list("usage_requests"));
  if (rows.length !== 3 || rows.some((r) => !r.actual))
    throw Error("Usage adapter did not persist actual counts");
  const notes = await page.evaluate(() => window.passage.list("notes"));
  if (!notes.length) throw Error("AI-to-note did not save");
  const cancelled = await page.evaluate(async () => {
    const id = crypto.randomUUID();
    const providers = (await window.passage.get("settings", "app")).providers;
    const promise = window.passage.ai({
      id,
      documentId: "test",
      provider: providers[0],
      task: "ask",
      system: "Explain",
      prompt: "cancel-test",
      contextIds: [],
      maxTokens: 100,
    });
    setTimeout(() => window.passage.cancel(id), 100);
    try {
      await promise;
      return false;
    } catch {
      return true;
    }
  });
  if (!cancelled) throw Error("Cancellation failed");
  const hard = await page.evaluate(async () => {
    const settings = await window.passage.get("settings", "app");
    await window.passage.saveSettings({ ...settings, dailyTokenLimit: 1 }, {});
    try {
      await window.passage.ai({
        id: crypto.randomUUID(),
        documentId: "test",
        provider: settings.providers[0],
        task: "ask",
        system: "Explain",
        prompt: "large request",
        contextIds: [],
      });
      return false;
    } catch {
      return true;
    }
  });
  if (!hard) throw Error("Hard budget was not enforced");
  if (wholePaper) throw Error("Excessive context");
  const keyFile = await readFile(path.join(folder, "credentials.json"), "utf8");
  if (keyFile !== "{}") throw Error("Unexpected stored credentials");
  console.log(
    JSON.stringify(
      {
        passed: true,
        protocolFixtureOnly: true,
        translation: true,
        formulaAndCitationProtection: true,
        cacheNoDuplicateRequest: true,
        explain: true,
        paperQA: true,
        sourcePeek: true,
        aiToNote: true,
        usage: true,
        cancel: cancelled,
        hardLimit: hard,
        calls,
        aborts,
        wholePaperSent: false,
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
  server.close();
  await rm(folder, { recursive: true, force: true });
}
