// ─── Base Types ──────────────────────────────────────────────────────────────

export type SessionStatus =
  | "idle"
  | "thinking"
  | "responding"
  | "tool_use"
  | "error"
  | "exited";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type ParsedEventType =
  | "message"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "error"
  | "status"
  | "raw";

// ─── Messages ────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  type?: ParsedEventType;
  metadata?: {
    toolName?: string;
    toolInput?: unknown;
    thinkingDuration?: number;
    isStreaming?: boolean;
    provider?: string;
  };
}

// ─── Parsed Events (from CLI output) ─────────────────────────────────────────

export interface ParsedEvent {
  type: ParsedEventType;
  role: MessageRole;
  content: string;
  metadata?: {
    toolName?: string;
    toolInput?: unknown;
    isStreaming?: boolean;
  };
}

// ─── Output Parser ───────────────────────────────────────────────────────────

export interface OutputParser {
  /** Feed raw data (ANSI or JSON) and get back parsed events */
  feed(data: string): ParsedEvent[];
  /** Reset parser state between sessions */
  reset(): void;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export interface SpawnOptions {
  cwd: string;
  initialPrompt?: string;
  model?: string;
  systemPrompt?: string;
  env?: Record<string, string>;
  /** Tools allowed to run without confirmation (Claude: --allowedTools, Gemini: --allowed-tools) */
  allowedTools?: string[];
  /** Permission/approval mode (Claude: --permission-mode, Gemini: --approval-mode) */
  permissionMode?: string;
  /** Maximum number of agentic turns */
  maxTurns?: number;
}

export interface SpawnConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Initial PTY columns (default: process.stdout.columns ?? 80) */
  cols?: number;
  /** Initial PTY rows (default: process.stdout.rows ?? 24) */
  rows?: number;
  /** Pre-spawn setup (e.g., MCP config injection) */
  setup?: () => Promise<void>;
  /** Use child_process.spawn instead of node-pty (for structured I/O) */
  useChildProcess?: boolean;
}

export interface CLIProvider {
  id: string;
  label: string;
  icon?: string;

  /** Build spawn configuration for this provider */
  spawn(options: SpawnOptions): SpawnConfig | Promise<SpawnConfig>;

  /** Parser for this provider's output */
  parser: OutputParser;

  /** Format user input before sending to CLI (default: text + \n) */
  formatInput(text: string): string;

  /**
   * Per-message spawn mode: if defined, each send() kills the current process
   * and spawns a new one with these args. Used by Claude CLI's `-p` print mode.
   */
  respawnOnSend?(text: string, isFirst: boolean, options: SpawnOptions): SpawnConfig | Promise<SpawnConfig>;
}

// ─── PTY Backend ─────────────────────────────────────────────────────────────

export interface PTYHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number) => void): void;
}

export interface PTYBackend {
  spawn(config: SpawnConfig): Promise<PTYHandle>;
}

// ─── Plugin System ───────────────────────────────────────────────────────────

export interface PluginManifest {
  version: string;
  description?: string;
  /** Lower number = runs earlier. Default: 100 */
  priority?: number;
  /** Provider IDs this plugin supports. Omit = all providers. */
  providers?: string[];
  /** Plugin IDs this plugin depends on */
  requires?: string[];
  /** Capability tags this plugin provides */
  provides?: string[];
}

export interface BeforeSendResult {
  text: string;
  cancel?: boolean;
}

export interface ParsedEventResult {
  event: ParsedEvent;
  cancel?: boolean;
}

export interface ToolUseResult {
  allow: boolean;
  input?: unknown;
}

export interface ErrorResult {
  retry?: boolean;
  handled?: boolean;
}

export interface SendContext {
  messages: ReadonlyArray<ChatMessage>;
  status: SessionStatus;
  providerId: string;
}

export interface ChatPlugin {
  id: string;
  name: string;
  manifest?: PluginManifest;

  // ─── Lifecycle hooks (existing) ─────────────────────────────────────
  /** Called when a session starts */
  onSessionStart?(session: ChatSessionEvents): void | Promise<void>;
  /** Called when a session ends */
  onSessionEnd?(session: ChatSessionEvents): void | Promise<void>;
  /** Modify spawn options before the CLI process is created */
  configureProvider?(provider: CLIProvider, options: SpawnOptions): SpawnOptions | Promise<SpawnOptions>;
  /** Transform a message before it's added to the message list */
  transformMessage?(message: ChatMessage): ChatMessage;

  // ─── Message hooks (new) ────────────────────────────────────────────
  /** Intercept/modify user input before sending. Return cancel:true to prevent send. */
  onBeforeSend?(text: string, context: SendContext): BeforeSendResult | Promise<BeforeSendResult> | void;
  /** Intercept parsed CLI events. Return cancel:true to skip processing. */
  onParsedEvent?(event: ParsedEvent): ParsedEventResult | Promise<ParsedEventResult> | void;

  // ─── Tool hooks (new) ───────────────────────────────────────────────
  /** Intercept tool calls. Return allow:false to block. */
  onToolUse?(toolName: string, input: unknown): ToolUseResult | Promise<ToolUseResult> | void;
  /** Transform tool results before adding to context. */
  onToolResult?(toolName: string, result: string): string | Promise<string> | void;

  // ─── Error & status hooks (new) ─────────────────────────────────────
  /** Handle errors. Return handled:true to suppress, retry:true to re-send. */
  onError?(error: Error, context: SendContext): ErrorResult | Promise<ErrorResult> | void;
  /** Observe status transitions (fire-and-forget). */
  onStatusChange?(from: SessionStatus, to: SessionStatus): void;
  /** Access raw CLI output before parsing (fire-and-forget). */
  onRawOutput?(data: string): void;
}

// ─── Session Events (for plugin access) ──────────────────────────────────────

export interface ChatSessionEvents {
  on(event: "message", cb: (msg: ChatMessage) => void): void;
  on(event: "status", cb: (status: SessionStatus) => void): void;
  on(event: "raw", cb: (data: string) => void): void;
  on(event: "exit", cb: (code: number) => void): void;
  on(event: "beforeSend", cb: (text: string, context: SendContext) => void): void;
  on(event: "afterSend", cb: (text: string) => void): void;
  on(event: "parsed", cb: (event: ParsedEvent) => void): void;
  on(event: "toolUse", cb: (toolName: string, input: unknown) => void): void;
  on(event: "toolResult", cb: (toolName: string, result: string) => void): void;
  on(event: "error", cb: (error: Error) => void): void;
  on(event: "statusChange", cb: (from: SessionStatus, to: SessionStatus) => void): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
  /** Emit custom events for inter-plugin communication */
  emitEvent(event: string, ...args: unknown[]): void;

  readonly messages: ReadonlyArray<ChatMessage>;
  readonly status: SessionStatus;
  readonly provider: CLIProvider;
}

// ─── Session Options ─────────────────────────────────────────────────────────

export interface ChatSessionOptions {
  provider: CLIProvider;
  backend: PTYBackend;
  cwd?: string;
  initialPrompt?: string;
  plugins?: ChatPlugin[];
  model?: string;
  systemPrompt?: string;
  env?: Record<string, string>;
  allowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
}
