# ROLES — 役割分担・ファイル所有権・ブランチ運用（リーダー: A）

## 目標
既存サイト（three.js r169 / WebGL2、横画面スマホ・全画面）を、**機種性能を無視した超・超高グラフィック**へ。
「細部」に執着すること：1px の縁取り、影の層、素材感、光、粒子、ゆらぎ、タイポの詰め、遷移の緩急、ロード中の見え方まで。
ただし **壊さない**：JS エラー 0、`?qa=1`（SwiftShader）でも起動、WebGL 不可時の静的フォールバック維持、横スクロール 0。

## ブランチ
| エージェント | 作業ブランチ | PR の向き |
|---|---|---|
| A（リーダー・統合） | `genspark_ai_developer` | → `main`（最終PR） |
| B | `agent/b` | → `genspark_ai_developer` |
| C | `agent/c` | → `genspark_ai_developer` |
| D | `agent/d` | → `genspark_ai_developer` |

- 各自は **自分のブランチだけ** に push（autosave が3分ごとに自動で行う）。
- A が定期的に `agent/*` を `genspark_ai_developer` へマージ。B/C/D は1〜2時間に一度 `git merge origin/genspark_ai_developer` で最新を取り込む（`pipeline/gitlock.sh git merge origin/genspark_ai_developer`）。
- **dist/ のHTML・CSS・JS は生成物**。コンフリクトしたら気にせず ours を取り、`python3 -m pipeline.run --only a6 --no-llm` で再生成（`.gitattributes` で自動化済み）。

## ファイル所有権（＝衝突ゼロの鍵）。**所有者以外は編集しない**。必要なら所有者の inbox に [REQ]。
既存の大きなファイルはモジュール分割済み：

| 領域 | A（リーダー / Core & Chrome） | B（Photo & Cinema） | C（World & Map） | D（Data Viz） |
|---|---|---|---|---|
| WebGL | `src/js/gl.js`（boot/loop）, `src/js/gl/core.js`（renderer・ポストFX・入力・DPR） | `src/js/gl/hero.js`, `src/js/gl/ambient.js`, 新規 `src/js/gl/b-*.js` | `src/js/gl/terrain.js`, 新規 `src/js/gl/c-*.js` | `src/js/gl/city.js`, 新規 `src/js/gl/d-*.js` |
| CSS（最後に読み込む層） | `src/css/fx-a-core.css` | `src/css/fx-b-photo.css` | `src/css/fx-c-world.css` | `src/css/fx-d-data.css` |
| DOM挙動（IIFE） | `src/js/site.js`（既存・下記の区画ルール）, `src/js/site/a-core.js` | `src/js/site/b-photo.js` | `src/js/site/c-world.js` | `src/js/site/d-data.js` |
| テンプレ（トップ） `templates/home/` | `intro`, `prep`, `credits` + `base.html`, `_macros.html`, `index.html` | `hero`（ローダー・ヒーロー・マーキー）, `regions` | `map`, `season` | `finder`, `compare`, `vs`, `robust` |
| テンプレ（地域） `templates/region/` | `overview`, `fit`, `sources` + `region.html` | `hero`, `highlights`, `food`, `gallery`, `next` | `itinerary`, `season`, `access` | `eval` |
| パイプライン | `run.py`, `a6`, `a7`, `a8`, `a9`, `audit.py`, `quick_shot.py`, `el_shot.py` | `a1_asset_curator`, `a1b_depth_mapper`, `tools/photo_sources.py`, `data/photos.json` | `a4_cartographer`, `a4b_terrain_sculptor` | `a3_score_analyst`, `a5_chart_designer` |
| データ | `data/config.json` | `data/regions/*.json` の写真ID欄（hero/gallery/highlights.photo/food_photo） | `data/regions/*.json` の coords/access | （スコアは変更しない） |

**既存の共有CSS**（`site.css` `mobile.css` `landscape.css` `polish.css` `graphics.css`）は **原則編集しない**。上書きは自分の `fx-*.css` で（後から読み込まれるので勝つ。必要なら詳細度を上げる）。どうしても削除が必要なら A に [REQ]。
**`src/js/site.js`**：既存の区画（`/* ---------------- xxx ---------------- */`）単位で所有。hero slideshow・lightbox・carousel・coverflow = B、map 区画 = C、finder・heatmap・axis explorer・VS・radar・season/holiday = D（季節のholidayフィルタは D）、それ以外 = A。**新機能は自分の `src/js/site/<x>.js` に書く**のが原則（衝突しない）。
**ベンダー**：`src/vendor/three/addons/**` に **新規ファイルを追加するのは誰でも可**（既存ファイルは変更禁止）。three は r169 固定 → `https://unpkg.com/three@0.169.0/examples/jsm/<path>` から取得。
**新規ファイル**は名前に自分のプレフィックス（`b-`, `c-`, `d-`）を付ければ誰でも作ってよい（例 `dist/assets/tex/c-clouds.webp`, `src/js/gl/d-glassRadar.js`）。

## イベント・API 契約（変更するときは BOARD に告知）
- site → gl：`hero:go`(index) / `map:focus`(region id) / `sheet:close`(key) / `axis:select`(axis id)
- gl → site：`map:pick`(region id)
- `gl/core.js` の export（`makeRenderer`, `makeComposer`, `loadTex`, `photoUrl`, `Gov`, `Input`, `DPR`(live binding), `QA` …）は A が後方互換を保つ。新しい共通機能が欲しければ A に [REQ]。
- 各シーンクラスは `frame(dt, now)` / `visible` / `ready` を持つこと（gl.js のループが呼ぶ）。新シーンを足したら A に [REQ] で gl.js の boot に登録依頼（または自分の `gl/x-*.js` 内で `window.__glScenes?.push(...)` …は禁止、必ず A 経由）。

## 品質ゲート（各自 push 前に）
1. `python3 -m pipeline.run --only a6 --no-llm`（数秒）でビルド
2. `python3 -m pipeline.quick_shot index.html top,map,compare` / `python3 -m pipeline.quick_shot jaipur/index.html top,highlights`
   → JSON の `errors` が空であること、`reports/mobile/q-*.jpg` を **Read ツールで目視**
3. 大きな変更後は `python3 -m pipeline.audit --gl index.html`（横はみ出し・クリップ・低解像度画像）
4. `understand_images` にスクショURLを渡して「細部の粗」をAI講評させるのも有効（TOOLS.md）

## 完了の定義
- 自分の担当範囲の「細部アップグレード一覧」（inbox/<ID>.md のキックオフ参照）をやり切る
- `logs/<ID>.md` に最終報告、`errors/<ID>.md` に **実際に遭遇した開発環境エラーと解決法** を全部書く（A が最終 md にまとめる）
- BOARD に `[DONE] agent X — final sha <sha>` と書いて終了
