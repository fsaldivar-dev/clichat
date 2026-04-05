#!/usr/bin/env node
import { claude, gemini } from "./dist/index.js";

const provider = process.argv[2] || "claude";
const prompt = process.argv.slice(3).join(" ") || "Hola! Que puedes hacer?";

console.log(`\n🤖 ${provider} | "${prompt}"\n`);

if (provider === "claude") {
  const r = await claude(prompt);
  console.log(r.text);
  console.log(`\n📊 ${r.model} | ${r.usage?.duration}ms | $${r.usage?.cost?.toFixed(4) ?? "?"}`);

} else if (provider === "gemini") {
  const r = await gemini(prompt);
  console.log(r.text);
  console.log(`\n📊 ${r.model} | ${r.usage?.duration}ms`);

} else if (provider === "stream") {
  // Streaming demo
  const ai = process.argv[3] || "claude";
  const msg = process.argv.slice(4).join(" ") || "Cuéntame un chiste";
  console.log(`Streaming ${ai}...\n`);

  const fn = ai === "gemini" ? gemini : claude;
  for await (const chunk of fn.stream(msg)) {
    if (chunk.type === "text") process.stdout.write(chunk.text);
    if (chunk.type === "thinking") process.stdout.write(`\n💭 ${chunk.text}\n`);
    if (chunk.type === "done") console.log("\n\n✅ Done");
  }

} else if (provider === "chat") {
  // Session demo (conversación con contexto)
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));

  const ai = process.argv[3] || "claude";
  const fn = ai === "gemini" ? gemini : claude;
  const chat = fn.session();

  console.log(`Chat con ${ai} (escribe "exit" para salir)\n`);

  while (true) {
    const input = await ask("Tú > ");
    if (input === "exit") break;

    console.log(`\n${ai} > `);
    const r = await chat.send(input);
    console.log(r.text);
    console.log();
  }

  rl.close();

} else {
  console.log("Uso:");
  console.log("  node demo.mjs claude 'tu pregunta'");
  console.log("  node demo.mjs gemini 'tu pregunta'");
  console.log("  node demo.mjs stream claude 'tu pregunta'");
  console.log("  node demo.mjs chat claude");
  console.log("  node demo.mjs chat gemini");
}
