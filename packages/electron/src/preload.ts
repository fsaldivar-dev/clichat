/**
 * @clichat/electron - Preload bridge
 *
 * Creates the IPC bridge for use in Electron's preload script.
 * Extracted from kuilo's electron/preload.cjs:36-42.
 *
 * Usage:
 *   import { createPTYBridge } from "@clichat/electron/preload";
 *   contextBridge.exposeInMainWorld("clichatPTY", createPTYBridge(ipcRenderer));
 */

interface IpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (...args: unknown[]) => void): void;
}

export interface PTYBridge {
  spawn(config: unknown): Promise<unknown>;
  write(data: string): Promise<void>;
  resize(size: { cols: number; rows: number }): Promise<void>;
  kill(): Promise<void>;
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
  offData(callback: (data: string) => void): void;
  offExit(callback: (code: number) => void): void;
}

/**
 * Create the PTY bridge object to expose via contextBridge.
 */
export function createPTYBridge(ipcRenderer: IpcRenderer): PTYBridge {
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(code: number) => void>();

  ipcRenderer.on("clichat:data", (_, data) => {
    for (const cb of dataListeners) cb(data as string);
  });

  ipcRenderer.on("clichat:exit", (_, code) => {
    for (const cb of exitListeners) cb(code as number);
  });

  return {
    spawn: (config) => ipcRenderer.invoke("clichat:spawn", config),
    write: (data) => ipcRenderer.invoke("clichat:write", data) as Promise<void>,
    resize: (size) => ipcRenderer.invoke("clichat:resize", size) as Promise<void>,
    kill: () => ipcRenderer.invoke("clichat:kill") as Promise<void>,
    onData: (cb) => { dataListeners.add(cb); },
    onExit: (cb) => { exitListeners.add(cb); },
    offData: (cb) => { dataListeners.delete(cb); },
    offExit: (cb) => { exitListeners.delete(cb); },
  };
}
