import type { PTYBackend, PTYHandle, SpawnConfig } from "../types.js";

/**
 * PTY backend using node-pty.
 * Requires `node-pty` as a peer dependency.
 * Falls back to child_process.spawn when SpawnConfig.useChildProcess is true.
 */
export class NodePTYBackend implements PTYBackend {
  async spawn(config: SpawnConfig): Promise<PTYHandle> {
    if (config.useChildProcess) {
      return this.spawnChildProcess(config);
    }
    return this.spawnPTY(config);
  }

  private async spawnPTY(config: SpawnConfig): Promise<PTYHandle> {
    let nodePty: typeof import("node-pty");
    try {
      // Dynamic import to keep node-pty optional
      nodePty = await import("node-pty");
    } catch {
      console.warn("[clichat] node-pty not available, falling back to child_process");
      return this.spawnChildProcess(config);
    }

    if (config.setup) await config.setup();

    const cols = config.cols ?? (typeof process !== "undefined" ? process.stdout?.columns : undefined) ?? 80;
    const rows = config.rows ?? (typeof process !== "undefined" ? process.stdout?.rows : undefined) ?? 24;

    let ptyProcess: ReturnType<typeof nodePty.spawn>;
    try {
      ptyProcess = nodePty.spawn(config.command, config.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: config.cwd,
        env: config.env as Record<string, string>,
      });
    } catch (err) {
      console.warn("[clichat] node-pty spawn failed, falling back to child_process:", (err as Error).message);
      return this.spawnChildProcess(config);
    }

    const dataCallbacks: Array<(data: string) => void> = [];
    const exitCallbacks: Array<(code: number) => void> = [];

    ptyProcess.onData((data) => {
      for (const cb of dataCallbacks) cb(data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      for (const cb of exitCallbacks) cb(exitCode);
    });

    return {
      write(data: string) {
        ptyProcess.write(data);
      },
      resize(cols: number, rows: number) {
        ptyProcess.resize(cols, rows);
      },
      kill() {
        ptyProcess.kill();
      },
      onData(cb) {
        dataCallbacks.push(cb);
      },
      onExit(cb) {
        exitCallbacks.push(cb);
      },
    };
  }

  private async spawnChildProcess(config: SpawnConfig): Promise<PTYHandle> {
    const { spawn } = await import("node:child_process");

    if (config.setup) await config.setup();

    const child = spawn(config.command, config.args, {
      cwd: config.cwd,
      env: config.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const dataCallbacks: Array<(data: string) => void> = [];
    const exitCallbacks: Array<(code: number) => void> = [];
    let exited = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const cb of dataCallbacks) cb(text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const cb of dataCallbacks) cb(text);
    });

    child.on("error", (err) => {
      if (exited) return;
      exited = true;
      for (const cb of dataCallbacks) cb(`Error: ${err.message}\n`);
      for (const cb of exitCallbacks) cb(1);
    });

    child.on("close", (code) => {
      if (exited) return;
      exited = true;
      for (const cb of exitCallbacks) cb(code ?? 1);
    });

    return {
      write(data: string) {
        try {
          child.stdin?.write(data);
        } catch {
          // stdin closed (EPIPE) — ignore gracefully
        }
      },
      resize() {
        // No resize for child_process
      },
      kill() {
        child.kill("SIGTERM");
      },
      onData(cb) {
        dataCallbacks.push(cb);
      },
      onExit(cb) {
        exitCallbacks.push(cb);
      },
    };
  }
}
