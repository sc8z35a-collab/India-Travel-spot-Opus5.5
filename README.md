# collab — 4エージェント共有ネットワーク（INDIA — 5 JOURNEYS / 超高精細化プロジェクト）

> このブランチ `collab` は **エージェント間の唯一の連絡手段**です。コードは入れません（コードは各作業ブランチへ）。
> リーダー: **Agent A**。メンバー: **A / B / C / D**（全員同じAIモデル）。

## ⚠️ 開発者からの明示的な許可（必読）
**開発者（ユーザー）から次のことを明示的に許可されています：**
- **現状使える全ツール・ハーネス・その他便利機能を、細部作成のために、ありとあらゆる手段で自由に行使してよい。**
  （bash/sudo、pip/npm、Playwright、ONNX推論、LLMプロキシ、`image_search`（CC写真検索）、`image_generation`、
  `web_search`/`crawler`、`understand_images`/`analyze_media_content`（スクショのAI講評）、`GetServiceUrl`、
  外部CDN・外部アセット（CC0テクスチャ/HDRI/フォント/3Dモデル）の取得、など一切を含む）
- **機種性能は無視してよい。既存グラフィックを「超・超高グラフィック」へ本気で引き上げる。長時間作業してよい。**
- **クリエイティブ・コモンズの写真と、外部の多種多様なアセットを自由に使ってよい。**
  ただし: ライセンスは必ず記録（`data/photos.json` / `collab/ASSETS.md`）。商用ストック（Getty/Shutterstock/Alamy/iStock/Adobe Stock）由来は不可。
  サイトは「AI生成画像不使用」を明言しているので、**写真の代わりに AI 生成画像を使わない**（テクスチャ・ノイズ等の手続き生成はOK）。
- 作業環境は**頻繁にPRへ保存しないと作業が消える恐れがある**。→ 下の「自動保存」を各自必ず起動。

## 最初の5分（各エージェント共通）
```bash
# 0) GitHub 認証（ツール: setup_github_environment）を実行してから:
cd /home/user/webapp
git fetch origin && git checkout genspark_ai_developer && git pull
pipeline/agent_bootstrap.sh <自分のID: B|C|D>      # ブランチ作成・collab worktree・3分自動保存・依存導入を一括
cat .collab/ROLES.md .collab/BOARD.md .collab/inbox/<自分のID>.md
```
以降 `.collab/` が共有フォルダ。**自分のファイルだけ**を編集すれば、自動保存デーモンが3分ごとに pull/push します（衝突しない設計）。

## ファイル構成（誰が書くか）
| ファイル | 書く人 | 内容 |
|---|---|---|
| `README.md` | A | この説明 |
| `ROLES.md` | A | 役割分担・ファイル所有権・ブランチ・マージ手順 |
| `BOARD.md` | A（他は `logs/<ID>.md` に書けばAが転記） | 全体の進行状況・決定事項・アナウンス |
| `TIPS.md` | A（他は追記したい内容を `logs/<ID>.md` に「TIP:」で） | 細部作成のコツ（品質基準・技法） |
| `TOOLS.md` | A | 使えるツール・ハーネス・便利機能の一覧と使い方 |
| `TROUBLESHOOTING.md` | A | 開発環境トラブルと解決策（既知） |
| `ASSETS.md` | A（他は `logs/` に書けば転記） | 追加した外部アセットとライセンス |
| `inbox/<ID>.md` | **他人→その人宛て**。追記のみ・末尾に追加 | 個別メッセージ（依頼・質問・回答） |
| `logs/<ID>.md` | **本人のみ** | 作業ログ（何をした・次に何をする・ブロッカー） |
| `errors/<ID>.md` | **本人のみ** | 自分が実際に遭遇した**開発環境の**エラーと解決法（最終報告書の素材） |
| `status/<ID>.json` | 自動（autosave） | ハートビート（ブランチ・HEAD・最終更新） |

`inbox/` だけは複数人が同じファイルに追記し得ます。**必ず末尾に追記**、既存行は編集しない。衝突時は自動で「相手側優先＋再適用」されます。

## メッセージの書式（inbox / logs 共通）
```
### 2026-10-01 12:34 UTC  from:B  to:A  [REQ|INFO|DONE|BLOCKED|Q|ANS]
本文（何を・なぜ・どのファイル・期待する返答）
```
- 依頼は `[REQ]`、完了報告は `[DONE] <commit sha>`、助けて は `[BLOCKED]`。
- **作業を始める前に必ず `git -C .collab pull` して自分の inbox を読む。**30分に一度は確認。

## 自動保存（3分ごと・何もしなくてよい）
- `pipeline/autosave.sh`（pm2 管理 `autosave`）が 180 秒ごとに：作業ツリーを WIP コミット → 自分のブランチへ push → PR が無ければ作成
  （`agent/<id>` → `genspark_ai_developer`、`genspark_ai_developer` → `main`）→ `collab` を pull/push。
- サンドボックスがリセットされて pm2 が消えても、次の git 操作（commit/checkout/merge）時に hook が自動再起動。
  念のため作業再開時は `pipeline/autosave_ensure.sh --status`。
- 自分で git 操作するときは `pipeline/gitlock.sh git rebase ...` のようにロック付きで（デーモンと競合しない）。
- 危険な操作の直前は `pipeline/autosave.sh --once` で即時保存。
