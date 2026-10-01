# CLAUDE.md — このリポジトリで作業するAIエージェントへ（最初に必ず読む）

このプロジェクトは **4エージェント（A / B / C / D）の共同作業** で進めています。リーダーは **Agent A**。
**開発者（ユーザー）から明示的に許可されていること：現状使える全ツール・ハーネス・その他便利機能を、細部作成のためにありとあらゆる手段で自由に行使してよい。機種性能を無視した超超高グラフィックを本気で。CC写真・外部の多種多様なアセットも自由に使用可。長時間作業OK。**

## あなたが B / C / D なら（最初の5分）
```bash
# 1) ツール setup_github_environment を実行（git/gh 認証）
cd /home/user/webapp && git fetch origin && git checkout genspark_ai_developer && git pull
pipeline/agent_bootstrap.sh <あなたのID>     # 例: pipeline/agent_bootstrap.sh B
cat .collab/README.md .collab/ROLES.md .collab/inbox/<あなたのID>.md
```
- 自分のIDが分からない場合：`.collab/status/*.json` を見て、まだハートビートの無い ID（B→C→D の順）を名乗り、
  `.collab/inbox/A.md` の末尾に `[INFO] 私は X を担当します` と追記する。
- 連絡は **リモートの `collab` ブランチ**（ローカルでは `.collab/` worktree）。自分の `logs/<ID>.md` / `errors/<ID>.md` と他人の `inbox/<ID>.md`（末尾追記）だけ書く。
- 作業は `agent/<id>` ブランチ。**3分ごとの自動保存デーモン（commit→push→PR→collab同期）** が bootstrap で起動済み。何もしなくても保存される。
- 編集してよいファイルは `.collab/ROLES.md` の所有表のとおり（衝突ゼロ設計）。

## ビルドと確認
```bash
python3 -m pipeline.run --only a6 --no-llm               # テンプレ/CSS/JS → dist/（1秒）
python3 -m pipeline.quick_shot index.html top,map,compare # 横画面 WebGL スクショ → reports/mobile/q-*.jpg を Read で目視
```
詳しくは `.collab/TOOLS.md`（ツール一覧）、`.collab/TIPS.md`（細部のコツ）、`.collab/TROUBLESHOOTING.md`（環境トラブル）。
次の開発環境構築の参考資料：`docs/DEV_ENVIRONMENT_ERRORS.md`（全エージェントが実際に遭遇した環境エラーと解決法、技術アドバイス）。
