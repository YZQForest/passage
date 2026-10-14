const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");
const tables = new Set([
  "documents",
  "blocks",
  "reading_positions",
  "notes",
  "highlights",
  "translation_cache",
  "terminology",
  "settings",
  "usage_requests",
  "ai_cache",
  "conversations",
]);
let db;
function persist() {
  const temporary = workerData.file + ".tmp";
  fs.writeFileSync(temporary, Buffer.from(db.export()), { mode: 0o600 });
  fs.renameSync(temporary, workerData.file);
}
function validate(table) {
  if (!tables.has(table)) throw new Error("不支持的数据表。");
}
(async () => {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(path.dirname(require.resolve("sql.js")), file),
  });
  db = fs.existsSync(workerData.file)
    ? new SQL.Database(fs.readFileSync(workerData.file))
    : new SQL.Database();
  const version = db.exec("PRAGMA user_version")[0]?.values[0][0] ?? 0;
  if (version > 2)
    throw new Error("数据库版本比软件更新，请升级 Passage 后再打开。");
  if (version < 2) {
    if (version === 1)
      fs.copyFileSync(workerData.file, workerData.file + ".v1.backup");
    db.run("BEGIN");
    try {
      for (const table of tables)
        db.run(
          `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, document_id TEXT, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_${table}_document ON ${table}(document_id)`,
        );
      db.run("PRAGMA user_version = 2");
      db.run("COMMIT");
      persist();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }
  parentPort.postMessage({ ready: true });
})().catch((error) => parentPort.postMessage({ fatal: error.message }));
parentPort.on("message", ({ requestId, op, table, id, data, documentId }) => {
  try {
    if (!db) throw new Error("数据库正在初始化。");
    validate(table);
    let result;
    if (op === "get" || op === "list") {
      const stmt = db.prepare(
        op === "get"
          ? `SELECT data FROM ${table} WHERE id=?`
          : documentId
            ? `SELECT data FROM ${table} WHERE document_id=?`
            : `SELECT data FROM ${table}`,
      );
      if (op === "get") stmt.bind([id]);
      else if (documentId) stmt.bind([documentId]);
      const rows = [];
      while (stmt.step()) rows.push(JSON.parse(stmt.getAsObject().data));
      stmt.free();
      result = op === "get" ? (rows[0] ?? null) : rows;
    } else if (op === "put") {
      db.run(
        `INSERT INTO ${table}(id,document_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, document_id=excluded.document_id`,
        [id, documentId ?? null, JSON.stringify(data)],
      );
      persist();
    } else if (op === "remove") {
      db.run("BEGIN");
      try {
        db.run(`DELETE FROM ${table} WHERE id=?`, [id]);
        if (table === "documents")
          for (const name of tables)
            if (
              name !== "documents" &&
              name !== "settings" &&
              name !== "usage_requests"
            )
              db.run(`DELETE FROM ${name} WHERE document_id=?`, [id]);
        db.run("COMMIT");
        persist();
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    } else throw new Error("未知数据库操作。");
    parentPort.postMessage({ requestId, result });
  } catch (error) {
    parentPort.postMessage({ requestId, error: error.message });
  }
});
