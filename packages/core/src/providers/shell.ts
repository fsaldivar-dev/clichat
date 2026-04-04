import type { CLIProvider, SpawnConfig, SpawnOptions } from "../types.js";
import { AnsiStripParser } from "../parsers/ansi-strip.js";
import { buildFullPath } from "./utils.js";

/**
 * Plain shell provider (bash/zsh).
 * Pass-through with minimal parsing — designed for raw terminal mode.
 */
export const shellProvider: CLIProvider = {
  id: "shell",
  label: "Terminal",
  icon: ">",

  async spawn(options: SpawnOptions): Promise<SpawnConfig> {
    const shell =
      process.platform === "win32"
        ? process.env.ComSpec || "cmd.exe"
        : process.env.SHELL || "/bin/sh";

    return {
      command: shell,
      args: [],
      cwd: options.cwd,
      env: {
        ...options.env,
        TERM: "xterm-256color",
        PATH: buildFullPath(),
      },
      useChildProcess: false,
    };
  },

  parser: new AnsiStripParser(),

  formatInput(text: string): string {
    return text + "\n";
  },
};
