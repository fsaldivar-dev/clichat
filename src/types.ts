export interface Response {
  text: string;
  thinking?: string;
  provider: "claude" | "gemini" | "cursor";
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    duration?: number;
  };
}

export interface StreamChunk {
  text: string;
  type: "text" | "thinking" | "tool_use" | "tool_result" | "done";
  toolName?: string;
}

export interface Options {
  model?: string;
  systemPrompt?: string;
  permissionMode?: string;
  allowedTools?: string[];
  maxTurns?: number;
  maxBudget?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface Session {
  send(prompt: string): Promise<Response>;
  stream(prompt: string): AsyncGenerator<StreamChunk>;
}

export type CliFunction = {
  (prompt: string, opts?: Options): Promise<Response>;
  stream(prompt: string, opts?: Options): AsyncGenerator<StreamChunk>;
  session(opts?: Options): Session;
};
