import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const data = await mkdtemp(path.join(os.tmpdir(), "passage-key-"));
const key = "sk-protocol-fixture-only-123";
let calls = 0;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const parsed = JSON.parse(body);
  if (
    req.headers.authorization !== `Bearer ${key}` ||
    parsed.model !== "protocol-fixture"
  ) {
    console.log({
      keyMatches: req.headers.authorization === `Bearer ${key}`,
      hasAuthorization: Boolean(req.headers.authorization),
      modelMatches: parsed.model === "protocol-fixture",
      receivedLength: req.headers.authorization?.length,
      expectedLength: key.length + 7,
      fixtureContained: req.headers.authorization?.includes(key),
    });
    res.writeHead(401);
    res.end("Fixture rejects missing credentials");
    return;
  }
  calls++;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(
    "data: " +
      JSON.stringify({
        choices: [{ delta: { content: "OK" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }) +
      "\n\ndata: [DONE]\n\n",
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const env = { ...process.env, PASSAGE_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const launch = process.env.PASSAGE_APP_EXECUTABLE
  ? { executablePath: process.env.PASSAGE_APP_EXECUTABLE, args: [] }
  : { args: [path.resolve("desktop/main.mjs")] };
let app;
let originalClipboard;
try {
  app = await electron.launch({ ...launch, env });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page
    .getByRole("button", { name: "自定义 / 本地", exact: true })
    .click();
  await page
    .getByLabel("API 地址", { exact: true })
    .fill(`http://127.0.0.1:${port}/v1`);
  await page.getByLabel("模型名称", { exact: true }).fill("protocol-fixture");
  const input = page.getByRole("textbox", { name: "API Key" });
  await input.pressSequentially(key, { delay: 20 });
  await expect(input).toHaveValue(key);
  await page.getByRole("button", { name: "OpenAI", exact: true }).click();
  await expect(input).toHaveValue("");
  await page
    .getByRole("button", { name: "自定义 / 本地", exact: true })
    .click();
  await expect(input).toHaveValue(key);
  originalClipboard = await app.evaluate(({ clipboard }) =>
    clipboard.readText(),
  );
  await app.evaluate(
    ({ clipboard }, key) => clipboard.writeText(" " + key + "\n"),
    key,
  );
  await input.click();
  await input.press("Meta+A");
  await input.press("Meta+V");
  await expect(input).toHaveValue(" " + key);
  await app.evaluate(
    ({ clipboard }, value) => clipboard.writeText(value),
    originalClipboard,
  );
  originalClipboard = undefined;
  await page
    .getByRole("button", { name: "保存并测试连接", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("连接成功", {
    timeout: 20000,
  });
  await expect(input).toHaveValue("");
  if (calls !== 1) throw Error("Test did not use the entered draft key");
  const secrets = await readFile(path.join(data, "credentials.json"), "utf8");
  if (secrets.includes(key)) throw Error("Plaintext stored");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await app.close();
  app = await electron.launch({ ...launch, env });
  const restarted = await app.firstWindow();
  await restarted.getByRole("button", { name: "偏好设置" }).click();
  await restarted
    .getByRole("button", { name: "自定义 / 本地", exact: true })
    .click();
  await expect(
    restarted.getByRole("textbox", { name: "API Key" }),
  ).toHaveAttribute("placeholder", "已保存 · 留空保留现有密钥");
  await restarted
    .getByRole("button", { name: "保存并测试连接", exact: true })
    .click();
  await expect(restarted.getByRole("status")).toContainText("连接成功", {
    timeout: 20000,
  });
  if (calls !== 2) throw Error("Restart lost credentials");
  await restarted.getByRole("button", { name: "删除密钥" }).click();
  await restarted
    .getByRole("button", { name: "保存设置", exact: true })
    .click();
  await expect(restarted.getByRole("status")).toContainText("设置已保存");
  const stored = JSON.parse(
    await readFile(path.join(data, "credentials.json"), "utf8"),
  );
  if (stored.custom) throw Error("Deletion failed");
  console.log(
    JSON.stringify({
      passed: true,
      typing: true,
      paste: true,
      providerSwitch: true,
      saveAndTestDraft: true,
      whitespaceTrim: true,
      encrypted: true,
      restart: true,
      deletion: true,
      protocolFixtureOnly: true,
    }),
  );
} finally {
  if (originalClipboard !== undefined)
    await app
      ?.evaluate(
        ({ clipboard }, value) => clipboard.writeText(value),
        originalClipboard,
      )
      .catch(() => {});
  await app?.close();
  await rm(data, { recursive: true, force: true });
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
