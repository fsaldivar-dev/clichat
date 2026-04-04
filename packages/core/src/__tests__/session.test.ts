import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatSession } from "../session.js";
import type { CLIProvider, PTYBackend, PTYHandle, SpawnConfig, OutputParser, ParsedEvent } from "../types.js";

function createMockParser(events: ParsedEvent[] = []): OutputParser {
  return {
    feed: vi.fn(() => events),
    reset: vi.fn(),
  };
}

function createMockHandle(): PTYHandle & { triggerData: (data: string) => void; triggerExit: (code: number) => void } {
  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(code: number) => void> = [];

  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData(cb) {
      dataCallbacks.push(cb);
    },
    onExit(cb) {
      exitCallbacks.push(cb);
    },
    triggerData(data: string) {
      for (const cb of dataCallbacks) cb(data);
    },
    triggerExit(code: number) {
      for (const cb of exitCallbacks) cb(code);
    },
  };
}

function createMockProvider(parser?: OutputParser): CLIProvider {
  return {
    id: "test",
    label: "Test Provider",
    spawn: vi.fn(async () => ({
      command: "echo",
      args: ["hello"],
      useChildProcess: true,
    })),
    parser: parser ?? createMockParser(),
    formatInput: (text: string) => text + "\n",
  };
}

function createMockBackend(handle: PTYHandle): PTYBackend {
  return {
    spawn: vi.fn(async () => handle),
  };
}

describe("ChatSession", () => {
  let handle: ReturnType<typeof createMockHandle>;
  let provider: CLIProvider;
  let backend: PTYBackend;
  let session: ChatSession;

  beforeEach(() => {
    handle = createMockHandle();
    provider = createMockProvider();
    backend = createMockBackend(handle);
    session = new ChatSession({ provider, backend });
  });

  describe("lifecycle", () => {
    it("starts with idle status", () => {
      expect(session.status).toBe("idle");
      expect(session.isAlive).toBe(false);
    });

    it("becomes alive after start", async () => {
      await session.start();
      expect(session.isAlive).toBe(true);
    });

    it("does not double-start", async () => {
      await session.start();
      await session.start();
      expect(backend.spawn).toHaveBeenCalledTimes(1);
    });

    it("emits exit event on process exit", async () => {
      await session.start();
      const exitHandler = vi.fn();
      session.on("exit", exitHandler);

      handle.triggerExit(0);

      expect(exitHandler).toHaveBeenCalledWith(0);
      expect(session.status).toBe("exited");
      expect(session.isAlive).toBe(false);
    });

    it("destroys session cleanly", async () => {
      await session.start();
      await session.destroy();

      expect(handle.kill).toHaveBeenCalled();
      expect(session.status).toBe("exited");
    });
  });

  describe("messaging", () => {
    it("sends user messages", async () => {
      await session.start();

      const messageHandler = vi.fn();
      session.on("message", messageHandler);

      session.send("Hello");

      expect(messageHandler).toHaveBeenCalledTimes(1);
      const msg = messageHandler.mock.calls[0][0];
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("Hello");
      expect(msg.type).toBe("message");
    });

    it("writes formatted input to handle", async () => {
      await session.start();
      session.send("Hello");
      expect(handle.write).toHaveBeenCalledWith("Hello\n");
    });

    it("does not send when handle is null", () => {
      session.send("Hello");
      expect(handle.write).not.toHaveBeenCalled();
    });

    it("generates unique message IDs", async () => {
      await session.start();
      session.send("First");
      session.send("Second");

      const ids = session.messages.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("abort", () => {
    it("sends Ctrl+C to handle", async () => {
      await session.start();
      session.abort();
      expect(handle.write).toHaveBeenCalledWith("\x03");
    });

    it("sets status to idle", async () => {
      await session.start();
      session.send("Hello");
      session.abort();
      expect(session.status).toBe("idle");
    });
  });

  describe("parsed events", () => {
    it("handles streaming message events", async () => {
      const parser = createMockParser([
        { type: "message", role: "assistant", content: "Hi", metadata: { isStreaming: true } },
      ]);
      const provider = createMockProvider(parser);
      const backend = createMockBackend(handle);
      const session = new ChatSession({ provider, backend });

      await session.start();

      const messageHandler = vi.fn();
      session.on("message", messageHandler);

      handle.triggerData("data");

      expect(messageHandler).toHaveBeenCalled();
      expect(session.status).toBe("responding");
    });

    it("handles message_stop by flushing and going idle", async () => {
      const parser = createMockParser([
        { type: "status", role: "system", content: "message_stop" },
      ]);
      const provider = createMockProvider(parser);
      const backend = createMockBackend(handle);
      const session = new ChatSession({ provider, backend });

      await session.start();
      handle.triggerData("data");

      expect(session.status).toBe("idle");
    });
  });

  describe("plugins", () => {
    it("isolates plugin errors in onSessionStart", async () => {
      const badPlugin = {
        id: "bad",
        name: "Bad Plugin",
        onSessionStart: vi.fn(() => {
          throw new Error("plugin crash");
        }),
      };

      const session = new ChatSession({ provider, backend, plugins: [badPlugin] });

      // Should not throw
      await session.start();
      expect(session.isAlive).toBe(true);
    });

    it("isolates plugin errors in transformMessage", async () => {
      const badPlugin = {
        id: "bad",
        name: "Bad Plugin",
        transformMessage: vi.fn(() => {
          throw new Error("transform crash");
        }),
      };

      const session = new ChatSession({ provider, backend, plugins: [badPlugin] });
      await session.start();

      // send should not throw despite plugin error
      session.send("Hello");
      expect(session.messages.length).toBeGreaterThan(0);
    });
  });
});
