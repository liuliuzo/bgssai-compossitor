const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  clipboard,
  protocol,
  net,
  session,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");

const MAX_BYTES = 128 * 1024 * 1024;
const devURL =
  !app.isPackaged && process.env.COMPOSITOR_DEV_URL === "http://127.0.0.1:5173"
    ? process.env.COMPOSITOR_DEV_URL
    : null;
let window;
let dirty = false;
let closeConfirmed = false;
let projectPath = null;
const pendingProjects = new Map();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "compositor",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function trusted(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("Untrusted sender");
  const url = new URL(event.senderFrame.url);
  if (
    !(devURL
      ? url.origin === devURL
      : url.protocol === "compositor:" && url.hostname === "app")
  )
    throw new Error("Untrusted origin");
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    return fn(...args);
  });
}
function listen(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    trusted(event);
    fn(...args);
  });
}
function action(name) {
  window?.webContents.send("editor:action", name);
}
function safeName(name) {
  return (
    String(name ?? "未命名")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .slice(0, 100) || "未命名"
  );
}
async function atomicWrite(target, data) {
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data, { flag: "wx" });
    await fs.rename(temp, target);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}

function setupIPC() {
  handle("app:info", async () => {
    const environment =
      !app.isPackaged && process.env.APP_ENV === "dev" ? "dev" : "prod";
    const config = await fs.readFile(
      path.join(__dirname, `../config/application-${environment}.properties`),
      "utf8",
    );
    return {
      version: app.getVersion(),
      channel: config.match(/^app.channel=(.*)$/m)?.[1] ?? "production",
    };
  });
  handle("file:open", async (kind) => {
    if (!["document", "image"].includes(kind))
      throw new Error("无效的文件类型");
    const filters = [
      { name: "图像", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
    ];
    if (kind === "document")
      filters.unshift({
        name: "Compositor 项目或图像",
        extensions: ["bgcomp", "png", "jpg", "jpeg", "webp", "bmp"],
      });
    const result = await dialog.showOpenDialog(window, {
      title: kind === "image" ? "导入图像为图层" : "打开项目或图像",
      properties: ["openFile"],
      filters,
    });
    if (result.canceled) return null;
    const selected = result.filePaths[0];
    if ((await fs.stat(selected)).size > MAX_BYTES)
      throw new Error("文件超过 128 MB，请缩小文件后再导入。");
    const bytes = await fs.readFile(selected);
    const ext = path.extname(selected).toLowerCase();
    if (ext === ".bgcomp") {
      const token = randomUUID();
      pendingProjects.clear();
      pendingProjects.set(token, selected);
      return {
        name: path.basename(selected),
        kind: "project",
        data: bytes.toString("utf8"),
        token,
      };
    }
    const mime = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
    }[ext];
    if (!mime)
      throw new Error("首版支持 PNG、JPEG、WebP、BMP 和 .bgcomp 项目。");
    return {
      name: path.basename(selected),
      kind: "image",
      data: `data:${mime};base64,${bytes.toString("base64")}`,
    };
  });
  // A read dialog alone must never change the destination of the current project.
  // Renderer adoption happens only after successful decoding and validation.
  handle("file:adopt-project", (token) => {
    if (!pendingProjects.has(token)) throw new Error("项目打开请求已失效");
    projectPath = pendingProjects.get(token);
    pendingProjects.clear();
  });
  handle("file:save-project", async ({ name, content, saveAs }) => {
    if (typeof content !== "string" || Buffer.byteLength(content) > MAX_BYTES)
      throw new Error("项目过大（上限 128 MB）");
    const parsed = JSON.parse(content);
    if (parsed.format !== "bgssai-compositor" || parsed.version !== 1)
      throw new Error("项目格式无效");
    let target = projectPath;
    if (!target || saveAs) {
      const result = await dialog.showSaveDialog(window, {
        title: "保存可编辑项目",
        defaultPath: `${safeName(name)}.bgcomp`,
        filters: [{ name: "Compositor 项目", extensions: ["bgcomp"] }],
      });
      if (result.canceled || !result.filePath) return null;
      target = result.filePath.toLowerCase().endsWith(".bgcomp")
        ? result.filePath
        : `${result.filePath}.bgcomp`;
    }
    await atomicWrite(target, content);
    projectPath = target;
    return { name: path.basename(target), path: target };
  });
  handle("file:export", async ({ name, data, format }) => {
    if (
      !["png", "jpeg"].includes(format) ||
      typeof data !== "string" ||
      data.length > MAX_BYTES * 1.4
    )
      throw new Error("导出内容无效");
    const prefix = `data:image/${format};base64,`;
    if (!data.startsWith(prefix)) throw new Error("图像格式不匹配");
    const ext = format === "jpeg" ? "jpg" : "png";
    const result = await dialog.showSaveDialog(window, {
      title: "导出图像",
      defaultPath: `${safeName(name)}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return null;
    const target = result.filePath.toLowerCase().endsWith(`.${ext}`)
      ? result.filePath
      : `${result.filePath}.${ext}`;
    await atomicWrite(target, Buffer.from(data.slice(prefix.length), "base64"));
    return { path: target };
  });
  handle("clipboard:image", () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? null : image.toDataURL();
  });
  listen("document:dirty", (value) => {
    dirty = value === true;
  });
  listen("document:title", (title) => {
    if (typeof title === "string")
      window.setTitle(`${title.slice(0, 150)} — BGSSAI Compositor`);
  });
  listen("document:reset-path", () => {
    projectPath = null;
    pendingProjects.clear();
  });
  listen("window:close-confirmed", () => {
    closeConfirmed = true;
    window.close();
  });
}

function setupMenu() {
  const item = (label, name, accelerator) => ({
    label,
    accelerator,
    click: () => action(name),
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "文件",
        submenu: [
          item("新建…", "new", "Ctrl+N"),
          item("打开…", "open", "Ctrl+O"),
          item("导入图像为图层…", "import", "Ctrl+Shift+O"),
          { type: "separator" },
          item("保存项目", "save", "Ctrl+S"),
          item("项目另存为…", "save-as", "Ctrl+Shift+S"),
          item("导出图像…", "export", "Ctrl+Shift+E"),
          { type: "separator" },
          { role: "quit", label: "退出" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          item("撤销", "undo", "Ctrl+Z"),
          item("重做", "redo", "Ctrl+Shift+Z"),
          { type: "separator" },
          { role: "cut", label: "剪切文本" },
          { role: "copy", label: "复制文本" },
          { role: "paste", label: "粘贴" },
          item("复制图层", "duplicate", "Ctrl+J"),
          item("取消选区", "deselect", "Ctrl+D"),
        ],
      },
      {
        label: "视图",
        submenu: [
          item("适合窗口", "fit", "Ctrl+0"),
          item("实际像素", "actual-size", "Ctrl+1"),
          { role: "togglefullscreen", label: "全屏" },
          ...(!app.isPackaged ? [{ role: "toggleDevTools" }] : []),
        ],
      },
      { label: "帮助", submenu: [item("快捷键与使用说明", "help")] },
    ]),
  );
}

app.whenReady().then(async () => {
  protocol.handle("compositor", async (request) => {
    const url = new URL(request.url);
    const dist = path.resolve(__dirname, "../dist");
    const requested = path.resolve(
      dist,
      `.${decodeURIComponent(url.pathname)}`,
    );
    if (url.hostname !== "app" || !requested.startsWith(`${dist}${path.sep}`))
      return new Response("Forbidden", { status: 403 });
    try {
      return await net.fetch(pathToFileURL(requested).href);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1050,
    minHeight: 720,
    backgroundColor: "#161819",
    title: "BGSSAI Compositor",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling:
        app.isPackaged || process.env.COMPOSITOR_TEST !== "1",
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("close", (event) => {
    if (dirty && !closeConfirmed) {
      event.preventDefault();
      action("close");
    }
  });
  setupIPC();
  setupMenu();
  window.once("ready-to-show", () => {
    if (app.isPackaged || process.env.COMPOSITOR_TEST !== "1") window.show();
  });
  await window.loadURL(devURL ?? "compositor://app/index.html");
});
app.on("window-all-closed", () => app.quit());
