import type { CLIProvider, SpawnConfig, SpawnOptions } from "../types.js";
import { StreamJsonParser } from "../parsers/stream-json.js";
import { findBinary, buildFullPath } from "./utils.js";

/**
 * Claude CLI provider using structured JSON I/O.
 * Spawns `claude` with `--output-format stream-json` for reliable parsing.
 */
export const claudeProvider: CLIProvider = {
  id: "claude",
  label: "Claude CLI",
  icon: "◇",

  async spawn(options: SpawnOptions): Promise<SpawnConfig> {
    const claudeBin = findBinary("claude");
    const args = ["--output-format", "stream-json"];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt);
    }

    if (options.initialPrompt) {
      args.push("--print", options.initialPrompt);
    }

    return {
      command: claudeBin,
      args,
      cwd: options.cwd,
      env: {
        ...options.env,
        TERM: "xterm-256color",
        PATH: buildFullPath(),
      },
      // Structured I/O — can use child_process instead of node-pty
      useChildProcess: true,
    };
  },

  parser: new StreamJsonParser(),

  formatInput(text: string): string {
    return text + "\n";
  },
};

/**
 * Claude CLI provider in interactive (PTY) mode.
 * Uses ANSI terminal output — less reliable but supports full interactive features.
 */
export const claudeInteractiveProvider: CLIProvider = {
  id: "claude-interactive",
  label: "Claude CLI (Interactive)",
  icon: "◇",

  async spawn(options: SpawnOptions): Promise<SpawnConfig> {
    const claudeBin = findBinary("claude");
    const args: string[] = [];

    return {
      command: claudeBin,
      args,
      cwd: options.cwd,
      env: {
        ...options.env,
        TERM: "xterm-256color",
        PATH: buildFullPath(),
      },
      useChildProcess: false,
    };
  },

  // Interactive mode uses raw ANSI — consumers should use RawTerminal component
  parser: new StreamJsonParser(), // placeholder, won't be used in raw mode
  formatInput: (text) => text,
};
