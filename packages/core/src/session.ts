import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  ChatSessionOptions,
  ChatSessionEvents,
  CLIProvider,
  PTYBackend,
  PTYHandle,
  SessionStatus,
  ParsedEvent,
  SendContext,
} from "./types.js";
import { PluginManager } from "./plugins/manager.js";

function generateId(): string {
  return `msg_${randomUUID()}`;
}

/**
 * ChatSession manages a single conversation with an AI CLI.
 *
 * Events:
 * - "message" (ChatMessage) — a new or updated message
 * - "status" (SessionStatus) — session status changed
 * - "raw" (string) — raw CLI output
 * - "exit" (number) — CLI process exited
 * - "beforeSend" (text, context) — before sending user message
 * - "afterSend" (text) — after sending user message
 * - "parsed" (ParsedEvent) — parsed CLI event
 * - "toolUse" (toolName, input) — tool invocation
 * - "toolResult" (toolName, result) — tool result
 * - "error" (Error) — error occurred
 * - "statusChange" (from, to) — status transition
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
  private _isFirstMessage = true;
  private _outputQueue: Promise<void> = Promise.resolve();

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
    if (this._provider.respawnOnSend) {
      return this._status !== "exited";
    }
    return this._handle !== null && this._status !== "exited";
  }

  /** Emit custom events for inter-plugin communication */
  emitEvent(event: string, ...args: unknown[]): void {
    this.emit(event, ...args);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /** Start the session — spawn the CLI process */
  async start(): Promise<void> {
    if (this._handle) return;

    // Set active provider for plugin filtering
    this._pluginManager.setActiveProvider(this._provider.id);

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

    // Wire up data handling with sequential queue for async hooks
    this._handle.onData((data) => {
      this.emit("raw", data);
      this._pluginManager.onRawOutput(data);
      this._outputQueue = this._outputQueue.then(() => this.handleOutput(data));
    });

    this._handle.onExit((code) => {
      if (this._provider.respawnOnSend) {
        this.flushStreamingMessage();
        this.setStatus("idle");
      } else {
        this.setStatus("exited");
        this._handle = null;
        this.flushStreamingMessage();
        this.emit("exit", code);
      }
    });

    this.setStatus("idle");

    // Notify plugins
    await this._pluginManager.onSessionStart(this);
  }

  /** Send a user message (async to support plugin hooks) */
  async send(text: string): Promise<void> {
    if (!this._handle && !this._provider.respawnOnSend) return;

    // Plugin hook: onBeforeSend — can modify text or cancel
    const context = this.getSendContext();
    const beforeResult = await this._pluginManager.onBeforeSend(text, context);
    if (beforeResult.cancel) return;
    const finalText = beforeResult.text;

    this.emit("beforeSend", finalText, context);

    // Add user message to history
    const msg = this.createMessage("user", finalText, "message");
    this._messages.push(msg);
    this.emit("message", msg);

    this.setStatus("thinking");

    // Per-message spawn mode
    if (this._provider.respawnOnSend) {
      this.flushStreamingMessage();
      this._provider.parser.reset();
      const spawnOptions = {
        cwd: this._options.cwd ?? process.cwd(),
        initialPrompt: this._options.initialPrompt,
        model: this._options.model,
        systemPrompt: this._options.systemPrompt,
        env: this._options.env,
        allowedTools: this._options.allowedTools,
        permissionMode: this._options.permissionMode,
        maxTurns: this._options.maxTurns,
      };
      const config = await Promise.resolve(
        this._provider.respawnOnSend(finalText, this._isFirstMessage, spawnOptions),
      );
      this._isFirstMessage = false;

      if (this._handle) {
        this._handle.kill();
        this._handle = null;
      }

      this._handle = await this._backend.spawn(config);
      this._handle.onData((data) => {
        this.emit("raw", data);
        this._pluginManager.onRawOutput(data);
        this._outputQueue = this._outputQueue.then(() => this.handleOutput(data));
      });
      this._handle.onExit((code) => {
        this.flushStreamingMessage();
        this.setStatus("idle");
        this.emit("exit", code);
      });

      this.emit("afterSend", finalText);
      return;
    }

    // Interactive mode
    const formatted = this._provider.formatInput(finalText);
    this._handle!.write(formatted);
    this.emit("afterSend", finalText);
  }

  /** Abort current operation (sends Ctrl+C) */
  abort(): void {
    if (!this._handle) return;
    this._handle.write("\x03");
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

  private async handleOutput(data: string): Promise<void> {
    const events = this._provider.parser.feed(data);

    for (const event of events) {
      await this.handleParsedEvent(event);
    }
  }

  private async handleParsedEvent(event: ParsedEvent): Promise<void> {
    // Plugin hook: onParsedEvent — can modify or cancel
    const result = await this._pluginManager.onParsedEvent(event);
    if (result.cancel) return;
    const ev = result.event;

    this.emit("parsed", ev);

    switch (ev.type) {
      case "message":
        if (ev.metadata?.isStreaming) {
          this.appendToStreamingMessage(ev);
          this.setStatus("responding");
        } else {
          this.flushStreamingMessage();
          const msg = this.createMessage(ev.role, ev.content, "message");
          this.addMessage(msg);
        }
        break;

      case "thinking":
        this.setStatus("thinking");
        if (ev.metadata?.isStreaming) {
          this.appendToStreamingMessage(ev);
        } else {
          const msg = this.createMessage(ev.role, ev.content, "thinking");
          this.addMessage(msg);
        }
        break;

      case "tool_use": {
        // Plugin hook: onToolUse — can block
        const toolName = ev.metadata?.toolName ?? "unknown";
        const toolResult = await this._pluginManager.onToolUse(toolName, ev.metadata?.toolInput);
        this.emit("toolUse", toolName, ev.metadata?.toolInput);

        if (!toolResult.allow) break; // blocked by plugin

        this.setStatus("tool_use");
        this.flushStreamingMessage();
        const toolMsg = this.createMessage(ev.role, ev.content, "tool_use");
        if (ev.metadata?.toolName) {
          toolMsg.metadata = { ...toolMsg.metadata, toolName: ev.metadata.toolName };
        }
        this.addMessage(toolMsg);
        break;
      }

      case "tool_result": {
        // Plugin hook: onToolResult — can transform
        const trName = ev.metadata?.toolName ?? "unknown";
        const transformedResult = await this._pluginManager.onToolResult(trName, ev.content);
        this.emit("toolResult", trName, transformedResult);

        this.flushStreamingMessage();
        const resultMsg = this.createMessage(ev.role, transformedResult, "tool_result");
        this.addMessage(resultMsg);
        break;
      }

      case "error": {
        // Plugin hook: onError — can handle or request retry
        const error = new Error(ev.content);
        const errResult = await this._pluginManager.onError(error, this.getSendContext());
        this.emit("error", error);

        if (errResult.handled) break; // suppressed by plugin

        this.setStatus("error");
        this.flushStreamingMessage();
        const errMsg = this.createMessage("system", ev.content, "error");
        this.addMessage(errMsg);
        break;
      }

      case "status":
        if (ev.content === "message_stop") {
          this.flushStreamingMessage();
          this.setStatus("idle");
        }
        break;

      case "raw":
        break;
    }
  }

  private appendToStreamingMessage(event: ParsedEvent): void {
    if (this._streamingMessage && this._streamingMessage.type === event.type) {
      this._streamingMessage.content += event.content;
      this._streamingMessage.metadata = {
        ...this._streamingMessage.metadata,
        isStreaming: true,
      };
      this.emit("message", this._streamingMessage);
    } else {
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
      const from = this._status;
      this._status = status;
      this._pluginManager.onStatusChange(from, status);
      this.emit("status", status);
      this.emit("statusChange", from, status);
    }
  }

  private getSendContext(): SendContext {
    return {
      messages: this._messages,
      status: this._status,
      providerId: this._provider.id,
    };
  }
}
