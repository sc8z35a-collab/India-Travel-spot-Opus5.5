# errors/A.md — Agent A が実際に遭遇した「開発環境」のエラーと解決法（本人のみ編集）

書式:
```
## <短いタイトル>
- 症状: （エラーメッセージそのまま）
- 状況: （何をしていたか）
- 原因:
- 解決:
- 再発防止:
```

## SwiftShader(ヘッドレスChromium CPU描画)で WebGL コンテキストが連続ロスト → page.goto がタイムアウト
- 症状: `WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost` ×4、続いて `Page.goto: Timeout 120000ms exceeded.`（load イベントが来ない）
- 状況: 最終ポストパスに 1ピクセル約21回のテクスチャ参照（スペクトル色収差5 + 光芒12 + ハレーション16）を追加しただけ
- 原因: SwiftShader は CPU でフラグメントを処理するため、重いフルスクリーンパスを3キャンバス分回すと GPU ウォッチドッグ相当のタイムアウトでコンテキストが破棄される。ロード中に描画ループが回るので load も遅延
- 解決: `?qa=1` のときだけ `#define LITE` を入れて 3 タップ版に分岐（`final.material.defines.LITE = 1`）。重いパス（SMAA・DoF・GTAO等）も QA では無効
- 再発防止: 新しいポストパス/重いシェーダは必ず `QA` 分岐を用意してから quick_shot で確認。`pipeline/console_dump.py <page>` で全コンソールを見る

## ヘッドレス確認で「エラー0件」なのに実は失敗していた
- 症状: quick_shot が `{"classes": "js | ..."}` を返す（gl-on が無い）→ WebGL が初期化失敗していたが errors 欄は警告しか出ない
- 解決: classes に `gl-on gl-hero-on gl-map-on gl-amb-on` が揃っているかも必ず見る
