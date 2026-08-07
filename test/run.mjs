/**
 * claude-mcp-doctor テストスイート
 * 依存パッケージを増やさないため、テストランナーも自前で持つ。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { defaultConfigPath, expandHome, normalizePlatform, revealCommand } from "../dist/paths.js";
import { diagnoseJson, applyCharFixes, FULLWIDTH_MAP } from "../dist/jsonDiagnose.js";
import { checkConfig, suggestCommand, findInPath, countBySeverity } from "../dist/checks.js";
import { renderFinding, detectLang, renderFullwidth, renderParseError } from "../dist/messages.js";
import { parseArgs, runDiagnosis, VERSION } from "../dist/index.js";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail !== undefined ? `\n     → ${JSON.stringify(detail)}` : ""}`);
  }
}

function group(name) {
  console.log(`\n── ${name}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-doctor-test-"));
function write(name, content) {
  const p = path.join(tmp, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
  return p;
}

/* ================================================================== */
group("paths: 設定ファイルの場所");

check(
  "Mac の既定パス",
  defaultConfigPath({ platform: "darwin", home: "/Users/taro" }) ===
    "/Users/taro/Library/Application Support/Claude/claude_desktop_config.json",
  defaultConfigPath({ platform: "darwin", home: "/Users/taro" }),
);
check(
  "Windows の既定パス(APPDATAあり)",
  defaultConfigPath({ platform: "win32", home: "C:\\Users\\taro", appData: "C:\\Users\\taro\\AppData\\Roaming" }).includes(
    "Claude",
  ),
);
check(
  "Windows の既定パス(APPDATAなしでも落ちない)",
  defaultConfigPath({ platform: "win32", home: "C:\\Users\\taro" }).includes("Roaming"),
);
check(
  "Linux の既定パス",
  defaultConfigPath({ platform: "linux", home: "/home/taro" }) ===
    "/home/taro/.config/Claude/claude_desktop_config.json",
);
check("未知のOSでもLinux扱いで落ちない", defaultConfigPath({ platform: "unknown", home: "/h" }).includes(".config"));
check("normalizePlatform: darwin", normalizePlatform("darwin") === "darwin");
check("normalizePlatform: 未知の値", normalizePlatform("aix") === "unknown");
check("expandHome: ~/ を展開", expandHome("~/a/b", "/Users/taro") === "/Users/taro/a/b");
check("expandHome: ~ 単体", expandHome("~", "/Users/taro") === "/Users/taro");
check("expandHome: 絶対パスはそのまま", expandHome("/tmp/x", "/Users/taro") === "/tmp/x");
check("expandHome: 途中の~は展開しない", expandHome("/a/~/b", "/Users/taro") === "/a/~/b");
check("revealCommand: Macはopen", revealCommand("/a/b/c.json", "darwin").startsWith("open "));
check("revealCommand: Windowsはexplorer", revealCommand("C:\\a\\b.json", "win32").startsWith("explorer "));

/* ================================================================== */
group("jsonDiagnose: 全角文字の検出");

const zenkakuComma = '{\n  "mcpServers": {\n    "a": {\n      "command": "node"，\n      "args": []\n    }\n  }\n}';
const d1 = diagnoseJson(zenkakuComma);
check("全角カンマを検出する", d1.issues.filter((i) => i.kind === "fullwidth").length === 1);
check("検出した文字が全角カンマ", d1.issues[0]?.found === "，");
check("置換候補が半角カンマ", d1.issues[0]?.replacement === ",");
check("行番号が正しい(4行目)", d1.issues[0]?.line === 4, d1.issues[0]?.line);
check("該当行のテキストを持っている", (d1.issues[0]?.lineText ?? "").includes("command"));
check("この時点ではJSONとして読めない", d1.parseError !== null);

const zenkakuColon = '{\n  "mcpServers"：{}\n}';
check("全角コロンを検出する", diagnoseJson(zenkakuColon).issues.some((i) => i.found === "："));

const smartQuote = '{\n  “mcpServers”: {}\n}';
check("スマートクォートを検出する", diagnoseJson(smartQuote).issues.filter((i) => i.kind === "fullwidth").length === 2);

const ideographicSpace = '{\n　"mcpServers": {}\n}';
check("全角スペースを検出する", diagnoseJson(ideographicSpace).issues.some((i) => i.found === "\u3000"));

const nbsp = '{\n\u00A0"mcpServers": {}\n}';
check("ノーブレークスペースを検出する", diagnoseJson(nbsp).issues.some((i) => i.found === "\u00A0"));

check("対応表に主要な全角記号が入っている", Object.keys(FULLWIDTH_MAP).length >= 20);

/* ------------------------------------------------------------------ */
group("jsonDiagnose: 日本語の値を誤検出しない(最重要)");

const japaneseValue = JSON.stringify(
  { mcpServers: { メモ: { command: "node", args: ["/a/b.js"], env: { NOTE: "あ、い。これは【テスト】です:全角:" } } } },
  null,
  2,
);
const dJa = diagnoseJson(japaneseValue);
check("日本語の値に含まれる全角文字を検出しない", dJa.issues.length === 0, dJa.issues);
check("日本語を含んでいてもJSONとして読める", dJa.parseError === null);

const mixed =
  '{\n  "mcpServers": {\n    "a": {\n      "command": "node",\n      "env": { "MEMO": "テスト、です：ね" }\n    }，\n    "b": { "command": "node" }\n  }\n}';
const dMixed = diagnoseJson(mixed);
check(
  "値の中の全角は無視し、構造部分の全角だけ検出する",
  dMixed.issues.filter((i) => i.kind === "fullwidth").length === 1,
  dMixed.issues.map((i) => i.found),
);
check("検出したのは構造部分の全角カンマ", dMixed.issues.find((i) => i.kind === "fullwidth")?.found === "，");

const escaped = '{\n  "mcpServers": { "a": { "command": "no\\"de、", "args": [] } }\n}';
check(
  "エスケープされた引用符があっても値の中を誤検出しない",
  diagnoseJson(escaped).issues.filter((i) => i.kind === "fullwidth").length === 0,
);

/* ------------------------------------------------------------------ */
group("jsonDiagnose: BOM・RTF・末尾カンマ");

const withBom = "\uFEFF" + '{ "mcpServers": {} }';
const dBom = diagnoseJson(withBom);
check("BOMを検出する", dBom.hasBom === true);
check("BOMを除けばJSONとして読める", dBom.parseError === null);
check("BOMがissueとして記録される", dBom.issues.some((i) => i.kind === "bom"));

const rtf = '{\\rtf1\\ansi\\ansicpg932 {"mcpServers":{}}}';
const dRtf = diagnoseJson(rtf);
check("RTF破損を検出する", dRtf.rtfCorrupted === true);
check("RTFのときは文字レベルの検出を行わない", dRtf.issues.length === 0);

const trailing = '{\n  "mcpServers": {\n    "a": { "command": "node" },\n  }\n}';
const dTrail = diagnoseJson(trailing);
check("末尾カンマを検出する", dTrail.issues.filter((i) => i.kind === "trailing-comma").length === 1);
check("末尾カンマの行番号", dTrail.issues.find((i) => i.kind === "trailing-comma")?.line === 3);

const validJson = '{ "mcpServers": { "a": { "command": "node" } } }';
const dValid = diagnoseJson(validJson);
check("正常なJSONでは何も検出しない", dValid.issues.length === 0 && dValid.parseError === null);
check("正常なJSONでは末尾カンマを誤検出しない", !dValid.issues.some((i) => i.kind === "trailing-comma"));

const commaInString = '{ "mcpServers": { "a": { "command": "node", "args": ["x,}"] } } }';
check("文字列の中のカンマを末尾カンマと誤検出しない", diagnoseJson(commaInString).issues.length === 0);

const broken = '{\n  "mcpServers": {\n    "a": { "command": "node" }\n    "b": { "command": "node" }\n  }\n}';
const dBroken = diagnoseJson(broken);
check("カンマ抜けをJSONエラーとして検出する", dBroken.parseError !== null);
check("エラー行を推定できる", typeof dBroken.parseErrorLine === "number");

/* ------------------------------------------------------------------ */
group("jsonDiagnose: 自動修正");

const fix1 = applyCharFixes(zenkakuComma);
check("全角カンマを修正する", fix1.applied === 1);
check("修正後はJSONとして読める", (() => { try { JSON.parse(fix1.fixed); return true; } catch { return false; } })());

const fixBom = applyCharFixes(withBom);
check("BOMを除去する", fixBom.fixed.charCodeAt(0) !== 0xfeff);
check("BOM除去も修正件数に数える", fixBom.applied === 1);

const fixTrail = applyCharFixes(trailing);
check("末尾カンマを除去する", (() => { try { JSON.parse(fixTrail.fixed); return true; } catch { return false; } })());

const multi = '{\n  "mcpServers"：{\n    "a": { "command": "node"，"args": [] }，\n  }\n}';
const fixMulti = applyCharFixes(multi);
check("複数の問題をまとめて修正する", fixMulti.applied === 4, fixMulti.applied);
check("複数修正後もJSONとして読める", (() => { try { JSON.parse(fixMulti.fixed); return true; } catch { return false; } })());

const fixJa = applyCharFixes(japaneseValue);
check("日本語の値は1文字も書き換えない", fixJa.fixed === japaneseValue && fixJa.applied === 0);

const fixValid = applyCharFixes(validJson);
check("正常なファイルは書き換えない", fixValid.fixed === validJson && fixValid.applied === 0);

/* ================================================================== */
group("checks: 全体構造");

check("配列はエラー", checkConfig([])[0]?.code === "ROOT_NOT_OBJECT");
check("null はエラー", checkConfig(null)[0]?.code === "ROOT_NOT_OBJECT");
check("文字列はエラー", checkConfig("x")[0]?.code === "ROOT_NOT_OBJECT");
check("mcpServersが無い", checkConfig({})[0]?.code === "NO_MCP_SERVERS_KEY");
check("mcpServersが配列", checkConfig({ mcpServers: [] })[0]?.code === "MCP_SERVERS_NOT_OBJECT");
check("mcpServersが空", checkConfig({ mcpServers: {} })[0]?.code === "MCP_SERVERS_EMPTY");
check("空のときは警告扱い", checkConfig({ mcpServers: {} })[0]?.severity === "warn");
check("サーバー定義が文字列", checkConfig({ mcpServers: { a: "node" } })[0]?.code === "SERVER_NOT_OBJECT");

/* ------------------------------------------------------------------ */
group("checks: command");

const existsAll = () => true;
const existsNone = () => false;
// 検査対象のOSを明示する。実行中のOSに依存せず、どの環境でも同じ結果になる。
const fakeEnv = { PATH: "/usr/bin" };

check(
  "commandが無い",
  checkConfig({ mcpServers: { a: {} } }, { exists: existsAll, env: fakeEnv, platform: "linux" })[0]?.code === "COMMAND_MISSING",
);
check(
  "commandが空文字",
  checkConfig({ mcpServers: { a: { command: "   " } } }, { exists: existsAll, env: fakeEnv, platform: "linux" })[0]?.code ===
    "COMMAND_MISSING",
);
check(
  "PATHにあるコマンドは通る",
  checkConfig({ mcpServers: { a: { command: "node" } } }, { exists: existsAll, env: fakeEnv, platform: "linux" }).length === 0,
);

const typo = checkConfig({ mcpServers: { a: { command: "nodee" } } }, { exists: existsNone, env: fakeEnv, platform: "linux" });
check("打ち間違いを検出する", typo[0]?.code === "COMMAND_TYPO");
check("正しい候補を提案する", typo[0]?.data.suggestion === "node", typo[0]?.data);

const unknownCmd = checkConfig({ mcpServers: { a: { command: "zzzzzzzz" } } }, { exists: existsNone, env: fakeEnv, platform: "linux" });
check("全く違うコマンドはPATH不在として扱う", unknownCmd[0]?.code === "COMMAND_NOT_IN_PATH");

check("suggestCommand: npxx → npx", suggestCommand("npxx") === "npx");
check("suggestCommand: pythn → python", suggestCommand("pythn") === "python");
check("suggestCommand: 一致しすぎる場合はnull", suggestCommand("node") === null);
check("suggestCommand: 遠すぎる場合はnull", suggestCommand("qwertyuiop") === null);

check(
  "絶対パスのcommandが存在しない",
  checkConfig({ mcpServers: { a: { command: "/opt/none/node" } } }, { exists: existsNone, env: fakeEnv, platform: "linux" })[0]?.code ===
    "COMMAND_PATH_MISSING",
);
check(
  "絶対パスのcommandが存在すれば通る",
  checkConfig({ mcpServers: { a: { command: "/usr/bin/node" } } }, { exists: existsAll, env: fakeEnv, platform: "linux" }).length === 0,
);
check(
  "commandの~は展開されないと警告",
  checkConfig({ mcpServers: { a: { command: "~/bin/node" } } }, { exists: existsAll, env: fakeEnv, platform: "linux" })[0]?.code ===
    "TILDE_NOT_EXPANDED",
);

check("findInPath: PATHが空ならnull", findInPath("node", { PATH: "" }, existsAll) === null);
check("findInPath: 見つかればパスを返す", typeof findInPath("node", { PATH: "/usr/bin" }, existsAll) === "string");

/* ------------------------------------------------------------------ */
group("checks: args とビルド忘れ");

const relative = checkConfig(
  { mcpServers: { a: { command: "node", args: ["dist/index.js"] } } },
  { exists: existsAll, env: fakeEnv, platform: "linux" },
);
check("相対パスを検出する", relative[0]?.code === "ARG_RELATIVE_PATH");

const tildeArg = checkConfig(
  { mcpServers: { a: { command: "node", args: ["~/p/dist/index.js"] } } },
  { exists: existsAll, env: fakeEnv, platform: "linux" },
);
check("argsの~を検出する", tildeArg[0]?.code === "TILDE_NOT_EXPANDED");

// ビルド忘れ: プロジェクトはあるが dist が無い
const buildMissing = checkConfig(
  { mcpServers: { a: { command: "node", args: ["/p/proj/dist/index.js"] } } },
  { exists: (p) => p === "/usr/bin/node" || p === "/p/proj", env: fakeEnv, platform: "linux" },
);
check("ビルド忘れを検出する", buildMissing[0]?.code === "BUILD_MISSING", buildMissing[0]);
check("ビルド忘れの解決にプロジェクトのパスが入る", buildMissing[0]?.data.projectDir === "/p/proj");

// dist はあるが中身が無い
const outMissing = checkConfig(
  { mcpServers: { a: { command: "node", args: ["/p/proj/dist/index.js"] } } },
  { exists: (p) => p === "/usr/bin/node" || p === "/p/proj" || p === "/p/proj/dist", env: fakeEnv, platform: "linux" },
);
check("ビルド結果の欠落を検出する", outMissing[0]?.code === "BUILD_OUTPUT_MISSING", outMissing[0]);

const argMissing = checkConfig(
  { mcpServers: { a: { command: "node", args: ["/nowhere/server.js"] } } },
  { exists: (p) => p === "/usr/bin/node", env: fakeEnv, platform: "linux" },
);
check("存在しないファイルを検出する", argMissing[0]?.code === "ARG_PATH_MISSING");

check(
  "オプション引数(-yなど)はパス扱いしない",
  checkConfig({ mcpServers: { a: { command: "npx", args: ["-y", "some-pkg"] } } }, { exists: existsAll, env: fakeEnv, platform: "linux" })
    .length === 0,
);
check(
  "パッケージ名はパス扱いしない",
  checkConfig(
    { mcpServers: { a: { command: "npx", args: ["@scope/pkg"] } } },
    { exists: (p) => p === "/usr/bin/npx", env: fakeEnv, platform: "linux" },
  ).length === 0,
);
check(
  "argsが配列でない",
  checkConfig({ mcpServers: { a: { command: "node", args: "x.js" } } }, { exists: existsAll, env: fakeEnv, platform: "linux" })[0]?.code ===
    "ARGS_NOT_ARRAY",
);
check(
  "argsの中身が数値",
  checkConfig({ mcpServers: { a: { command: "node", args: [8080] } } }, { exists: existsAll, env: fakeEnv, platform: "linux" })[0]?.code ===
    "ARG_NOT_STRING",
);
check(
  "存在するファイルなら通る",
  checkConfig({ mcpServers: { a: { command: "node", args: ["/p/dist/index.js"] } } }, { exists: existsAll, env: fakeEnv, platform: "linux" })
    .length === 0,
);

/* ------------------------------------------------------------------ */
group("checks: env と秘密情報");

const secret = checkConfig(
  { mcpServers: { a: { command: "node", env: { MY_KEY: "sk-EXAMPLE-not-a-real-key-abcdefg" } } } },
  { exists: existsAll, env: fakeEnv, platform: "linux" },
);
check("APIキーらしき値を警告する", secret[0]?.code === "ENV_SECRET_INLINE");
check("秘密情報は警告(errorではない)", secret[0]?.severity === "warn");
check("警告に鍵の名前が入る", secret[0]?.data.key === "MY_KEY");
check(
  "短い値は秘密情報扱いしない",
  checkConfig({ mcpServers: { a: { command: "node", env: { MODE: "debug" } } } }, { exists: existsAll, env: fakeEnv, platform: "linux" })
    .length === 0,
);
check(
  "普通の日本語の値は秘密情報扱いしない",
  checkConfig(
    { mcpServers: { a: { command: "node", env: { NOTE: "これは長めの説明文です。テストのために書いています。" } } } },
    { exists: existsAll, env: fakeEnv, platform: "linux" },
  ).length === 0,
);
check(
  "envが配列",
  checkConfig({ mcpServers: { a: { command: "node", env: [] } } }, { exists: existsAll, env: fakeEnv, platform: "linux" })[0]?.code ===
    "ENV_NOT_OBJECT",
);
check(
  "envの値が数値",
  checkConfig({ mcpServers: { a: { command: "node", env: { PORT: 8080 } } } }, { exists: existsAll, env: fakeEnv, platform: "linux" })[0]
    ?.code === "ENV_VALUE_NOT_STRING",
);

const multiServer = checkConfig(
  {
    mcpServers: {
      ok: { command: "node", args: ["/p/dist/index.js"] },
      bad: { command: "nodee" },
    },
  },
  { exists: (p) => p === "/usr/bin/node" || p.startsWith("/p"), env: fakeEnv, platform: "linux" },
);
check("複数サーバーのうち問題のあるものだけ報告する", multiServer.length === 1);
check("どのサーバーの問題か分かる", multiServer[0]?.server === "bad");

const counts = countBySeverity(secret);
check("countBySeverity が集計できる", counts.warn === 1 && counts.error === 0);

/* ================================================================== */
group("messages: 表示内容");

check("detectLang: LANG=ja_JP.UTF-8 → ja", detectLang({ LANG: "ja_JP.UTF-8" }) === "ja");
check("detectLang: LANG=en_US → en", detectLang({ LANG: "en_US.UTF-8" }) === "en");
check("detectLang: 未設定 → en", detectLang({}) === "en");
check("detectLang: LC_ALL を優先", detectLang({ LC_ALL: "ja_JP.UTF-8", LANG: "en_US" }) === "ja");

const buildMsgJa = renderFinding(buildMissing[0], "ja");
check("ビルド忘れの解決コマンドが出る", (buildMsgJa.fix ?? "").includes("npm run build"));
check("ビルド忘れの解決コマンドにプロジェクトパスが入る", (buildMsgJa.fix ?? "").includes("/p/proj"));
check("ビルド忘れの説明が日本語", buildMsgJa.title.includes("ビルド"));

const buildMsgEn = renderFinding(buildMissing[0], "en");
check("英語表示に切り替わる", buildMsgEn.title.includes("built"));

const typoMsg = renderFinding(typo[0], "ja");
check("打ち間違いの説明に正しい候補が入る", typoMsg.body.includes("node"));

const tildeMsg = renderFinding(tildeArg[0], "ja");
check("~の説明に echo $HOME が出る", (tildeMsg.fix ?? "").includes("echo $HOME"));

const secretMsg = renderFinding(secret[0], "ja");
check("秘密情報の説明に再発行の案内が入る", secretMsg.body.includes("作り直"));

const notInPath = renderFinding(unknownCmd[0], "ja");
check("PATH不在の説明に which が出る", (notInPath.fix ?? "").includes("which"));

const fwMsg = renderFullwidth(2, [{ line: 4, column: 20, found: "，", replacement: "," }], "ja");
check("全角の説明に件数が入る", fwMsg.title.includes("2"));
check("全角の説明に「値の中は問題ない」旨が入る", fwMsg.body.includes("値"));

const peMsg = renderParseError("Unexpected token", 3, '    "a": {}', "ja");
check("JSONエラーの説明によくある原因が並ぶ", peMsg.body.includes("カンマ"));

check("未知のコードでも落ちない", renderFinding({ code: "UNKNOWN_X", severity: "error", data: {} }, "ja").title === "UNKNOWN_X");

/* ================================================================== */
group("CLI: 引数の解釈");

check("--lang ja", parseArgs(["--lang", "ja"], {}).lang === "ja");
check("--lang en", parseArgs(["--lang", "en"], { LANG: "ja_JP.UTF-8" }).lang === "en");
check("--ja ショートハンド", parseArgs(["--ja"], {}).lang === "ja");
check("--no-color", parseArgs(["--no-color"], {}).color === false);
check("NO_COLOR 環境変数", parseArgs([], { NO_COLOR: "1" }).color === false);
check("--fix", parseArgs(["--fix"], {}).fix === true);
check("--help", parseArgs(["--help"], {}).help === true);
check("-h", parseArgs(["-h"], {}).help === true);
check("--version", parseArgs(["--version"], {}).version === true);
check("--path", parseArgs(["--path", "/tmp/x.json"], {}).configPath === "/tmp/x.json");
check("-p", parseArgs(["-p", "/tmp/y.json"], {}).configPath === "/tmp/y.json");
check("指定なしなら既定パス", parseArgs([], {}).configPath.includes("claude_desktop_config.json"));
check("値のないオプションで落ちない", parseArgs(["--path"], {}).configPath.includes("claude_desktop_config.json"));
check("知らないオプションは無視する", parseArgs(["--zzz"], {}).help === false);
check("バージョンが定義されている", /^\d+\.\d+\.\d+$/.test(VERSION));

/* ================================================================== */
group("runDiagnosis: 実ファイルでの動作");

const okFile = write("ok.json", JSON.stringify({ mcpServers: { a: { command: "node", args: [] } } }, null, 2));
const rOk = runDiagnosis(okFile, "ja");
check("正常な設定は問題なし", rOk.rendered.length === 0, rOk.rendered.map((x) => x.rendered.title));
check("自動修正対象もゼロ", rOk.fixableChars === 0);

const missingFile = path.join(tmp, "does-not-exist.json");
const rMissing = runDiagnosis(missingFile, "ja");
check("ファイル無しを検出する", rMissing.exists === false);
check("ファイル無しの説明が出る", rMissing.rendered[0]?.rendered.title.includes("ありません"));
check("ファイル無しでも自動修正は提案しない", rMissing.fixableChars === 0);

const zenkakuFile = write("zenkaku.json", zenkakuComma);
const rZen = runDiagnosis(zenkakuFile, "ja");
check("全角混入を検出する", rZen.rendered.some((x) => x.rendered.title.includes("全角")));
check("自動修正できる件数を返す", rZen.fixableChars === 1);
check("生のJSONエラーを重ねて出さない", !rZen.rendered.some((x) => x.rendered.title.includes("形式(JSON)")));

const rtfFile = write("rtf.json", rtf);
const rRtf = runDiagnosis(rtfFile, "ja");
check("RTF破損を検出する", rRtf.rendered[0]?.rendered.title.includes("リッチテキスト"));
check("RTFは自動修正の対象外", rRtf.fixableChars === 0);
check("RTFは曖昧としてマークされる", rRtf.ambiguous === true);

const brokenFile = write("broken.json", broken);
const rBroken = runDiagnosis(brokenFile, "ja");
check("カンマ抜けを検出する", rBroken.rendered.some((x) => x.rendered.title.includes("JSON")));
check("原因が絞れない場合は曖昧としてマークされる", rBroken.ambiguous === true);

const buildDir = path.join(tmp, "proj");
fs.mkdirSync(buildDir, { recursive: true });
const buildFile = write(
  "build.json",
  JSON.stringify({ mcpServers: { s: { command: "node", args: [path.join(buildDir, "dist", "index.js")] } } }, null, 2),
);
const rBuild = runDiagnosis(buildFile, "ja");
check("実ファイルでもビルド忘れを検出する", rBuild.rendered.some((x) => x.rendered.title.includes("ビルド")), rBuild.rendered.map((x) => x.rendered.title));

const enFile = runDiagnosis(zenkakuFile, "en");
check("英語モードで英語の説明が出る", enFile.rendered[0]?.rendered.title.includes("full-width"));

/* ================================================================== */
group("CLI: 実行(終了コードと安全性)");

const bin = path.resolve("dist/index.js");
function run(args, env = {}) {
  try {
    const stdout = execFileSync("node", [bin, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
      input: "",
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? -1, stdout: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

const rv = run(["--version"]);
check("--version の終了コードが0", rv.code === 0);
check("--version がバージョンを出す", rv.stdout.trim() === VERSION);

const rh = run(["--help"], { LANG: "ja_JP.UTF-8" });
check("--help の終了コードが0", rh.code === 0);
check("--help に使い方が出る", rh.stdout.includes("使い方"));

const rc = run(["--path", okFile], { LANG: "ja_JP.UTF-8" });
check("正常な設定の終了コードが0", rc.code === 0, rc.stdout);
check("正常時にメッセージが出る", rc.stdout.includes("問題は見つかりませんでした"));

const rz = run(["--path", zenkakuFile], { LANG: "ja_JP.UTF-8" });
check("問題ありの終了コードが1", rz.code === 1);
check("修正コマンドの案内が出る", rz.stdout.includes("--fix"));

const rEn = run(["--path", zenkakuFile], { LANG: "en_US.UTF-8" });
check("英語環境では英語で出る", rEn.stdout.includes("full-width"));

// --fix で n を入力した場合、1バイトも変わらないこと
const guardFile = write("guard.json", zenkakuComma);
const beforeBytes = fs.readFileSync(guardFile);
try {
  execFileSync("node", [bin, "--path", guardFile, "--fix"], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", LANG: "ja_JP.UTF-8" },
    input: "n\n",
  });
} catch { /* 終了コード1は想定内 */ }
const afterBytes = fs.readFileSync(guardFile);
check("--fix で拒否したらファイルは1バイトも変わらない", Buffer.compare(beforeBytes, afterBytes) === 0);
check("拒否時にバックアップも作らない", fs.readdirSync(tmp).filter((f) => f.startsWith("guard.json.backup")).length === 0);

// --fix で y を入力した場合、修正されバックアップが残ること
const fixFile = write("tofix.json", zenkakuComma);
try {
  execFileSync("node", [bin, "--path", fixFile, "--fix"], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", LANG: "ja_JP.UTF-8" },
    input: "y\n",
  });
} catch { /* noop */ }
const afterFix = fs.readFileSync(fixFile, "utf8");
check("--fix 承諾でファイルが修正される", (() => { try { JSON.parse(afterFix); return true; } catch { return false; } })(), afterFix);
check("バックアップが作成される", fs.readdirSync(tmp).some((f) => f.startsWith("tofix.json.backup")));
const backupName = fs.readdirSync(tmp).find((f) => f.startsWith("tofix.json.backup"));
check("バックアップの中身は修正前と同じ", fs.readFileSync(path.join(tmp, backupName), "utf8") === zenkakuComma);

// 修正後にもう一度診断すると問題なしになること
const rAfter = run(["--path", fixFile], { LANG: "ja_JP.UTF-8" });
check("修正後の再診断で問題なしになる", rAfter.code === 0, rAfter.stdout);

// RTF に対しては --fix を拒否すること
const rtfFix = write("rtffix.json", rtf);
const rtfBefore = fs.readFileSync(rtfFix);
try {
  execFileSync("node", [bin, "--path", rtfFix, "--fix"], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", LANG: "ja_JP.UTF-8" },
    input: "y\n",
  });
} catch { /* noop */ }
check("RTFには自動修正をかけない", Buffer.compare(rtfBefore, fs.readFileSync(rtfFix)) === 0);

// 日本語だらけの正常ファイルを --fix しても変わらないこと
const jaFile = write("ja.json", japaneseValue);
const jaBefore = fs.readFileSync(jaFile);
try {
  execFileSync("node", [bin, "--path", jaFile, "--fix"], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", LANG: "ja_JP.UTF-8" },
    input: "y\n",
  });
} catch { /* noop */ }
check("日本語を含む正常ファイルは--fixでも変わらない", Buffer.compare(jaBefore, fs.readFileSync(jaFile)) === 0);

const rMissingCli = run(["--path", path.join(tmp, "nope.json")], { LANG: "ja_JP.UTF-8" });
check("ファイル無しの終了コードが1", rMissingCli.code === 1);
check("ファイル無しでも落ちない", rMissingCli.stdout.includes("設定ファイル"));

/* ================================================================== */
group("依存パッケージ");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
check("実行時の依存パッケージがゼロ", !pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
check("binが定義されている", typeof pkg.bin === "object" && pkg.bin["claude-mcp-doctor"] === "dist/index.js");
check("filesにdistが含まれる", (pkg.files ?? []).includes("dist"));
check("publishConfigがpublic", pkg.publishConfig?.access === "public");
check("package.jsonのversionとコードのVERSIONが一致", pkg.version === VERSION);
check("ライセンスがMIT", pkg.license === "MIT");

/* ================================================================== */
fs.rmSync(tmp, { recursive: true, force: true });

console.log("");
console.log("=".repeat(50));
if (fail > 0) {
  console.log("失敗した項目:");
  for (const f of failures) console.log(`  ✖ ${f}`);
  console.log("");
}
console.log(`結果: ${pass} 件成功 / ${fail} 件失敗`);
console.log("=".repeat(50));
process.exit(fail > 0 ? 1 : 0);
