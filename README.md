# aidev

GitHub Issue を起点に、計画 → 実装 → レビュー → PR 作成 → CI 監視 → マージまでを自動で行う開発ループツール。

[Claude Code SDK](https://docs.anthropic.com/en/docs/claude-code) を使い、各フェーズを Claude エージェントが実行する。

## 前提条件

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) がインストール済みで認証済み
- [GitHub CLI (`gh`)](https://cli.github.com/) がインストール済みで認証済み
- [bun](https://bun.sh/) がインストール済み

## セットアップ

```bash
bun install
bun run build
```

## コマンド

### `run` — Issue を処理する

```bash
node dist/index.js run --issue <number> --repo <owner/name> --cwd <path>
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--issue <number>` | GitHub Issue 番号（必須） | — |
| `--repo <owner/name>` | GitHub リポジトリ | 自動検出 |
| `--cwd <path>` | 作業ディレクトリ | カレントディレクトリ |
| `--auto-merge` | CI 通過後に自動マージ | `false` |
| `--dry-run` | push / PR 作成 / マージをスキップ | `false` |
| `--resume` | 前回の実行を途中から再開 | — |
| `--max-fix-attempts <n>` | CI 失敗時の最大修正回数 | `3` |
| `--claude-path <path>` | Claude Code バイナリのパス | PATH から自動検出 |

#### 自動マージ

以下のいずれかで自動マージが有効になる:

- `--auto-merge` フラグを指定
- Issue に `auto-merge` ラベルを付与

### `watch` — ラベル付き Issue を監視

```bash
node dist/index.js watch --repo <owner/name> --cwd <path>
```

指定ラベル（デフォルト: `ai:run`）の Issue を定期的にポーリングし、見つかったら `run` を実行する。

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--label <label>` | 監視するラベル | `ai:run` |
| `--interval <seconds>` | ポーリング間隔（秒） | `30` |

### `status` — 実行状態を確認

```bash
node dist/index.js status <run-id>
```

## ワークフロー

```
init          Issue 取得、ブランチ作成
  ↓
planning      Claude がコードベースを調査し、実装計画を策定
  ↓
implementing  Claude が計画に基づいて実装
  ↓
reviewing     Claude が diff をレビュー（approve or changes_requested）
  ↓           ← changes_requested の場合 implementing に戻る
committing    git commit
  ↓
creating_pr   git push → PR 作成
  ↓
watching_ci   CI の結果をポーリング（最大10分）
  ↓           ← CI 失敗の場合 fixing → watching_ci のループ（最大3回）
merging       PR をマージ（auto-merge 有効時のみ）
  ↓
closing_issue Issue をクローズ
  ↓
done
```

## 開発

```bash
# テスト
bun run test

# ビルド
bun run build
```

## 実行ログ

実行状態は `~/.devloop/runs/<run-id>/` に保存される。`--resume` で途中から再開可能。
