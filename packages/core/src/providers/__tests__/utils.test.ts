import { describe, it, expect } from "vitest";
import { findBinary, buildFullPath } from "../utils.js";

describe("findBinary", () => {
  it("finds a known binary", () => {
    const result = findBinary("node");
    expect(result).toMatch(/node/);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns the name as-is for unknown binaries", () => {
    const result = findBinary("nonexistent-binary-xyz-123");
    expect(result).toBe("nonexistent-binary-xyz-123");
  });

  it("handles names with special characters gracefully", () => {
    // Should not throw — just return the name if binary is not found
    const result = findBinary("some-cli-tool");
    expect(typeof result).toBe("string");
  });
});

describe("buildFullPath", () => {
  it("returns a colon-separated path string", () => {
    const path = buildFullPath();
    expect(path).toContain("/opt/homebrew/bin");
    expect(path).toContain("/usr/local/bin");
    expect(path.split(":").length).toBeGreaterThan(2);
  });

  it("includes the current process PATH", () => {
    const path = buildFullPath();
    if (process.env.PATH) {
      expect(path).toContain(process.env.PATH);
    }
  });
});
