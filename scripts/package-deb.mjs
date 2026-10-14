import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
const source = path.resolve("release/linux-unpacked");
const work = path.resolve("release/deb-work");
await fs.rm(work, { recursive: true, force: true });
await fs.mkdir(path.join(work, "data/opt"), { recursive: true });
await fs.mkdir(path.join(work, "control"), { recursive: true });
await fs.cp(source, path.join(work, "data/opt/passage"), { recursive: true });
const entries = await fs.readdir(source);
const executable = entries.find(
  (n) => /^passage/i.test(n) && !n.endsWith(".desktop"),
);
if (!executable) throw Error("Linux executable not found");
await fs.mkdir(path.join(work, "data/usr/share/applications"), {
  recursive: true,
});
await fs.mkdir(path.join(work, "data/usr/share/icons/hicolor/512x512/apps"), {
  recursive: true,
});
await fs.copyFile(
  "build/icon.png",
  path.join(work, "data/usr/share/icons/hicolor/512x512/apps/passage.png"),
);
await fs.writeFile(
  path.join(work, "data/usr/share/applications/passage.desktop"),
  `[Desktop Entry]\nName=Passage\nComment=Local-first research paper reader\nExec=/opt/passage/${executable}\nIcon=passage\nTerminal=false\nType=Application\nCategories=Office;Education;\nMimeType=application/pdf;\n`,
);
await fs.writeFile(
  path.join(work, "control/control"),
  `Package: passage-reader\nVersion: ${version}\nArchitecture: amd64\nMaintainer: Passage development <noreply@localhost>\nSection: education\nPriority: optional\nDepends: libc6 (>= 2.31), libgtk-3-0, libnss3, libasound2 | libasound2t64, libxss1, libgbm1, libsecret-1-0\nDescription: Local-first research paper reader development build\n Preserves original PDFs and provides user-configured AI assistance.\n This is an unsigned development package, not a validated Linux release.\n`,
);
await fs.writeFile(
  path.join(work, "control/postinst"),
  "#!/bin/sh\nset -e\nchown -R root:root /opt/passage\nchmod 4755 /opt/passage/chrome-sandbox\nexit 0\n",
  { mode: 0o755 },
);
await fs.writeFile(path.join(work, "debian-binary"), "2.0\n");
execFileSync("tar", [
  "-czf",
  path.join(work, "control.tar.gz"),
  "-C",
  path.join(work, "control"),
  ".",
]);
execFileSync("tar", [
  "-czf",
  path.join(work, "data.tar.gz"),
  "-C",
  path.join(work, "data"),
  ".",
]);
const target = path.resolve(`release/passage-reader_${version}_amd64.deb`);
await fs.rm(target, { force: true });
const archive = await fs.open(target, "w");
try {
  await archive.write("!<arch>\n");
  for (const name of ["debian-binary", "control.tar.gz", "data.tar.gz"]) {
    const content = await fs.readFile(path.join(work, name));
    const header =
      (name + "/").padEnd(16) +
      "0".padEnd(12) +
      "0".padEnd(6) +
      "0".padEnd(6) +
      "100644".padEnd(8) +
      String(content.length).padEnd(10) +
      "`\n";
    if (Buffer.byteLength(header) !== 60) throw Error("Invalid ar header");
    await archive.write(header);
    await archive.write(content);
    if (content.length % 2) await archive.write("\n");
  }
} finally {
  await archive.close();
}
console.log(target);
await fs.rm(work, { recursive: true, force: true });
