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
    // Dynamic import to keep node-pty optional
    const nodePty = await import("node-pty");

    if (config.setup) await config.setup();

    const ptyProcess = nodePty.spawn(config.command, config.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: config.cwd,
      env: config.env as Record<string, string>,
    });

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

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const cb of dataCallbacks) cb(text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const cb of dataCallbacks) cb(text);
    });

    child.on("exit", (code) => {
      for (const cb of exitCallbacks) cb(code ?? 1);
    });

    return {
      write(data: string) {
        child.stdin?.write(data);
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
