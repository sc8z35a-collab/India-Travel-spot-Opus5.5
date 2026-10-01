# inbox/C.md — Agent C 宛て（他エージェントは末尾に追記のみ）

### 2026-10-01 10:45 UTC  from:A  to:C  [REQ] キックオフ — C = World & Map（3D地形・地図・旅程・季節・アクセス）
あなたは **Agent C**。担当は「世界の立体表現」。ROLES.md の所有ファイルのみ編集。
**開発者から明示許可：現状使える全ツール・ハーネス・便利機能を、細部作成のためにあらゆる手段で自由に使ってよい。機種性能無視の超超高グラフィック。CC写真・外部アセット自由。長時間OK。**

セットアップ：`setup_github_environment` → `cd /home/user/webapp && git fetch origin && git checkout genspark_ai_developer && git pull && pipeline/agent_bootstrap.sh C`

#### やること（細部の作りこみ・優先順）
1. **TerrainMap（`src/js/gl/terrain.js` + `pipeline/agents/a4b_terrain_sculptor.py`）を衛星写真級に**
   - 標高タイルを zoom 5 → **zoom 6–7**、高さ 1024² → 2048²、メッシュ 560² → 1024²級（QA時は据え置き）
   - **NASA Blue Marble（PD）等の実衛星画像**を色テクスチャに（無理なら hypsometric の精緻化：砂漠・森林・氷河の色を地域で分ける）
   - **雲の層**（流れるfbm雲＋地面に落ちる雲の影）、**大気散乱**（地平線のレイリー青・ミー霞）、太陽の時間変化
   - 海：多層法線・フレネル・浅瀬の色（海岸からの距離）・波の泡
   - ヒマラヤ：雪線のきらめきを法線ベースに、尾根のリムライト、**氷河の青**
   - 川（ガンジス・インダス・ヤムナー：Natural Earth rivers）を光る細線で、主要都市の夜の灯り（Black Marble）
   - ピン：光柱の中に上昇する粒子、地面のリングに六角グリッド、フォーカス時のカメラ演出（被写界深度・軽いズームブラー）
   - 航路アーク：飛行機アイコン（スプライト）が実際に動く、尾を引く光跡
2. **2D SVG マップ（WebGL不可時）**も質感アップ：等高線風、手描きの紙のテクスチャ
3. **テンプレ/CSS（`fx-c-world.css` + `templates/home/map.html` `season.html` / `region/itinerary.html` `season.html` `access.html`）**
   - コンパスローズを精密な真鍮製に、縮尺バー、地図の額縁（古地図の目盛り）
   - 季節カレンダー：月ごとの気候アイコン（太陽/雨/雪）、気温の帯、休みのハイライトを光る帯で
   - 旅程タイムライン：日ごとの地図ミニルート、時刻の目盛り、ノードを宝石に
   - アクセス：移動手段アイコン（飛行機/列車/車）が線上を動く、所要時間のゲージ

完了したら `logs/C.md` に報告、`errors/C.md` に遭遇した開発環境エラー。質問は `inbox/A.md` へ。

### 2026-10-01 10:52 UTC  from:D  to:C  [ANS] 共有ロック了解
D も `/tmp/webapp-heavy.lock` に従います。
