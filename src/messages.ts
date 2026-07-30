/**
 * claude-mcp-doctor
 * 表示メッセージ。エラー名を出すだけでなく「次に何をすればいいか」を必ず書く。
 */
import type { Finding } from "./checks.js";

export type Lang = "ja" | "en";

export interface Rendered {
  title: string;
  body: string;
  /** そのままコピペできる解決コマンド */
  fix?: string;
}

export function detectLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE || "";
  return /^ja/i.test(raw) ? "ja" : "en";
}

export const UI = {
  banner: {
    ja: "claude-mcp-doctor — Claude Desktop の MCP 設定を診断します",
    en: "claude-mcp-doctor — diagnosing your Claude Desktop MCP setup",
  },
  configPathLabel: { ja: "設定ファイル", en: "Config file" },
  checking: { ja: "診断中...", en: "Checking..." },
  allGood: {
    ja: "問題は見つかりませんでした。設定は正しく書けています。",
    en: "No problems found. Your configuration looks good.",
  },
  allGoodHint: {
    ja: "それでもClaudeにサーバーが出てこない場合は、Claude Desktop を完全に終了して(Command+Q)から開き直してください。",
    en: "If servers still don't appear, fully quit Claude Desktop (Cmd+Q / right-click → Quit) and reopen it.",
  },
  summaryError: { ja: "件の問題", en: " problem(s)" },
  summaryWarn: { ja: "件の注意", en: " warning(s)" },
  fixHint: {
    ja: "文字の問題は自動修正できます。次のコマンドを実行してください:",
    en: "The character problems can be fixed automatically. Run:",
  },
  fixHeader: { ja: "自動修正モード", en: "Auto-fix mode" },
  fixPreview: { ja: "次のように直します:", en: "Proposed changes:" },
  fixConfirm: {
    ja: "この内容で修正しますか? バックアップを作ってから書き込みます [y/N]: ",
    en: "Apply these changes? A backup will be created first [y/N]: ",
  },
  fixCancelled: {
    ja: "中止しました。ファイルは1文字も変更していません。",
    en: "Cancelled. Not a single byte was changed.",
  },
  fixBackup: { ja: "バックアップを作成しました", en: "Backup created" },
  fixDone: {
    ja: "修正しました。Claude Desktop を完全に終了して(Command+Q)から開き直してください。",
    en: "Fixed. Fully quit Claude Desktop and reopen it.",
  },
  fixNothing: {
    ja: "自動修正できる問題はありませんでした。",
    en: "There is nothing that can be fixed automatically.",
  },
  fixRefused: {
    ja: "自動修正は行いません。原因が1つに絞れないため、手作業での確認をおすすめします。",
    en: "Refusing to auto-fix: the cause is ambiguous, so manual review is safer.",
  },
  serverLabel: { ja: "サーバー", en: "server" },
  line: { ja: "行目", en: "line " },
  restartNote: {
    ja: "設定を直したあとは、必ず Claude Desktop を完全に終了してから開き直してください。",
    en: "After editing the config, always fully quit and reopen Claude Desktop.",
  },
} as const;

export function t(key: keyof typeof UI, lang: Lang): string {
  return UI[key][lang];
}

/* ------------------------------------------------------------------ */
/* ファイル・文字レベルの問題                                            */
/* ------------------------------------------------------------------ */

export function renderFileMissing(
  configPath: string,
  revealCmd: string,
  lang: Lang,
): Rendered {
  if (lang === "ja") {
    return {
      title: "設定ファイルがまだありません",
      body: [
        `Claude Desktop は次の場所の設定ファイルを読みます。今はそこにファイルがありません。`,
        `  ${configPath}`,
        ``,
        `これは異常ではありません。MCPサーバーを一度も設定していない場合は、まだ存在しないのが普通です。`,
        `Claude Desktop の 設定 → 開発者 → 「構成を編集」を押すと、空のファイルが自動で作られます。`,
      ].join("\n"),
      fix: revealCmd,
    };
  }
  return {
    title: "Config file does not exist yet",
    body: [
      `Claude Desktop reads its config from:`,
      `  ${configPath}`,
      ``,
      `This is normal if you have never added an MCP server.`,
      `Open Claude Desktop → Settings → Developer → "Edit Config" to create it.`,
    ].join("\n"),
    fix: revealCmd,
  };
}

export function renderRtf(configPath: string, lang: Lang): Rendered {
  if (lang === "ja") {
    return {
      title: "設定ファイルがリッチテキスト形式で壊れています",
      body: [
        `中身が {\\rtf... で始まっています。これは Mac の「テキストエディット」で保存したときに起きる、非常によくある事故です。`,
        `見た目は正しく見えても、実際のファイルには書式情報が大量に混ざっていて、Claude は読み取れません。`,
        ``,
        `直し方: いったんファイルを削除して作り直すのが確実です。`,
        `テキストエディットを使う場合は、開いたあと メニューの「フォーマット」→「標準テキストにする」を必ず実行してください。`,
        `VS Code や CotEditor など、プログラム用のエディタを使うのが安全です。`,
      ].join("\n"),
      fix: `mv "${configPath}" "${configPath}.rtf-broken"`,
    };
  }
  return {
    title: "Config file is corrupted as rich text (RTF)",
    body: [
      `The file starts with {\\rtf..., which happens when it was saved by macOS TextEdit in rich-text mode.`,
      `Claude cannot read it even though it may look fine on screen.`,
      ``,
      `Fix: move the broken file aside and recreate it with a code editor (VS Code, etc.).`,
      `If you use TextEdit, choose Format → Make Plain Text first.`,
    ].join("\n"),
    fix: `mv "${configPath}" "${configPath}.rtf-broken"`,
  };
}

export function renderFullwidth(
  count: number,
  samples: { line: number; column: number; found: string; replacement: string }[],
  lang: Lang,
): Rendered {
  const list = samples
    .map(
      (s) =>
        lang === "ja"
          ? `  ${s.line}行目 ${s.column}文字目 : ${describe(s.found, lang)} → ${s.replacement}`
          : `  line ${s.line}, col ${s.column} : ${describe(s.found, lang)} → ${s.replacement}`,
    )
    .join("\n");

  if (lang === "ja") {
    return {
      title: `全角文字が ${count} 個 混ざっています`,
      body: [
        `日本語入力(かな入力)のまま記号を打つと、見た目がそっくりな全角文字になります。`,
        `Claude はこれを読み取れず、設定ファイル全体が無効になります。`,
        ``,
        list,
        ``,
        `注意: 日本語の「値」の中にある全角文字は問題ありません。ここに出ているのは、記号として使われている位置のものだけです。`,
      ].join("\n"),
    };
  }
  return {
    title: `Found ${count} full-width / typographic character(s)`,
    body: [
      `These look almost identical to ASCII punctuation but are different characters, so the file cannot be parsed.`,
      ``,
      list,
      ``,
      `Note: full-width characters inside string values are fine and are never reported here.`,
    ].join("\n"),
  };
}

export function renderTrailingComma(
  count: number,
  samples: { line: number }[],
  lang: Lang,
): Rendered {
  const lines = samples.map((s) => s.line).join(", ");
  if (lang === "ja") {
    return {
      title: `余分なカンマ(末尾カンマ)が ${count} 個 あります`,
      body: [
        `} や ] の直前にカンマがあります。JavaScript では許されますが、設定ファイルの形式(JSON)では文法エラーになります。`,
        `該当行: ${lines}`,
        ``,
        `サーバーを1つ消したときに、カンマだけ残ってしまうのがよくある原因です。`,
      ].join("\n"),
    };
  }
  return {
    title: `Found ${count} trailing comma(s)`,
    body: [
      `A comma right before } or ] is valid JavaScript but invalid JSON.`,
      `Line(s): ${lines}`,
    ].join("\n"),
  };
}

export function renderParseError(
  message: string,
  line: number | null,
  lineText: string | null,
  lang: Lang,
): Rendered {
  const where =
    line !== null
      ? lang === "ja"
        ? `\n${line}行目のあたりです:\n  ${(lineText ?? "").trim()}`
        : `\nAround line ${line}:\n  ${(lineText ?? "").trim()}`
      : "";

  if (lang === "ja") {
    return {
      title: "設定ファイルの形式(JSON)が壊れています",
      body: [
        `カッコやカンマの数が合っていない可能性が高いです。${where}`,
        ``,
        `よくある原因は3つです。`,
        `  1. サーバーとサーバーの間のカンマ , が抜けている`,
        `  2. 最後のサーバーのうしろに、余分なカンマが残っている`,
        `  3. 波カッコ { } の数が合っていない`,
        ``,
        `参考(元のエラー): ${message}`,
      ].join("\n"),
    };
  }
  return {
    title: "Config file is not valid JSON",
    body: [
      `Brackets or commas are most likely unbalanced.${where}`,
      ``,
      `Common causes: a missing comma between servers, a leftover trailing comma, or unbalanced { }.`,
      ``,
      `Raw error: ${message}`,
    ].join("\n"),
  };
}

function describe(ch: string, lang: Lang): string {
  if (ch === "\u3000") return lang === "ja" ? "全角スペース" : "ideographic space";
  if (ch === "\u00A0") return lang === "ja" ? "ノーブレークスペース" : "no-break space";
  return `"${ch}"`;
}

/* ------------------------------------------------------------------ */
/* 中身のチェック結果                                                    */
/* ------------------------------------------------------------------ */

export function renderFinding(f: Finding, lang: Lang): Rendered {
  const v = f.data.value ?? "";
  const ja = lang === "ja";

  switch (f.code) {
    case "ROOT_NOT_OBJECT":
      return ja
        ? {
            title: "設定ファイル全体の形が違います",
            body: '一番外側は { } で囲まれた形である必要があります。先頭が [ になっていないか確認してください。',
          }
        : {
            title: "Top level is not an object",
            body: "The file must start with { and end with }.",
          };

    case "NO_MCP_SERVERS_KEY":
      return ja
        ? {
            title: "mcpServers の項目がありません",
            body: [
              "Claude はこの項目を見てMCPサーバーを読み込みます。無いと、何も認識されません。",
              "最低限、次の形になっている必要があります。",
              "",
              '  {',
              '    "mcpServers": {',
              '      "サーバー名": { "command": "node", "args": ["/絶対パス/dist/index.js"] }',
              '    }',
              '  }',
            ].join("\n"),
          }
        : {
            title: "Missing the mcpServers key",
            body: 'Claude reads MCP servers from the "mcpServers" object. Without it nothing is loaded.',
          };

    case "MCP_SERVERS_NOT_OBJECT":
      return ja
        ? {
            title: "mcpServers の書き方が違います",
            body: "mcpServers は { } のオブジェクトである必要があります。[ ] の配列にはできません。",
          }
        : {
            title: "mcpServers must be an object",
            body: "Use { } with server names as keys, not an array.",
          };

    case "MCP_SERVERS_EMPTY":
      return ja
        ? {
            title: "MCPサーバーが1つも登録されていません",
            body: "ファイルの形式は正しいですが、中身が空です。まだサーバーを追加していない状態です。",
          }
        : {
            title: "No MCP servers are registered",
            body: "The file is valid but contains no servers yet.",
          };

    case "SERVER_NOT_OBJECT":
      return ja
        ? {
            title: `${f.server}: 中身が { } になっていません`,
            body: "各サーバーは { \"command\": ..., \"args\": [...] } の形で書きます。",
          }
        : {
            title: `${f.server}: definition must be an object`,
            body: 'Each server is written as { "command": ..., "args": [...] }.',
          };

    case "COMMAND_MISSING":
      return ja
        ? {
            title: `${f.server}: command が指定されていません`,
            body: 'どのプログラムで起動するかを書く必要があります。多くのMCPサーバーでは "command": "node" です。',
          }
        : {
            title: `${f.server}: "command" is missing`,
            body: 'Specify how to launch the server, usually "command": "node".',
          };

    case "COMMAND_TYPO": {
      const s = f.data.suggestion;
      return ja
        ? {
            title: `${f.server}: command "${v}" が見つかりません`,
            body: `打ち間違いの可能性があります。"${s}" ではありませんか?\n設定ファイルの "command" の値を "${s}" に書き換えてください。`,
          }
        : {
            title: `${f.server}: command "${v}" not found`,
            body: `This looks like a typo. Did you mean "${s}"? Update the "command" value.`,
          };
    }

    case "COMMAND_NOT_IN_PATH":
      return ja
        ? {
            title: `${f.server}: command "${v}" が見つかりません`,
            body: [
              `そのコマンドがインストールされていないか、Claude Desktop から見える場所に無い状態です。`,
              ``,
              `まずターミナルで次を実行して、結果を確認してください。`,
              `  which ${v}`,
              ``,
              `パス(例: /usr/local/bin/${v})が表示されたら、その全部を "command" に書き写してください。`,
              `何も表示されない場合は、そのプログラム自体がまだインストールされていません。`,
            ].join("\n"),
            fix: `which ${v}`,
          }
        : {
            title: `${f.server}: command "${v}" not found on PATH`,
            body: [
              `Run "which ${v}" in a terminal.`,
              `If it prints a path, copy that full path into "command".`,
              `If it prints nothing, the program is not installed yet.`,
            ].join("\n"),
            fix: `which ${v}`,
          };

    case "COMMAND_PATH_MISSING":
      return ja
        ? {
            title: `${f.server}: command のパスが存在しません`,
            body: `指定されたファイルが見つかりません。\n  ${v}\nパスの打ち間違い、またはファイルを移動・削除した可能性があります。`,
          }
        : {
            title: `${f.server}: command path does not exist`,
            body: `Not found: ${v}`,
          };

    case "TILDE_NOT_EXPANDED":
      return ja
        ? {
            title: `${f.server}: パスに ~ が使われています`,
            body: [
              `Claude Desktop は ~ をホームフォルダに置き換えてくれません。そのままの文字として扱われ、失敗します。`,
              `  ${v}`,
              ``,
              `/Users/あなたの名前/... のように、先頭から全部書いた絶対パスにしてください。`,
              `ターミナルで echo $HOME を実行すると、書き換えるべき文字列が分かります。`,
            ].join("\n"),
            fix: "echo $HOME",
          }
        : {
            title: `${f.server}: "~" is not expanded`,
            body: `Claude Desktop does not expand ~. Use a full absolute path instead of: ${v}`,
            fix: "echo $HOME",
          };

    case "ARG_RELATIVE_PATH":
      return ja
        ? {
            title: `${f.server}: 相対パスが使われています`,
            body: `"${v}" は相対パスです。Claude Desktop はどのフォルダを基準にするか分からないため、必ず失敗します。\n/ で始まる絶対パスに書き換えてください。`,
          }
        : {
            title: `${f.server}: relative path used`,
            body: `"${v}" is relative. Use an absolute path starting with /.`,
          };

    case "BUILD_MISSING":
      return ja
        ? {
            title: `${f.server}: ビルドがまだ実行されていません`,
            body: [
              `dist フォルダが存在しません。TypeScript で書かれたMCPサーバーは、一度ビルドしないと動きません。`,
              `ダウンロードしただけ・git clone しただけの状態がこれにあたります。`,
              ``,
              `ターミナルで次の1行を実行してください。`,
            ].join("\n"),
            fix: `cd "${f.data.projectDir}" && npm install && npm run build`,
          }
        : {
            title: `${f.server}: the project has not been built`,
            body: `The dist folder does not exist. TypeScript servers must be built once before use.`,
            fix: `cd "${f.data.projectDir}" && npm install && npm run build`,
          };

    case "BUILD_OUTPUT_MISSING":
      return ja
        ? {
            title: `${f.server}: ビルド結果のファイルが見つかりません`,
            body: [
              `dist フォルダはありますが、指定されたファイルがその中にありません。`,
              `  ${v}`,
              ``,
              `ビルドが途中で失敗しているか、ファイル名が違う可能性があります。もう一度ビルドし直してください。`,
            ].join("\n"),
            fix: `cd "${f.data.projectDir}" && npm run build && ls dist`,
          }
        : {
            title: `${f.server}: build output file is missing`,
            body: `dist exists but ${v} is not inside it. Rebuild and check the file name.`,
            fix: `cd "${f.data.projectDir}" && npm run build && ls dist`,
          };

    case "ARG_PATH_MISSING":
      return ja
        ? {
            title: `${f.server}: 指定されたファイルがありません`,
            body: [
              `  ${v}`,
              ``,
              `パスの打ち間違い、またはフォルダを移動した可能性があります。`,
              `Finder で目的のファイルを右クリックし、Option キーを押しながら「"..."のパス名をコピー」を選ぶと、正しい絶対パスをコピーできます。`,
            ].join("\n"),
          }
        : {
            title: `${f.server}: file does not exist`,
            body: `${v}\n\nCheck for a typo, or copy the correct absolute path from Finder / Explorer.`,
          };

    case "ARGS_NOT_ARRAY":
      return ja
        ? {
            title: `${f.server}: args は [ ] の配列で書きます`,
            body: '例: "args": ["/Users/name/project/dist/index.js"]',
          }
        : {
            title: `${f.server}: "args" must be an array`,
            body: 'Example: "args": ["/Users/name/project/dist/index.js"]',
          };

    case "ARG_NOT_STRING":
      return ja
        ? {
            title: `${f.server}: args の中身は文字列にします`,
            body: '数字や true をそのまま書かず、"8080" のように " " で囲んでください。',
          }
        : {
            title: `${f.server}: args entries must be strings`,
            body: 'Wrap values in quotes, e.g. "8080".',
          };

    case "ENV_NOT_OBJECT":
      return ja
        ? {
            title: `${f.server}: env は { } で書きます`,
            body: '例: "env": { "API_KEY": "..." }',
          }
        : {
            title: `${f.server}: "env" must be an object`,
            body: 'Example: "env": { "API_KEY": "..." }',
          };

    case "ENV_VALUE_NOT_STRING":
      return ja
        ? {
            title: `${f.server}: env の "${f.data.key}" は文字列にします`,
            body: '環境変数の値は必ず " " で囲んだ文字列にしてください。',
          }
        : {
            title: `${f.server}: env value "${f.data.key}" must be a string`,
            body: "Environment variable values must be quoted strings.",
          };

    case "ENV_SECRET_INLINE":
      return ja
        ? {
            title: `${f.server}: env の "${f.data.key}" にAPIキーらしき文字列があります`,
            body: [
              `動作はしますが、この設定ファイルを誰かに見せたりスクリーンショットを撮ったりすると、そのまま漏れます。`,
              `画面共有・不具合の相談で貼り付ける前に、必ずこの部分を伏せてください。`,
              `もし既にどこかに貼ってしまった場合は、発行元のサイトでそのキーを削除して作り直してください。`,
            ].join("\n"),
          }
        : {
            title: `${f.server}: env "${f.data.key}" looks like an API key`,
            body: [
              `This works, but the key will leak if you share this file or a screenshot.`,
              `Mask it before posting anywhere. If it is already exposed, revoke and reissue it.`,
            ].join("\n"),
          };

    default:
      return { title: f.code, body: "" };
  }
}
