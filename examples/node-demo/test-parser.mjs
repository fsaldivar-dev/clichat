/**
 * Test rápido de los parsers — no requiere CLIs instalados
 *
 * Uso: node examples/node-demo/test-parser.mjs
 */

import { StreamJsonParser, AnsiStripParser, stripAnsi } from "@clichat/core";

console.log("═══ clichat parser tests ═══\n");

// ─── Test 1: StreamJsonParser (Claude structured output) ─────────────────────

console.log("1. StreamJsonParser (Claude --output-format stream-json)");
console.log("─".repeat(50));

const jsonParser = new StreamJsonParser();

const claudeEvents = [
  '{"type":"message_start","message":{"id":"msg_01","role":"assistant"}}',
  '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world!"}}',
  '{"type":"content_block_stop","index":0}',
  '{"type":"message_stop"}',
].join("\n") + "\n";

const parsed = jsonParser.feed(claudeEvents);
for (const event of parsed) {
  console.log(`  ${event.type.padEnd(12)} | ${event.role.padEnd(10)} | "${event.content}"`);
}
console.log(`  → ${parsed.length} events parsed ✓\n`);

// ─── Test 2: StreamJsonParser with thinking ──────────────────────────────────

console.log("2. StreamJsonParser with thinking blocks");
console.log("─".repeat(50));

jsonParser.reset();

const thinkingEvents = [
  '{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me analyze..."}}',
  '{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Here is my answer."}}',
  '{"type":"message_stop"}',
].join("\n") + "\n";

const parsed2 = jsonParser.feed(thinkingEvents);
for (const event of parsed2) {
  console.log(`  ${event.type.padEnd(12)} | ${event.role.padEnd(10)} | "${event.content}"`);
}
console.log(`  → ${parsed2.length} events parsed ✓\n`);

// ─── Test 3: StreamJsonParser with tool use ──────────────────────────────────

console.log("3. StreamJsonParser with tool use");
console.log("─".repeat(50));

jsonParser.reset();

const toolEvents = [
  '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_01","name":"read_file"}}',
  '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"/src"}}',
  '{"type":"content_block_stop","index":0}',
].join("\n") + "\n";

const parsed3 = jsonParser.feed(toolEvents);
for (const event of parsed3) {
  const meta = event.metadata?.toolName ? ` (tool: ${event.metadata.toolName})` : "";
  console.log(`  ${event.type.padEnd(12)} | ${event.role.padEnd(10)} | "${event.content}"${meta}`);
}
console.log(`  → ${parsed3.length} events parsed ✓\n`);

// ─── Test 4: ANSI stripping ─────────────────────────────────────────────────

console.log("4. ANSI strip utility");
console.log("─".repeat(50));

const ansiText = "\x1b[1m\x1b[32mHello\x1b[0m \x1b[36mWorld\x1b[0m \x1b[90m(muted)\x1b[0m";
const stripped = stripAnsi(ansiText);
console.log(`  Input:    "${ansiText}"`);
console.log(`  Stripped: "${stripped}"`);
console.log(`  Match: ${stripped === "Hello World (muted)" ? "✓" : "✗"}\n`);

// ─── Test 5: AnsiStripParser ─────────────────────────────────────────────────

console.log("5. AnsiStripParser (Gemini/generic fallback)");
console.log("─".repeat(50));

const ansiParser = new AnsiStripParser();

const ansiOutput = [
  "\x1b[1m✦\x1b[0m Welcome to Gemini CLI\n",
  "\x1b[33mThinking...\x1b[0m\n",
  "Here is the answer to your question.\n",
  "It has multiple lines.\n",
].join("");

const parsed5 = ansiParser.feed(ansiOutput);
for (const event of parsed5) {
  console.log(`  ${event.type.padEnd(12)} | "${event.content}"`);
}
console.log(`  → ${parsed5.length} events parsed ✓\n`);

// ─── Test 6: Partial data (streaming simulation) ────────────────────────────

console.log("6. Partial data handling (streaming)");
console.log("─".repeat(50));

const streamParser = new StreamJsonParser();

// Simulate data arriving in chunks
const chunk1 = '{"type":"content_block_del';
const chunk2 = 'ta","index":0,"delta":{"type":"text_delta","text":"Hel';
const chunk3 = 'lo"}}\n{"type":"message_stop"}\n';

const r1 = streamParser.feed(chunk1);
console.log(`  Chunk 1: ${r1.length} events (buffering...)`);

const r2 = streamParser.feed(chunk2);
console.log(`  Chunk 2: ${r2.length} events (still buffering...)`);

const r3 = streamParser.feed(chunk3);
console.log(`  Chunk 3: ${r3.length} events (flushed!)`);
for (const event of r3) {
  console.log(`    → ${event.type}: "${event.content}"`);
}
console.log("");

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("═══ All parser tests passed ✓ ═══");
