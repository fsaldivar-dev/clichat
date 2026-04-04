import type { OutputParser, ParsedEvent } from "../types.js";

// Match ANSI escape sequences: CSI (ESC[ with optional DEC private mode ?/>/=),
// OSC (ESC] terminated by BEL or ST), charset designation, and simple escapes
const ANSI_RE = /\x1b\[[?>=]?[0-9;]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][AB012]|\x1b[=>]/g;

/** Strip all ANSI escape codes from a string */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * Generic ANSI-stripping parser that emits cleaned lines as raw messages.
 * Used as a base for provider-specific ANSI parsers.
 */
export class AnsiStripParser implements OutputParser {
  private buffer = "";

  feed(data: string): ParsedEvent[] {
    const clean = stripAnsi(data);
    this.buffer += clean;

    const events: ParsedEvent[] = [];
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      events.push({
        type: "message",
        role: "assistant",
        content: trimmed,
        metadata: { isStreaming: true },
      });
    }

    return events;
  }

  reset(): void {
    this.buffer = "";
  }
}

/**
 * State-machine based parser for CLIs with distinctive markers.
 * Subclass and override `classifyLine` for provider-specific parsing.
 */
export abstract class StateMachineParser implements OutputParser {
  protected buffer = "";
  protected currentBlock: { type: ParsedEvent["type"]; role: ParsedEvent["role"]; lines: string[] } | null = null;

  feed(data: string): ParsedEvent[] {
    const clean = stripAnsi(data);
    this.buffer += clean;

    const events: ParsedEvent[] = [];
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const classification = this.classifyLine(line);

      if (classification === "boundary") {
        // Flush current block
        if (this.currentBlock && this.currentBlock.lines.length > 0) {
          events.push({
            type: this.currentBlock.type,
            role: this.currentBlock.role,
            content: this.currentBlock.lines.join("\n"),
          });
        }
        this.currentBlock = null;
        continue;
      }

      if (classification) {
        // New block type — flush previous
        if (this.currentBlock && this.currentBlock.type !== classification.type) {
          if (this.currentBlock.lines.length > 0) {
            events.push({
              type: this.currentBlock.type,
              role: this.currentBlock.role,
              content: this.currentBlock.lines.join("\n"),
            });
          }
          this.currentBlock = null;
        }

        if (!this.currentBlock) {
          this.currentBlock = { type: classification.type, role: classification.role, lines: [] };
        }
        this.currentBlock.lines.push(line);
      }
    }

    return events;
  }

  reset(): void {
    this.buffer = "";
    this.currentBlock = null;
  }

  /**
   * Classify a single line.
   * Return null to skip, "boundary" to flush current block,
   * or { type, role } to accumulate into a block.
   */
  protected abstract classifyLine(
    line: string,
  ): { type: ParsedEvent["type"]; role: ParsedEvent["role"] } | "boundary" | null;
}
