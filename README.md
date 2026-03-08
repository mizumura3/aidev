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

### `init` — リポジトリ設定ファイルを生成

```bash
bun run aidev init [--cwd <path>] [--force]
```

`.aidev.yml` を対象ディレクトリに生成する。リポジトリごとのデフォルト設定として使用される。

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--cwd <path>` | 生成先ディレクトリ | カレントディレクトリ |
| `--force` | 既存ファイルを上書き | `false` |

### `run` — Issue または PR を処理する

```bash
bun run aidev run --issue <number> --repo <owner/name> --cwd <path>
bun run aidev run --pr <number> --repo <owner/name> --cwd <path>
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--issue <number>` | GitHub Issue 番号 | — |
| `--pr <number>` | GitHub Pull Request 番号 | — |
| `--repo <owner/name>` | GitHub リポジトリ | 自動検出 |
| `--cwd <path>` | 作業ディレクトリ | カレントディレクトリ |
| `--auto-merge` | CI 通過後に自動マージ | `false` |
| `--base <branch>` | ブランチ作成元のベースブランチまたはタグ | `main` |
| `--dry-run` | push / PR 作成 / マージをスキップ | `false` |
| `--resume` | 前回の実行を途中から再開 | — |
| `--max-fix-attempts <n>` | CI 失敗時の最大修正回数 | `3` |
| `--claude-path <path>` | Claude Code バイナリのパス | PATH から自動検出 |
| `-y, --yes` | 実行前の確認プロンプトをスキップ | `false` |
| `--allow-foreign-issues` | 他ユーザーが作成した Issue の処理を許可 | `false` |
| `--backend <name>` | 使用するバックエンドランナー | `claude-code` |
| `--model <model>` | バックエンドで使用するモデル | — |

`--issue` と `--pr` は排他的で、**どちらか一方を必ず指定**する。

#### 実行確認

`run` コマンドは実行前に対象の Issue または PR の内容（タイトル・作成者・本文）を表示し、確認プロンプトを表示する。`-y` / `--yes` で確認をスキップできる。非対話環境（TTY でない場合）では確認は自動スキップされる。

#### プロンプトインジェクション対策

デフォルトでは、Issue / PR の作成者が認証ユーザー自身でない場合、`init` フェーズでエラーとなる。他ユーザーの Issue / PR を処理する場合は `--allow-foreign-issues` を指定する。

#### PR モード

`--pr <number>` を指定すると、既存の PR を直接改善対象として扱う。

- PR の `head` ブランチを checkout してそのブランチに push する
- 新しい PR は作らない
- `--auto-merge` を付けた場合は、既存 PR をそのまま merge する
- Issue は close しない

#### 自動マージ

以下のいずれかで自動マージが有効になる:

- `--auto-merge` フラグを指定
- Issue に `auto-merge` ラベルを付与

#### Issue / PR 本文でのワークフロー設定

Issue 本文または PR 本文に ` ```aidev ` コードフェンスを記述することで、ワークフローパラメータを指定できる。

````markdown
```aidev
maxFixAttempts: 5
autoMerge: true
base: release/1.3
skip:
  - reviewing
  - documenter
```
````

| パラメータ | 型 | 説明 |
|-----------|---|------|
| `maxFixAttempts` | number | CI 修正の最大試行回数 |
| `autoMerge` | boolean | CI 通過後に自動マージ |
| `dryRun` | boolean | push/PR/merge をスキップ |
| `base` | string | ブランチ作成元 |
| `skip` | string[] | スキップする工程（下記参照） |
| `backend` | string | 使用するバックエンドランナー |
| `model` | string | バックエンドで使用するモデル |

`skip` で指定可能な工程:

- `reviewing` — AI コードレビューをスキップ（creating_pr → watching_ci へ直行）
- `watching_ci` — CI 待ちをスキップ（reviewing → merging or done へ直行）
- `documenter` — ドキュメント更新チェックをスキップ

**優先順位**: CLI フラグ > Issue / PR 本文 > `.aidev.yml` > 環境変数 > デフォルト値

PR モードでは `base` のデフォルトが PR の `baseRefName` となり、そこに上記の優先順位で上書きされる。

#### バックエンド設定

`--backend` と `--model` でエージェント実行に使用するバックエンドを切り替えられる。環境変数でも設定可能:

```bash
export AIDEV_BACKEND=claude-code
export AIDEV_MODEL=claude-sonnet-4-6
```

### `watch` — ラベル付き Issue を監視して自動処理

```bash
bun run aidev watch --repo <owner/name> --cwd <path>
```

指定ラベル（デフォルト: `ai:run`）の Issue を定期的にポーリングし、見つかったら自動で開発ループを実行する。Issue に `auto-merge` ラベルがあれば CI 通過後に自動マージされる。

セキュリティのため、認証ユーザー自身が作成した Issue のみ処理される。他ユーザーの Issue はスキップされログに警告が出力される。

各 Issue は `.worktrees/issue-<number>` に作成される git worktree 内で処理されるため、複数 Issue を並行して安全に処理できる。worktree は処理完了後に自動で削除される。`.worktrees/` を `.gitignore` に追加することを推奨する。

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--label <label>` | 監視するラベル | `ai:run` |
| `--interval <seconds>` | ポーリング間隔（秒） | `30` |
| `--base <branch>` | worktree 作成元のベースブランチまたはタグ | `main` |
| `--cwd <path>` | 作業ディレクトリ | カレントディレクトリ |
| `--repo <owner/name>` | GitHub リポジトリ | 自動検出 |
| `--claude-path <path>` | Claude Code バイナリのパス | PATH から自動検出 |
| `--backend <name>` | 使用するバックエンドランナー | `claude-code` |
| `--model <model>` | バックエンドで使用するモデル | — |

### `status` — 実行状態を確認

```bash
bun run aidev status <run-id>
```

## ワークフロー

```
init          Issue 取得、ブランチ作成
  ↓
planning      Claude がコードベースを調査し、実装計画を策定
  ↓
implementing  Claude が計画に基づいて実装
  ↓
committing    git commit
  ↓
creating_pr   git push → PR 作成
  ↓
reviewing     Claude が diff をレビューし、結果を PR コメントとして投稿
  ↓           ← changes_requested の場合 fixing → reviewing のループ
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

## Slack 通知

ワークフロー完了時（成功・失敗）に Slack 通知を送信できる。環境変数で設定する。

### Webhook モード

```bash
export AIDEV_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
```

### Bot Token モード

```bash
export AIDEV_SLACK_BOT_TOKEN=xoxb-xxx
export AIDEV_SLACK_CHANNEL=C12345678  # チャンネル ID またはユーザー ID（DM）
```

両方設定した場合は両方に通知される。通知失敗はワークフローに影響しない（non-fatal）。

## 実行ログ

実行状態は `~/.devloop/runs/<run-id>/` に保存される。`--resume` で途中から再開可能。
