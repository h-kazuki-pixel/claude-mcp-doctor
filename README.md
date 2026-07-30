# claude-mcp-doctor

**Claude Desktop の MCP 設定を診断して、「次に何をすればいいか」まで教えるCLIツールです。**

MCPサーバーを設定したのに Claude に出てこない——その原因を探して、**そのままコピペできる解決コマンド**を表示します。プログラミングの知識がなくても使えるように作りました。

- ✅ **インストール不要** — 1行のコマンドを貼るだけ
- ✅ **日本語 / English 対応** — 環境から自動判定
- ✅ **依存パッケージゼロ** — 余計なものを一切ダウンロードしません
- ✅ **診断は読み取りのみ** — 修正は必ず確認とバックアップのうえで実行します

---

## 使い方

ターミナルに、次の1行を貼り付けて Enter を押すだけです。

```bash
npx claude-mcp-doctor
```

### ターミナルの開き方がわからない場合

| OS | 開き方 |
|---|---|
| **Mac** | `Command` + `スペース` を押す → `ターミナル` と入力 → Enter |
| **Windows** | スタートボタンを右クリック → 「ターミナル」または「PowerShell」 |

黒い(または白い)画面が出たら、そこに上のコマンドを貼り付けて Enter を押してください。

---

## 何を調べてくれるのか

| # | 検査項目 | 見つかる問題の例 |
|---|---|---|
| 1 | 設定ファイルの場所 | ファイルがまだ無い / 場所が違う |
| 2 | ファイルの形式(JSON) | カッコやカンマの過不足で読めなくなっている |
| 3 | **全角文字の混入** | 日本語入力のまま `,` や `:` を打って全角になっている |
| 4 | **リッチテキスト破損** | Mac のテキストエディットで保存して中身が壊れている |
| 5 | 余分なカンマ | サーバーを1つ消したときにカンマだけ残っている |
| 6 | BOM | 一部のエディタが先頭に付ける見えない文字 |
| 7 | command の存在 | `nodee` のような打ち間違い / PATH に無い |
| 8 | **ビルド忘れ** | `dist` フォルダが無い(clone しただけの状態) |
| 9 | パスの書き方 | 相対パス、`~` の使用(Claude Desktop は展開しません) |
| 10 | ファイルの実在 | `args` に書いたファイルが存在しない |
| 11 | APIキーの直書き | 設定ファイルに秘密情報がそのまま入っている |

---

## 実行例

```
$ npx claude-mcp-doctor

claude-mcp-doctor — Claude Desktop の MCP 設定を診断します
設定ファイル: /Users/me/Library/Application Support/Claude/claude_desktop_config.json

✖ [1] 全角文字が 1 個 混ざっています
   日本語入力(かな入力)のまま記号を打つと、見た目がそっくりな全角文字になります。
   Claude はこれを読み取れず、設定ファイル全体が無効になります。

     4行目 24文字目 : "，" → ,

   注意: 日本語の「値」の中にある全角文字は問題ありません。
        ここに出ているのは、記号として使われている位置のものだけです。

1件の問題 / 0件の注意

文字の問題は自動修正できます。次のコマンドを実行してください:
   npx claude-mcp-doctor --fix
```

「ビルド忘れ」が見つかった場合は、こう出ます。

```
✖ [1] jp-dates: ビルドがまだ実行されていません
   dist フォルダが存在しません。TypeScript で書かれたMCPサーバーは、一度ビルドしないと動きません。

   コピペして実行:
   cd "/Users/me/projects/jp-dates-mcp-server" && npm install && npm run build
```

---

## 自動修正について

```bash
npx claude-mcp-doctor --fix
```

自動修正の対象は、**文字レベルの問題だけ**です(全角文字・余分なカンマ・BOM)。

修正するときは、必ずこの順番を守ります。

1. どこをどう直すかを **差分で表示する**
2. `y` を入力してもらうまで **何も書き込まない**
3. 書き込む前に **バックアップを作る**(`claude_desktop_config.json.backup-日時`)
4. 直した結果が正しいJSONになることを確認してから書き込む

**原因が1つに絞れないときは、自動修正を行いません。** リッチテキスト破損のように、機械的に直すと別の壊し方をしてしまうケースは、はっきり断ったうえで手順だけを案内します。

---

## オプション

```
-p, --path <ファイル>   設定ファイルの場所を指定する
    --lang ja|en       表示言語を指定する(既定は環境から自動判定)
    --fix              文字の問題を確認のうえ自動修正する
    --no-color         色を使わない
-h, --help             ヘルプを表示する
-v, --version          バージョンを表示する
```

終了コード: `0` = 問題なし / `1` = 問題あり / `2` = 想定外のエラー

---

## 設定ファイルの場所

| OS | パス |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

---

## 先行ツールとの違い

同じ領域に [`mcp-doctor`](https://www.npmjs.com/package/mcp-doctor) と [`mcp-config-doctor`](https://www.npmjs.com/package/mcp-config-doctor) があります(どちらも v0.1.1)。調べたうえで、次の3点に絞って作りました。

1. **日本語環境で実際に起きる壊れ方を検出する** — 全角記号の混入、テキストエディットによるリッチテキスト破損。海外製のツールはこの2つを見ていません。
2. **「次に何をすればいいか」を日本語で出す** — エラー名だけでなく、その場でコピペできる解決コマンドを組み立てて表示します。
3. **依存パッケージがゼロ** — 診断ツール自体が余計なものを持ち込まない設計にしています。

「全角文字の検出」は、**文字列の外側(記号として使われている位置)だけ**を対象にしています。日本語の値に含まれる `、` や `：` は絶対に誤検出しません。ここはテストで固定してあります。

---

## 開発

```bash
npm install
npm run build
npm test
```

テストは依存パッケージを使わない自前のランナーで、165件を実行します。

---

## English

**Diagnose your Claude Desktop MCP configuration and get copy-paste fixes.**

```bash
npx claude-mcp-doctor
```

- Zero runtime dependencies
- Japanese / English output (auto-detected from your locale)
- Diagnosis is read-only; `--fix` always shows a diff, asks for confirmation, and creates a backup first
- Refuses to auto-fix when the cause is ambiguous

It checks the config file location, JSON validity, full-width and typographic characters in structural positions, RTF corruption from macOS TextEdit, trailing commas, BOM, whether `command` exists on PATH (with typo suggestions), missing builds (`dist` not found), relative paths and unexpanded `~`, missing files referenced in `args`, and API keys hardcoded into `env`.

Full-width characters are only reported when they appear **outside string values**, so Japanese text inside your config is never falsely flagged.

Options: `--path <file>`, `--lang ja|en`, `--fix`, `--no-color`, `--help`, `--version`.
Exit codes: `0` clean, `1` problems found, `2` unexpected error.

---

## License

MIT
