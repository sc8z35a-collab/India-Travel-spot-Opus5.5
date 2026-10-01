# TROUBLESHOOTING — 開発環境のトラブルと解決策（A が管理。新しいものは errors/<ID>.md に書く → A が転記）

> 制作物（サイト）のバグではなく、**開発環境そのもの**のトラブル集。

## サンドボックス / シェル
| 症状 | 原因 | 解決 |
|---|---|---|
| コマンドが前のディレクトリで動かない／`No such file` | Bash ツールは毎回 cwd=`/home/user` で始まる | 必ず `cd /home/user/webapp && ...` を前置 |
| `ls` すら返らない・タイムアウト連発 | メモリ枯渇（RAM ~1GB, swap 127MB）でフリーズ | `ResetSandbox` ツール → 再起動後 `setup_github_environment` → `pipeline/agent_bootstrap.sh <ID>`。原因プロセス（Chromium・ONNX）を同時に動かさない |
| pm2 のプロセスが全部消えた | サンドボックス再起動で pm2 デーモンごと消える | `pipeline/autosave_ensure.sh`（git 操作時に hook が自動実行もする） |
| 2分でコマンドが打ち切られる | Bash ツールのデフォルト timeout 120s | `timeout` パラメータ（最大 600000ms）か `run_in_background: true` |
| `python3 -m playwright` が無い | 新しいサンドボックスには未導入 | `pip install playwright && python3 -m playwright install --with-deps chromium`（~2分、bootstrap が背景で実行） |

## git / GitHub
| 症状 | 原因 | 解決 |
|---|---|---|
| `git push` が認証で止まる／403 | 認証情報がリセットされた | `setup_github_environment` を再実行。`GIT_TERMINAL_PROMPT=0` で無限待ちを防止（autosave は設定済み） |
| push rejected (non-fast-forward) | 他エージェント/自動保存が先に push | `pipeline/gitlock.sh git pull --rebase`。dist の衝突は `git checkout --ours dist/... && python3 -m pipeline.run --only a6 --no-llm` |
| `index.lock exists` | 中断された git 操作 | 他の git が動いていないことを確認して `rm -f .git/index.lock` |
| PR 作成で `No commits between` | ブランチが base と同じ | 何か commit してから（autosave は次サイクルで自動作成） |
| 100MB超のファイルで push 失敗 | GitHub の制限 | autosave は 95MB 超を自動除外。手動なら `.gitignore` へ |
| `merge=ours` が効かない | ドライバ未登録（クローンごとに必要） | `git config merge.ours.driver true`（bootstrap/autosave_ensure が実行） |

## ブラウザ / WebGL QA
| 症状 | 原因 | 解決 |
|---|---|---|
| ヘッドレスで WebGL が `gl-off` | GPU なし | `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`（quick_shot 等は設定済み）、URL に `?qa=1` |
| スクショが真っ黒／途中 | SwiftShader が遅く描画前に撮影 | 待機を 6–10 秒に。重い Pass は `QA` 時に軽量化 |
| `page.screenshot` タイムアウト | 1フレームが重すぎる | `timeout=45000` + 失敗しても続行（a9 は実装済み）。`QA` 時の解像度・サンプル数を下げる |
| Chromium 起動で OOM | 他の重いプロセスと同時実行 | ONNX推論・ビルドと同時に走らせない。`browser.new_context()` をページごとに閉じる |

## Python / パイプライン
| 症状 | 原因 | 解決 |
|---|---|---|
| Wikimedia から 429/403 | レート制限 | a1 が指数バックオフ＋fallback。`HEADERS` の User-Agent を必ず付ける |
| AVIF 保存で例外 | Pillow の AVIF 非対応ビルド | Pillow ≥ 11.3（AVIF 内蔵）。無ければ a1 が WebP/JPEG のみに自動切替 |
| ONNX 推論で強制終了 | メモリ | a1b は別プロセス実行（`HEAVY` タスク）。他を止めてから |
