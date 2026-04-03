const { contextBridge, ipcRenderer } = require("electron");

// Use window.postMessage to bridge events from preload to renderer
// This avoids the "object could not be cloned" error with contextBridge + callbacks

ipcRenderer.on("clichat:data", (_, data) => {
  window.postMessage({ type: "clichat:data", data }, "*");
});

ipcRenderer.on("clichat:exit", (_, code) => {
  window.postMessage({ type: "clichat:exit", code }, "*");
});

contextBridge.exposeInMainWorld("clichatPTY", {
  spawn: (config) => ipcRenderer.invoke("clichat:spawn", config),
  write: (data) => ipcRenderer.invoke("clichat:write", data),
  resize: (size) => ipcRenderer.invoke("clichat:resize", size),
  kill: () => ipcRenderer.invoke("clichat:kill"),
});
