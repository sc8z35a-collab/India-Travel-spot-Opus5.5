# TOOLS — 使えるツール・ハーネス・便利機能の共有（開発者から「全部自由に使ってよい」と明示許可済み）

## ハーネス（エージェントが呼べるツール）
| ツール | 用途 | コツ |
|---|---|---|
| `Bash`（`run_in_background` 可） | 何でも。毎回 cwd が `/home/user` に戻る → **必ず `cd /home/user/webapp && ...`** | 長い処理は background + `BashOutput`。sudo はパスワード無しで可 |
| `Read` / `Write` / `Edit` / `MultiEdit` / `Glob` / `Grep` / `LS` | ファイル操作 | `Read` は **画像（jpg/png）も見られる** → スクショ目視確認に使う。Write/Edit 前に Read 必須 |
| `setup_github_environment` | git/gh の認証 | **サンドボックスのリセット後は毎回最初に実行** |
| `image_search` | **CCライセンス写真の検索**（ライセンスフィルタ内蔵） | 結果の出典ページ・作者・ライセンスを `data/photos.json` に記録（B が管理）。商用ストック由来は不可 |
| `image_generation` | 画像生成 | **写真としては使わない**（サイトがAI画像不使用を宣言）。装飾テクスチャ等に使うなら A に相談 |
| `understand_images` | 画像のAI解析 | スクショ（`UploadFileWrapper` で URL 化）に「細部の粗」を指摘させる。デザイン講評に強い |
| `analyze_media_content` | 画像/動画の深い解析 | 複数スクショの比較講評 |
| `web_search` / `WebSearch` / `crawler` | 技術調査・外部アセットのURL/ライセンス確認 | three.js r169 の API 差分に注意（最新版の記事は r17x 以降のことがある） |
| `GetServiceUrl` | サンドボックス内HTTPの公開URL | `dist/` を `python3 -m http.server 8080` で配信 → 実機（スマホ）で確認できる |
| `UploadFileWrapper` / `DownloadFileWrapper` | ファイルのURL化／取得 | スクショ共有に便利 |
| `PlaywrightConsoleCapture` | URL を開いてコンソールログ収集 | 公開URLの JS エラー確認 |
| `TodoWrite` | タスク管理 | 長時間作業で自分の進捗を見失わない |
| `meta_info` | プロジェクトのメタ情報 | （今回は不要） |

## プロジェクト内のスクリプト（`/home/user/webapp/pipeline/`）
| コマンド | 内容 | 所要 |
|---|---|---|
| `python3 -m pipeline.run --only a6 --no-llm` | **テンプレ/CSS/JS → dist/ 再生成**（普段はこれだけ） | 1秒 |
| `python3 -m pipeline.run --skip-assets` | 写真以外をフルビルド（深度・地形・チャート・QA含む） | 数分 |
| `python3 -m pipeline.run --only a1` | 写真の取得・最適化（`data/photos.json` 変更後） | 長い |
| `python3 -m pipeline.run --only a1b` | 深度マップ推定（新しい写真に） | 写真1枚 ~10秒 |
| `python3 -m pipeline.quick_shot <page> top,map,...` | 横画面915×412・WebGL(SwiftShader)スクショ → `reports/mobile/q-*.jpg` + JSエラー一覧 | ~60秒 |
| `python3 -m pipeline.el_shot <page> "<css selector>" ...` | 要素ごとのスクショ → `reports/mobile/e-*.jpg` | ~40秒 |
| `python3 -m pipeline.audit [--gl] [page]` | 横はみ出し・文字クリップ・レール重なり・低解像度画像・JSエラーの全面監査 | 数分 |
| `python3 -m pipeline.run --only a9` | 全6ページの実機相当QA | 数分 |
| `pipeline/autosave_ensure.sh --status` | 自動保存デーモンの状態 | 即 |
| `pipeline/autosave.sh --once` | 今すぐ保存（commit+push+PR+collab同期） | 数秒 |
| `pipeline/gitlock.sh <git ...>` | 自動保存と競合しない git 操作 | — |
| `pipeline/agent_bootstrap.sh <ID>` | 新しいサンドボックスの一括セットアップ | 1分＋依存導入 |
| `pipeline/deploy_pages.sh` | dist/ を gh-pages へ公開（A のみ） | — |

## 外部アセットの入手先（CC0 / CC BY 中心）
- **three.js addons r169**：`https://unpkg.com/three@0.169.0/examples/jsm/<dir>/<File>.js` → `src/vendor/three/addons/<dir>/` に保存（相対 import `../../build/three.module.js` は `three` に書き換える必要あり。既存ファイルを参照）。
- **HDRI / テクスチャ（CC0）**：Poly Haven（`https://api.polyhaven.com/assets?t=hdris`、`https://dl.polyhaven.org/file/ph-assets/...`）、ambientCG（`https://ambientcg.com/api/v2/full_json?...`）。
- **写真**：`image_search`（CCフィルタ済み）、Wikimedia Commons API、Flickr（CCのみ）。`pipeline/tools/photo_sources.py` が原寸・作者・ライセンスを取得。
- **フォント**：Google Fonts（既に Cormorant Garamond / Shippori Mincho B1 / Zen Kaku Gothic New）。
- **地理データ**：Natural Earth（PD）、AWS Terrain Tiles（SRTM/GMTED、オープン）、NASA Blue Marble / Black Marble（PD）。

## LLM
- OpenAI互換プロキシ：環境変数 `OPENAI_API_KEY` / `OPENAI_BASE_URL`（`~/.bashrc`）または `~/.genspark_llm.yaml`。`pipeline/llm.py` の `chat()`。
- 失敗（クレジット切れ等）時は各エージェントがルールベースへフォールバック。
