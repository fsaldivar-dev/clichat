import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the full path of a CLI binary.
 * Handles the Electron PATH issue by using an interactive login shell.
 * Uses execFileSync to avoid shell metacharacter interpretation.
 */
export function findBinary(name: string): string {
  try {
    if (process.platform === "win32") {
      const output = execFileSync("where.exe", [name], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const binPath = output.split("\n").find((l) => l.trim().length > 0);
      return binPath?.trim() || name;
    }

    const shell = process.env.SHELL || "/bin/sh";
    const output = execFileSync(shell, ["-ilc", `which ${name}`], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Filter out session restore messages — take only the line starting with /
    const binPath = output.split("\n").find((l) => l.startsWith("/"));
    return binPath?.trim() || name;
  } catch {
    return name;
  }
}

/**
 * Build a full PATH that includes common binary locations.
 * Solves the issue where Electron/spawned processes don't inherit the full shell PATH.
 * Extracted from kuilo's electron/main.cjs:853.
 */
export function buildFullPath(): string {
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local/bin"),
    process.env.PATH ?? "",
  ].join(":");
}
