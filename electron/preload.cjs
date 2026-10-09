const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  openFile: (kind) => ipcRenderer.invoke("file:open", kind),
  adoptProject: (token) => ipcRenderer.invoke("file:adopt-project", token),
  saveProject: (name, content, saveAs) =>
    ipcRenderer.invoke("file:save-project", { name, content, saveAs }),
  exportImage: (name, data, format) =>
    ipcRenderer.invoke("file:export", { name, data, format }),
  readClipboard: () => ipcRenderer.invoke("clipboard:image"),
  setDirty: (dirty) => ipcRenderer.send("document:dirty", dirty),
  setTitle: (title) => ipcRenderer.send("document:title", title),
  resetProjectPath: () => ipcRenderer.send("document:reset-path"),
  confirmClose: () => ipcRenderer.send("window:close-confirmed"),
  getInfo: () => ipcRenderer.invoke("app:info"),
  onAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("editor:action", listener);
    return () => ipcRenderer.removeListener("editor:action", listener);
  },
});
