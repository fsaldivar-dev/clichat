import { run, stream, parseJSON } from "./spawn.js";
import type { Response, StreamChunk, Options, Session, CliFunction } from "./types.js";

function buildArgs(prompt: string, opts?: Options, extra?: string[]): string[] {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (opts?.model) args.push("--model", opts.model);
  if (opts?.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
  if (opts?.permissionMode) args.push("--permission-mode", opts.permissionMode);
  if (opts?.allowedTools?.length) args.push("--allowedTools", ...opts.allowedTools);
  if (opts?.maxTurns) args.push("--max-turns", String(opts.maxTurns));
  if (opts?.maxBudget) args.push("--max-budget-usd", String(opts.maxBudget));
  if (extra) args.push(...extra);
  return args;
}

function parseOutput(stdout: string): Response {
  let text = "";
  let thinking = "";
  let model: string | undefined;
  let usage: Response["usage"] | undefined;

  for (const line of stdout.split("\n")) {
    const json = parseJSON(line);
    if (!json) continue;

    if (json.type === "assistant") {
      const content = (json.message as Record<string, unknown>)?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) text = block.text;
          if (block.type === "thinking" && block.thinking) thinking = block.thinking;
        }
      }
    }

    if (json.type === "result" && typeof json.result === "string") {
      if (!text) text = json.result;
      if (typeof json.total_cost_usd === "number") {
        usage = { cost: json.total_cost_usd, duration: json.duration_ms as number };
        const u = json.usage as Record<string, unknown> | undefined;
        if (u) {
          usage.inputTokens = u.input_tokens as number;
          usage.outputTokens = u.output_tokens as number;
        }
      }
      const mu = json.modelUsage as Record<string, unknown> | undefined;
      if (mu) model = Object.keys(mu)[0];
    }
  }

  return { text, thinking: thinking || undefined, provider: "claude", model, usage };
}

async function claudeFn(prompt: string, opts?: Options): Promise<Response> {
  const args = buildArgs(prompt, opts);
  const result = await run("claude", args, { cwd: opts?.cwd, env: opts?.env });
  return parseOutput(result.stdout);
}

claudeFn.stream = async function* (prompt: string, opts?: Options): AsyncGenerator<StreamChunk> {
  const args = buildArgs(prompt, opts);
  for await (const line of stream("claude", args, { cwd: opts?.cwd, env: opts?.env })) {
    const json = parseJSON(line);
    if (!json) continue;

    if (json.type === "assistant") {
      const content = (json.message as Record<string, unknown>)?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) yield { text: block.text, type: "text" };
          if (block.type === "thinking" && block.thinking) yield { text: block.thinking, type: "thinking" };
          if (block.type === "tool_use") yield { text: block.name ?? "", type: "tool_use", toolName: block.name };
        }
      }
    }

    if (json.type === "result") yield { text: "", type: "done" };
  }
};

claudeFn.session = (opts?: Options): Session => {
  let isFirst = true;
  return {
    async send(prompt: string) {
      const extra = isFirst ? [] : ["--continue"];
      isFirst = false;
      const args = buildArgs(prompt, opts, extra);
      const result = await run("claude", args, { cwd: opts?.cwd, env: opts?.env });
      return parseOutput(result.stdout);
    },
    async *stream(prompt: string) {
      const extra = isFirst ? [] : ["--continue"];
      isFirst = false;
      const args = buildArgs(prompt, opts, extra);
      yield* claudeFn.stream(prompt, opts);
    },
  };
};

export const claude = claudeFn as CliFunction;
