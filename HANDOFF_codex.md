# 陸これ（仮）— 開発引き継ぎ書（Codex / 後任AI向け）

最終更新: 2026-06-16

## 0. これは何
**「陸版・艦これ」** ＝ 戦車（実在のWWII〜現代戦車）を擬人化した育成＆戦闘ブラウザゲーム。
艦これの陸上版。参考世界観は「りっくじあーす」。ビジュアル（立ち絵・チビ絵）はユーザーがChatGPT/画像生成で作り、開発側が背景透過してゲームに組み込む。

- **完全に素のHTML/CSS/JS（ビルド無し）**。フレームワーク不使用。
- 場所: 外部SSD `/Volumes/MacMovedData/RikuKanColle/`
- UI言語は日本語。

## 1. 起動方法（重要）
- **`起動.command` をダブルクリック**するのが正規の起動。VOICEVOX起動＋キャッシュ無効サーバ(`serve.py`)を最新版で立ち上げ＋ブラウザを開く、を全自動でやる。
- **`file://` で直接開くのは不可**：① `fetch` がCORSで死ぬ ② VOICEVOX(localhost:50021)へ繋がらず音声が出ない。必ず `http://localhost:8765/...` 経由。
- `serve.py` は **no-store ヘッダ**を返す。これが無いとブラウザが game.js/style.css を古いままキャッシュして「最新版にならない」事故が起きる（過去に発生）。
- 開発時のプレビュー: `/Volumes/MacMovedData/.claude/launch.json` に `rikukore`(port 8799) 定義あり。Claude Code の preview_* ツールで実機確認していた。ルートに `index.html`（src/index.htmlへmeta refreshリダイレクト）あり。

## 2. ファイル構成
```
RikuKanColle/
├── 起動.command         ワンクリック起動（VOICEVOX+no-cacheサーバ+ブラウザ）
├── serve.py             キャッシュ無効ローカルサーバ
├── index.html           ルート→ src/index.html へリダイレクト
├── backup.sh            ./backup.sh で backups/ にタイムスタンプ付き全コピー
├── src/
│   ├── index.html       画面のガワ（全タブのコンテナ）
│   ├── game.js          ゲームロジック全部（≒1500行・単一ファイル）
│   └── style.css        スタイル全部（単一ファイル・約600行）
├── data/
│   ├── characters.json  キャラ定義（正）
│   └── characters.js    ↑をJSにラップ（window.CHARDB）。index.htmlはこっちを読む
├── assets/
│   ├── characters/{id}.png        立ち絵（健在）＋ {id}_d1..d4.png（小破/中破/大破/撃破）
│   ├── chibi/{id}.png             戦闘・カード用チビ絵
│   └── ui/hq.png                  司令室の背景写真
├── backups/             作業ごとのバックアップ（毎回 ./backup.sh 実行）
└── HANDOFF_codex.md     この文書
```

### データ同期の注意
- **`characters.js` は `characters.json` の手動ラップ**。json を編集したら必ず再生成：
  ```bash
  { echo "window.CHARDB ="; cat data/characters.json; echo ";"; } > data/characters.js
  ```
  （`file://`でも動くようfetchを避け、scriptで window.CHARDB を読む方式にしてある）

## 3. キャラデータ（characters.json）
15両。各キャラ: `id, name, base, nation, class, rarity, hp/fire/armor/mobility/range/scout/luck, intro, ability{name,type,val,desc}, history(史実)`。
- id一覧: type10, leopard2, m26, m4a1, tiger1, tiger2, panther, panzer4, t34_85, is2, bt7, t72, matilda2, churchill, chiha
- `ability.type` は戦闘で効く: leadership/selffire/bossfire/armor/self_def/vanguard/count/resource/exp/luck/laststand

## 4. 画像の作り方（運用）
- ユーザーがDesktopに置く立ち絵/チビ絵を、Python(PIL)で**背景透過**して assets に配置。
- 透過方式: 内側リングから背景色を推定→フラッドフィル＋縁フェザー（過去スクリプト `/tmp/*.py` 参照、要再実装可）。
- **立ち絵は800px高に縮小最適化済み**（元は1〜2MB→約0.3MB。重いと表示が出ない事故が起きたため）。
- キャッシュ更新: 画像差し替え時は `const ASSET_V="?v=N"`（game.js 6行目）の N を上げる。現状 `?v=7`。

## 5. 実装済みシステム（game.js）
状態は `state`（localStorage キー **`rikukore_save_v5`**）。主要フィールド:
`player{name,level,exp}, res{fuel,ammo,steel,parts,gold}, items{}, weapons{}, equips{}, owned[unit], squads[3][6], activeSquad, secretary, dex[], records{}, missions{}, commissions[], clearedAreas[], theme(司令室背景), uiTheme(配色5種), voiceOn`

unit: `{uid,charId,level,exp,hp,maxhp,remodel,bonus{},repairEnd,equip[3]}`

### タブ（src/index.html の各 section、game.js の renderTab で振り分け）
- **司令室(base)**: 秘書立ち絵を中央〜右に主役表示（背景は暗め+ぼかし）。HP割合で破損立ち絵に自動切替＋揺れモーション。**立ち絵タップ→ぐわんアニメ＋ボイス**（HP半分以下は破損ボイス DMG_VOICES）。放置90秒で待機ボイス。秘書は選択式(openSecretarySelect)。
  - **v0.5.2でレイアウト刷新（参照: docs/ui/rikukore-ui-reference-v051.png）**。左に司令官パネル `#port-command`（司令官Lv＋経験値バー `#pc-lv`/`#pc-expbar`/`#pc-exptxt`＋ステータス4行 `#pc-stats`＋2×2アクション `.pc-act[data-tab]`=編成/出撃/工廠/任務）。右下に丸ユーティリティ `#port-utils`（`.pu`=秘書交代/図鑑/商店/設定）。旧 `#port-side`/`#port-foot`/`#base-stats` は廃止。`renderBaseStats()` が `#pc-stats` と司令官Lv/expを描画（要素は常時DOMにあるので全タブで安全に呼べる）。新ボタンの結線は `bindButtons()` の `#port-command .pc-act[data-tab], #port-utils .pu[data-tab]` セレクタ。
- **編成(squad)**: 6人×3小隊、**ドラッグ&ドロップ**配置、小隊タブ切替。カードに耐久バー＋「要修理」バッジ。
- **出撃(sortie)**: 戦域選択→出撃準備(編成)→**アッシュアームズ式ターン制グリッド戦闘**。詳細は§6。
- **工廠(arsenal)**: サブタブ build(配備建造)/commission(工場依頼=工房に時間依頼で戦車or武装)/remodel(改装=兵科別成長＋改/改二)/repair(修理＋全車修理ボタン)/cast(**鋳造=装備製作**)。
- **任務(mission)**: デイリー9種。達成で資源/アイテム/資金。
- **図鑑(dex)**: 15両。未発見はシルエット。タップ→詳細モーダル(史実＋立ち絵)。**破損グラフィック5段階を切替閲覧**(健在/小破/中破/大破/撃破)＋立ち絵全画面ズーム。
- **商店(shop)**: 資金でアイテム購入。所持アイテム/武装表示。
- **設定(config)**: 改名、戦績、**UIテーマ5色**(body[data-ui])、模様替え(司令室背景5種)、音声ON/OFF＋テスト、リセット。

### 装備システム（§4の艦これ式）
- `EQUIPMENTS`（実在兵器17種: 8.8cm KwK36, 122mm D-25T, 120mm滑腔砲Rh120, 複合装甲, ERA, ガスタービン, FCS, C4I 等。各 st{ステ補正} と real(史実)）。
- unit.equip[3]スロット。`effStat(u,key)` = 基礎+改装bonus+装備。`unitPower`/戦闘atk/def は effStat 経由。
- 入手: **鋳造**(工廠cast、資源投入で高レア確率UP) ＋ **戦闘ドロップ**(勝利・ボスで高確率)。
- 装備UI: 詳細モーダルの装備欄→スロットタップで equip-picker。

### 音声（VOICEVOX）
- `speak(text,charId)`: localhost:50021 で audio_query→synthesis→Audio再生。**合成結果をvoiceCacheで再利用**＋秘書になった時点で5セリフを prefetch（即時再生のため）。
- `VOICE_MAP`: charId→{sp(話者ID), pitch, speed}。**全員別の女性ボイス**を顔/性格で割当。
- `VOICELINES`: キャラ別5セリフ（5個目がお触りボイス）。`DMG_VOICES`: 破損共通。

## 6. 戦闘システム（アッシュアームズ式・最重要）
- **ターン制グリッド**（リアルタイムではない＝勝手に動かない）。`COLS=12, ROWS=4` の六角マス(ポインティトップで連結)。
- `battle` オブジェクト: `units[](味方), enemies[](敵=プレースホルダー図形●▲■◆), tiles[][](マス地形), sel(選択uid), selAttack, turn('player'/'enemy'), fx[], cutin, result`。
- 敵は `ENEMY_TYPES`(circle/triangle/square/diamond)。戦域の `AREA_BATTLE[areaId].waves` でwave定義。waveを倒すと次wave、全滅で勝利。`AREAS`(5戦域: hokkaido/fuji/kyushu/city/river)。
- **地形はマス単位**（`TERRAINS` + `AREA_TILESET`、`genTiles`で帯状配置）。マスの色＋アイコン。`tileDef(r,c)`でそのマスに居る車の被ダメ軽減。背景は中立ダーク色で視認性確保。
- 操作: 味方タップ→選択(青い移動可能マス点滅)→マスタップで移動 or 敵タップで攻撃→「敵ターンへ」ボタン。
- 攻撃4種 `ATTACKS`(通常/徹甲弾=装甲貫通/榴弾=範囲/機銃=反撃受けない)。スキル3種 `SKILLS`(全車突撃/応急修理/集中砲火、ターン制CD)。
- **戦術**: 挟撃(`flankBonus`で敵を味方2体隣接=+25%)、**反撃**(隣接攻撃時、機銃以外は敵反撃)、ダメージ予測表示(`calcUnitDamage`を選択中に敵上へ`.dmg-preview`、撃破圏は☠)、敵HP数値表示、攻撃時lungeモーション、被弾hitフラッシュ、中破/大破で**カットイン**(showCutin、青/赤の専用画面)。
- 勝利→`endBattle('win')`: **戦果サマリーカード**(資源/経験値/ドロップ/装備/初攻略を一覧)。
- **重要修正済バグ**: 撤退(bc-quit)時は `syncBattleHp()` で戦闘中の損傷を本体へ反映（昔は撤退で全回復するバグがあった）。勝敗でも反映。

## 7. 開発ルール（ユーザー指定）
- **作業ごとに `./backup.sh`** でバックアップ（backups/にタイムスタンプ）。
- **実装はOpusサブエージェント並列**を推奨（別ファイル単位で分ければ競合しない。例: game.js担当 と style.css担当 を同時起動）。モデルはOpus指定。
- 変更後は `node --check src/game.js` で構文確認＋preview_*で実機確認。
- 立ち絵・チビ絵の著作物は流用しない（敵はプレースホルダー図形）。

## 8. 既知の次やること（ユーザー要望・未着手/部分）
- 装備の**セット効果**、敵の多様化・**敵の本画像化**、空ユニット・ミサイル。
- 連続出撃のスタミナ設計、デイリー任務拡充。
- 編成タブの**小隊スロット(.slot)にも**耐久/要修理表示（現状は保有カード(.card)のみ）。
- UIのさらなる作り込み（艦これ風）。テーマ毎の微調整。
- グリッドの本格ヘックス距離・入れ子マップ（保留中）。

## 9. よくある落とし穴
1. characters.json 編集後に characters.js 再生成を忘れる→反映されない。
2. 画像差し替え後に ASSET_V を上げ忘れ→キャッシュで古い絵。
3. file:// で開く→fetch失敗で真っ白＆音声無し。必ず起動.command。
4. 立ち絵が重い/暗いと「出ない」と言われる→800px最適化＆司令室は背景を暗くして立ち絵を明るく。
5. SAVE_KEY を変えると全プレイヤーデータがリセットされる。スキーマ追加は load() で後方互換の既定値補完で対応（例 `if(!state.equips) state.equips={}`）。
