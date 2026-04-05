import { describe, it, expect } from "vitest";
import { gemini } from "../src/gemini.js";

describe("gemini", () => {
  it("sends a prompt and gets a response", async () => {
    const r = await gemini("Reply with only the word PONG");
    expect(r.provider).toBe("gemini");
    expect(r.text.toLowerCase()).toContain("pong");
  }, 30000);

  it("streams a response", async () => {
    const chunks: string[] = [];
    for await (const chunk of gemini.stream("Reply with only: STREAM_OK")) {
      if (chunk.type === "text") chunks.push(chunk.text);
      if (chunk.type === "done") break;
    }
    expect(chunks.length).toBeGreaterThan(0);
  }, 30000);
});
