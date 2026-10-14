import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  Menu,
  protocol,
  net,
} from "electron";
import { Worker } from "node:worker_threads";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { complete, normalizeUsage, estimateCost } from "./providers.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let win;
let store;
let userDir;
let ready;
const pending = new Map();
const requests = new Map();
const session = randomUUID();
let reservedTokens = 0;
const activeRequests = new Set();
let allowClose = false;
let closeRequested = false;
function storage(op, table, id, data, documentId) {
  return ready.then(
    () =>
      new Promise((resolve, reject) => {
        const requestId = randomUUID();
        pending.set(requestId, { resolve, reject });
        store.postMessage({ requestId, op, table, id, data, documentId });
      }),
  );
}
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (
      event.sender !== win?.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("拒绝未知窗口请求。");
    return fn(...args);
  });
}
async function encrypt(text) {
  if (
    process.platform === "linux" &&
    safeStorage.getSelectedStorageBackend() === "basic_text"
  )
    throw new Error(
      "系统未启用安全密钥环，请先配置 Secret Service / KWallet。密钥未保存。",
    );
  if (safeStorage.isAsyncEncryptionAvailable) {
    if (!(await safeStorage.isAsyncEncryptionAvailable()))
      throw new Error("系统凭据存储不可用。");
    return (await safeStorage.encryptStringAsync(text)).toString("base64");
  }
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("系统凭据存储不可用。");
  return safeStorage.encryptString(text).toString("base64");
}
async function decrypt(value) {
  if (!value) return "";
  const buffer = Buffer.from(value, "base64");
  if (!safeStorage.decryptStringAsync) return safeStorage.decryptString(buffer);
  const decrypted = await safeStorage.decryptStringAsync(buffer);
  if (typeof decrypted.result !== "string")
    throw new Error("无法解密 API Key，请在设置中重新保存密钥。");
  return decrypted.result;
}
async function keys() {
  try {
    return JSON.parse(
      await fs.readFile(path.join(userDir, "credentials.json"), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}
async function configs() {
  const data = await storage("get", "settings", "app");
  if (!data) return null;
  const secrets = await keys();
  return {
    ...data,
    providers: data.providers.map((p) => ({
      ...p,
      keySet: Boolean(secrets[p.id]),
    })),
  };
}
async function runAI(request, persistUsage = true) {
  if (typeof request.id !== "string" || requests.has(request.id))
    throw new Error("请求标识无效或重复。");
  if (
    typeof request.prompt !== "string" ||
    request.prompt.length > 24000 ||
    typeof request.system !== "string" ||
    request.system.length > 8000
  )
    throw new Error("请求上下文过大，请选择较短段落。");
  const settings = await configs();
  const config = settings?.providers.find((p) => p.id === request.provider.id);
  if (!config) throw new Error("请先保存 AI 服务商配置。");
  if (!config.model.trim()) throw new Error("请先填写模型 ID。");
  const encrypted = (await keys())[config.id];
  const key = await decrypt(encrypted);
  if (!key && config.id !== "custom")
    throw new Error("请先保存此服务商的 API Key。");
  const estimate =
    Math.ceil((request.system.length + request.prompt.length) / 3) +
    (request.maxTokens ?? 1500);
  const all = await storage("list", "usage_requests");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const consumed = all
    .filter((u) => u.timestamp >= today.getTime())
    .reduce((s, u) => s + u.input + u.output, 0);
  if (
    settings.hardLimit &&
    settings.dailyTokenLimit > 0 &&
    consumed + reservedTokens + estimate > settings.dailyTokenLimit
  )
    throw new Error("已达到每日 Token 硬限制，请在设置中调整限额。");
  reservedTokens += estimate;
  const controller = new AbortController();
  requests.set(request.id, controller);
  const started = Date.now();
  const timeout = setTimeout(() => controller.abort("timeout"), 90000);
  let output = "";
  let providerUsage;
  let status = "success";
  try {
    const result = await complete(
      config,
      key,
      request,
      controller.signal,
      (text) => {
        output += text;
        win?.webContents.send("ai:chunk", { id: request.id, text });
      },
    );
    providerUsage = result.usage;
    return {
      text: result.text,
      usage: {
        id: request.id,
        timestamp: started,
        session,
        provider: config.id,
        model: config.model,
        task: request.task,
        documentId: request.documentId,
        ...providerUsage,
        cost: estimateCost(providerUsage, config),
        duration: Date.now() - started,
        status,
        contextIds: request.contextIds,
      },
    };
  } catch (error) {
    providerUsage = error.usage;
    status = controller.signal.aborted
      ? controller.signal.reason === "timeout"
        ? "timeout"
        : "cancelled"
      : "failed";
    if (controller.signal.aborted)
      throw new Error(
        status === "timeout"
          ? "AI 请求超时，请检查网络或更换模型。"
          : "请求已停止。",
      );
    if (error.message.includes("fetch") || error.message.includes("network"))
      throw new Error("无法连接 AI 服务，请检查网络与 Base URL。");
    throw error;
  } finally {
    clearTimeout(timeout);
    requests.delete(request.id);
    reservedTokens -= estimate;
    const usage =
      providerUsage ??
      normalizeUsage(config.id, null, request.system + request.prompt, output);
    if (persistUsage)
      await storage(
        "put",
        "usage_requests",
        request.id,
        {
          id: request.id,
          timestamp: started,
          session,
          provider: config.id,
          model: config.model,
          task: request.task,
          documentId: request.documentId,
          ...usage,
          cost: estimateCost(usage, config),
          duration: Date.now() - started,
          status,
          contextIds: request.contextIds,
        },
        request.documentId,
      );
  }
}
function trackedAI(request) {
  const promise = runAI(request);
  activeRequests.add(promise);
  promise.then(
    () => activeRequests.delete(promise),
    () => activeRequests.delete(promise),
  );
  return promise;
}
app
  .whenReady()
  .then(async () => {
    userDir = process.env.PASSAGE_TEST_DATA || app.getPath("userData");
    await fs.mkdir(path.join(userDir, "papers"), { recursive: true });
    store = new Worker(path.join(here, "storage.cjs"), {
      workerData: { file: path.join(userDir, "passage.sqlite") },
    });
    ready = new Promise((resolve, reject) => {
      store.on("message", (message) => {
        if (message.ready) resolve();
        else if (message.fatal) reject(new Error(message.fatal));
        else {
          const promise = pending.get(message.requestId);
          if (promise) {
            pending.delete(message.requestId);
            if (message.error) promise.reject(new Error(message.error));
            else promise.resolve(message.result);
          }
        }
      });
      store.on("error", (error) => {
        reject(error);
        for (const promise of pending.values()) promise.reject(error);
        pending.clear();
      });
    });
    await ready;
    protocol.handle("app", (request) => {
      const url = new URL(request.url);
      const root = path.resolve(here, "../dist");
      const target = path.resolve(root, "." + decodeURIComponent(url.pathname));
      if (url.hostname !== "passage" || !target.startsWith(root + path.sep))
        return new Response("Forbidden", { status: 403 });
      return net.fetch(pathToFileURL(target).toString());
    });
    handle("storage:list", (table, documentId) =>
      storage("list", table, undefined, undefined, documentId),
    );
    handle("storage:get", async (table, id) =>
      table === "settings" && id === "app"
        ? configs()
        : storage("get", table, id),
    );
    handle("storage:put", (table, id, data, documentId) => {
      if (["settings", "usage_requests"].includes(table))
        throw new Error("此数据必须由对应服务保存。");
      return storage("put", table, id, data, documentId);
    });
    handle("storage:remove", async (table, id) => {
      if (["settings", "usage_requests"].includes(table))
        throw new Error("此记录不能直接删除。");
      await storage("remove", table, id);
      if (table === "documents" && /^[a-f0-9]{64}$/.test(id))
        await fs.rm(path.join(userDir, "papers", `${id}.pdf`), { force: true });
    });
    handle("pdf:import", async () => {
      const selection = process.env.PASSAGE_TEST_PDF
        ? { canceled: false, filePaths: [process.env.PASSAGE_TEST_PDF] }
        : await dialog.showOpenDialog(win, {
            properties: ["openFile"],
            filters: [{ name: "PDF 论文", extensions: ["pdf"] }],
          });
      if (selection.canceled) return null;
      const file = selection.filePaths[0];
      const stat = await fs.stat(file);
      if (stat.size > 250 * 1024 * 1024)
        throw new Error("PDF 超过 250 MB，请先压缩或拆分后导入。");
      const bytes = await fs.readFile(file);
      if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
        throw new Error("此文件不是有效的 PDF。");
      const id = createHash("sha256").update(bytes).digest("hex");
      const existing = await storage("get", "documents", id);
      if (existing) return existing;
      await fs.writeFile(path.join(userDir, "papers", `${id}.pdf`), bytes, {
        mode: 0o600,
      });
      const paper = {
        id,
        name: path.basename(file, ".pdf"),
        pages: 0,
        addedAt: Date.now(),
        openedAt: Date.now(),
      };
      await storage("put", "documents", id, paper);
      return paper;
    });
    handle("pdf:read", async (id) => {
      if (
        !/^[a-f0-9]{64}$/.test(id) ||
        !(await storage("get", "documents", id))
      )
        throw new Error("论文不存在，请重新导入。");
      return new Uint8Array(
        await fs.readFile(path.join(userDir, "papers", `${id}.pdf`)),
      );
    });
    handle("settings:save", async (settings, changes) => {
      if (!Array.isArray(settings.providers))
        throw new Error("无效服务商配置。");
      for (const p of settings.providers) {
        if (
          !["openai", "anthropic", "gemini", "deepseek", "custom"].includes(
            p.id,
          )
        )
          throw new Error("未知服务商。");
        for (const price of [p.inputPrice, p.outputPrice, p.cachedPrice])
          if (price != null && (!Number.isFinite(price) || price < 0))
            throw new Error("价格必须是非负数字。");
      }
      if (
        !Number.isFinite(settings.dailyTokenLimit) ||
        settings.dailyTokenLimit < 0
      )
        throw new Error("Token 限额必须是非负数字。");
      const current = await keys();
      for (const [id, text] of Object.entries(changes)) {
        if (!settings.providers.some((p) => p.id === id))
          throw new Error("未知凭据。");
        if (text === "") delete current[id];
        else current[id] = await encrypt(text);
      }
      const temporary = path.join(userDir, "credentials.json.tmp");
      await fs.writeFile(temporary, JSON.stringify(current), { mode: 0o600 });
      await fs.rename(temporary, path.join(userDir, "credentials.json"));
      await storage("put", "settings", "app", {
        ...settings,
        providers: settings.providers.map(({ keySet: _keySet, ...p }) => p),
      });
    });
    handle("ai:request", trackedAI);
    handle("ai:cancel", (id) => requests.get(id)?.abort());
    handle("ai:test", async (id) => {
      const settings = await configs();
      const provider = settings?.providers.find((p) => p.id === id);
      if (!provider) throw new Error("请先保存服务商设置。");
      await trackedAI({
        id: randomUUID(),
        provider,
        documentId: "",
        task: "connection-test",
        system: "Reply briefly.",
        prompt: "Reply OK.",
        contextIds: [],
        maxTokens: 100,
      });
      return "连接成功；测试调用已计入用量。";
    });
    handle("data:export", async () => {
      const target = await dialog.showSaveDialog(win, {
        defaultPath: "Passage-backup.json",
        filters: [{ name: "JSON backup", extensions: ["json"] }],
      });
      if (target.canceled) return null;
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        pdfs: {},
      };
      for (const table of [
        "documents",
        "blocks",
        "reading_positions",
        "notes",
        "highlights",
        "translation_cache",
        "terminology",
        "usage_requests",
        "ai_cache",
        "conversations",
      ])
        data[table] = await storage("list", table);
      for (const document of data.documents)
        data.pdfs[document.id] = (
          await fs.readFile(path.join(userDir, "papers", `${document.id}.pdf`))
        ).toString("base64");
      data.settings = await configs();
      await fs.writeFile(target.filePath, JSON.stringify(data), {
        mode: 0o600,
      });
      return target.filePath;
    });
    win = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 860,
      minHeight: 600,
      title: "Passage",
      backgroundColor: "#f4f3ef",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 20 },
      webPreferences: {
        preload: path.join(here, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_, __, callback) =>
      callback(false),
    );
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Passage",
          submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
        },
        {
          label: "编辑",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "窗口",
          submenu: [
            { role: "minimize" },
            { role: "zoom" },
            { role: "togglefullscreen" },
          ],
        },
      ]),
    );
    handle("app:closeReady", async () => {
      for (const controller of requests.values()) controller.abort();
      await Promise.allSettled([...activeRequests]);
      allowClose = true;
      win.close();
    });
    handle("app:closeFailed", () => {
      closeRequested = false;
      dialog.showErrorBox(
        "阅读位置保存失败",
        "请返回应用检查本地存储后再关闭。",
      );
    });
    win.on("close", (event) => {
      if (allowClose) return;
      event.preventDefault();
      if (closeRequested) return;
      closeRequested = true;
      win.webContents.send("app:closing");
      setTimeout(async () => {
        if (!closeRequested || allowClose || win.isDestroyed()) return;
        closeRequested = false;
        const choice = await dialog.showMessageBox(win, {
          type: "warning",
          message: "尚未确认最近阅读位置已保存。",
          detail: "可以返回应用等待保存，或退出并保留此前已保存的阅读记录。",
          buttons: ["返回应用", "仍然退出"],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice.response === 1) {
          allowClose = true;
          win.close();
        }
      }, 10000);
    });
    await win.loadURL("app://passage/index.html");
  })
  .catch((error) => {
    dialog.showErrorBox("Passage 启动失败", error.message);
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  for (const controller of requests.values()) controller.abort();
});
app.on("will-quit", () => store?.terminate());
