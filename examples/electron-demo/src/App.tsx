import { useState, useCallback, useRef, useEffect } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";

// ─── Types ───────────────────────────────────────────────────────────────────

type SessionStatus = "idle" | "thinking" | "responding" | "tool_use" | "error" | "exited";
type MessageRole = "user" | "assistant" | "system" | "tool";
type ParsedEventType = "message" | "thinking" | "tool_use" | "tool_result" | "error" | "status" | "raw";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  type?: ParsedEventType;
  metadata?: {
    toolName?: string;
    isStreaming?: boolean;
    provider?: string;
  };
}

interface ProviderInfo {
  id: string;
  label: string;
  icon: string;
  /** "per-message" = spawn claude -p per message; "pty" = interactive PTY */
  mode: "per-message" | "pty";
  command: string;
  baseArgs: string[];
  models?: string[];
  defaultModel?: string;
  permissionModes?: string[];
}

// ─── Providers ───────────────────────────────────────────────────────────────

const PROVIDERS: ProviderInfo[] = [
  {
    id: "claude",
    label: "Claude CLI",
    icon: "◇",
    mode: "per-message",
    command: "claude",
    baseArgs: ["-p", "--output-format", "stream-json", "--verbose"],
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
    defaultModel: "claude-sonnet-4-6",
    permissionModes: ["default", "plan"],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    icon: "✦",
    mode: "per-message",
    command: "gemini",
    baseArgs: ["-p", "--output-format", "stream-json"],
    models: ["gemini-3-flash-preview", "gemini-2.5-pro"],
    defaultModel: "gemini-3-flash-preview",
    permissionModes: ["default", "auto_edit", "yolo", "plan"],
  },
  {
    id: "shell",
    label: "Terminal",
    icon: ">",
    mode: "pty",
    command: "/bin/zsh",
    baseArgs: [],
  },
];

// ─── Globals ─────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    clichatPTY: {
      spawn: (config: unknown) => Promise<unknown>;
      write: (data: string) => Promise<void>;
      resize: (size: { cols: number; rows: number }) => Promise<void>;
      kill: () => Promise<void>;
    };
  }
}

// ─── Stream JSON Parser ─────────────────────────────────────────────────────

function parseStreamJsonLine(line: string): { type: ParsedEventType; role: MessageRole; content: string; toolName?: string } | null {
  try {
    const json = JSON.parse(line);
    switch (json.type) {
      // ─── Claude --verbose stream-json format ───────────────────────
      // Events: {type:"assistant", message:{content:[{type:"thinking",...},{type:"text",text:"..."}]}}
      case "assistant": {
        const content = json.message?.content;
        if (!Array.isArray(content)) return null;
        // Return the LAST meaningful block (text > tool_use > thinking)
        // Claude sends the same message.id multiple times as content grows
        for (let i = content.length - 1; i >= 0; i--) {
          const block = content[i];
          if (block.type === "text" && block.text) {
            return { type: "message", role: "assistant", content: block.text };
          }
          if (block.type === "tool_use") {
            return { type: "tool_use", role: "tool", content: JSON.stringify(block.input ?? ""), toolName: block.name };
          }
          if (block.type === "thinking" && block.thinking) {
            return { type: "thinking", role: "assistant", content: block.thinking };
          }
        }
        return null;
      }

      // Final result event
      case "result": {
        const content = json.result as string | undefined;
        if (content) return { type: "message", role: "assistant", content };
        return null;
      }

      // ─── Raw API stream format (content_block_delta) ───────────────
      case "content_block_delta": {
        const delta = json.delta;
        if (delta?.type === "text_delta") return { type: "message", role: "assistant", content: delta.text };
        if (delta?.type === "thinking_delta") return { type: "thinking", role: "assistant", content: delta.thinking };
        if (delta?.type === "input_json_delta") return { type: "tool_use", role: "tool", content: delta.partial_json };
        return null;
      }
      case "content_block_start": {
        const block = json.content_block;
        if (block?.type === "tool_use") return { type: "tool_use", role: "tool", content: "", toolName: block.name };
        return null;
      }
      case "message_stop":
        return { type: "status", role: "system", content: "__stop__" };

      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ─── ANSI stripper ──────────────────────────────────────────────────────────

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][AB012]/g, "")
    .replace(/\x1b[>=<cDEFHMNOZ78]/g, "")
    .replace(/\x1b[P_^][^\x1b]*\x1b\\/g, "")
    .replace(/\x1b./g, "")
    .replace(/\r/g, "")
    .replace(/\x07/g, "");
}

function isMeaningfulLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 2) return false;
  if (/^\[[\d;?]*[a-zA-Z]/.test(trimmed)) return false;
  if (/^\[>[0-9]/.test(trimmed)) return false;
  if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/.test(trimmed)) return false;
  return true;
}

// ─── Raw Terminal Component ─────────────────────────────────────────────────

function RawTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#1c1c1e",
        foreground: "#f2f2f7",
        cursor: "#f2f2f7",
        selectionBackground: "rgba(255,255,255,0.15)",
        black: "#1c1c1e", red: "#ff3b30", green: "#34c759", yellow: "#ff9f0a",
        blue: "#0a84ff", magenta: "#bf5af2", cyan: "#64d2ff", white: "#f2f2f7",
      },
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "clichat:data") {
        term.write(event.data.data);
      }
      if (event.data?.type === "clichat:exit") {
        term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
      }
    };
    window.addEventListener("message", handleMessage);

    // For PTY mode: forward terminal input to process
    term.onData((data) => window.clichatPTY.write(data));
    term.onResize(({ cols, rows }) => window.clichatPTY.resize({ cols, rows }));

    const handleResize = () => fit.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, []);

  return <div ref={containerRef} className="raw-terminal" />;
}

// ─── useChatSession: Per-Message mode (Claude) ──────────────────────────────
// Spawns `claude -p "msg" --output-format stream-json` for each message.
// Uses --continue after first message to keep conversation context.

function usePerMessageSession(provider: ProviderInfo) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [isAlive, setIsAlive] = useState(true);
  const streamBuf = useRef("");
  const streamMsg = useRef<ChatMessage | null>(null);
  const isFirstMessage = useRef(true);
  const seenMsgIds = useRef(new Set<string>());
  const nextId = useRef(0);
  const mkId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${nextId.current++}`;

  // Listen for data from the spawned process
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "clichat:exit") {
        // Process finished for this message — flush and go idle
        if (streamMsg.current) {
          streamMsg.current = { ...streamMsg.current, metadata: { ...streamMsg.current.metadata, isStreaming: false } };
          setMessages(prev => {
            const copy = [...prev];
            copy[copy.length - 1] = { ...streamMsg.current! };
            return copy;
          });
          streamMsg.current = null;
        }
        streamBuf.current = "";
        setStatus("idle");
        return;
      }

      if (event.data?.type !== "clichat:data") return;
      const data: string = event.data.data;

      // Parse stream-json lines
      streamBuf.current += data;
      const lines = streamBuf.current.split("\n");
      streamBuf.current = lines.pop() ?? "";

      for (const line of lines) {
        // Deduplicate: Claude sends same message.id multiple times as content grows
        try {
          const raw = JSON.parse(line);
          if (raw.type === "assistant" && raw.message?.id) {
            const key = `${raw.message.id}_${raw.message.content?.length ?? 0}`;
            if (seenMsgIds.current.has(key)) continue;
            seenMsgIds.current.add(key);
          }
        } catch {}

        const parsed = parseStreamJsonLine(line);
        if (!parsed) continue;

        if (parsed.type === "status" && parsed.content === "__stop__") {
          if (streamMsg.current) {
            streamMsg.current = { ...streamMsg.current, metadata: { ...streamMsg.current.metadata, isStreaming: false } };
            setMessages(prev => {
              const copy = [...prev];
              copy[copy.length - 1] = { ...streamMsg.current! };
              return copy;
            });
            streamMsg.current = null;
          }
          setStatus("idle");
          continue;
        }

        if (parsed.type === "message" || parsed.type === "thinking") {
          if (streamMsg.current && streamMsg.current.type === parsed.type) {
            streamMsg.current = { ...streamMsg.current, content: streamMsg.current.content + parsed.content };
          } else {
            // Flush previous streaming msg, start new one
            if (streamMsg.current) {
              streamMsg.current = { ...streamMsg.current, metadata: { ...streamMsg.current.metadata, isStreaming: false } };
              setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { ...streamMsg.current! };
                return copy;
              });
            }
            const newMsg: ChatMessage = {
              id: mkId(), role: parsed.role, content: parsed.content,
              timestamp: Date.now(), type: parsed.type,
              metadata: { isStreaming: true, provider: provider.id },
            };
            streamMsg.current = newMsg;
            setMessages(prev => [...prev, newMsg]);
          }
          setMessages(prev => {
            const copy = [...prev];
            copy[copy.length - 1] = { ...streamMsg.current! };
            return copy;
          });
          setStatus(parsed.type === "thinking" ? "thinking" : "responding");
        } else if (parsed.type === "tool_use") {
          setStatus("tool_use");
          if (streamMsg.current) {
            streamMsg.current = { ...streamMsg.current, metadata: { ...streamMsg.current.metadata, isStreaming: false } };
          }
          streamMsg.current = null;
          setMessages(prev => [...prev, {
            id: mkId(), role: "tool", content: parsed.content,
            timestamp: Date.now(), type: "tool_use",
            metadata: { toolName: parsed.toolName, provider: provider.id },
          }]);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [provider]);

  const send = useCallback((text: string, opts?: { model?: string; permissionMode?: string }) => {
    // Add user message
    setMessages(prev => [...prev, {
      id: mkId(), role: "user", content: text,
      timestamp: Date.now(), type: "message",
    }]);
    setStatus("thinking");
    streamMsg.current = null;
    streamBuf.current = "";
    seenMsgIds.current.clear();

    // Build args: claude -p "message" --output-format stream-json [--continue]
    const args = [...provider.baseArgs, text];

    if (opts?.model) {
      args.push("--model", opts.model);
    }

    if (opts?.permissionMode && opts.permissionMode !== "default") {
      // Claude uses --permission-mode, Gemini uses --approval-mode
      if (provider.id === "gemini") {
        args.push("--approval-mode", opts.permissionMode);
      } else {
        args.push("--permission-mode", opts.permissionMode);
      }
    }

    if (!isFirstMessage.current) {
      if (provider.id === "gemini") {
        args.push("--resume", "latest");
      } else {
        args.push("--continue");
      }
    }
    isFirstMessage.current = false;

    // Spawn a new process for this message
    window.clichatPTY.spawn({
      command: provider.command,
      args,
      useChildProcess: true, // child_process for structured I/O
    });
  }, [provider]);

  const abort = useCallback(() => {
    window.clichatPTY.kill();
    setStatus("idle");
  }, []);

  return { messages, status, isAlive, send, abort };
}

// ─── useChatSession: PTY mode (Gemini, Shell) ───────────────────────────────

function usePTYSession(provider: ProviderInfo, enabled: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [isAlive, setIsAlive] = useState(false);
  const ansiBuf = useRef("");
  const ansiFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamMsg = useRef<ChatMessage | null>(null);
  const nextId = useRef(0);
  const mkId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${nextId.current++}`;

  useEffect(() => {
    if (!enabled) return;

    setMessages([]);
    setStatus("idle");
    ansiBuf.current = "";
    streamMsg.current = null;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "clichat:exit") {
        setIsAlive(false);
        setStatus("exited");
        return;
      }
      if (event.data?.type !== "clichat:data") return;

      ansiBuf.current += event.data.data;

      if (ansiFlushTimer.current) clearTimeout(ansiFlushTimer.current);
      ansiFlushTimer.current = setTimeout(() => {
        const clean = stripAnsi(ansiBuf.current);
        ansiBuf.current = "";
        const lines = clean.split("\n").filter(isMeaningfulLine);
        if (lines.length === 0) return;
        const content = lines.join("\n");

        if (streamMsg.current && streamMsg.current.metadata?.isStreaming) {
          streamMsg.current = { ...streamMsg.current, content: streamMsg.current.content + "\n" + content };
          setMessages(prev => {
            const copy = [...prev];
            copy[copy.length - 1] = { ...streamMsg.current! };
            return copy;
          });
        } else {
          const newMsg: ChatMessage = {
            id: mkId(), role: "assistant", content,
            timestamp: Date.now(), type: "message",
            metadata: { isStreaming: true, provider: provider.id },
          };
          streamMsg.current = newMsg;
          setMessages(prev => [...prev, newMsg]);
        }
        setStatus("responding");
      }, 200);
    };

    window.addEventListener("message", handleMessage);

    window.clichatPTY.spawn({
      command: provider.command,
      args: provider.baseArgs,
      useChildProcess: false,
    }).then(() => setIsAlive(true));

    return () => {
      window.removeEventListener("message", handleMessage);
      if (ansiFlushTimer.current) clearTimeout(ansiFlushTimer.current);
      window.clichatPTY.kill();
    };
  }, [provider, enabled]);

  const send = useCallback((text: string) => {
    if (ansiFlushTimer.current) { clearTimeout(ansiFlushTimer.current); ansiFlushTimer.current = null; }
    ansiBuf.current = "";
    if (streamMsg.current) {
      streamMsg.current = { ...streamMsg.current, metadata: { ...streamMsg.current.metadata, isStreaming: false } };
      setMessages(prev => {
        const copy = [...prev];
        if (copy.length > 0) copy[copy.length - 1] = { ...streamMsg.current! };
        return copy;
      });
      streamMsg.current = null;
    }
    setMessages(prev => [...prev, {
      id: mkId(), role: "user", content: text,
      timestamp: Date.now(), type: "message",
    }]);
    setStatus("thinking");
    window.clichatPTY.write(text + "\n");
  }, []);

  const abort = useCallback(() => {
    window.clichatPTY.write("\x03");
    setStatus("idle");
  }, []);

  return { messages, status, isAlive, send, abort };
}

// ─── UI Components ───────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const cls = [
    "clichat-bubble",
    `clichat-bubble--${message.role}`,
    message.type === "thinking" && "clichat-bubble--thinking",
    message.type === "tool_use" && "clichat-bubble--tool",
    message.type === "error" && "clichat-bubble--error",
    message.metadata?.isStreaming && "clichat-bubble--streaming",
  ].filter(Boolean).join(" ");

  return (
    <div className={cls}>
      <div className="clichat-bubble__role">
        {isUser ? "You" : message.role === "tool" ? "Tool" : "AI"}
      </div>
      {message.type === "thinking" && <div className="clichat-bubble__thinking-label">Thinking...</div>}
      {message.type === "tool_use" && message.metadata?.toolName && (
        <div className="clichat-bubble__tool-label">Using: {message.metadata.toolName}</div>
      )}
      <div className="clichat-bubble__content">{message.content}</div>
      {message.metadata?.isStreaming && <span className="clichat-bubble__cursor" />}
    </div>
  );
}

function StatusIndicator({ status }: { status: SessionStatus }) {
  if (status === "idle" || status === "exited") return null;
  const labels: Record<string, string> = {
    thinking: "Thinking...", responding: "Responding...", tool_use: "Using tools...", error: "Error",
  };
  return (
    <div className={`clichat-status clichat-status--${status}`}>
      <span className="clichat-status__dot" />
      <span className="clichat-status__label">{labels[status] ?? ""}</span>
    </div>
  );
}

function ChatInput({ onSend, disabled, placeholder }: { onSend: (t: string) => void; disabled: boolean; placeholder?: string }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const handleSubmit = () => {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue("");
  };

  return (
    <div className="clichat-input">
      <textarea
        ref={ref} className="clichat-input__textarea" value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
        placeholder={disabled ? "Session ended" : placeholder ?? "Type a message..."} disabled={disabled} rows={1}
      />
      <button className="clichat-input__send" onClick={handleSubmit} disabled={disabled || !value.trim()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
        </svg>
      </button>
    </div>
  );
}

// ─── Chat View ───────────────────────────────────────────────────────────────

function ChatView({ provider, onBack }: { provider: ProviderInfo; onBack: () => void }) {
  const isPTY = provider.mode === "pty";
  const perMsg = usePerMessageSession(provider);
  const pty = usePTYSession(provider, isPTY);

  // Pick the right session based on provider mode
  const session = isPTY ? pty : perMsg;
  const { messages, status, send, abort } = session;
  const isAlive = isPTY ? pty.isAlive : true;

  const [showTerminal, setShowTerminal] = useState(true);
  const [selectedModel, setSelectedModel] = useState(provider.defaultModel ?? "");
  const [permissionMode, setPermissionMode] = useState("default");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, status]);

  const sendWithOpts = useCallback((text: string) => {
    send(text, { model: selectedModel || undefined, permissionMode });
  }, [send, selectedModel, permissionMode]);

  const isActive = status === "thinking" || status === "responding" || status === "tool_use";

  return (
    <div className="chat-view">
      <div className="chat-view__header">
        <button className="demo-back" onClick={onBack}>←</button>
        <span className="demo-provider-icon">{provider.icon}</span>
        <span className="demo-provider-label">{provider.label}</span>
        {isAlive && <span className="demo-alive">●</span>}

        {provider.models && (
          <select
            className="demo-model-select"
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            title="Select model"
          >
            {provider.models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}

        {provider.permissionModes && (
          <select
            className="demo-permission-select"
            value={permissionMode}
            onChange={e => setPermissionMode(e.target.value)}
            title="Approval mode"
          >
            {provider.permissionModes.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}

        <div style={{ flex: 1 }} />
        <button
          className={`terminal-toggle ${showTerminal ? "terminal-toggle--active" : ""}`}
          onClick={() => setShowTerminal(t => !t)}
          title="Toggle raw terminal"
        >
          &gt;_
        </button>
      </div>

      <div className={`chat-view__body ${showTerminal ? "chat-view__body--split" : ""}`}>
        <div className="chat-panel">
          <div className="chat-panel__messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="clichat-container__empty">
                <div className="demo-empty">
                  <div className="demo-empty-icon">{provider.icon}</div>
                  <p>Start a conversation with {provider.label}</p>
                  <div className="demo-suggestions">
                    <button onClick={() => sendWithOpts("Hola! Que puedes hacer?")}>Que puedes hacer?</button>
                    <button onClick={() => sendWithOpts("Cuentame un chiste")}>Cuentame un chiste</button>
                  </div>
                </div>
              </div>
            )}
            {messages.map(msg => <ChatBubble key={msg.id} message={msg} />)}
          </div>

          <div className="chat-panel__footer">
            <StatusIndicator status={status} />
            <ChatInput
              onSend={sendWithOpts}
              disabled={status === "exited"}
              placeholder={`Message ${provider.label}...`}
            />
            {isActive && (
              <button className="clichat-container__abort" onClick={abort}>Stop</button>
            )}
          </div>
        </div>

        {showTerminal && (
          <div className="terminal-panel">
            <div className="terminal-panel__header">
              <span className="terminal-panel__title">Raw Terminal</span>
              <span className="terminal-panel__hint">
                {provider.mode === "per-message" ? "JSON stream" : "Live CLI output"}
              </span>
            </div>
            <RawTerminal />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export function App() {
  const [provider, setProvider] = useState<ProviderInfo | null>(null);

  if (!provider) {
    return (
      <div className="demo-app">
        <div className="demo-welcome">
          <h1 className="demo-title">clichat</h1>
          <p className="demo-subtitle">AI CLI → Chat UI</p>
        </div>
        <div className="clichat-picker">
          <p className="clichat-picker__hint">Choose a provider:</p>
          <div className="clichat-picker__options">
            {PROVIDERS.map(p => (
              <button key={p.id} className="clichat-picker__option" onClick={() => setProvider(p)}>
                <span className="clichat-picker__icon">{p.icon}</span>
                <span className="clichat-picker__label">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="demo-app">
      <ChatView key={provider.id} provider={provider} onBack={() => setProvider(null)} />
    </div>
  );
}
