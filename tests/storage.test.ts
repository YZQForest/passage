import { afterEach, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
let worker: Worker;
let folder: string;
afterEach(async () => {
  if (worker) await worker.terminate();
  if (folder) await rm(folder, { recursive: true, force: true });
});
async function launch(file: string) {
  worker = new Worker(path.resolve("desktop/storage.cjs"), {
    workerData: { file },
  });
  await new Promise<void>((resolve, reject) => {
    worker.once("message", (m) =>
      m.ready ? resolve() : reject(Error(m.fatal)),
    );
    worker.once("error", reject);
  });
}
let n = 0;
function call(
  op: string,
  table: string,
  id?: string,
  data?: unknown,
  documentId?: string,
) {
  const requestId = String(++n);
  return new Promise<unknown>((resolve, reject) => {
    const listener = (m: {
      requestId: string;
      error?: string;
      result: unknown;
    }) => {
      if (m.requestId !== requestId) return;
      worker.off("message", listener);
      if (m.error) reject(Error(m.error));
      else resolve(m.result);
    };
    worker.on("message", listener);
    worker.postMessage({ requestId, op, table, id, data, documentId });
  });
}
it("persists notes after restart, filters by document and cascades deletion", async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "passage-db-"));
  const file = path.join(folder, "test.sqlite");
  await launch(file);
  await call("put", "documents", "paper", { id: "paper" });
  await call("put", "notes", "note", { text: "real note" }, "paper");
  await call("put", "notes", "other", { text: "other" }, "else");
  await worker.terminate();
  await launch(file);
  expect(await call("list", "notes", undefined, undefined, "paper")).toEqual([
    { text: "real note" },
  ]);
  await call("remove", "documents", "paper");
  expect(await call("list", "notes")).toEqual([{ text: "other" }]);
});
it("rejects arbitrary SQL table names", async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "passage-db-"));
  await launch(path.join(folder, "test.sqlite"));
  await expect(call("list", "notes; DROP TABLE documents")).rejects.toThrow(
    "不支持",
  );
});

it("migrates a version 1 database without losing paper data", async () => {
  const { default: initSqlJs } = await import("sql.js");
  const { readFile, writeFile } = await import("node:fs/promises");
  folder = await mkdtemp(path.join(os.tmpdir(), "passage-migration-"));
  const file = path.join(folder, "legacy.sqlite");
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  legacy.run(
    "CREATE TABLE documents(id TEXT PRIMARY KEY,document_id TEXT,data TEXT NOT NULL); PRAGMA user_version=1",
  );
  legacy.run("INSERT INTO documents VALUES(?,?,?)", [
    "legacy",
    null,
    JSON.stringify({ id: "legacy", name: "Preserve this paper" }),
  ]);
  await writeFile(file, Buffer.from(legacy.export()));
  legacy.close();
  await launch(file);
  expect(await call("get", "documents", "legacy")).toEqual({
    id: "legacy",
    name: "Preserve this paper",
  });
  expect((await readFile(file + ".v1.backup")).subarray(0, 15).toString()).toBe(
    "SQLite format 3",
  );
  await call(
    "put",
    "ai_cache",
    "answer",
    { text: "cached explanation" },
    "legacy",
  );
  expect(await call("get", "ai_cache", "answer")).toEqual({
    text: "cached explanation",
  });
});
