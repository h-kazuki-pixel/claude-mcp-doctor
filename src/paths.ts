/**
 * claude-mcp-doctor
 * Claude Desktop の設定ファイルの場所を、OSごとに解決する。
 */
import * as os from "node:os";
import * as path from "node:path";

export type Platform = "darwin" | "win32" | "linux" | "unknown";

export function normalizePlatform(p: string): Platform {
  if (p === "darwin" || p === "win32" || p === "linux") return p;
  return "unknown";
}

export interface PathContext {
  platform: Platform;
  home: string;
  appData?: string;
}

/**
 * Claude Desktop の claude_desktop_config.json の既定パスを返す。
 */
export function defaultConfigPath(ctx: PathContext): string {
  switch (ctx.platform) {
    case "darwin":
      return path.join(
        ctx.home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
    case "win32": {
      const base = ctx.appData ?? path.join(ctx.home, "AppData", "Roaming");
      return path.join(base, "Claude", "claude_desktop_config.json");
    }
    default:
      return path.join(ctx.home, ".config", "Claude", "claude_desktop_config.json");
  }
}

export function currentContext(): PathContext {
  return {
    platform: normalizePlatform(process.platform),
    home: os.homedir(),
    appData: process.env.APPDATA,
  };
}

/**
 * `~/...` を絶対パスに展開する。
 */
export function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(home, p.slice(2));
  }
  return p;
}

/**
 * 設定ファイルを開くための、OSごとのコマンドを返す。
 */
export function revealCommand(configPath: string, platform: Platform): string {
  const dir = path.dirname(configPath);
  switch (platform) {
    case "darwin":
      return `open "${dir}"`;
    case "win32":
      return `explorer "${dir}"`;
    default:
      return `xdg-open "${dir}"`;
  }
}
