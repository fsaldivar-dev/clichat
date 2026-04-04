import type { OutputParser, ParsedEvent } from "../types.js";

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

        if (delta.type === "text_delta" && typeof delta.text === "string") {
          return {
            type: "message",
            role: "assistant",
            content: delta.text,
            metadata: { isStreaming: true },
          };
        }
        if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
          return {
            type: "thinking",
            role: "assistant",
            content: delta.thinking,
            metadata: { isStreaming: true },
          };
        }
        if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          return {
            type: "tool_use",
            role: "tool",
            content: delta.partial_json,
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
              toolName: typeof block.name === "string" ? block.name : "unknown",
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

      // Claude --verbose format: full assistant message with content blocks
      case "assistant": {
        const message = json.message as Record<string, unknown> | undefined;
        if (!message) return null;
        const content = message.content as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(content)) return null;

        // Return the last meaningful block (text > tool_use > thinking)
        for (let i = content.length - 1; i >= 0; i--) {
          const block = content[i];
          if (block.type === "text" && typeof block.text === "string") {
            return { type: "message", role: "assistant", content: block.text };
          }
          if (block.type === "tool_use") {
            return {
              type: "tool_use",
              role: "tool",
              content: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? ""),
              metadata: { toolName: typeof block.name === "string" ? block.name : "unknown" },
            };
          }
          if (block.type === "thinking" && typeof block.thinking === "string") {
            return { type: "thinking", role: "assistant", content: block.thinking };
          }
        }
        return null;
      }

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
            .filter((b) => b.type === "text" && typeof b.text === "string")
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
