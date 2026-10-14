import { _android, expect } from "@playwright/test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import path from "node:path";
const serial = process.env.PASSAGE_ANDROID_SERIAL;
if (!serial)
  throw Error(
    "Set PASSAGE_ANDROID_SERIAL to an explicitly selected test emulator.",
  );
const adb =
  process.env.PASSAGE_ADB ||
  path.resolve(".tools/android/sdk/platform-tools/adb");
let calls = 0;
const key = "protocol-fixture-test-only-key";
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body);
  if (req.headers.authorization !== `Bearer ${key}`) {
    res.writeHead(401);
    res.end();
    return;
  }
  calls++;
  const answer =
    "测试协议译文：" + input.messages[1].content.split("as data:\n")[1];
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const text of answer.match(/.{1,20}/gs) || []) {
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    );
    await new Promise((r) => setTimeout(r, 15));
  }
  res.end(
    `data: ${JSON.stringify({ usage: { prompt_tokens: 200, completion_tokens: 60 } })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
execFileSync(adb, ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
const device = (await _android.devices()).find((d) => d.serial() === serial);
if (!device) throw Error("Selected test emulator not found");
const errors = [];
try {
  let page = await (await device.webView({ pkg: "com.passage.reader" })).page();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForFunction(
    () =>
      document
        .querySelector(".reader-status")
        ?.textContent?.includes("已保存在本机"),
    {},
    { timeout: 45000 },
  );
  await expect(page.locator(".textLayer span").first()).toBeAttached();
  if ((await page.locator(".pdf-page").count()) !== 24)
    throw Error("Fixture pages missing");
  await page.evaluate(
    async ({ port, key }) => {
      const native = window.Capacitor.Plugins.PassageNative;
      for (const table of ["notes", "translation_cache", "ai_cache"]) {
        const { value: rows } = await native.storage({ op: "list", table });
        for (const row of rows)
          await native.storage({ op: "remove", table, id: row.id });
      }
      await native.saveSettings({
        settings: {
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
        keys: { custom: key },
      });
    },
    { port, key },
  );
  const secretFile = execFileSync(adb, [
    "-s",
    serial,
    "shell",
    "run-as",
    "com.passage.reader",
    "cat",
    "shared_prefs/credentials.xml",
  ]).toString();
  if (secretFile.includes(key))
    throw Error("Test credential saved as plaintext");
  await page.reload();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".reader-status")
        ?.textContent?.includes("已保存在本机"),
    {},
    { timeout: 45000 },
  );
  await page
    .locator(".textLayer span")
    .filter({ hasText: "Transformer" })
    .first()
    .click();
  await page.locator(".mobile-nav button").filter({ hasText: "AI" }).click();
  await page.getByRole("button", { name: "翻译", exact: true }).click();
  await expect(page.locator(".answer-footer")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".answer-text")).toContainText("Transformer");
  await page.getByRole("button", { name: "翻译", exact: true }).click();
  await expect(page.getByText("本地缓存", { exact: true })).toBeVisible();
  if (calls !== 1) throw Error("Android cache made duplicate request");
  await page.locator(".mobile-nav button").filter({ hasText: "阅读" }).click();
  await page.getByRole("spinbutton", { name: "当前页码" }).fill("7");
  await page.waitForTimeout(500);
  await page.locator(".mobile-nav button").filter({ hasText: "笔记" }).click();
  await page
    .getByRole("textbox", { name: "新笔记" })
    .fill("Android SQLite persistence test.");
  await page.getByRole("button", { name: "添加笔记" }).click();
  await expect(page.locator(".note")).toHaveCount(1);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: "test-results/android-reader.png" });
  await device.shell("am force-stop com.passage.reader");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await device.shell("am start -n com.passage.reader/.MainActivity");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  page = await (await device.webView({ pkg: "com.passage.reader" })).page();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".reader-status")
        ?.textContent?.includes("已保存在本机"),
    {},
    { timeout: 45000 },
  );
  await expect(page.getByRole("spinbutton", { name: "当前页码" })).toHaveValue(
    "7",
  );
  await page.locator(".mobile-nav button").filter({ hasText: "笔记" }).click();
  await expect(page.locator(".note")).toHaveCount(1);
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        passed: true,
        nativePdfImport: true,
        pages: 24,
        androidKeyStore: true,
        nativeHttpStreaming: true,
        translation: true,
        cache: true,
        sqliteRestart: true,
        notes: true,
        resumePage: 7,
        protocolFixtureOnly: true,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  execFileSync(adb, ["-s", serial, "reverse", "--remove", `tcp:${port}`]);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await device.close();
}
