import React, { useState, useRef, useEffect, useCallback } from "react";

const API = "http://localhost:3001";

type Provider = "claude" | "gemini";
type Message = { role: "user" | "assistant"; text: string; provider?: Provider };
type McpServer = { name: string; command: string; args: string };

export function App() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showMcp, setShowMcp] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo(0, messagesRef.current.scrollHeight);
  }, [messages]);

  const startSession = useCallback(async (p: Provider) => {
    setProvider(p);
    setMessages([]);
    setSessionId(null);
    try {
      const res = await fetch(`${API}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: p }),
      });
      const data = await res.json();
      setSessionId(data.sessionId);
    } catch {
      // Session creation failed — will use stateless mode
    }
  }, []);

  const send = useCallback(async () => {
    if (!input.trim() || !provider || loading) return;
    const text = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          prompt: text,
          sessionId,
          options: mcpServers.length ? { mcpServers: buildMcpConfig() } : undefined,
        }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", text: data.text || data.error, provider }]);
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, provider, loading, sessionId, mcpServers]);

  const buildMcpConfig = () => {
    const config: Record<string, { command: string; args: string[] }> = {};
    for (const s of mcpServers) {
      if (s.name && s.command) {
        config[s.name] = { command: s.command, args: s.args.split(" ").filter(Boolean) };
      }
    }
    return config;
  };

  const addMcpServer = () => {
    setMcpServers((prev) => [...prev, { name: "", command: "", args: "" }]);
  };

  const updateMcp = (i: number, field: keyof McpServer, value: string) => {
    setMcpServers((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  };

  const removeMcp = (i: number) => {
    setMcpServers((prev) => prev.filter((_, idx) => idx !== i));
  };

  // Provider selection screen
  if (!provider) {
    return (
      <div className="app">
        <div className="welcome">
          <h1>clichat</h1>
          <p>AI CLI wrapper</p>
          <div className="providers">
            <button className="provider-btn claude" onClick={() => startSession("claude")}>
              <span className="icon">&#9671;</span>
              Claude
            </button>
            <button className="provider-btn gemini" onClick={() => startSession("gemini")}>
              <span className="icon">&#10022;</span>
              Gemini
            </button>
          </div>
          <button className="mcp-toggle" onClick={() => setShowMcp(!showMcp)}>
            {showMcp ? "Hide" : "Configure"} MCP Servers
          </button>
          {showMcp && (
            <div className="mcp-config">
              {mcpServers.map((s, i) => (
                <div key={i} className="mcp-row">
                  <input placeholder="Name" value={s.name} onChange={(e) => updateMcp(i, "name", e.target.value)} />
                  <input placeholder="Command" value={s.command} onChange={(e) => updateMcp(i, "command", e.target.value)} />
                  <input placeholder="Args (space separated)" value={s.args} onChange={(e) => updateMcp(i, "args", e.target.value)} />
                  <button className="remove-btn" onClick={() => removeMcp(i)}>x</button>
                </div>
              ))}
              <button className="add-btn" onClick={addMcpServer}>+ Add MCP Server</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Chat screen
  return (
    <div className="app">
      <div className="chat-header">
        <button className="back-btn" onClick={() => setProvider(null)}>&#8592;</button>
        <span className={`provider-badge ${provider}`}>
          {provider === "claude" ? "&#9671;" : "&#10022;"} {provider}
        </span>
        {sessionId && <span className="session-badge">session</span>}
      </div>

      <div className="messages" ref={messagesRef}>
        {messages.length === 0 && (
          <div className="empty">Start a conversation with {provider}</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="msg-label">{m.role === "user" ? "You" : provider}</div>
            <div className="msg-text">{m.text}</div>
          </div>
        ))}
        {loading && (
          <div className="msg assistant">
            <div className="msg-label">{provider}</div>
            <div className="msg-text loading-dots">Thinking</div>
          </div>
        )}
      </div>

      <div className="input-bar">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={`Message ${provider}...`}
          disabled={loading}
          rows={1}
        />
        <button onClick={send} disabled={loading || !input.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
