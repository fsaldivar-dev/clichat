import type {
  ChatPlugin,
  ChatMessage,
  ChatSessionEvents,
  CLIProvider,
  SpawnOptions,
  ParsedEvent,
  SendContext,
  SessionStatus,
  BeforeSendResult,
  ParsedEventResult,
  ToolUseResult,
  ErrorResult,
} from "../types.js";

export class PluginManager {
  private plugins: ChatPlugin[] = [];
  private activeProviderId: string | null = null;

  constructor(plugins: ChatPlugin[] = []) {
    // Sort by manifest.priority (lower = earlier, default 100)
    this.plugins = [...plugins].sort(
      (a, b) => (a.manifest?.priority ?? 100) - (b.manifest?.priority ?? 100),
    );

    // Validate requires/provides
    const provided = new Set<string>();
    for (const p of this.plugins) {
      for (const cap of p.manifest?.provides ?? []) provided.add(cap);
    }
    for (const p of this.plugins) {
      for (const req of p.manifest?.requires ?? []) {
        if (!provided.has(req)) {
          console.warn(`[clichat] plugin "${p.id}" requires "${req}" but no plugin provides it`);
        }
      }
    }
  }

  /** Set the active provider for filtering plugins by manifest.providers */
  setActiveProvider(providerId: string): void {
    this.activeProviderId = providerId;
  }

  /** Get plugins that apply to the current provider */
  private activePlugins(): ChatPlugin[] {
    if (!this.activeProviderId) return this.plugins;
    return this.plugins.filter((p) => {
      if (!p.manifest?.providers) return true;
      return p.manifest.providers.includes(this.activeProviderId!);
    });
  }

  // ─── Existing hooks (unchanged behavior) ──────────────────────────────

  async onSessionStart(session: ChatSessionEvents): Promise<void> {
    for (const plugin of this.activePlugins()) {
      try {
        await plugin.onSessionStart?.(session);
      } catch (err) {
        console.warn(`[clichat] plugin "${plugin.id}" onSessionStart failed:`, err);
      }
    }
  }

  async onSessionEnd(session: ChatSessionEvents): Promise<void> {
    for (const plugin of this.activePlugins()) {
      try {
        await plugin.onSessionEnd?.(session);
      } catch (err) {
        console.warn(`[clichat] plugin "${plugin.id}" onSessionEnd failed:`, err);
      }
    }
  }

  async configureProvider(provider: CLIProvider, options: SpawnOptions): Promise<SpawnOptions> {
    let result = options;
    for (const plugin of this.activePlugins()) {
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

  transformMessage(message: ChatMessage): ChatMessage {
    let result = message;
    for (const plugin of this.activePlugins()) {
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

  // ─── New hooks ────────────────────────────────────────────────────────

  /** Chain text through plugins. Cancel = stop processing and return cancel. */
  async onBeforeSend(text: string, context: SendContext): Promise<BeforeSendResult> {
    let result: BeforeSendResult = { text };
    for (const plugin of this.activePlugins()) {
      if (plugin.onBeforeSend) {
        try {
          const r = await plugin.onBeforeSend(result.text, context);
          if (r) {
            result = r;
            if (r.cancel) return result;
          }
        } catch (err) {
          console.warn(`[clichat] plugin "${plugin.id}" onBeforeSend failed:`, err);
        }
      }
    }
    return result;
  }

  /** Chain event through plugins. Cancel = skip processing. */
  async onParsedEvent(event: ParsedEvent): Promise<ParsedEventResult> {
    let result: ParsedEventResult = { event };
    for (const plugin of this.activePlugins()) {
      if (plugin.onParsedEvent) {
        try {
          const r = await plugin.onParsedEvent(result.event);
          if (r) {
            result = r;
            if (r.cancel) return result;
          }
        } catch (err) {
          console.warn(`[clichat] plugin "${plugin.id}" onParsedEvent failed:`, err);
        }
      }
    }
    return result;
  }

  /** Chain tool use through plugins. allow:false = block. */
  async onToolUse(toolName: string, input: unknown): Promise<ToolUseResult> {
    let result: ToolUseResult = { allow: true, input };
    for (const plugin of this.activePlugins()) {
      if (plugin.onToolUse) {
        try {
          const r = await plugin.onToolUse(toolName, result.input);
          if (r) {
            result = r;
            if (!r.allow) return result;
          }
        } catch (err) {
          console.warn(`[clichat] plugin "${plugin.id}" onToolUse failed:`, err);
        }
      }
    }
    return result;
  }

  /** Chain tool result through plugins. */
  async onToolResult(toolName: string, result: string): Promise<string> {
    let current = result;
    for (const plugin of this.activePlugins()) {
      if (plugin.onToolResult) {
        try {
          const r = await plugin.onToolResult(toolName, current);
          if (typeof r === "string") current = r;
        } catch (err) {
          console.warn(`[clichat] plugin "${plugin.id}" onToolResult failed:`, err);
        }
      }
    }
    return current;
  }

  /** Handle error. Return first handled/retry result. */
  async onError(error: Error, context: SendContext): Promise<ErrorResult> {
    for (const plugin of this.activePlugins()) {
      if (plugin.onError) {
        try {
          const r = await plugin.onError(error, context);
          if (r && (r.handled || r.retry)) return r;
        } catch (err) {
          console.warn(`[clichat] plugin "${plugin.id}" onError failed:`, err);
        }
      }
    }
    return {};
  }

  /** Fire-and-forget status change broadcast. */
  onStatusChange(from: SessionStatus, to: SessionStatus): void {
    for (const plugin of this.activePlugins()) {
      if (plugin.onStatusChange) {
        try {
          plugin.onStatusChange(from, to);
        } catch (err) {
          console.warn(`[clichat] plugin "${plugin.id}" onStatusChange failed:`, err);
        }
      }
    }
  }

  /** Fire-and-forget raw output broadcast. */
  onRawOutput(data: string): void {
    for (const plugin of this.activePlugins()) {
      if (plugin.onRawOutput) {
        try {
          plugin.onRawOutput(data);
        } catch (err) {
          console.warn(`[clichat] plugin "${plugin.id}" onRawOutput failed:`, err);
        }
      }
    }
  }
}
