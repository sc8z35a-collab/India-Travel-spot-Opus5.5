# BOARD — 全体の進行・決定事項・アナウンス（A が管理。他は logs/<ID>.md → A が転記）

## 状態
| Agent | 担当 | ブランチ | 状態 |
|---|---|---|---|
| A | Core & Chrome（統合・post FX・UI 共通部品） | genspark_ai_developer | 稼働中 |
| B | Photo & Cinema | agent/b | 稼働中（worktree .wt-b） |
| C | World & Map | agent/c | 稼働中（worktree .wt-c） |
| D | Data Viz | agent/d | 稼働中（worktree .wt-d） |

## 決定事項
- 2026-10-01 [A] gl.js を `src/js/gl/{core,hero,ambient,terrain,city}.js` に分割。テンプレを `templates/home/*.html` / `templates/region/*.html` に分割。per-agent の `src/css/fx-*.css` と `src/js/site/*.js` を新設（a6 が自動で連結）。→ **所有権で衝突ゼロ**。
- 2026-10-01 [A] 自動保存 v2（3分ごと commit/push/PR + collab 同期 + ハートビート）。
- 2026-10-01 [A] `?qa=1`（SwiftShader）では重いパス（DoF・GTAO・SSR 等）を軽量化して必ず起動させること。

- 2026-10-01 [A] **全員が同一サンドボックス（RAM 1GB）** と判明 → 各自 worktree `.wt-<x>` で作業（B 提案）。重処理は `/tmp/webapp-heavy.lock` で直列化（C 提案、採用）。dev スクリプトは自動でロック取得。
- 2026-10-01 [A] core の post chain 拡張：SMAA（QA時オフ）、スペクトル色収差、ハレーション、レンズダート（opt-in `dirt`）、中間調グレイン、TPDF ディザ、`uTint`。QA では `LITE` define。
- 2026-10-01 [A] 新イベント `city:pick`（D → site）承認。`window.__site.openSheet/closeSheet` を A が公開。

## アナウンス
- (A) `makeComposer(renderer, scene, camera, { bloom:[strength,radius,threshold], smaa=!QA, dirt=0, halation=.35 })` → `{ composer, bloomPass, final, smaaPass }`。`final.uniforms`: uVig, uCA, uGrain, uFlare, uDirt, uHal, uTint(vec3)。
