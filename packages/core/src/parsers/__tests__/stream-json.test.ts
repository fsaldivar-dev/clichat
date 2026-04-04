import { describe, it, expect, beforeEach } from "vitest";
import { StreamJsonParser } from "../stream-json.js";

describe("StreamJsonParser", () => {
  let parser: StreamJsonParser;

  beforeEach(() => {
    parser = new StreamJsonParser();
  });

  it("parses text_delta events", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message");
    expect(events[0].content).toBe("Hello");
    expect(events[0].metadata?.isStreaming).toBe(true);
  });

  it("parses thinking_delta events", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "Let me consider..." },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("thinking");
    expect(events[0].content).toBe("Let me consider...");
  });

  it("parses input_json_delta events", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '{"key":' },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_use");
    expect(events[0].content).toBe('{"key":');
  });

  it("parses content_block_start with tool_use", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "content_block_start",
        content_block: { type: "tool_use", name: "read_file" },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_use");
    expect(events[0].metadata?.toolName).toBe("read_file");
  });

  it("parses message_stop events", () => {
    const events = parser.feed(
      JSON.stringify({ type: "message_stop" }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("status");
    expect(events[0].content).toBe("message_stop");
  });

  it("parses result events (--print mode)", () => {
    const events = parser.feed(
      JSON.stringify({ type: "result", result: "The answer is 42" }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message");
    expect(events[0].content).toBe("The answer is 42");
  });

  it("parses result events with content blocks", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "result",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("Hello world");
  });

  it("emits raw events for non-JSON lines", () => {
    const events = parser.feed("This is not JSON\n");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("raw");
    expect(events[0].content).toBe("This is not JSON");
  });

  it("buffers partial lines across multiple feeds", () => {
    const json = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hi" },
    });

    // Feed first half
    const events1 = parser.feed(json.slice(0, 20));
    expect(events1).toHaveLength(0);

    // Feed second half with newline
    const events2 = parser.feed(json.slice(20) + "\n");
    expect(events2).toHaveLength(1);
    expect(events2[0].content).toBe("Hi");
  });

  it("skips empty lines", () => {
    const events = parser.feed("\n\n\n");
    expect(events).toHaveLength(0);
  });

  it("handles delta without expected fields gracefully", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta" },
      }) + "\n",
    );

    // Should return null (no event) since delta.text is not a string
    expect(events).toHaveLength(0);
  });

  it("handles content_block_start with non-string name", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "content_block_start",
        content_block: { type: "tool_use", name: 123 },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].metadata?.toolName).toBe("unknown");
  });

  it("resets buffer state", () => {
    parser.feed("partial");
    parser.reset();
    const events = parser.feed("new line\n");
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("new line");
  });

  // ─── --verbose format (type: "assistant") ───────────────────────────

  it("parses --verbose assistant message with text", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_1",
          content: [{ type: "text", text: "Hello from verbose" }],
        },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message");
    expect(events[0].role).toBe("assistant");
    expect(events[0].content).toBe("Hello from verbose");
  });

  it("parses --verbose assistant with thinking block", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "thinking", thinking: "Let me think..." }],
        },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("thinking");
    expect(events[0].content).toBe("Let me think...");
  });

  it("parses --verbose assistant with tool_use block", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "read_file", input: { path: "/tmp" } }],
        },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_use");
    expect(events[0].metadata?.toolName).toBe("read_file");
    expect(events[0].content).toContain("/tmp");
  });

  it("parses --verbose assistant with multiple blocks (last text wins)", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "Final answer" },
          ],
        },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message");
    expect(events[0].content).toBe("Final answer");
  });

  it("handles --verbose assistant with empty content array", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "assistant",
        message: { content: [] },
      }) + "\n",
    );

    expect(events).toHaveLength(0);
  });

  it("handles --verbose assistant without message field", () => {
    const events = parser.feed(
      JSON.stringify({ type: "assistant" }) + "\n",
    );

    expect(events).toHaveLength(0);
  });
});
