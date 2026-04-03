/**
 * @clichat/plugin-mcp - MCP context plugin
 *
 * Auto-configures MCP servers for AI CLIs before session start.
 * Extracted from kuilo's electron/main.cjs:856-879.
 *
 * Usage:
 *   import { createMCPPlugin } from "@clichat/plugin-mcp";
 *   const plugin = createMCPPlugin({
 *     name: "my-server",
 *     command: "node",
 *     args: ["/path/to/mcp-server.js", "/path/to/data"],
 *   });
 */

import type { ChatPlugin, CLIProvider, SpawnOptions, ChatSessionEvents } from "@clichat/core";
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

export interface MCPServerConfig {
  /** Unique name for this MCP server */
  name: string;
  /** Command to run the MCP server */
  command: string;
  /** Arguments for the command */
  args: string[];
}

export interface MCPPluginOptions extends MCPServerConfig {
  /** Custom configurators per provider (override defaults) */
  configurators?: Record<string, MCPConfigurator>;
}

export type MCPConfigurator = (
  server: MCPServerConfig,
  provider: CLIProvider,
  options: SpawnOptions,
) => Promise<void> | void;

// ─── Built-in Configurators ──────────────────────────────────────────────────

/**
 * Configure MCP for Claude CLI by writing to ~/.claude.json
 * Extracted from kuilo's main.cjs:864-873
 */
async function configureClaude(server: MCPServerConfig): Promise<void> {
  const configPath = join(homedir(), ".claude.json");
  let config: Record<string, unknown> = {};

  try {
    const raw = await readFile(configPath, "utf8");
    config = JSON.parse(raw);
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }

  (config.mcpServers as Record<string, unknown>)[server.name] = {
    command: server.command,
    args: server.args,
  };

  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Configure MCP for Gemini CLI by running `gemini mcp add`
 * Extracted from kuilo's main.cjs:857-860
 */
function configureGemini(server: MCPServerConfig): void {
  const env = { ...process.env, PATH: buildPath() };

  // Remove existing, then add
  try {
    execSync(`gemini mcp remove ${server.name} --scope user 2>/dev/null`, {
      stdio: "ignore",
      env,
    });
  } catch {}

  try {
    const args = server.args.map((a) => `"${a}"`).join(" ");
    execSync(
      `gemini mcp add ${server.name} ${server.command} --scope user -- ${args}`,
      { stdio: "ignore", env },
    );
  } catch (e) {
    console.error(`[clichat/plugin-mcp] Gemini MCP add failed:`, e);
  }
}

function buildPath(): string {
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local/bin"),
    process.env.PATH ?? "",
  ].join(":");
}

// ─── Default configurator map ────────────────────────────────────────────────

const DEFAULT_CONFIGURATORS: Record<string, MCPConfigurator> = {
  claude: (server) => configureClaude(server),
  "claude-interactive": (server) => configureClaude(server),
  gemini: (server) => configureGemini(server),
};

// ─── Plugin Factory ──────────────────────────────────────────────────────────

/**
 * Create an MCP plugin that auto-configures MCP servers for supported CLIs.
 */
export function createMCPPlugin(options: MCPPluginOptions): ChatPlugin {
  const server: MCPServerConfig = {
    name: options.name,
    command: options.command,
    args: options.args,
  };

  const configurators = { ...DEFAULT_CONFIGURATORS, ...options.configurators };

  return {
    id: `mcp-${options.name}`,
    name: `MCP: ${options.name}`,

    async configureProvider(provider: CLIProvider, spawnOptions: SpawnOptions) {
      const configurator = configurators[provider.id];
      if (configurator) {
        await configurator(server, provider, spawnOptions);
      }
      return spawnOptions;
    },
  };
}

// Re-export types
export type { ChatPlugin, CLIProvider, SpawnOptions } from "@clichat/core";
