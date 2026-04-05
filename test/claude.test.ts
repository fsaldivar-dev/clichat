import { describe, it, expect } from "vitest";
import { claude } from "../src/claude.js";

describe("claude", () => {
  it("sends a prompt and gets a response", async () => {
    const r = await claude("Reply with only the word PONG", { model: "sonnet" });
    expect(r.provider).toBe("claude");
    expect(r.text.toLowerCase()).toContain("pong");
  }, 30000);

  it("streams a response", async () => {
    const chunks: string[] = [];
    for await (const chunk of claude.stream("Reply with only: STREAM_OK")) {
      if (chunk.type === "text") chunks.push(chunk.text);
      if (chunk.type === "done") break;
    }
    expect(chunks.length).toBeGreaterThan(0);
  }, 30000);

  it("creates a session with context", async () => {
    const chat = claude.session({ model: "sonnet" });
    const r1 = await chat.send("Remember: the secret word is BANANA");
    expect(r1.provider).toBe("claude");

    const r2 = await chat.send("What is the secret word?");
    expect(r2.text.toLowerCase()).toContain("banana");
  }, 60000);
});
