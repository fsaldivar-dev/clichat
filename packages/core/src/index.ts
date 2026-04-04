// Types
export type {
  BeforeSendResult,
  ChatMessage,
  ChatPlugin,
  ChatSessionEvents,
  ChatSessionOptions,
  CLIProvider,
  ErrorResult,
  MessageRole,
  OutputParser,
  ParsedEvent,
  ParsedEventResult,
  ParsedEventType,
  PluginManifest,
  PTYBackend,
  PTYHandle,
  SendContext,
  SessionStatus,
  SpawnConfig,
  SpawnOptions,
  ToolUseResult,
} from "./types.js";

export type { IPCTransport } from "./backends/ipc.js";

// Session
export { ChatSession } from "./session.js";

// Backends
export { NodePTYBackend } from "./backends/node-pty.js";
export { IPCPTYBackend } from "./backends/ipc.js";

// Providers
export { claudeProvider, claudeInteractiveProvider } from "./providers/claude.js";
export { geminiProvider, geminiInteractiveProvider } from "./providers/gemini.js";
export { shellProvider } from "./providers/shell.js";
export { registerProvider, getProvider, getProviders } from "./providers/registry.js";

// Parsers
export { StreamJsonParser } from "./parsers/stream-json.js";
export { GeminiJsonParser } from "./parsers/gemini-json.js";
export { AnsiStripParser, StateMachineParser, stripAnsi } from "./parsers/ansi-strip.js";

// Plugins
export { PluginManager } from "./plugins/manager.js";
export { createLogger } from "./plugins/logger.js";

// Utils
export { findBinary, buildFullPath } from "./providers/utils.js";
