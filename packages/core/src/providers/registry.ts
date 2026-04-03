import type { CLIProvider } from "../types.js";
import { claudeProvider, claudeInteractiveProvider } from "./claude.js";
import { geminiProvider } from "./gemini.js";
import { shellProvider } from "./shell.js";

const providers = new Map<string, CLIProvider>();

/** Register a CLI provider */
export function registerProvider(provider: CLIProvider): void {
  providers.set(provider.id, provider);
}

/** Get a provider by ID */
export function getProvider(id: string): CLIProvider | undefined {
  return providers.get(id);
}

/** Get all registered providers */
export function getProviders(): CLIProvider[] {
  return [...providers.values()];
}

// Register built-in providers
registerProvider(claudeProvider);
registerProvider(claudeInteractiveProvider);
registerProvider(geminiProvider);
registerProvider(shellProvider);
