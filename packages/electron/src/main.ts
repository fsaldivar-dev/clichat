/**
 * @clichat/electron - Main process IPC handlers
 *
 * Sets up IPC handlers in the Electron main process for PTY management.
 * Extracted from kuilo's electron/main.cjs:824-913.
 *
 * Usage:
 *   import { createPTYHandler } from "@clichat/electron/main";
 *   createPTYHandler(ipcMain);
 */

import type { SpawnConfig } from "@clichat/core";

interface IpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>): void;
}

interface WebContents {
  send(channel: string, ...args: unknown[]): void;
}

interface IpcMainInvokeEvent {
  sender: WebContents;
}

interface PTYProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (event: { exitCode: number }) => void): void;
}

interface PTYModule {
  spawn(
    command: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): PTYProcess;
}

let ptyProcess: PTYProcess | null = null;
let ptyWebContents: WebContents | null = null;

/**
 * Register clichat IPC handlers on the Electron main process.
 * Channels: clichat:spawn, clichat:write, clichat:resize, clichat:kill
 */
export function createPTYHandler(ipcMain: IpcMain): void {
  ipcMain.handle("clichat:spawn", async (event: unknown, ...args: unknown[]) => {
    const ev = event as IpcMainInvokeEvent;
    const config = args[0] as SpawnConfig;

    // Kill existing process
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }

    ptyWebContents = ev.sender;

    if (config.useChildProcess) {
      // Use child_process for structured I/O
      const { spawn } = await import("node:child_process");

      const child = spawn(config.command, config.args, {
        cwd: config.cwd,
        env: config.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const handle: PTYProcess = {
        write: (data) => child.stdin?.write(data),
        resize: () => {},
        kill: () => child.kill("SIGTERM"),
        onData: (cb) => {
          child.stdout?.on("data", (chunk: Buffer) => cb(chunk.toString("utf8")));
          child.stderr?.on("data", (chunk: Buffer) => cb(chunk.toString("utf8")));
        },
        onExit: (cb) => {
          child.on("exit", (code) => cb({ exitCode: code ?? 1 }));
        },
      };

      ptyProcess = handle;
    } else {
      // Use node-pty for full terminal emulation
      const nodePty: PTYModule = require("node-pty");

      ptyProcess = nodePty.spawn(config.command, config.args, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: config.cwd,
        env: config.env as Record<string, string>,
      });
    }

    ptyProcess.onData((data: string) => {
      try {
        ptyWebContents?.send("clichat:data", data);
      } catch {}
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      try {
        ptyWebContents?.send("clichat:exit", exitCode);
      } catch {}
      ptyProcess = null;
    });

    return { ok: true };
  });

  ipcMain.handle("clichat:write", async (_: unknown, ...args: unknown[]) => {
    ptyProcess?.write(args[0] as string);
  });

  ipcMain.handle("clichat:resize", async (_: unknown, ...args: unknown[]) => {
    const size = args[0] as { cols: number; rows: number };
    ptyProcess?.resize(size.cols, size.rows);
  });

  ipcMain.handle("clichat:kill", async () => {
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
  });
}
