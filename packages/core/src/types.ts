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

export interface ChatPlugin {
  id: string;
  name: string;

  /** Called when a session starts */
  onSessionStart?(session: ChatSessionEvents): void | Promise<void>;

  /** Called when a session ends */
  onSessionEnd?(session: ChatSessionEvents): void | Promise<void>;

  /** Modify spawn options before the CLI process is created */
  configureProvider?(
    provider: CLIProvider,
    options: SpawnOptions,
  ): SpawnOptions | Promise<SpawnOptions>;

  /** Transform a message before it's added to the message list */
  transformMessage?(message: ChatMessage): ChatMessage;
}

// ─── Session Events (for plugin access) ──────────────────────────────────────

export interface ChatSessionEvents {
  on(event: "message", cb: (msg: ChatMessage) => void): void;
  on(event: "status", cb: (status: SessionStatus) => void): void;
  on(event: "raw", cb: (data: string) => void): void;
  on(event: "exit", cb: (code: number) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;

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
}
