/**
 * clichat demo — prueba rápida desde Node.js
 *
 * Uso:
 *   node examples/node-demo/demo.mjs               # usa Claude por defecto
 *   node examples/node-demo/demo.mjs --provider gemini
 *   node examples/node-demo/demo.mjs --provider shell
 */

import { ChatSession, claudeProvider, geminiProvider, shellProvider, NodePTYBackend } from "@clichat/core";
import { createInterface } from "node:readline";

// ─── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const providerFlag = args.includes("--provider")
  ? args[args.indexOf("--provider") + 1]
  : "claude";

const providers = {
  claude: claudeProvider,
  gemini: geminiProvider,
  shell: shellProvider,
};

const provider = providers[providerFlag];
if (!provider) {
  console.error(`Provider desconocido: ${providerFlag}`);
  console.error(`Opciones: ${Object.keys(providers).join(", ")}`);
  process.exit(1);
}

// ─── Create session ──────────────────────────────────────────────────────────

console.log(`\n🔌 clichat demo — provider: ${provider.label} (${provider.id})`);
console.log("─".repeat(50));

const session = new ChatSession({
  provider,
  backend: new NodePTYBackend(),
  cwd: process.cwd(),
});

// ─── Listen to events ────────────────────────────────────────────────────────

session.on("message", (msg) => {
  const prefix =
    msg.role === "user" ? "\x1b[36mYou\x1b[0m" :
    msg.role === "assistant" ? "\x1b[33mAI\x1b[0m" :
    msg.role === "tool" ? "\x1b[35mTool\x1b[0m" :
    "\x1b[90mSystem\x1b[0m";

  const typeTag = msg.type !== "message" ? ` [${msg.type}]` : "";
  const streaming = msg.metadata?.isStreaming ? " ..." : "";

  // Only print complete messages (not streaming deltas) to avoid spam
  if (!msg.metadata?.isStreaming) {
    console.log(`\n${prefix}${typeTag}: ${msg.content}${streaming}`);
  }
});

session.on("status", (status) => {
  if (status === "thinking") {
    process.stdout.write("\x1b[90m⏳ Thinking...\x1b[0m");
  } else if (status === "responding") {
    process.stdout.write("\r\x1b[K"); // clear thinking line
  } else if (status === "tool_use") {
    process.stdout.write("\n\x1b[35m🔧 Using tools...\x1b[0m");
  } else if (status === "idle") {
    process.stdout.write("\r\x1b[K");
  }
});

session.on("exit", (code) => {
  console.log(`\n\x1b[90m[Session ended with code ${code}]\x1b[0m`);
  process.exit(0);
});

// ─── Start and read input ────────────────────────────────────────────────────

await session.start();
console.log(`\x1b[32m✓ Session started\x1b[0m`);
console.log(`Escribe un mensaje (Ctrl+C para salir):\n`);

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

rl.prompt();

rl.on("line", (line) => {
  const text = line.trim();
  if (!text) {
    rl.prompt();
    return;
  }
  session.send(text);
  // Wait a bit before re-prompting (let response come in)
  setTimeout(() => rl.prompt(), 500);
});

rl.on("close", async () => {
  console.log("\n\x1b[90mCerrando session...\x1b[0m");
  await session.destroy();
  process.exit(0);
});

// Handle Ctrl+C gracefully
process.on("SIGINT", async () => {
  session.abort();
  // Second Ctrl+C exits
  process.once("SIGINT", async () => {
    await session.destroy();
    process.exit(0);
  });
});
