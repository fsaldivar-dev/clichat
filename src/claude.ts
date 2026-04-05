import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Response, StreamChunk, Options, Session, CliFunction } from "./types.js";

function buildOptions(opts?: Options) {
  const sdkOpts: Record<string, unknown> = {};
  if (opts?.model) sdkOpts.model = opts.model;
  if (opts?.systemPrompt) sdkOpts.systemPrompt = opts.systemPrompt;
  if (opts?.permissionMode) sdkOpts.permissionMode = opts.permissionMode;
  if (opts?.allowedTools) sdkOpts.allowedTools = opts.allowedTools;
  if (opts?.maxTurns) sdkOpts.maxTurns = opts.maxTurns;
  if (opts?.maxBudget) sdkOpts.maxBudgetUsd = opts.maxBudget;
  if (opts?.cwd) sdkOpts.cwd = opts.cwd;
  if (opts?.mcpServers) sdkOpts.mcpConfig = opts.mcpServers;
  return sdkOpts;
}

function extractResponse(messages: Array<Record<string, unknown>>): Response {
  let text = "";
  let thinking = "";
  let model: string | undefined;

  for (const msg of messages) {
    if (msg.type === "assistant") {
      const content = (msg as Record<string, unknown>).message;
      if (content && typeof content === "object") {
        const m = content as Record<string, unknown>;
        if (m.model) model = m.model as string;
        const blocks = m.content;
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            if (b.type === "text" && b.text) text = b.text;
            if (b.type === "thinking" && b.thinking) thinking = b.thinking;
          }
        }
      }
    }
    if (msg.type === "result") {
      if (typeof msg.result === "string" && !text) text = msg.result;
    }
  }

  return { text, thinking: thinking || undefined, provider: "claude", model };
}

async function claudeFn(prompt: string, opts?: Options): Promise<Response> {
  const q = query({ prompt, options: buildOptions(opts) as any });
  const messages: Array<Record<string, unknown>> = [];

  for await (const msg of q) {
    messages.push(msg as unknown as Record<string, unknown>);
  }

  return extractResponse(messages);
}

claudeFn.stream = async function* (prompt: string, opts?: Options): AsyncGenerator<StreamChunk> {
  const q = query({ prompt, options: buildOptions(opts) as any });

  for await (const msg of q) {
    const m = msg as unknown as Record<string, unknown>;

    if (m.type === "assistant") {
      const message = m.message as Record<string, unknown> | undefined;
      const blocks = message?.content;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b.type === "text" && b.text) yield { text: b.text, type: "text" as const };
          if (b.type === "thinking" && b.thinking) yield { text: b.thinking, type: "thinking" as const };
          if (b.type === "tool_use") yield { text: b.name ?? "", type: "tool_use" as const, toolName: b.name };
        }
      }
    }

    if (m.type === "result") {
      yield { text: "", type: "done" as const };
    }
  }
};

claudeFn.session = (opts?: Options): Session => {
  let sessionId: string | undefined;

  return {
    async send(prompt: string) {
      const sdkOpts = buildOptions(opts) as Record<string, unknown>;
      if (sessionId) sdkOpts.resume = sessionId;

      const q = query({ prompt, options: sdkOpts as any });
      const messages: Array<Record<string, unknown>> = [];

      for await (const msg of q) {
        const m = msg as unknown as Record<string, unknown>;
        messages.push(m);
        // Capture session ID for continuation
        if (m.session_id && typeof m.session_id === "string") {
          sessionId = m.session_id;
        }
      }

      return extractResponse(messages);
    },

    async *stream(prompt: string) {
      const sdkOpts = buildOptions(opts) as Record<string, unknown>;
      if (sessionId) sdkOpts.resume = sessionId;

      const q = query({ prompt, options: sdkOpts as any });

      for await (const msg of q) {
        const m = msg as unknown as Record<string, unknown>;
        if (m.session_id && typeof m.session_id === "string") {
          sessionId = m.session_id;
        }

        if (m.type === "assistant") {
          const message = m.message as Record<string, unknown> | undefined;
          const blocks = message?.content;
          if (Array.isArray(blocks)) {
            for (const b of blocks) {
              if (b.type === "text" && b.text) yield { text: b.text, type: "text" as const };
              if (b.type === "thinking" && b.thinking) yield { text: b.thinking, type: "thinking" as const };
            }
          }
        }

        if (m.type === "result") yield { text: "", type: "done" as const };
      }
    },
  };
};

export const claude = claudeFn as CliFunction;
