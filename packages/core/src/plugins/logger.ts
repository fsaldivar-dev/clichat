import type { ChatPlugin } from "../types.js";

/**
 * Built-in logger plugin — logs all session events to console.
 *
 * Usage:
 *   import { createLogger } from "@clichat/core";
 *   const session = new ChatSession({ plugins: [createLogger()] });
 */
export function createLogger(opts?: { prefix?: string }): ChatPlugin {
  const p = opts?.prefix ?? "[clichat]";
  return {
    id: "logger",
    name: "Logger",
    manifest: { version: "1.0.0", priority: 1 },
    onBeforeSend(text) { console.log(`${p} send: ${text.slice(0, 80)}`); },
    onParsedEvent(event) { console.log(`${p} ${event.type}: ${event.content.slice(0, 80)}`); },
    onToolUse(name) { console.log(`${p} tool: ${name}`); },
    onToolResult(name, result) { console.log(`${p} tool result [${name}]: ${result.slice(0, 80)}`); },
    onStatusChange(from, to) { console.log(`${p} ${from} → ${to}`); },
    onError(err) { console.error(`${p} error: ${err.message}`); },
    onRawOutput(data) { console.debug(`${p} raw: ${data.length}B`); },
  };
}
