import type { ChatPlugin, ChatMessage, ChatSessionEvents, CLIProvider, SpawnOptions } from "../types.js";

export class PluginManager {
  private plugins: ChatPlugin[] = [];

  constructor(plugins: ChatPlugin[] = []) {
    this.plugins = [...plugins];
  }

  /** Run all plugin onSessionStart hooks */
  async onSessionStart(session: ChatSessionEvents): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.onSessionStart?.(session);
    }
  }

  /** Run all plugin onSessionEnd hooks */
  async onSessionEnd(session: ChatSessionEvents): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.onSessionEnd?.(session);
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
        result = await plugin.configureProvider(provider, result);
      }
    }
    return result;
  }

  /** Run all plugin transformMessage hooks, chaining the message */
  transformMessage(message: ChatMessage): ChatMessage {
    let result = message;
    for (const plugin of this.plugins) {
      if (plugin.transformMessage) {
        result = plugin.transformMessage(result);
      }
    }
    return result;
  }
}
