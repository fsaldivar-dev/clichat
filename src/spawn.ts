import { spawn as cpSpawn } from "node:child_process";

/** Spawn a CLI command, collect all stdout, return it as a string. */
export function run(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = cpSpawn(cmd, args, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    child.on("error", (err) => {
      resolve({ stdout, stderr: stderr || err.message, code: 1 });
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

/** Spawn a CLI command and yield stdout lines as they arrive. */
export async function* stream(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }): AsyncGenerator<string> {
  const child = cpSpawn(cmd, args, {
    cwd: opts?.cwd,
    env: { ...process.env, ...opts?.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";

  const lines = new Promise<void>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  // Yield lines as they become available
  while (true) {
    const nlIndex = buffer.indexOf("\n");
    if (nlIndex !== -1) {
      const line = buffer.slice(0, nlIndex);
      buffer = buffer.slice(nlIndex + 1);
      if (line.trim()) yield line;
    } else {
      // Wait a tick for more data
      await new Promise((r) => setTimeout(r, 10));
      // Check if process ended
      if (child.exitCode !== null && buffer.indexOf("\n") === -1) {
        if (buffer.trim()) yield buffer;
        break;
      }
    }
  }

  await lines.catch(() => {});
}

/** Try to parse a line as JSON, return null if not valid JSON. */
export function parseJSON(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line.trim());
  } catch {
    return null;
  }
}
