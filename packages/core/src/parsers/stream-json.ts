import type { OutputParser, ParsedEvent, ParsedEventType, MessageRole } from "../types.js";

/**
 * Parser for Claude CLI's `--output-format stream-json` mode.
 * Each line is a JSON object with a `type` field.
 *
 * Known event types from Claude CLI:
 * - message_start, content_block_start, content_block_delta,
 *   content_block_stop, message_delta, message_stop
 * - result (for --print mode with structured output)
 */
export class StreamJsonParser implements OutputParser {
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
        const parsed = this.parseJsonEvent(json);
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

  private parseJsonEvent(json: Record<string, unknown>): ParsedEvent | null {
    const type = json.type as string;

    switch (type) {
      // Claude stream-json events
      case "content_block_delta": {
        const delta = json.delta as Record<string, unknown> | undefined;
        if (!delta) return null;

        if (delta.type === "text_delta") {
          return {
            type: "message",
            role: "assistant",
            content: delta.text as string,
            metadata: { isStreaming: true },
          };
        }
        if (delta.type === "thinking_delta") {
          return {
            type: "thinking",
            role: "assistant",
            content: delta.thinking as string,
            metadata: { isStreaming: true },
          };
        }
        if (delta.type === "input_json_delta") {
          return {
            type: "tool_use",
            role: "tool",
            content: delta.partial_json as string,
            metadata: { isStreaming: true },
          };
        }
        return null;
      }

      case "content_block_start": {
        const block = json.content_block as Record<string, unknown> | undefined;
        if (!block) return null;

        if (block.type === "tool_use") {
          return {
            type: "tool_use",
            role: "tool",
            content: "",
            metadata: {
              toolName: block.name as string,
              isStreaming: true,
            },
          };
        }
        return null;
      }

      case "content_block_stop":
        return {
          type: "status",
          role: "system",
          content: "block_complete",
        };

      case "message_start":
        return {
          type: "status",
          role: "system",
          content: "message_start",
        };

      case "message_delta": {
        const delta = json.delta as Record<string, unknown> | undefined;
        if (delta?.stop_reason === "tool_use") {
          return { type: "status", role: "system", content: "awaiting_tool_result" };
        }
        return { type: "status", role: "system", content: "message_delta" };
      }

      case "message_stop":
        return {
          type: "status",
          role: "system",
          content: "message_stop",
        };

      // Claude --print mode result
      case "result": {
        const result = json.result as string | undefined;
        if (result) {
          return {
            type: "message",
            role: "assistant",
            content: result,
          };
        }
        // Subresult with content blocks
        const content = json.content as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(content)) {
          const text = content
            .filter((b) => b.type === "text")
            .map((b) => b.text as string)
            .join("");
          if (text) {
            return { type: "message", role: "assistant", content: text };
          }
        }
        return null;
      }

      default:
        return null;
    }
  }
}

/** Map Claude stream-json event type to our ParsedEventType */
function mapEventType(type: string): ParsedEventType {
  switch (type) {
    case "text":
    case "text_delta":
      return "message";
    case "thinking":
    case "thinking_delta":
      return "thinking";
    case "tool_use":
    case "input_json_delta":
      return "tool_use";
    case "tool_result":
      return "tool_result";
    default:
      return "status";
  }
}
