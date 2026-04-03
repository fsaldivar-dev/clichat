import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ChatMessage,
  ChatSessionOptions,
  SessionStatus,
  CLIProvider,
  PTYBackend,
  ChatPlugin,
} from "@clichat/core";
import { ChatSession } from "@clichat/core";

export interface UseChatSessionOptions {
  provider: CLIProvider;
  backend: PTYBackend;
  cwd?: string;
  initialPrompt?: string;
  plugins?: ChatPlugin[];
  model?: string;
  systemPrompt?: string;
  env?: Record<string, string>;
  /** Auto-start the session on mount (default: true) */
  autoStart?: boolean;
}

export interface UseChatSessionReturn {
  messages: ChatMessage[];
  status: SessionStatus;
  isAlive: boolean;
  send: (text: string) => void;
  abort: () => void;
  start: () => Promise<void>;
  destroy: () => Promise<void>;
  rawOutput: string;
  /** Toggle raw terminal output visibility */
  rawMode: boolean;
  toggleRawMode: () => void;
}

export function useChatSession(options: UseChatSessionOptions): UseChatSessionReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [isAlive, setIsAlive] = useState(false);
  const [rawOutput, setRawOutput] = useState("");
  const [rawMode, setRawMode] = useState(false);

  const sessionRef = useRef<ChatSession | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const createSession = useCallback(() => {
    const opts = optionsRef.current;
    return new ChatSession({
      provider: opts.provider,
      backend: opts.backend,
      cwd: opts.cwd,
      initialPrompt: opts.initialPrompt,
      plugins: opts.plugins,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      env: opts.env,
    });
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current?.isAlive) return;

    const session = createSession();
    sessionRef.current = session;

    session.on("message", () => {
      setMessages([...session.messages]);
    });

    session.on("status", (s: SessionStatus) => {
      setStatus(s);
    });

    session.on("raw", (data: string) => {
      setRawOutput((prev) => prev + data);
    });

    session.on("exit", () => {
      setIsAlive(false);
    });

    await session.start();
    setIsAlive(true);
    setMessages([]);
    setRawOutput("");
    setStatus("idle");
  }, [createSession]);

  const send = useCallback((text: string) => {
    sessionRef.current?.send(text);
  }, []);

  const abort = useCallback(() => {
    sessionRef.current?.abort();
  }, []);

  const destroy = useCallback(async () => {
    if (sessionRef.current) {
      await sessionRef.current.destroy();
      sessionRef.current = null;
      setIsAlive(false);
    }
  }, []);

  const toggleRawMode = useCallback(() => {
    setRawMode((prev) => !prev);
  }, []);

  // Auto-start
  useEffect(() => {
    if (options.autoStart !== false) {
      start();
    }
    return () => {
      sessionRef.current?.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    messages,
    status,
    isAlive,
    send,
    abort,
    start,
    destroy,
    rawOutput,
    rawMode,
    toggleRawMode,
  };
}
