import { run, stream, parseJSON } from "./spawn.js";
import type { Response, StreamChunk, Options, Session, CliFunction } from "./types.js";

function buildArgs(prompt: string, opts?: Options, extra?: string[]): string[] {
  // Gemini: -p must come right before the prompt text
  const args = ["--output-format", "stream-json"];
  if (opts?.model) args.push("--model", opts.model);
  if (opts?.permissionMode) args.push("--approval-mode", opts.permissionMode);
  if (extra) args.push(...extra);
  args.push("-p", prompt);
  return args;
}

function parseOutput(stdout: string): Response {
  let text = "";
  let model: string | undefined;
  let usage: Response["usage"] | undefined;

  for (const line of stdout.split("\n")) {
    const json = parseJSON(line);
    if (!json) continue;

    if (json.type === "init" && typeof json.model === "string") {
      model = json.model;
    }

    if (json.type === "message" && json.role === "assistant" && typeof json.content === "string") {
      text += json.content;
    }

    if (json.type === "result") {
      const stats = json.stats as Record<string, unknown> | undefined;
      if (stats) {
        usage = {
          inputTokens: stats.input_tokens as number,
          outputTokens: stats.output_tokens as number,
          duration: stats.duration_ms as number,
        };
      }
    }
  }

  return { text, provider: "gemini", model, usage };
}

async function geminiFn(prompt: string, opts?: Options): Promise<Response> {
  const args = buildArgs(prompt, opts);
  const result = await run("gemini", args, { cwd: opts?.cwd, env: opts?.env });
  return parseOutput(result.stdout);
}

geminiFn.stream = async function* (prompt: string, opts?: Options): AsyncGenerator<StreamChunk> {
  const args = buildArgs(prompt, opts);
  for await (const line of stream("gemini", args, { cwd: opts?.cwd, env: opts?.env })) {
    const json = parseJSON(line);
    if (!json) continue;

    if (json.type === "message" && json.role === "assistant" && typeof json.content === "string") {
      yield { text: json.content, type: "text" };
    }

    if (json.type === "result") yield { text: "", type: "done" };
  }
};

geminiFn.session = (opts?: Options): Session => {
  let isFirst = true;
  return {
    async send(prompt: string) {
      const extra = isFirst ? [] : ["--resume", "latest"];
      isFirst = false;
      const args = buildArgs(prompt, opts, extra);
      const result = await run("gemini", args, { cwd: opts?.cwd, env: opts?.env });
      return parseOutput(result.stdout);
    },
    stream: geminiFn.stream,
  };
};

export const gemini = geminiFn as CliFunction;
