import { EventEmitter } from "node:events";
import type {
  ChatMessage,
  ChatSessionOptions,
  ChatSessionEvents,
  CLIProvider,
  PTYBackend,
  PTYHandle,
  SessionStatus,
  ParsedEvent,
  ChatPlugin,
} from "./types.js";
import { PluginManager } from "./plugins/manager.js";

let nextId = 1;

function generateId(): string {
  return `msg_${Date.now()}_${nextId++}`;
}

/**
 * ChatSession manages a single conversation with an AI CLI.
 *
 * It spawns the CLI process, feeds raw output through the provider's parser,
 * and emits structured chat events.
 *
 * Events:
 * - "message" (ChatMessage) — a new or updated message
 * - "status" (SessionStatus) — session status changed
 * - "raw" (string) — raw CLI output (escape hatch)
 * - "exit" (number) — CLI process exited with code
 */
export class ChatSession extends EventEmitter implements ChatSessionEvents {
  private _messages: ChatMessage[] = [];
  private _status: SessionStatus = "idle";
  private _provider: CLIProvider;
  private _backend: PTYBackend;
  private _handle: PTYHandle | null = null;
  private _pluginManager: PluginManager;
  private _options: ChatSessionOptions;
  private _streamingMessage: ChatMessage | null = null;

  constructor(options: ChatSessionOptions) {
    super();
    this._provider = options.provider;
    this._backend = options.backend;
    this._pluginManager = new PluginManager(options.plugins);
    this._options = options;
  }

  // ─── Public Getters ──────────────────────────────────────────────────────

  get messages(): ReadonlyArray<ChatMessage> {
    return this._messages;
  }

  get status(): SessionStatus {
    return this._status;
  }

  get provider(): CLIProvider {
    return this._provider;
  }

  get isAlive(): boolean {
    return this._handle !== null && this._status !== "exited";
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /** Start the session — spawn the CLI process */
  async start(): Promise<void> {
    if (this._handle) return;

    // Let plugins modify spawn options
    const spawnOptions = await this._pluginManager.configureProvider(
      this._provider,
      {
        cwd: this._options.cwd ?? process.cwd(),
        initialPrompt: this._options.initialPrompt,
        model: this._options.model,
        systemPrompt: this._options.systemPrompt,
        env: this._options.env,
      },
    );

    // Get spawn config from provider
    const config = await this._provider.spawn(spawnOptions);

    // Spawn the process
    this._handle = await this._backend.spawn(config);

    // Wire up data handling
    this._handle.onData((data) => {
      this.emit("raw", data);
      this.handleOutput(data);
    });

    this._handle.onExit((code) => {
      this.setStatus("exited");
      this._handle = null;
      this.flushStreamingMessage();
      this.emit("exit", code);
    });

    this.setStatus("idle");

    // Notify plugins
    await this._pluginManager.onSessionStart(this);
  }

  /** Send a user message */
  send(text: string): void {
    if (!this._handle) return;

    // Add user message to history
    const msg = this.createMessage("user", text, "message");
    this._messages.push(msg);
    this.emit("message", msg);

    // Format and write to CLI
    const formatted = this._provider.formatInput(text);
    this._handle.write(formatted);

    this.setStatus("thinking");
  }

  /** Abort current operation (sends Ctrl+C) */
  abort(): void {
    if (!this._handle) return;
    this._handle.write("\x03"); // Ctrl+C
    this.flushStreamingMessage();
    this.setStatus("idle");
  }

  /** Resize the terminal */
  resize(cols: number, rows: number): void {
    this._handle?.resize(cols, rows);
  }

  /** Destroy the session */
  async destroy(): Promise<void> {
    this.flushStreamingMessage();
    if (this._handle) {
      this._handle.kill();
      this._handle = null;
    }
    await this._pluginManager.onSessionEnd(this);
    this.setStatus("exited");
    this.removeAllListeners();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private handleOutput(data: string): void {
    const events = this._provider.parser.feed(data);

    for (const event of events) {
      this.handleParsedEvent(event);
    }
  }

  private handleParsedEvent(event: ParsedEvent): void {
    switch (event.type) {
      case "message":
        if (event.metadata?.isStreaming) {
          this.appendToStreamingMessage(event);
          this.setStatus("responding");
        } else {
          this.flushStreamingMessage();
          const msg = this.createMessage(event.role, event.content, "message");
          this.addMessage(msg);
        }
        break;

      case "thinking":
        this.setStatus("thinking");
        if (event.metadata?.isStreaming) {
          this.appendToStreamingMessage(event);
        } else {
          const msg = this.createMessage(event.role, event.content, "thinking");
          this.addMessage(msg);
        }
        break;

      case "tool_use":
        this.setStatus("tool_use");
        this.flushStreamingMessage();
        const toolMsg = this.createMessage(event.role, event.content, "tool_use");
        if (event.metadata?.toolName) {
          toolMsg.metadata = { ...toolMsg.metadata, toolName: event.metadata.toolName };
        }
        this.addMessage(toolMsg);
        break;

      case "tool_result":
        this.flushStreamingMessage();
        const resultMsg = this.createMessage(event.role, event.content, "tool_result");
        this.addMessage(resultMsg);
        break;

      case "error":
        this.setStatus("error");
        this.flushStreamingMessage();
        const errMsg = this.createMessage("system", event.content, "error");
        this.addMessage(errMsg);
        break;

      case "status":
        if (event.content === "message_stop") {
          this.flushStreamingMessage();
          this.setStatus("idle");
        }
        break;

      case "raw":
        // Already emitted via "raw" event in handleOutput
        break;
    }
  }

  private appendToStreamingMessage(event: ParsedEvent): void {
    if (this._streamingMessage && this._streamingMessage.type === event.type) {
      // Append to existing streaming message
      this._streamingMessage.content += event.content;
      this._streamingMessage.metadata = {
        ...this._streamingMessage.metadata,
        isStreaming: true,
      };
      this.emit("message", this._streamingMessage);
    } else {
      // Start new streaming message
      this.flushStreamingMessage();
      this._streamingMessage = this.createMessage(event.role, event.content, event.type);
      this._streamingMessage.metadata = {
        ...this._streamingMessage.metadata,
        isStreaming: true,
      };
      this._messages.push(this._streamingMessage);
      this.emit("message", this._streamingMessage);
    }
  }

  private flushStreamingMessage(): void {
    if (this._streamingMessage) {
      this._streamingMessage.metadata = {
        ...this._streamingMessage.metadata,
        isStreaming: false,
      };
      this.emit("message", this._streamingMessage);
      this._streamingMessage = null;
    }
  }

  private createMessage(
    role: ChatMessage["role"],
    content: string,
    type: ChatMessage["type"],
  ): ChatMessage {
    const msg: ChatMessage = {
      id: generateId(),
      role,
      content,
      timestamp: Date.now(),
      type,
      metadata: { provider: this._provider.id },
    };
    return this._pluginManager.transformMessage(msg);
  }

  private addMessage(msg: ChatMessage): void {
    this._messages.push(msg);
    this.emit("message", msg);
  }

  private setStatus(status: SessionStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit("status", status);
    }
  }
}
