import type { PTYBackend, PTYHandle, SpawnConfig } from "../types.js";

/**
 * IPC/message-based PTY backend.
 * Communicates with a remote process that actually spawns the PTY.
 * Works with Electron IPC, WebSocket, or any message transport.
 */
export interface IPCTransport {
  /** Send a message to the PTY host */
  send(channel: string, data: unknown): void;

  /** Invoke a request and wait for a response */
  invoke(channel: string, data: unknown): Promise<unknown>;

  /** Listen for messages from the PTY host */
  on(channel: string, callback: (...args: unknown[]) => void): void;

  /** Remove a listener */
  off(channel: string, callback: (...args: unknown[]) => void): void;
}

export class IPCPTYBackend implements PTYBackend {
  constructor(private transport: IPCTransport) {}

  async spawn(config: SpawnConfig): Promise<PTYHandle> {
    await this.transport.invoke("clichat:spawn", {
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      useChildProcess: config.useChildProcess,
    });

    const dataCallbacks: Array<(data: string) => void> = [];
    const exitCallbacks: Array<(code: number) => void> = [];

    const onData = (...args: unknown[]) => {
      const data = args[0] as string;
      for (const cb of dataCallbacks) cb(data);
    };

    const onExit = (...args: unknown[]) => {
      const code = (args[0] as number) ?? 0;
      for (const cb of exitCallbacks) cb(code);
    };

    this.transport.on("clichat:data", onData);
    this.transport.on("clichat:exit", onExit);

    return {
      write: (data: string) => {
        this.transport.send("clichat:write", data);
      },
      resize: (cols: number, rows: number) => {
        this.transport.send("clichat:resize", { cols, rows });
      },
      kill: () => {
        this.transport.send("clichat:kill", null);
        this.transport.off("clichat:data", onData);
        this.transport.off("clichat:exit", onExit);
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
