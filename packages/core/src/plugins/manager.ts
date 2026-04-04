import type { ChatPlugin, ChatMessage, ChatSessionEvents, CLIProvider, SpawnOptions } from "../types.js";

export class PluginManager {
  private plugins: ChatPlugin[] = [];

  constructor(plugins: ChatPlugin[] = []) {
    this.plugins = [...plugins];
  }

  /** Run all plugin onSessionStart hooks */
  async onSessionStart(session: ChatSessionEvents): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.onSessionStart?.(session);
      } catch (err) {
        console.warn(`[clichat] plugin "${plugin.id}" onSessionStart failed:`, err);
      }
    }
  }

  /** Run all plugin onSessionEnd hooks */
  async onSessionEnd(session: ChatSessionEvents): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.onSessionEnd?.(session);
      } catch (err) {
        console.warn(`[clichat] plugin "${plugin.id}" onSessionEnd failed:`, err);
      }
    }
  }

  /** Run all plugin configureProvider hooks, chaining the options */
  async configureProvider(
    provider: CLIProvider,
    options: SpawnOptions,
  ): Promise<SpawnOptions> {
    let result = options;
    for (const plugin of this.plugins) {
      if (plugin.configureProvider) {
        try {
          result = await plugin.configureProvider(provider, result);
        } catch (err) {
          console.warn(`[clichat] plugin "${plugin.id}" configureProvider failed:`, err);
        }
      }
    }
    return result;
  }

  /** Run all plugin transformMessage hooks, chaining the message */
  transformMessage(message: ChatMessage): ChatMessage {
    let result = message;
    for (const plugin of this.plugins) {
      if (plugin.transformMessage) {
        try {
          result = plugin.transformMessage(result);
        } catch (err) {
          console.warn(`[clichat] plugin "${plugin.id}" transformMessage failed:`, err);
        }
      }
    }
    return result;
  }
}
