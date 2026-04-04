import { describe, it, expect, beforeEach } from "vitest";
import { GeminiJsonParser } from "../gemini-json.js";

describe("GeminiJsonParser", () => {
  let parser: GeminiJsonParser;

  beforeEach(() => {
    parser = new GeminiJsonParser();
  });

  it("parses assistant message events", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: "Hello from Gemini",
        delta: true,
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message");
    expect(events[0].role).toBe("assistant");
    expect(events[0].content).toBe("Hello from Gemini");
    expect(events[0].metadata?.isStreaming).toBe(true);
  });

  it("skips user echo messages", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "message",
        role: "user",
        content: "My question",
      }) + "\n",
    );

    expect(events).toHaveLength(0);
  });

  it("parses result events as message_stop", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "result",
        status: "success",
        stats: { total_tokens: 100 },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("status");
    expect(events[0].content).toBe("message_stop");
  });

  it("ignores init events", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "init",
        session_id: "abc-123",
        model: "gemini-3-flash-preview",
      }) + "\n",
    );

    expect(events).toHaveLength(0);
  });

  it("parses tool_call events", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "tool_call",
        name: "read_file",
        args: { path: "/tmp/test.txt" },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_use");
    expect(events[0].metadata?.toolName).toBe("read_file");
    expect(events[0].content).toContain("/tmp/test.txt");
  });

  it("parses tool_result events", () => {
    const events = parser.feed(
      JSON.stringify({
        type: "tool_result",
        output: "file contents here",
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_result");
    expect(events[0].content).toBe("file contents here");
  });

  it("buffers partial lines", () => {
    const json = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "Hi",
      delta: true,
    });

    const events1 = parser.feed(json.slice(0, 15));
    expect(events1).toHaveLength(0);

    const events2 = parser.feed(json.slice(15) + "\n");
    expect(events2).toHaveLength(1);
    expect(events2[0].content).toBe("Hi");
  });

  it("emits raw events for non-JSON lines", () => {
    const events = parser.feed("Loaded cached credentials.\n");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("raw");
  });

  it("handles full Gemini stream sequence", () => {
    const stream = [
      '{"type":"init","session_id":"abc","model":"gemini-3-flash-preview"}',
      '{"type":"message","role":"user","content":"Hello"}',
      '{"type":"message","role":"assistant","content":"Hi there!","delta":true}',
      '{"type":"result","status":"success","stats":{"total_tokens":100}}',
    ].join("\n") + "\n";

    const events = parser.feed(stream);

    // init → skip, user → skip, assistant → message, result → status
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("message");
    expect(events[0].content).toBe("Hi there!");
    expect(events[1].type).toBe("status");
    expect(events[1].content).toBe("message_stop");
  });

  it("resets buffer state", () => {
    parser.feed("partial");
    parser.reset();
    const events = parser.feed(
      JSON.stringify({ type: "message", role: "assistant", content: "fresh" }) + "\n",
    );
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("fresh");
  });
});
