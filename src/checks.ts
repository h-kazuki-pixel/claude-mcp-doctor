/**
 * claude-mcp-doctor
 * パースできた設定の「中身」を検査する。
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type Severity = "error" | "warn" | "info";

export interface Finding {
  code: string;
  severity: Severity;
  server?: string;
  /** メッセージ組み立て用の差し込み値 */
  data: Record<string, string>;
}

const KNOWN_COMMANDS = [
  "node",
  "npx",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "bunx",
  "deno",
  "python",
  "python3",
  "uv",
  "uvx",
  "docker",
  "sh",
  "bash",
];

const SCRIPT_EXT = new Set([".js", ".mjs", ".cjs", ".py", ".ts"]);

function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(
        dp[j]! + 1,
        dp[j - 1]! + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export function suggestCommand(input: string): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const cmd of KNOWN_COMMANDS) {
    const d = levenshtein(input.toLowerCase(), cmd);
    if (d < bestDist) {
      bestDist = d;
      best = cmd;
    }
  }
  return bestDist > 0 && bestDist <= 2 ? best : null;
}

/** PATH を順に探して実行ファイルが見つかるか調べる */
export function findInPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): string | null {
  const rawPath = env.PATH ?? env.Path ?? "";
  if (!rawPath) return null;
  const sep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of rawPath.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function looksLikeSecret(value: string): boolean {
  if (value.length < 16) return false;
  if (/^(sk-|ghp_|gho_|github_pat_|xoxb-|xoxp-|AKIA|AIza)/.test(value)) return true;
  if (/^[A-Za-z0-9_\-]{32,}$/.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value)) return true;
  return false;
}

function looksLikePath(value: string): boolean {
  if (value.startsWith("-")) return false;
  if (value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:[\\/]/.test(value)) return true;
  return SCRIPT_EXT.has(path.extname(value)) || value.includes("/") || value.includes("\\");
}

export interface CheckOptions {
  exists?: (p: string) => boolean;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export function checkConfig(parsed: unknown, options: CheckOptions = {}): Finding[] {
  const exists = options.exists ?? ((p: string) => fs.existsSync(p));
  const env = options.env ?? process.env;
  const findings: Finding[] = [];

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    findings.push({ code: "ROOT_NOT_OBJECT", severity: "error", data: {} });
    return findings;
  }

  const root = parsed as Record<string, unknown>;
  const servers = root.mcpServers;

  if (servers === undefined) {
    findings.push({ code: "NO_MCP_SERVERS_KEY", severity: "error", data: {} });
    return findings;
  }
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
    findings.push({ code: "MCP_SERVERS_NOT_OBJECT", severity: "error", data: {} });
    return findings;
  }

  const entries = Object.entries(servers as Record<string, unknown>);
  if (entries.length === 0) {
    findings.push({ code: "MCP_SERVERS_EMPTY", severity: "warn", data: {} });
    return findings;
  }

  for (const [name, rawDef] of entries) {
    if (typeof rawDef !== "object" || rawDef === null || Array.isArray(rawDef)) {
      findings.push({ code: "SERVER_NOT_OBJECT", severity: "error", server: name, data: {} });
      continue;
    }
    const def = rawDef as Record<string, unknown>;

    // --- command ---
    const command = def.command;
    if (typeof command !== "string" || command.trim() === "") {
      findings.push({ code: "COMMAND_MISSING", severity: "error", server: name, data: {} });
    } else if (command.includes("/") || command.includes("\\")) {
      if (command.startsWith("~")) {
        findings.push({
          code: "TILDE_NOT_EXPANDED",
          severity: "error",
          server: name,
          data: { value: command },
        });
      } else if (!exists(command)) {
        findings.push({
          code: "COMMAND_PATH_MISSING",
          severity: "error",
          server: name,
          data: { value: command },
        });
      }
    } else {
      const found = findInPath(command, env, exists);
      if (!found) {
        const suggestion = suggestCommand(command);
        findings.push({
          code: suggestion ? "COMMAND_TYPO" : "COMMAND_NOT_IN_PATH",
          severity: "error",
          server: name,
          data: { value: command, suggestion: suggestion ?? "" },
        });
      }
    }

    // --- args ---
    const args = def.args;
    if (args !== undefined && !Array.isArray(args)) {
      findings.push({ code: "ARGS_NOT_ARRAY", severity: "error", server: name, data: {} });
    } else if (Array.isArray(args)) {
      for (const rawArg of args) {
        if (typeof rawArg !== "string") {
          findings.push({ code: "ARG_NOT_STRING", severity: "error", server: name, data: {} });
          continue;
        }
        const arg = rawArg;
        if (!looksLikePath(arg)) continue;

        if (arg.startsWith("~")) {
          findings.push({
            code: "TILDE_NOT_EXPANDED",
            severity: "error",
            server: name,
            data: { value: arg },
          });
          continue;
        }

        const isAbsolute = arg.startsWith("/") || /^[A-Za-z]:[\\/]/.test(arg);
        if (!isAbsolute) {
          if (SCRIPT_EXT.has(path.extname(arg))) {
            findings.push({
              code: "ARG_RELATIVE_PATH",
              severity: "error",
              server: name,
              data: { value: arg },
            });
          }
          continue;
        }

        if (exists(arg)) continue;

        // ビルド忘れの判定: .../<project>/dist/xxx.js で、<project> は存在するが dist が無い
        const distIndex = arg.replace(/\\/g, "/").lastIndexOf("/dist/");
        if (distIndex > 0) {
          const projectDir = arg.slice(0, distIndex);
          const distDir = arg.slice(0, distIndex + 5);
          if (exists(projectDir) && !exists(distDir)) {
            findings.push({
              code: "BUILD_MISSING",
              severity: "error",
              server: name,
              data: { value: arg, projectDir },
            });
            continue;
          }
          if (exists(distDir)) {
            findings.push({
              code: "BUILD_OUTPUT_MISSING",
              severity: "error",
              server: name,
              data: { value: arg, projectDir },
            });
            continue;
          }
        }

        findings.push({
          code: "ARG_PATH_MISSING",
          severity: "error",
          server: name,
          data: { value: arg },
        });
      }
    }

    // --- env ---
    const serverEnv = def.env;
    if (serverEnv !== undefined) {
      if (typeof serverEnv !== "object" || serverEnv === null || Array.isArray(serverEnv)) {
        findings.push({ code: "ENV_NOT_OBJECT", severity: "error", server: name, data: {} });
      } else {
        for (const [key, value] of Object.entries(serverEnv as Record<string, unknown>)) {
          if (typeof value !== "string") {
            findings.push({
              code: "ENV_VALUE_NOT_STRING",
              severity: "error",
              server: name,
              data: { key },
            });
            continue;
          }
          if (looksLikeSecret(value)) {
            findings.push({
              code: "ENV_SECRET_INLINE",
              severity: "warn",
              server: name,
              data: { key },
            });
          }
        }
      }
    }
  }

  return findings;
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const result: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) result[f.severity]++;
  return result;
}
