import { _android, expect } from "@playwright/test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import path from "node:path";
const serial = process.env.PASSAGE_ANDROID_SERIAL;
if (!serial) throw Error("Select the dedicated test emulator");
const adb =
  process.env.PASSAGE_ADB ||
  path.resolve(".tools/android/sdk/platform-tools/adb");
const key = "android-protocol-fixture-only";
let calls = 0;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const parsed = JSON.parse(body);
  if (
    req.headers.authorization !== `Bearer ${key}` ||
    parsed.model !== "protocol-fixture"
  ) {
    res.writeHead(401);
    res.end();
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
execFileSync(adb, ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
const device = (await _android.devices()).find((d) => d.serial() === serial);
try {
  const page = await (
    await device.webView({ pkg: "com.passage.reader" })
  ).page();
  await page.locator(".mobile-nav button").filter({ hasText: "操作" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "偏好设置" })
    .click();
  await page
    .getByRole("button", { name: "自定义 / 本地", exact: true })
    .click();
  await page
    .getByLabel("API 地址", { exact: true })
    .fill(`http://127.0.0.1:${port}/v1`);
  await page.getByLabel("模型名称", { exact: true }).fill("protocol-fixture");
  await page.getByLabel("API Key", { exact: true }).fill(" " + key + " ");
  await page
    .getByRole("button", { name: "保存并测试连接", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("连接成功", {
    timeout: 20000,
  });
  if (calls !== 1) throw Error("Newly entered Android credential was not used");
  const encrypted = execFileSync(adb, [
    "-s",
    serial,
    "shell",
    "run-as",
    "com.passage.reader",
    "cat",
    "shared_prefs/credentials.xml",
  ]).toString();
  if (encrypted.includes(key)) throw Error("Plaintext credential");
  await page.reload();
  await page.locator(".mobile-nav button").filter({ hasText: "操作" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "偏好设置" })
    .click();
  await page
    .getByRole("button", { name: "自定义 / 本地", exact: true })
    .click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "placeholder",
    "已保存 · 留空保留现有密钥",
  );
  await page
    .getByRole("button", { name: "保存并测试连接", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("连接成功", {
    timeout: 20000,
  });
  if (calls !== 2) throw Error("Reload lost Android credentials");
  console.log(
    JSON.stringify({
      passed: true,
      mobileSettingsAccessible: true,
      saveAndTestDraft: true,
      encrypted: true,
      reload: true,
      protocolFixtureOnly: true,
    }),
  );
} finally {
  execFileSync(adb, ["-s", serial, "reverse", "--remove", `tcp:${port}`]);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await device.close();
}
