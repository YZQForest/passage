import { _electron as electron } from "@playwright/test";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="42" y="42" width="940" height="940" rx="216" fill="#386757"/><path d="M256 308Q386 288 512 370Q638 288 768 308V686Q638 666 512 748Q386 666 256 686Z" fill="#f4f3ef"/><path d="M512 370V748" fill="none" stroke="#386757" stroke-width="23"/><path d="M310 387Q395 385 450 421M310 469Q395 467 450 503M310 551Q395 549 450 585" fill="none" stroke="#a8bfa8" stroke-width="16" stroke-linecap="round"/><path d="M637 400L653 441L694 457L653 473L637 514L621 473L580 457L621 441Z" fill="#386757"/></svg>';
await mkdir("build", { recursive: true });
await writeFile("build/icon.svg", svg);
const data = await mkdtemp(path.join(os.tmpdir(), "passage-icon-"));
const env = { ...process.env, PASSAGE_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [path.resolve("desktop/main.mjs")],
  env,
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1024, height: 1024 });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg}</body></html>`,
  );
  await page.screenshot({ path: "build/icon.png", omitBackground: true });
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
