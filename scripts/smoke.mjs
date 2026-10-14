import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixture } from "./fixture.mjs";
const output = path.resolve("test-results");
await mkdir(output, { recursive: true });
const data = await mkdtemp(path.join(os.tmpdir(), "passage-smoke-"));
const fixture = path.join(output, "reader-fixture.pdf");
await createFixture(fixture);
const env = {
  ...process.env,
  PASSAGE_TEST_DATA: data,
  PASSAGE_TEST_PDF: process.env.PASSAGE_REAL_PDF || fixture,
};
delete env.ELECTRON_RUN_AS_NODE;
const launchOptions = process.env.PASSAGE_APP_EXECUTABLE
  ? { executablePath: process.env.PASSAGE_APP_EXECUTABLE, args: [] }
  : { args: [path.resolve("desktop/main.mjs")] };
let application;
const errors = [];
try {
  application = await electron.launch({ ...launchOptions, env });
  let page = await application.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.error("RENDERER:", m.text());
  });
  await expect(page.getByText("让理解跟上")).toBeVisible();
  await page.screenshot({ path: path.join(output, "welcome.png") });
  await page.getByRole("button", { name: "导入论文" }).click();
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible();
  await expect(page.locator(".textLayer span").first()).toBeAttached({
    timeout: 30000,
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector(".reader-status")
        ?.textContent?.includes("已保存在本机"),
    {},
    { timeout: 45000 },
  );
  const pageCount = await page.locator(".pdf-page").count();
  if (pageCount < 2) throw Error("Expected multipage PDF");
  const canvasWidth = await page
    .locator(".pdf-page canvas")
    .first()
    .evaluate((canvas) => canvas.width);
  if (canvasWidth === 0) throw Error("PDF canvas was not rendered");
  await page
    .locator(".textLayer span")
    .filter({
      hasText: process.env.PASSAGE_REAL_PDF ? "Attention" : "Transformer",
    })
    .first()
    .click();
  await page.getByRole("button", { name: "双语辅助栏" }).click();
  await expect(page.locator(".assistant")).toBeVisible();
  await page.screenshot({
    path: path.join(
      output,
      process.env.PASSAGE_REAL_PDF ? "real-paper.png" : "reader.png",
    ),
  });
  await page.getByRole("button", { name: "搜索论文（⌘ F）" }).click();
  await page
    .getByRole("textbox", { name: "论文全文搜索" })
    .fill(process.env.PASSAGE_REAL_PDF ? "attention" : "loss function");
  await expect(page.locator(".reader-outline button").first()).toBeVisible();
  await page.locator(".reader-outline button").first().click();
  await page.getByRole("button", { name: "关闭搜索" }).click();
  await page.getByRole("button", { name: "当前页码", exact: true }).count();
  await page.getByRole("spinbutton", { name: "当前页码" }).fill("6");
  await expect(page.getByRole("spinbutton", { name: "当前页码" })).toHaveValue(
    "6",
  );
  await page.waitForTimeout(750);
  let savedScroll = await page
    .locator(".pdf-scroller")
    .evaluate((node) => node.scrollTop);
  if (savedScroll < 1000) throw Error("Page navigation did not update scroll");
  await page.getByRole("button", { name: "论文笔记", exact: true }).click();
  await page
    .getByRole("textbox", { name: "新笔记" })
    .fill("Persistence checked against real PDF page.");
  await page.getByRole("button", { name: "添加笔记" }).click();
  await expect(page.locator(".note")).toHaveCount(1);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const selected = await page
    .locator('[data-page="6"] .textLayer span')
    .first();
  await selected.waitFor({ state: "attached" });
  await selected.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.locator(".selection-toolbar")).toBeVisible();
  await page.getByRole("button", { name: "高亮", exact: true }).click();
  await expect(page.locator(".highlight-box")).toHaveCount(1);
  await page.getByRole("button", { name: "撤销最近高亮" }).click();
  await expect(page.locator(".highlight-box")).toHaveCount(0);
  await page.getByRole("button", { name: "偏好设置" }).click();
  await expect(page.getByRole("dialog", { name: "偏好设置" })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("spinbutton", { name: "当前页码" }).fill("9");
  await page.waitForTimeout(45);
  savedScroll = await page
    .locator(".pdf-scroller")
    .evaluate((node) => node.scrollTop);
  await application.close();
  application = await electron.launch({ ...launchOptions, env });
  page = await application.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForFunction(
    () =>
      document
        .querySelector(".reader-status")
        ?.textContent?.includes("已保存在本机"),
    {},
    { timeout: 45000 },
  );
  await expect(page.getByRole("spinbutton", { name: "当前页码" })).toHaveValue(
    "9",
  );
  await page.waitForTimeout(350);
  const resumed = await page
    .locator(".pdf-scroller")
    .evaluate((node) => node.scrollTop);
  if (Math.abs(resumed - savedScroll) > 150)
    throw Error(`Resume drift ${resumed - savedScroll}`);
  await page.getByRole("button", { name: "论文笔记", exact: true }).click();
  await expect(page.locator(".note")).toHaveCount(1);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const documents = await page.evaluate(() => window.passage.list("documents"));
  if (documents.length !== 1) throw Error("Library did not persist");
  if (errors.length) throw Error(errors.join("\n"));
  const bytes = await readFile(path.join(data, "passage.sqlite"));
  if (bytes.subarray(0, 15).toString() !== "SQLite format 3")
    throw Error("Not a SQLite database");
  console.log(
    JSON.stringify(
      {
        passed: true,
        pageCount,
        persistence: true,
        search: true,
        selection: true,
        notes: true,
        highlightUndo: true,
        resumeScroll: resumed,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await application?.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
