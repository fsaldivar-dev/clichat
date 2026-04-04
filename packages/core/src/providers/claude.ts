import type { CLIProvider, SpawnConfig, SpawnOptions } from "../types.js";
import { StreamJsonParser } from "../parsers/stream-json.js";
import { AnsiStripParser } from "../parsers/ansi-strip.js";
import { findBinary, buildFullPath } from "./utils.js";

/**
 * Claude CLI provider using per-message spawn with structured JSON output.
 * Each send() spawns `claude -p "msg" --verbose --output-format stream-json`.
 * Uses `--continue` after the first message to maintain conversation context.
 */
export const claudeProvider: CLIProvider = {
  id: "claude",
  label: "Claude CLI",
  icon: "◇",

  async spawn(options: SpawnOptions): Promise<SpawnConfig> {
    // Initial spawn: just `true` — a no-op process that exits immediately.
    // Real work happens in respawnOnSend() which spawns per message.
    return {
      command: "true",
      args: [],
      cwd: options.cwd,
      env: {
        ...options.env,
        PATH: buildFullPath(),
      },
      useChildProcess: true,
    };
  },

  respawnOnSend(text: string, isFirst: boolean, options: SpawnOptions): SpawnConfig {
    const claudeBin = findBinary("claude");
    const args = ["-p", text, "--output-format", "stream-json", "--verbose"];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt);
    }

    if (!isFirst) {
      args.push("--continue");
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
 * Keeps a single long-lived process with raw ANSI output.
 * Best used with a RawTerminal component for full terminal emulation.
 */
export const claudeInteractiveProvider: CLIProvider = {
  id: "claude-interactive",
  label: "Claude CLI (Interactive)",
  icon: "◇",

  async spawn(options: SpawnOptions): Promise<SpawnConfig> {
    const claudeBin = findBinary("claude");
    return {
      command: claudeBin,
      args: [],
      cwd: options.cwd,
      env: {
        ...options.env,
        TERM: "xterm-256color",
        PATH: buildFullPath(),
      },
      useChildProcess: false,
    };
  },

  parser: new AnsiStripParser(),
  formatInput: (text) => text + "\n",
};
