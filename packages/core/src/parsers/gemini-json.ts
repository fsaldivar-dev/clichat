import type { OutputParser, ParsedEvent } from "../types.js";

/**
 * Parser for Gemini CLI's `--output-format stream-json` mode.
 * Each line is a JSON object with a `type` field.
 *
 * Known event types from Gemini CLI:
 * - init (session info, model name)
 * - message (role: user | assistant, with delta flag for streaming)
 * - result (status: success | error, with stats)
 */
export class GeminiJsonParser implements OutputParser {
  private buffer = "";

  feed(data: string): ParsedEvent[] {
    this.buffer += data;
    const events: ParsedEvent[] = [];
    const lines = this.buffer.split("\n");

    // Keep incomplete last line in buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const json = JSON.parse(trimmed);
        const parsed = this.parseGeminiEvent(json);
        if (parsed) events.push(parsed);
      } catch {
        // Non-JSON line — emit as raw
        events.push({
          type: "raw",
          role: "system",
          content: trimmed,
        });
      }
    }

    return events;
  }

  reset(): void {
    this.buffer = "";
  }

  private parseGeminiEvent(json: Record<string, unknown>): ParsedEvent | null {
    const type = json.type as string;

    switch (type) {
      case "message": {
        const role = json.role as string;
        const content = json.content;

        // Skip user echo messages
        if (role === "user") return null;

        if (role === "assistant" && typeof content === "string") {
          return {
            type: "message",
            role: "assistant",
            content,
            metadata: { isStreaming: json.delta === true },
          };
        }
        return null;
      }

      case "result": {
        return {
          type: "status",
          role: "system",
          content: "message_stop",
        };
      }

      case "init":
        // Session initialization — ignore
        return null;

      case "tool_call": {
        const name = json.name as string | undefined;
        return {
          type: "tool_use",
          role: "tool",
          content: typeof json.args === "string" ? json.args : JSON.stringify(json.args ?? ""),
          metadata: { toolName: name ?? "unknown" },
        };
      }

      case "tool_result": {
        return {
          type: "tool_result",
          role: "tool",
          content: typeof json.output === "string" ? json.output : JSON.stringify(json.output ?? ""),
        };
      }

      default:
        return null;
    }
  }
}
