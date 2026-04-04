import type { CLIProvider, SpawnConfig, SpawnOptions, ParsedEvent } from "../types.js";
import { StateMachineParser } from "../parsers/ansi-strip.js";
import { GeminiJsonParser } from "../parsers/gemini-json.js";
import { findBinary, buildFullPath } from "./utils.js";

/**
 * Parser for Gemini CLI ANSI output (interactive PTY mode).
 * Gemini uses ✦ as its prompt marker and has distinctive output patterns.
 */
class GeminiAnsiParser extends StateMachineParser {
  private seenPrompt = false;

  protected classifyLine(
    line: string,
  ): { type: ParsedEvent["type"]; role: ParsedEvent["role"] } | "boundary" | null {
    const trimmed = line.trim();

    if (!trimmed) return null;

    if (trimmed.startsWith("✦")) {
      this.seenPrompt = false;
      this.seenPrompt = true;
      return "boundary";
    }

    if (trimmed.match(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)) {
      return { type: "thinking", role: "assistant" };
    }

    if (trimmed.startsWith("Using tool:") || trimmed.startsWith("Tool:")) {
      return { type: "tool_use", role: "tool" };
    }

    if (this.seenPrompt) {
      return { type: "message", role: "assistant" };
    }

    return null;
  }

  override reset(): void {
    super.reset();
    this.seenPrompt = false;
  }
}

/**
 * Gemini CLI provider using per-message spawn with structured JSON output.
 * Each send() spawns `gemini -p "msg" --output-format stream-json`.
 * Uses `--resume latest` after the first message to maintain conversation context.
 */
export const geminiProvider: CLIProvider = {
  id: "gemini",
  label: "Gemini CLI",
  icon: "✦",

  async spawn(options: SpawnOptions): Promise<SpawnConfig> {
    return {
      command: "true",
      args: [],
      cwd: options.cwd,
      env: { ...options.env, PATH: buildFullPath() },
      useChildProcess: true,
    };
  },

  respawnOnSend(text: string, isFirst: boolean, options: SpawnOptions): SpawnConfig {
    const geminiBin = findBinary("gemini");
    const args = ["-p", text, "--output-format", "stream-json"];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.permissionMode) {
      args.push("--approval-mode", options.permissionMode);
    }

    if (!isFirst) {
      args.push("--resume", "latest");
    }

    return {
      command: geminiBin,
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

  parser: new GeminiJsonParser(),

  formatInput(text: string): string {
    return text + "\n";
  },
};

/**
 * Gemini CLI provider in interactive (PTY) mode.
 * Keeps a single long-lived process with raw ANSI output.
 * Requires node-pty for full terminal emulation.
 */
export const geminiInteractiveProvider: CLIProvider = {
  id: "gemini-interactive",
  label: "Gemini CLI (Interactive)",
  icon: "✦",

  async spawn(options: SpawnOptions): Promise<SpawnConfig> {
    const geminiBin = findBinary("gemini");
    return {
      command: geminiBin,
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

  parser: new GeminiAnsiParser(),

  formatInput(text: string): string {
    return text + "\n";
  },
};
