import { run, stream as spawnStream } from "./spawn.js";
import type { Response, StreamChunk, Options, Session, CliFunction } from "./types.js";

function buildArgs(prompt: string, opts?: Options): string[] {
  const args = ["-p", prompt];
  if (opts?.model) args.push("--model", opts.model);
  return args;
}

async function cursorFn(prompt: string, opts?: Options): Promise<Response> {
  const args = buildArgs(prompt, opts);
  const result = await run("cursor", args, { cwd: opts?.cwd, env: opts?.env });
  return { text: result.stdout.trim(), provider: "cursor" };
}

cursorFn.stream = async function* (prompt: string, opts?: Options): AsyncGenerator<StreamChunk> {
  const args = buildArgs(prompt, opts);
  for await (const line of spawnStream("cursor", args, { cwd: opts?.cwd, env: opts?.env })) {
    yield { text: line, type: "text" };
  }
  yield { text: "", type: "done" };
};

cursorFn.session = (opts?: Options): Session => {
  return {
    send: (prompt: string) => cursorFn(prompt, opts),
    stream: (prompt: string) => cursorFn.stream(prompt, opts),
  };
};

export const cursor = cursorFn as CliFunction;
