#!/usr/bin/env node
/**
 * Integration test for all 3 providers after bug fixes.
 */
import { ChatSession, claudeProvider, shellProvider, geminiProvider, NodePTYBackend } from "@clichat/core";

const TIMEOUT = 45_000;

async function testProvider(name, provider, message) {
  const t0 = performance.now();
  console.log(`▶ Testing ${name}...`);

  try {
    const backend = new NodePTYBackend();
    const session = new ChatSession({ provider, backend, cwd: process.cwd() });

    let rawBytes = 0;
    session.on("raw", (d) => rawBytes += d.length);

    await session.start();
    const startMs = Math.round(performance.now() - t0);

    session.send(message);

    // Wait for response
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ status: "TIMEOUT" }), TIMEOUT);

      // Track assistant messages
      let lastAssistantContent = "";
      let idleAfterWork = false;

      session.on("message", (msg) => {
        if (msg.role === "assistant" && msg.content.length > 0) {
          lastAssistantContent = msg.content;
        }
      });

      session.on("status", (s) => {
        if (s === "responding" || s === "thinking") idleAfterWork = true;
        if (s === "idle" && idleAfterWork) {
          clearTimeout(timer);
          setTimeout(() => resolve({ status: "OK", content: lastAssistantContent }), 300);
        }
      });

      session.on("exit", (code) => {
        clearTimeout(timer);
        resolve({ status: "EXIT", code, content: lastAssistantContent });
      });
    });

    const totalMs = Math.round(performance.now() - t0);
    const assistantMsgs = session.messages.filter((m) => m.role === "assistant");

    await session.destroy();

    const icon = result.status === "TIMEOUT" ? "⚠" : assistantMsgs.length > 0 ? "✓" : "✗";
    console.log(`  ${icon} [${result.status}] ${startMs}ms start, ${totalMs}ms total, ${rawBytes}B raw, ${assistantMsgs.length} assistant msgs`);
    if (result.content) console.log(`  Response: ${result.content.slice(0, 200)}`);
    return { name, pass: assistantMsgs.length > 0, totalMs, rawBytes };
  } catch (err) {
    const totalMs = Math.round(performance.now() - t0);
    console.log(`  ✗ ERROR: ${err.message} (${totalMs}ms)`);
    return { name, pass: false, totalMs, error: err.message };
  }
}

console.log("╔══════════════════════════════════════════════╗");
console.log("║   clichat Integration Tests (all providers) ║");
console.log("╚══════════════════════════════════════════════╝\n");

const results = [];

// Shell
results.push(await testProvider("Shell", shellProvider, "echo 'SHELL_TEST_OK' && echo DONE"));
console.log();

// Claude
results.push(await testProvider("Claude", claudeProvider, "Reply with only: CLAUDE_TEST_OK"));
console.log();

// Gemini
results.push(await testProvider("Gemini", geminiProvider, "Reply with only: GEMINI_TEST_OK"));
console.log();

// Summary
console.log("━━━ Summary ━━━");
for (const r of results) {
  console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}: ${r.pass ? "PASS" : "FAIL"} (${r.totalMs}ms)`);
}
const passCount = results.filter((r) => r.pass).length;
console.log(`\n  ${passCount}/${results.length} providers working\n`);

process.exit(passCount === results.length ? 0 : 1);
