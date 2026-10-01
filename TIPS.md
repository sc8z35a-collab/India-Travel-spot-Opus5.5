# TIPS — 細部作成のコツ（リーダーA記。追記は logs/<ID>.md に「TIP:」で → Aが転記）

## 0. 心構え
- **「近づいて見る」前提で作る。** 対象は DPR 3 の横画面スマホ。1 CSS px = 3 物理 px。0.5px の線、1px のハイライト、ノイズの粒度まで見える。
- **一要素に最低3層**：①素材（グラデ・テクスチャ・ノイズ）②光（スペキュラ・リム・発光）③影（接地影・キー影・環境影）。
- **静止画でも「生きている」**：極小のゆらぎ（呼吸 0.5–2%、0.1–0.3Hz）、粒子、光の移動。ただし `prefers-reduced-motion` では止める。
- **既存を壊さない**：変更は自分の `fx-*.css` / `gl/<x>-*.js` / `site/<x>.js` に足す。上書きのほうが安全。

## 1. CSS の細部
- 影は**多層**：`0 1px 1px rgba(0,0,0,.35), 0 6px 12px -4px rgba(0,0,0,.4), 0 24px 48px -24px rgba(0,0,0,.55)`（接地→キー→環境）。既に `--sh-1..3` がある。
- ガラス：`background: linear-gradient(165deg, rgba(255,255,255,.08), rgba(255,255,255,.02) 40%, rgba(0,0,0,.12)), rgba(20,16,13,.5)` + `backdrop-filter: blur(14px) saturate(1.4)` + `inset 0 1px 0 rgba(255,255,255,.1)`（上辺ハイライト）+ `inset 0 0 0 .5px rgba(255,255,255,.06)`（髪の毛の縁）。
- 金属文字：`background-clip: text` に **縦3〜5ストップ**＋`filter: drop-shadow` 2段。さらに `::after` で斜めのスペキュラ帯を `mix-blend-mode: screen` でスイープさせると一気に高級になる。
- **ノイズ／ディザ**：大きなグラデはバンディングする。SVG `feTurbulence` を `background-image` に重ねて opacity .03–.06。
- `@property` で数値をアニメ（`--g` の例が graphics.css にある）→ conic-gradient のリングや色相の滑らかな遷移。
- `color-mix(in oklab, ...)` を使うと中間色が濁らない（srgb より自然）。
- `text-wrap: balance / pretty`, `word-break: auto-phrase`（日本語の文節改行、Chrome 119+）。
- `mask-image` + `radial-gradient` で縁を柔らかく消す（写真の端・装飾）。`-webkit-mask` も併記。
- 画像の上の文字は `text-shadow` より **局所的な暗いグラデ（スクリム）** のほうが美しい。
- `:active` 状態を必ず作る（タッチ端末に hover はない）。押下で `scale(.97)` + 影を浅く。
- `will-change` は乱用しない（メモリ）。アニメ中のみ付ける。

## 2. WebGL（three r169）の細部
- **色空間**：テクスチャは `colorSpace = SRGBColorSpace`、データ（深度・法線・高さ）は `NoColorSpace`。間違えると白っぽく／暗くなる。
- **HDR → Bloom**：光らせたい部分だけ 1.0 超の値を出す（シェーダで `col * 3.0`）。トーンマップは `NeutralToneMapping`（core）。Bloom の threshold を下げすぎると全体が眠くなる。
- **ディザ**：最終パスで `+(hash(uv)-.5)/255.` を足すとグラデのバンディングが消える。
- **異方性フィルタ**：斜めに見る地面テクスチャは `anisotropy = renderer.capabilities.getMaxAnisotropy()`。
- **MSAA**：`WebGLRenderTarget({ samples: 4 })`（core で設定済み）。ポスト後のエッジは FXAA/SMAA を足すとさらに滑らか（`addons/postprocessing/SMAAPass.js` を unpkg から追加可）。
- **SSAO/GTAO**（`GTAOPass`）、**被写界深度**（`BokehPass`）、**SSR**、**God rays** はシーンの奥行きを劇的に増す。重いが「機種性能無視」許可あり。ただし `QA`（`?qa=1`）時は品質を落として SwiftShader でも数秒で描けるようにする。
- **環境マップ**：`RoomEnvironment` の代わりに CC0 HDRI（Poly Haven: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/<name>_1k.hdr`）＋ `RGBELoader` → PMREM。反射が「本物」になる。
- **法線は高さから再計算**（terrain の例）。ライティングの質はほぼ法線で決まる。
- **時間は `dt` で積分**し、`Math.min(dt, .05)` でクランプ（既に loop で実施）。
- GLSL：`smoothstep(e0, e1, x)` は **e0 < e1 必須**（逆は未定義。過去に14か所バグった）。`pow(負数, y)` も未定義 → `max(x, 0.)`。
- `gl_PointSize` は必ず clamp（カメラ直前で巨大化する）。
- `frustumCulled = false` は頂点シェーダで動かすメッシュ／点群に必要。
- シェーダの `precision highp float;` はモバイルで重要（ShaderMaterial は three が付与）。
- コンテキストロス対策は core の `makeRenderer` が持つ。**新しい canvas を作るときも必ず `makeRenderer` を使う**。
- DPR ガバナー（`Gov`）にリスナー登録して resize すること（`Gov.listeners.add(() => this.resize())`）。

## 3. 写真の細部
- 1枚ごとに `currentSrc` の幅 × DPR がボックス幅以上か（`pipeline.audit` が `upscaled` で報告）。
- 写真の「格」を上げる：わずかなビネット、局所コントラスト、色温度を地域アクセントへ 3–5% 寄せる（CSS `filter` か WebGL）。**画素の創作はしない**（AI生成不使用の宣言）。
- 深度マップ（Depth Anything V2）はパララックス・被写界深度・霧・光の差し込みに再利用できる（`DATA.depth[id]`）。

## 4. 動きの細部
- イージング：入場 `cubic-bezier(.22,1,.36,1)`（`--ease`）、往復 `(.76,0,.24,1)`。線形は避ける（スクロール連動のみ線形）。
- **スタッガー**は 40–80ms。全部同時は安っぽい、遅すぎるとだるい。
- スクロール連動はGSAP ScrollTrigger（読み込み済み）。`scrub: true` は transform/opacity のみ（レイアウトを揺らさない）。
- タップのフィードバックは 100ms 以内に（`navigator.vibrate(8)` は site.js の `vibrate()`）。

## 5. 確認のコツ
- `python3 -m pipeline.quick_shot <page> top,<sectionId>` → `reports/mobile/q-*.jpg` を **Read で必ず目で見る**。
- 要素単位：`python3 -m pipeline.el_shot index.html ".card" ".rank"` → `reports/mobile/e-*.jpg`。
- SwiftShader（CPU描画）は遅い。**待ち時間を長めに**（重いシーンは 6–10 秒）。DPR は 1 で撮るので、実機の繊細さはコードで担保。
- 公開URLで実機確認：`cd dist && python3 -m http.server 8080` を background で → `GetServiceUrl(8080)`。
- スクショを `UploadFileWrapper` で URL 化 → `understand_images` に「細部の粗を10個挙げて」と頼むと第三者の目になる。
