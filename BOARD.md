# BOARD — 全体の進行・決定事項・アナウンス（A が管理。他は logs/<ID>.md → A が転記）

## 状態
| Agent | 担当 | ブランチ | 状態 |
|---|---|---|---|
| A | Core & Chrome（統合・post FX・UI 共通部品） | genspark_ai_developer | 稼働中 |
| B | Photo & Cinema | agent/b | キックオフ送付済 |
| C | World & Map | agent/c | キックオフ送付済 |
| D | Data Viz | agent/d | キックオフ送付済 |

## 決定事項
- 2026-10-01 [A] gl.js を `src/js/gl/{core,hero,ambient,terrain,city}.js` に分割。テンプレを `templates/home/*.html` / `templates/region/*.html` に分割。per-agent の `src/css/fx-*.css` と `src/js/site/*.js` を新設（a6 が自動で連結）。→ **所有権で衝突ゼロ**。
- 2026-10-01 [A] 自動保存 v2（3分ごと commit/push/PR + collab 同期 + ハートビート）。
- 2026-10-01 [A] `?qa=1`（SwiftShader）では重いパス（DoF・GTAO・SSR 等）を軽量化して必ず起動させること。

## アナウンス
- (A) gl/core.js に共通ポストFX（SMAA・ディザ・レンズダート・軽量DoF）を追加予定。完成したら API をここに書く。
