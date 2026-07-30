#!/usr/bin/env node
/**
 * claude-mcp-doctor
 * Claude Desktop の MCP 設定を診断して、「次に何をすればいいか」まで表示する。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { currentContext, defaultConfigPath, revealCommand, expandHome } from "./paths.js";
import { diagnoseJson, applyCharFixes } from "./jsonDiagnose.js";
import { checkConfig, countBySeverity } from "./checks.js";
import type { Finding } from "./checks.js";
import {
  UI,
  detectLang,
  renderFinding,
  renderFileMissing,
  renderRtf,
  renderFullwidth,
  renderTrailingComma,
  renderParseError,
} from "./messages.js";
import type { Lang, Rendered } from "./messages.js";

export const VERSION = "1.0.0";

interface Options {
  configPath: string;
  lang: Lang;
  color: boolean;
  fix: boolean;
  help: boolean;
  version: boolean;
}

const color = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  cyan: "\u001b[36m",
};

let useColor = true;
function paint(text: string, ...codes: string[]): string {
  if (!useColor) return text;
  return codes.join("") + text + color.reset;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Options {
  const ctx = currentContext();
  const options: Options = {
    configPath: defaultConfigPath(ctx),
    lang: detectLang(env),
    color: true,
    fix: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--path":
      case "-p":
        if (argv[i + 1]) options.configPath = expandHome(argv[++i]!, ctx.home);
        break;
      case "--lang":
        if (argv[i + 1]) options.lang = argv[++i] === "ja" ? "ja" : "en";
        break;
      case "--ja":
        options.lang = "ja";
        break;
      case "--en":
        options.lang = "en";
        break;
      case "--no-color":
        options.color = false;
        break;
      case "--fix":
        options.fix = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
    }
  }
  if (env.NO_COLOR) options.color = false;
  return options;
}

function helpText(lang: Lang): string {
  if (lang === "ja") {
    return [
      `claude-mcp-doctor v${VERSION}`,
      ``,
      `Claude Desktop の MCP 設定を診断します。診断は読み取りのみで、勝手に書き換えません。`,
      ``,
      `使い方:`,
      `  npx claude-mcp-doctor            設定を診断する`,
      `  npx claude-mcp-doctor --fix      文字の問題を確認のうえ自動修正する`,
      ``,
      `オプション:`,
      `  -p, --path <ファイル>   設定ファイルの場所を指定する`,
      `      --lang ja|en       表示言語を指定する(既定は自動判定)`,
      `      --no-color         色を使わない`,
      `  -h, --help             このヘルプを表示する`,
      `  -v, --version          バージョンを表示する`,
      ``,
      `終了コード: 0=問題なし / 1=問題あり / 2=想定外のエラー`,
    ].join("\n");
  }
  return [
    `claude-mcp-doctor v${VERSION}`,
    ``,
    `Diagnose your Claude Desktop MCP configuration. Diagnosis is read-only.`,
    ``,
    `Usage:`,
    `  npx claude-mcp-doctor            diagnose`,
    `  npx claude-mcp-doctor --fix      fix character problems after confirmation`,
    ``,
    `Options:`,
    `  -p, --path <file>   path to the config file`,
    `      --lang ja|en    display language (auto-detected by default)`,
    `      --no-color      disable colored output`,
    `  -h, --help          show this help`,
    `  -v, --version       show version`,
    ``,
    `Exit codes: 0 = clean, 1 = problems found, 2 = unexpected error`,
  ].join("\n");
}

function printRendered(r: Rendered, severity: "error" | "warn", index: number, lang: Lang): void {
  const mark = severity === "error" ? paint("✖", color.red, color.bold) : paint("▲", color.yellow, color.bold);
  console.log("");
  console.log(`${mark} ${paint(`[${index}] ${r.title}`, color.bold)}`);
  for (const line of r.body.split("\n")) {
    console.log(line ? `   ${line}` : "");
  }
  if (r.fix) {
    console.log("");
    console.log(`   ${paint(lang === "ja" ? "コピペして実行:" : "Copy and run:", color.dim)}`);
    console.log(`   ${paint(r.fix, color.cyan, color.bold)}`);
  }
}

export interface DiagnoseResult {
  exists: boolean;
  rendered: { rendered: Rendered; severity: "error" | "warn" }[];
  fixableChars: number;
  ambiguous: boolean;
}

/** 診断本体(表示はしない。テストから直接呼べるようにしてある) */
export function runDiagnosis(configPath: string, lang: Lang): DiagnoseResult {
  const ctx = currentContext();
  const out: { rendered: Rendered; severity: "error" | "warn" }[] = [];

  if (!fs.existsSync(configPath)) {
    return {
      exists: false,
      rendered: [
        {
          rendered: renderFileMissing(configPath, revealCommand(configPath, ctx.platform), lang),
          severity: "error",
        },
      ],
      fixableChars: 0,
      ambiguous: false,
    };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const diag = diagnoseJson(raw);

  if (diag.rtfCorrupted) {
    return {
      exists: true,
      rendered: [{ rendered: renderRtf(configPath, lang), severity: "error" }],
      fixableChars: 0,
      ambiguous: true,
    };
  }

  const fullwidth = diag.issues.filter((i) => i.kind === "fullwidth");
  const trailing = diag.issues.filter((i) => i.kind === "trailing-comma");

  if (fullwidth.length > 0) {
    out.push({ rendered: renderFullwidth(fullwidth.length, fullwidth, lang), severity: "error" });
  }
  if (trailing.length > 0) {
    out.push({ rendered: renderTrailingComma(trailing.length, trailing, lang), severity: "error" });
  }

  const fixableChars = fullwidth.length + trailing.length + (diag.hasBom ? 1 : 0);

  if (diag.parseError !== null) {
    // 文字の問題で説明がついているなら、生のJSONエラーは重ねて出さない
    if (fixableChars === 0) {
      out.push({
        rendered: renderParseError(diag.parseError, diag.parseErrorLine, diag.parseErrorLineText, lang),
        severity: "error",
      });
    }
    return { exists: true, rendered: out, fixableChars, ambiguous: fixableChars === 0 };
  }

  const findings: Finding[] = checkConfig(diag.parsed);
  for (const f of findings) {
    out.push({
      rendered: renderFinding(f, lang),
      severity: f.severity === "error" ? "error" : "warn",
    });
  }

  return { exists: true, rendered: out, fixableChars, ambiguous: false };
}

async function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY && process.env.CLAUDE_MCP_DOCTOR_ASSUME_NO === "1") return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function runFix(options: Options): Promise<number> {
  const lang = options.lang;
  console.log("");
  console.log(paint(UI.fixHeader[lang], color.bold));

  if (!fs.existsSync(options.configPath)) {
    console.log(UI.fixNothing[lang]);
    return 1;
  }

  const raw = fs.readFileSync(options.configPath, "utf8");
  const diag = diagnoseJson(raw);

  if (diag.rtfCorrupted) {
    console.log(paint(UI.fixRefused[lang], color.yellow));
    return 1;
  }

  const { fixed, applied } = applyCharFixes(raw);
  if (applied === 0) {
    console.log(UI.fixNothing[lang]);
    return 0;
  }

  // 直した結果がちゃんとJSONとして読めることを、書き込む前に必ず確認する
  try {
    JSON.parse(fixed);
  } catch {
    console.log(paint(UI.fixRefused[lang], color.yellow));
    return 1;
  }

  console.log("");
  console.log(UI.fixPreview[lang]);
  const beforeLines = raw.replace(/^\uFEFF/, "").split("\n");
  const afterLines = fixed.split("\n");
  let shown = 0;
  for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i++) {
    if (beforeLines[i] !== afterLines[i]) {
      console.log(`  ${paint(`- ${beforeLines[i] ?? ""}`, color.red)}`);
      console.log(`  ${paint(`+ ${afterLines[i] ?? ""}`, color.green)}`);
      shown++;
      if (shown >= 20) {
        console.log("  ...");
        break;
      }
    }
  }
  if (shown === 0) {
    console.log(`  (BOM)`);
  }
  console.log("");

  const ok = await confirm(UI.fixConfirm[lang]);
  if (!ok) {
    console.log(paint(UI.fixCancelled[lang], color.dim));
    return 1;
  }

  const backupPath = `${options.configPath}.backup-${timestamp()}`;
  fs.copyFileSync(options.configPath, backupPath);
  console.log(`${UI.fixBackup[lang]}: ${backupPath}`);
  fs.writeFileSync(options.configPath, fixed, "utf8");
  console.log("");
  console.log(paint(UI.fixDone[lang], color.green, color.bold));
  return 0;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  useColor = options.color;
  const lang = options.lang;

  if (options.version) {
    console.log(VERSION);
    return 0;
  }
  if (options.help) {
    console.log(helpText(lang));
    return 0;
  }

  console.log(paint(UI.banner[lang], color.bold));
  console.log(paint(`${UI.configPathLabel[lang]}: ${options.configPath}`, color.dim));

  const result = runDiagnosis(options.configPath, lang);

  if (result.rendered.length === 0) {
    console.log("");
    console.log(paint(`✔ ${UI.allGood[lang]}`, color.green, color.bold));
    console.log(`   ${UI.allGoodHint[lang]}`);
    if (options.fix) {
      console.log("");
      console.log(UI.fixNothing[lang]);
    }
    return 0;
  }

  const errors = result.rendered.filter((r) => r.severity === "error").length;
  const warns = result.rendered.filter((r) => r.severity === "warn").length;

  let i = 0;
  for (const item of result.rendered) {
    printRendered(item.rendered, item.severity, ++i, lang);
  }

  console.log("");
  const summary =
    lang === "ja"
      ? `${errors}${UI.summaryError.ja} / ${warns}${UI.summaryWarn.ja}`
      : `${errors}${UI.summaryError.en} / ${warns}${UI.summaryWarn.en}`;
  console.log(paint(summary, color.bold));

  if (errors > 0) {
    console.log(paint(UI.restartNote[lang], color.dim));
  }

  if (options.fix) {
    return await runFix(options);
  }

  if (result.fixableChars > 0) {
    console.log("");
    console.log(paint(UI.fixHint[lang], color.bold));
    console.log(`   ${paint("npx claude-mcp-doctor --fix", color.cyan, color.bold)}`);
  }

  return errors > 0 ? 1 : 0;
}

// 直接実行されたときだけ動かす(テストから import できるようにするため)
function isDirectRun(): boolean {
  const invokedRaw = process.argv[1];
  if (!invokedRaw) return false;
  const thisFile = fileURLToPath(import.meta.url);
  const invoked = path.resolve(invokedRaw);
  if (invoked === thisFile) return true;
  try {
    return fs.realpathSync(invoked) === fs.realpathSync(thisFile);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error("claude-mcp-doctor: unexpected error");
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    },
  );
}
