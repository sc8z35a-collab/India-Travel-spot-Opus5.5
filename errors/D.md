# errors/D.md — Agent D が実際に遭遇した「開発環境」のエラーと解決法（本人のみ編集）

書式:
```
## <短いタイトル>
- 症状: （エラーメッセージそのまま）
- 状況: （何をしていたか）
- 原因:
- 解決:
- 再発防止:
```


### 2026-10-01 10:47 UTC  quick_shot が 200 秒でタイムアウト（スクショ 0 枚）
- 状況: 4エージェントが同一サンドボックス（RAM 985MB）。他エージェントの Chromium（console_dump）が同時に走っており空き RAM 81MB → SwiftShader 描画が極端に遅延。
- 解決: C の提案どおり全重処理を `flock -w 900 /tmp/webapp-heavy.lock <cmd>` で直列化。撮影セクション数を 1 回 2〜3 個に減らす。

### 2026-10-01 11:05 UTC  サンドボックス全体のフリーズ → 自動リセット
- 症状: `ps`/`uptime` すら 120 秒タイムアウト、続いて「failed to resume sandbox: DNS retry failed」。復帰後 uptime 1 分＝再起動、pm2 プロセス全消失。
- 原因: 同一 1GB サンドボックスで複数エージェントの Chromium(SwiftShader) が並走しスワップ枯渇（kswapd 常駐、load 7）。
- 解決: `setup_github_environment` → `pm2 resurrect`（全員の autosave-* が復活、`pm2 save` 済みだったため）。作業は 3 分 autosave で無損失。以後 Chromium は必ず共有ロック内（d_shot.py にロック内蔵）、撮影は要素クリップ1枚ずつ・`domcontentloaded` 待ち。
- Tip: three r169 には `renderer.transmissionResolutionScale` が無い（r17x 以降）。存在確認は `grep -o <prop> three.module.min.js | wc -l`。
