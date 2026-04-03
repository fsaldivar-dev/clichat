/**
 * @clichat/electron - Renderer-side IPCPTYBackend
 *
 * Uses the PTYBridge exposed via preload to communicate with the main process.
 *
 * Usage:
 *   import { ElectronPTYBackend } from "@clichat/electron";
 *   const backend = new ElectronPTYBackend(window.clichatPTY);
 */

import type { PTYBackend, PTYHandle, SpawnConfig } from "@clichat/core";
import type { PTYBridge } from "./preload.js";

export { createPTYHandler } from "./main.js";
export { createPTYBridge } from "./preload.js";
export type { PTYBridge } from "./preload.js";

export class ElectronPTYBackend implements PTYBackend {
  constructor(private bridge: PTYBridge) {}

  async spawn(config: SpawnConfig): Promise<PTYHandle> {
    await this.bridge.spawn({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      useChildProcess: config.useChildProcess,
    });

    const dataCallbacks: Array<(data: string) => void> = [];
    const exitCallbacks: Array<(code: number) => void> = [];

    const onData = (data: string) => {
      for (const cb of dataCallbacks) cb(data);
    };
    const onExit = (code: number) => {
      for (const cb of exitCallbacks) cb(code);
    };

    this.bridge.onData(onData);
    this.bridge.onExit(onExit);

    return {
      write: (data: string) => {
        this.bridge.write(data);
      },
      resize: (cols: number, rows: number) => {
        this.bridge.resize({ cols, rows });
      },
      kill: () => {
        this.bridge.kill();
        this.bridge.offData(onData);
        this.bridge.offExit(onExit);
      },
      onData: (cb) => { dataCallbacks.push(cb); },
      onExit: (cb) => { exitCallbacks.push(cb); },
    };
  }
}
