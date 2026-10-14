const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("passage", {
  list: (table, documentId) =>
    ipcRenderer.invoke("storage:list", table, documentId),
  get: (table, id) => ipcRenderer.invoke("storage:get", table, id),
  put: (table, id, data, documentId) =>
    ipcRenderer.invoke("storage:put", table, id, data, documentId),
  remove: (table, id) => ipcRenderer.invoke("storage:remove", table, id),
  importPdf: () => ipcRenderer.invoke("pdf:import"),
  pdf: (id) => ipcRenderer.invoke("pdf:read", id),
  saveSettings: (settings, keys) =>
    ipcRenderer.invoke("settings:save", settings, keys),
  ai: (request) => ipcRenderer.invoke("ai:request", request),
  cancel: (id) => ipcRenderer.invoke("ai:cancel", id),
  onChunk: (fn) => {
    const listener = (_, data) => fn(data);
    ipcRenderer.on("ai:chunk", listener);
    return () => ipcRenderer.removeListener("ai:chunk", listener);
  },
  testProvider: (id) => ipcRenderer.invoke("ai:test", id),
  exportData: () => ipcRenderer.invoke("data:export"),
  onClose: (fn) => {
    const listener = () =>
      Promise.resolve(fn())
        .then(() => ipcRenderer.invoke("app:closeReady"))
        .catch(() => ipcRenderer.invoke("app:closeFailed"));
    ipcRenderer.on("app:closing", listener);
    return () => ipcRenderer.removeListener("app:closing", listener);
  },
});
