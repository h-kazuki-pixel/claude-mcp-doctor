/**
 * claude-mcp-doctor
 * 設定ファイルの「文字レベル」の問題を診断する。
 *
 * 設計方針(重要):
 *   全角文字は「文字列の外側(= JSONの構造部分)」にある場合だけ問題として扱う。
 *   日本語の値(例: "説明": "あ、い。") に含まれる全角文字は絶対に誤検出しない。
 */

/** 全角・紛らわしい記号 → 正しいASCII文字 の対応表 */
export const FULLWIDTH_MAP: Record<string, string> = {
  "\uFF0C": ",", // ，
  "\u3001": ",", // 、
  "\uFF1A": ":", // ：
  "\uFF1B": ";", // ；
  "\uFF5B": "{", // ｛
  "\uFF5D": "}", // ｝
  "\uFF3B": "[", // ［
  "\uFF3D": "]", // ］
  "\uFF08": "(", // （
  "\uFF09": ")", // ）
  "\uFF02": '"', // ＂
  "\u201C": '"', // “
  "\u201D": '"', // ”
  "\u2018": "'", // ‘
  "\u2019": "'", // ’
  "\u3000": " ", // 全角スペース
  "\u00A0": " ", // ノーブレークスペース(Webからのコピペで混入)
  "\uFF0E": ".", // ．
  "\uFF0F": "/", // ／
  "\uFF3C": "\\", // ＼
  "\uFF0D": "-", // －
  "\uFF3F": "_", // ＿
  "\uFF5C": "|", // ｜
};

const CHAR_LABEL: Record<string, string> = {
  "\u3000": "全角スペース",
  "\u00A0": "ノーブレークスペース",
};

export interface CharIssue {
  kind: "fullwidth" | "trailing-comma" | "bom";
  index: number;
  length: number;
  found: string;
  replacement: string;
  line: number;
  column: number;
  lineText: string;
}

export interface JsonDiagnosis {
  /** リッチテキスト(.rtf)として保存されてしまっている */
  rtfCorrupted: boolean;
  /** 先頭にBOMが付いている */
  hasBom: boolean;
  /** 自動修正できる文字レベルの問題 */
  issues: CharIssue[];
  /** JSON.parse に失敗したときのメッセージ */
  parseError: string | null;
  /** parseError の行番号(推定できた場合) */
  parseErrorLine: number | null;
  parseErrorLineText: string | null;
  /** パースに成功した場合の中身 */
  parsed: unknown;
}

function lineInfo(text: string, index: number): { line: number; column: number; lineText: string } {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  const column = index - lastBreak;
  const lines = text.split("\n");
  return { line, column, lineText: lines[line - 1] ?? "" };
}

/**
 * 文字列の内側かどうかを追跡しながら本文を走査する。
 */
function scanStructuralIssues(text: string): CharIssue[] {
  const issues: CharIssue[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue; // 文字列の中身は一切チェックしない
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    // --- ここから先は「文字列の外側」だけ ---
    const replacement = FULLWIDTH_MAP[ch];
    if (replacement !== undefined) {
      const info = lineInfo(text, i);
      issues.push({
        kind: "fullwidth",
        index: i,
        length: 1,
        found: ch,
        replacement,
        ...info,
      });
      continue;
    }

    // 末尾カンマ: , のあと空白を挟んで } または ] が来る
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (text[j] === "}" || text[j] === "]") {
        const info = lineInfo(text, i);
        issues.push({
          kind: "trailing-comma",
          index: i,
          length: 1,
          found: ",",
          replacement: "",
          ...info,
        });
      }
    }
  }

  return issues;
}

function extractErrorLine(text: string, message: string): number | null {
  const posMatch = /at position (\d+)/.exec(message);
  if (posMatch) {
    return lineInfo(text, Number(posMatch[1])).line;
  }
  const lineMatch = /line (\d+)/.exec(message);
  if (lineMatch) return Number(lineMatch[1]);
  return null;
}

export function diagnoseJson(raw: string): JsonDiagnosis {
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const text = hasBom ? raw.slice(1) : raw;

  const rtfCorrupted = /^\s*\{\\rtf/.test(text);

  const issues: CharIssue[] = [];
  if (hasBom) {
    issues.push({
      kind: "bom",
      index: 0,
      length: 0,
      found: "BOM",
      replacement: "",
      line: 1,
      column: 1,
      lineText: text.split("\n")[0] ?? "",
    });
  }

  if (!rtfCorrupted) {
    const firstPass = scanStructuralIssues(text);
    issues.push(...firstPass);

    // 全角記号は「1文字→1文字」の置換なので、直してもインデックスがずれない。
    // 直した状態でもう一度走査すると、「全角カンマが半角に直った結果あらわれる末尾カンマ」
    // のような連鎖した問題も、正しい位置のまま拾える。
    const fullwidthOnly = firstPass.filter((i) => i.kind === "fullwidth");
    if (fullwidthOnly.length > 0) {
      let repaired = text;
      for (const issue of fullwidthOnly) {
        repaired =
          repaired.slice(0, issue.index) + issue.replacement + repaired.slice(issue.index + 1);
      }
      const known = new Set(issues.map((i) => `${i.kind}:${i.index}`));
      for (const extra of scanStructuralIssues(repaired)) {
        if (!known.has(`${extra.kind}:${extra.index}`)) {
          issues.push({ ...extra, ...lineInfo(text, extra.index) });
        }
      }
      issues.sort((a, b) => a.index - b.index);
    }
  }

  let parsed: unknown = undefined;
  let parseError: string | null = null;
  let parseErrorLine: number | null = null;
  let parseErrorLineText: string | null = null;

  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
    parseErrorLine = extractErrorLine(text, parseError);
    if (parseErrorLine !== null) {
      parseErrorLineText = text.split("\n")[parseErrorLine - 1] ?? null;
    }
  }

  return {
    rtfCorrupted,
    hasBom,
    issues,
    parseError,
    parseErrorLine,
    parseErrorLineText,
    parsed,
  };
}

/**
 * 検出した文字レベルの問題を実際に修正した本文を返す。
 * (書き込みは行わない。呼び出し側の責任)
 */
export function applyCharFixes(raw: string): { fixed: string; applied: number } {
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  let text = hasBom ? raw.slice(1) : raw;

  let applied = hasBom ? 1 : 0;

  // 1回直すと別の問題が現れることがある(全角カンマ → 半角カンマ → 末尾カンマ)。
  // 変化しなくなるまで繰り返す。無限ループを防ぐため上限を設ける。
  for (let round = 0; round < 5; round++) {
    const issues = scanStructuralIssues(text);
    if (issues.length === 0) break;
    // うしろから置換する(インデックスがずれないように)
    const sorted = [...issues].sort((a, b) => b.index - a.index);
    for (const issue of sorted) {
      text = text.slice(0, issue.index) + issue.replacement + text.slice(issue.index + issue.length);
    }
    applied += issues.length;
  }

  return { fixed: text, applied };
}

export function describeChar(ch: string): string {
  if (CHAR_LABEL[ch]) return CHAR_LABEL[ch]!;
  return ch;
}
