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

/**
 * 対象OSに対応する path 実装を返す。
 * path.join をそのまま使うと「実行中のOS」の区切り文字になり、
 * 引数で受け取った platform と食い違うため、ここで明示的に選ぶ。
 */
function pathFor(platform: Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

/** Windows形式のパスに見えるか(ドライブレターまたは円記号を含む) */
function looksWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\");
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
  const p = pathFor(ctx.platform);
  switch (ctx.platform) {
    case "darwin":
      return p.join(
        ctx.home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
    case "win32": {
      const base = ctx.appData ?? p.join(ctx.home, "AppData", "Roaming");
      return p.join(base, "Claude", "claude_desktop_config.json");
    }
    default:
      return p.join(ctx.home, ".config", "Claude", "claude_desktop_config.json");
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
    const impl = looksWindowsPath(home) ? path.win32 : path.posix;
    return impl.join(home, p.slice(2));
  }
  return p;
}

/**
 * 設定ファイルを開くための、OSごとのコマンドを返す。
 */
export function revealCommand(configPath: string, platform: Platform): string {
  const dir = pathFor(platform).dirname(configPath);
  switch (platform) {
    case "darwin":
      return `open "${dir}"`;
    case "win32":
      return `explorer "${dir}"`;
    default:
      return `xdg-open "${dir}"`;
  }
}
