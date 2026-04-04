import { describe, it, expect, beforeEach } from "vitest";
import { stripAnsi, AnsiStripParser } from "../ansi-strip.js";

describe("stripAnsi", () => {
  it("strips CSI sequences", () => {
    expect(stripAnsi("\x1b[31mred text\x1b[0m")).toBe("red text");
  });

  it("strips bold/underline sequences", () => {
    expect(stripAnsi("\x1b[1mbold\x1b[22m")).toBe("bold");
  });

  it("strips cursor movement", () => {
    expect(stripAnsi("\x1b[2Aup two lines")).toBe("up two lines");
  });

  it("strips OSC sequences (BEL terminated)", () => {
    expect(stripAnsi("\x1b]0;Window Title\x07content")).toBe("content");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("Hello, world!")).toBe("Hello, world!");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("strips charset designation sequences", () => {
    expect(stripAnsi("\x1b(Btext\x1b)0")).toBe("text");
  });
});

describe("AnsiStripParser", () => {
  let parser: AnsiStripParser;

  beforeEach(() => {
    parser = new AnsiStripParser();
  });

  it("parses clean lines as streaming messages", () => {
    const events = parser.feed("Hello world\n");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message");
    expect(events[0].role).toBe("assistant");
    expect(events[0].content).toBe("Hello world");
    expect(events[0].metadata?.isStreaming).toBe(true);
  });

  it("strips ANSI before emitting", () => {
    const events = parser.feed("\x1b[32mGreen text\x1b[0m\n");

    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("Green text");
  });

  it("buffers partial lines", () => {
    const events1 = parser.feed("Hello ");
    expect(events1).toHaveLength(0);

    const events2 = parser.feed("world\n");
    expect(events2).toHaveLength(1);
    expect(events2[0].content).toBe("Hello world");
  });

  it("skips empty lines", () => {
    const events = parser.feed("\n\n\n");
    expect(events).toHaveLength(0);
  });

  it("resets buffer state", () => {
    parser.feed("partial");
    parser.reset();
    const events = parser.feed("fresh\n");
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("fresh");
  });
});
