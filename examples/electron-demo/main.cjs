const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// ─── PTY Management (extracted pattern from @clichat/electron) ───────────────

let ptyProcess = null;
let ptyWebContents = null;

const findBin = (name) => {
  try {
    const output = execSync(`/bin/zsh -ilc "which ${name}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const binPath = output.split("\n").find((l) => l.startsWith("/"));
    return binPath?.trim() || name;
  } catch {
    return name;
  }
};

const fullPath = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".local/bin"),
  process.env.PATH,
].join(":");

ipcMain.handle("clichat:spawn", async (event, config) => {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }

  ptyWebContents = event.sender;
  const pty = require("node-pty");

  const cmd = findBin(config.command);
  const env = { ...process.env, TERM: "xterm-256color", PATH: fullPath, ...config.env };

  if (config.useChildProcess) {
    const { spawn } = require("child_process");
    const child = spawn(cmd, config.args || [], {
      cwd: config.cwd || os.homedir(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      try { ptyWebContents?.send("clichat:data", chunk.toString("utf8")); } catch {}
    });
    child.stderr?.on("data", (chunk) => {
      try { ptyWebContents?.send("clichat:data", chunk.toString("utf8")); } catch {}
    });
    child.on("exit", (code) => {
      try { ptyWebContents?.send("clichat:exit", code ?? 0); } catch {}
      ptyProcess = null;
    });

    ptyProcess = {
      write: (d) => child.stdin?.write(d),
      resize: () => {},
      kill: () => child.kill("SIGTERM"),
    };
  } else {
    const proc = pty.spawn(cmd, config.args || [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: config.cwd || os.homedir(),
      env,
    });

    proc.onData((data) => {
      try { ptyWebContents?.send("clichat:data", data); } catch {}
    });
    proc.onExit(() => {
      try { ptyWebContents?.send("clichat:exit", 0); } catch {}
      ptyProcess = null;
    });

    ptyProcess = proc;
  }

  return { ok: true };
});

ipcMain.handle("clichat:write", async (_, data) => {
  ptyProcess?.write(data);
});

ipcMain.handle("clichat:resize", async (_, { cols, rows }) => {
  ptyProcess?.resize?.(cols, rows);
});

ipcMain.handle("clichat:kill", async () => {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }
});

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    title: "clichat demo",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#1c1c1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL("http://localhost:5199");
  } else {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
