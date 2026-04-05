import { describe, it, expect } from "vitest";
import { run, parseJSON } from "../src/spawn.js";

describe("spawn", () => {
  it("runs a command and captures stdout", async () => {
    const result = await run("echo", ["hello world"]);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.code).toBe(0);
  });

  it("captures stderr", async () => {
    const result = await run("ls", ["nonexistent-file-xyz"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("handles command not found", async () => {
    const result = await run("nonexistent-command-xyz", []);
    expect(result.code).toBe(1);
  });

  it("passes environment variables", async () => {
    const result = await run("env", [], { env: { CLICHAT_TEST: "yes" } });
    expect(result.stdout).toContain("CLICHAT_TEST=yes");
  });
});

describe("parseJSON", () => {
  it("parses valid JSON", () => {
    expect(parseJSON('{"type":"test"}')).toEqual({ type: "test" });
  });

  it("returns null for invalid JSON", () => {
    expect(parseJSON("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseJSON("")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseJSON('  {"a":1}  ')).toEqual({ a: 1 });
  });
});
