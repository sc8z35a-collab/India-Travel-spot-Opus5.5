# logs/D.md — Agent D の作業ログ（本人のみ編集）


### 2026-10-01 10:45 UTC  [INFO] 枠取り — **私は D エージェント（Data Viz）として動きます**
- `agent/d` を origin に作成して枠を確保。B/C と同じく同一サンドボックス → worktree `/home/user/webapp/.wt-d`（agent/d）と collab の別クローン `.collab-d/` を使用（`.git/info/exclude` 登録済み）。A の作業ツリーには触れない。
- 所有: gl/city.js, gl/d-*.js, fx-d-data.css, site/d-data.js, templates home/{finder,compare,vs,robust}, region/eval, a3/a5。
- 着手順: ①ScoreCity ショールーム化（ガラス/宝石柱・PolyHaven HDRI・反射床・大理石台座・軸スポット・raycast で `city:pick`）②SVGチャート（レーダー・ヒートマップ・メダル・VS・ロバスト分布）③評価カードの液体メーター

### 2026-10-01 11:15 UTC  [DONE] c6aab77 — ScoreCity ショールーム版（PR #8 agent/d → genspark_ai_developer）
- 柱: MeshPhysical 透過ガラス（ior 1.52・dispersion・iridescence・地域色の attenuation）＋発光フィラメント芯、天面に金の刻印スコア（ギョーシェ環）、真鍮の台座リング、接地AO
- 台座: ambientCG Marble016（黒大理石 color/normal/roughness）＋ Marble021（白）帯、金の象嵌グリッド・四隅ロゼット、側面にピエトラ・ドゥーラ花帯（手続き生成）、床際の発光シーム
- 床: Reflector（25tap ぼかし＋フレネル）で研磨大理石の映り込み、Poly Haven brown_photostudio_02 HDRI で IBL
- 光: 4096 PCF 影、選択列へ滑る SpotLight＋体積光カーテン（ノイズ塵）、ガラス柱の疑似コースティクス、上昇スパーク 900 粒
- UI: 地域名をエナメル＋金縁の銘板、軸ラベルは base.html の ax-* アイコンを Path2D で金エンボス描画、選択軸に値のカウントアップ銘板、webfont ロード後に再描画
- タップ → `city:pick` {region, axis} → site/d-data.js が軸チップ切替＋該当ヒートマップセルの採点理由ドロワーを開く
- `?qa=1`: 透過・Reflector・HDRI・コースティクスを無効化（SwiftShader で 50 秒以内に撮影、エラー 0）
- 新ツール `pipeline/d_shot.py`（要素クリップ撮影、--full で実機パス、共有ロック内蔵）
- ASSET: dist/assets/tex/d-studio_1k.hdr — https://polyhaven.com/a/brown_photostudio_02 — Sergej Majboroda — CC0
- ASSET: dist/assets/tex/d-marble-black{,-n,-r}.jpg — https://ambientcg.com/view?id=Marble016 — ambientCG — CC0
- ASSET: dist/assets/tex/d-marble-white.jpg — https://ambientcg.com/view?id=Marble021 — ambientCG — CC0
- 未着手（次の担当者/次セッション向け）: fx-d-data.css（ヒートマップ金属刻印・王冠、メダルの conic 金属、VS 稲妻分割線、ロバスト3重リング＋20,000通りドット分布、評価カードの液体メーター）、a5 レーダーの目盛り数字、`--full` 実機パスの目視確認
