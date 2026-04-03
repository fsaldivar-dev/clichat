import type { CLIProvider, SpawnConfig, SpawnOptions, ParsedEvent } from "../types.js";
import { StateMachineParser } from "../parsers/ansi-strip.js";
import { findBinary, buildFullPath } from "./utils.js";

/**
 * Parser for Gemini CLI output.
 * Gemini uses ✦ as its prompt marker and has distinctive output patterns.
 */
class GeminiParser extends StateMachineParser {
  private seenPrompt = false;

  protected classifyLine(
    line: string,
  ): { type: ParsedEvent["type"]; role: ParsedEvent["role"] } | "boundary" | null {
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) return null;

    // Gemini prompt marker (✦) — boundary between exchanges
    if (trimmed.startsWith("✦")) {
      this.seenPrompt = true;
      return "boundary";
    }

    // Spinner/loading patterns
    if (trimmed.match(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)) {
      return { type: "thinking", role: "assistant" };
    }

    // Tool use patterns
    if (trimmed.startsWith("Using tool:") || trimmed.startsWith("Tool:")) {
      return { type: "tool_use", role: "tool" };
    }

    // Default: assistant message content
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
 * Gemini CLI provider.
 * Uses ANSI parsing since Gemini CLI doesn't support structured JSON output.
 */
export const geminiProvider: CLIProvider = {
  id: "gemini",
  label: "Gemini CLI",
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
      useChildProcess: false, // Gemini needs PTY for interactive mode
    };
  },

  parser: new GeminiParser(),

  formatInput(text: string): string {
    return text + "\n";
  },
};
