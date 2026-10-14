import { _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const data = await mkdtemp(path.join(os.tmpdir(), "passage-icons-"));
const env = { ...process.env, PASSAGE_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [path.resolve("desktop/main.mjs")],
  env,
});
try {
  const page = await app.firstWindow();
  for (const [density, size] of [
    ["mdpi", 48],
    ["hdpi", 72],
    ["xhdpi", 96],
    ["xxhdpi", 144],
    ["xxxhdpi", 192],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0"><img width="${size}" height="${size}" src="file://${path.resolve("build/icon.png")}"/></body>`,
    );
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({
      path: `android/app/src/main/res/mipmap-${density}/ic_launcher.png`,
    });
    await page.screenshot({
      path: `android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`,
    });
  }
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
