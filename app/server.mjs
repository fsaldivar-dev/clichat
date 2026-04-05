#!/usr/bin/env node
/**
 * Backend server for clichat React app.
 * Proxies browser requests to CLI tools via the clichat library.
 */
import { createServer } from "node:http";
import { claude, gemini } from "../dist/index.js";

const PORT = 3001;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// Session storage (in-memory)
const sessions = {};

const providers = { claude, gemini };

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  try {
    // POST /chat — send a message
    if (req.method === "POST" && req.url === "/chat") {
      const { provider, prompt, sessionId, options } = await readBody(req);
      const fn = providers[provider];
      if (!fn) return json(res, { error: `Unknown provider: ${provider}` }, 400);

      // Use session if sessionId provided
      if (sessionId && sessions[sessionId]) {
        const r = await sessions[sessionId].send(prompt);
        return json(res, r);
      }

      const r = await fn(prompt, options);
      return json(res, r);
    }

    // POST /session — create a new session
    if (req.method === "POST" && req.url === "/session") {
      const { provider, options } = await readBody(req);
      const fn = providers[provider];
      if (!fn) return json(res, { error: `Unknown provider: ${provider}` }, 400);

      const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      sessions[id] = fn.session(options);
      return json(res, { sessionId: id });
    }

    // POST /stream — streaming response (SSE)
    if (req.method === "POST" && req.url === "/stream") {
      const { provider, prompt, options } = await readBody(req);
      const fn = providers[provider];
      if (!fn) return json(res, { error: `Unknown provider: ${provider}` }, 400);

      cors(res);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      for await (const chunk of fn.stream(prompt, options)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    json(res, { error: "Not found" }, 404);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`clichat server running on http://localhost:${PORT}`);
  console.log("Endpoints: POST /chat, POST /session, POST /stream");
});
