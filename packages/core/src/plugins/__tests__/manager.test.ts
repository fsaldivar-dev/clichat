import { describe, it, expect, vi } from "vitest";
import { PluginManager } from "../manager.js";
import type { ChatPlugin, ChatMessage, ChatSessionEvents, CLIProvider, SpawnOptions } from "../../types.js";

function createMockSession(): ChatSessionEvents {
  return {
    on: vi.fn(),
    off: vi.fn(),
    messages: [],
    status: "idle",
    provider: { id: "test", label: "Test", parser: { feed: vi.fn(() => []), reset: vi.fn() }, spawn: vi.fn(), formatInput: (t: string) => t },
  };
}

function createMockPlugin(overrides: Partial<ChatPlugin> = {}): ChatPlugin {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    ...overrides,
  };
}

describe("PluginManager", () => {
  describe("onSessionStart", () => {
    it("calls all plugins", async () => {
      const fn = vi.fn();
      const manager = new PluginManager([createMockPlugin({ onSessionStart: fn })]);
      const session = createMockSession();

      await manager.onSessionStart(session);
      expect(fn).toHaveBeenCalledWith(session);
    });

    it("isolates errors — continues with remaining plugins", async () => {
      const fn1 = vi.fn(() => { throw new Error("boom"); });
      const fn2 = vi.fn();

      const manager = new PluginManager([
        createMockPlugin({ id: "bad", onSessionStart: fn1 }),
        createMockPlugin({ id: "good", onSessionStart: fn2 }),
      ]);

      await manager.onSessionStart(createMockSession());
      expect(fn2).toHaveBeenCalled();
    });
  });

  describe("onSessionEnd", () => {
    it("isolates errors", async () => {
      const fn = vi.fn(() => { throw new Error("boom"); });
      const manager = new PluginManager([createMockPlugin({ onSessionEnd: fn })]);

      // Should not throw
      await expect(manager.onSessionEnd(createMockSession())).resolves.toBeUndefined();
    });
  });

  describe("configureProvider", () => {
    it("chains options through plugins", async () => {
      const plugin = createMockPlugin({
        configureProvider: vi.fn(async (_provider, options) => ({
          ...options,
          model: "custom-model",
        })),
      });

      const manager = new PluginManager([plugin]);
      const options: SpawnOptions = { cwd: "/tmp" };
      const result = await manager.configureProvider({} as CLIProvider, options);

      expect(result).toEqual({ cwd: "/tmp", model: "custom-model" });
    });

    it("returns original options on plugin error", async () => {
      const plugin = createMockPlugin({
        configureProvider: vi.fn(async () => { throw new Error("boom"); }),
      });

      const manager = new PluginManager([plugin]);
      const options: SpawnOptions = { cwd: "/tmp" };
      const result = await manager.configureProvider({} as CLIProvider, options);

      expect(result).toEqual(options);
    });
  });

  describe("transformMessage", () => {
    it("chains transforms through plugins", () => {
      const plugin = createMockPlugin({
        transformMessage: vi.fn((msg) => ({ ...msg, content: msg.content.toUpperCase() })),
      });

      const manager = new PluginManager([plugin]);
      const msg = { id: "1", role: "user" as const, content: "hello", timestamp: 0 };
      const result = manager.transformMessage(msg);

      expect(result.content).toBe("HELLO");
    });

    it("returns original message on plugin error", () => {
      const plugin = createMockPlugin({
        transformMessage: vi.fn(() => { throw new Error("boom"); }),
      });

      const manager = new PluginManager([plugin]);
      const msg = { id: "1", role: "user" as const, content: "hello", timestamp: 0 };
      const result = manager.transformMessage(msg);

      expect(result.content).toBe("hello");
    });
  });
});
