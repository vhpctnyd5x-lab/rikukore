# 陸これ（仮）— 開発引き継ぎ書（Codex / 後任AI向け）

最終更新: 2026-10-06（v0.8.0）

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
│   ├── game.js          戦闘以外のゲームロジック（母港・編成・工廠・任務・図鑑・商店・設定・詳細）
│   ├── battle.js        戦闘（出撃画面・出撃準備・六角マス戦闘・勝敗）。game.js より先に読む
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

## 6. 戦闘システム（りっくじあーす式・v0.8.0〜・`src/battle.js`）
- **六角マス・ターン制**。11列×9行（尖った頂点が上、奇数行が右へ半マス）。`hexCenter`/`hexDist`/`neighbors`。画面いっぱい（`#battle`）。
- 画面：上＝両軍の「部隊戦力」（耐久の合計。敵は残りの波も含む）とターン数、左＝味方の札、右＝敵の札（＋残りの増援）、下＝撤退・情報・攻撃4種＋待機・支援4種・ターン終了・**自動 ON/OFF**・速度×1/2/3。
- 流れ：`beginSide`→（敵なら `runAI`）→`endSide`→相手の番。自軍は「隊員を選ぶ→青いマスで移動→赤い敵で攻撃」。攻撃すると行動終了。動かず攻撃もしないと**防御態勢**。
- **地形** `TERRAIN`（移動コスト・被ダメ倍率・山は射程+1）。地図は戦域ごとの作り方 `genMap`（毎回少し変わる）。左2列＝味方、右2列＝敵の出現。
- **マスが変わる** `SCAR`：榴弾・支援砲撃で 森→炎上→(3ターン)→焼け野原、市街→瓦礫、平地/道路/雪→砲撃痕、橋→浅瀬。炎は15%で隣の森へ広がる。撃破された車輌は**残骸**（遮蔽・移動+1）。**煙幕**（支援）は2ターン。
- **強化・弱体** `STATUS`：士気高揚・防御態勢（強化）／炎上（毎ターン8%）・履帯損傷（移動1）・制圧（攻撃−30%）・照準（被ダメ+20%）。徹甲→履帯、榴弾→炎上、機銃→制圧、索敵60以上の攻撃→照準。
- **敵** `ENEMY_TYPES`：歩兵・軽戦車・重戦車・自走砲（射程3・榴弾）・対戦車砲・攻撃ヘリ（地形無視）。絵はSVGのシルエット（`enemySvg`）。波 `AREA_BATTLE[*].waves`：残り1体以下で次の波（増援）。最後の波にボス。`atk` が戦域ごとの敵の強さ（調整済み：初期3人Lv1で北海道9/10勝ち、富士はLv2の3人で1/8）。
- **動き**：移動（マスごと）、発砲の反動・砲口の光、弾（徹甲＝青い曳光、榴弾＝放物線、機銃＝3連）、爆発・火花・煙、画面の揺れ、被弾の点滅と揺れ、ダメージ数字（会心は大きく）、弱体の吹き出し、撃破（傾いて消え、残骸と煙）、ターンの帯、中破/大破のカットイン。全部 `await` してから次へ（`battle.busy`）。
- 試験用：`window.__battleFast=400` で動きを早送り、`battle.auto=true` で自動。
- 撤退・勝敗で `syncBattleHp`（撃破=耐久1）。報酬は `endBattle`（v0.6.0 の固有能力の効き方はそのまま）。

## 6.5 v0.6.0 の変更（2026-10-06）
- **戦闘力に装備が入る**: `unitPower` は `effStat`（基礎＋改装＋装備）で数える（それまで装備は戦闘力・カードの数字に出ていなかった）。
- **射程**: `effStat(range)>=RANGE_LONG(75)` の車は2マス先まで撃てる（隣接しないので反撃を受けない）。
- **会心**: `critRate`＝(運＋索敵)/1000（上限25%）で1.5倍。選択中の表示に射程・会心率。
- **攻撃の待ち**: `ATTACKS[*].cd` を隊員ごとに効かせる（徹甲3・榴弾4・機銃2ターンに1回）。ボタンに残りターン。機銃は3連射（`hits`）。
- **スキルの待ち**はターン数（突撃4・修理5・砲火6）。旧リアルタイム版の秒数（14〜22）のままだった。
- **固有能力が戦闘で効く**（それまで bossfire・armor・self_def・laststand だけ）: leadership・count（小隊の攻撃）、selffire・self_def（自分の攻撃）、vanguard（最初のターンの攻撃＋、被ダメ+10%）、resource（勝利時の資源）、exp（経験値）、luck（ドロップ率）。改装の `abilityLv` 1段につき元の値の25%ずつ強化（`abilityVal`）。使われていなかった `battlePower`/`dmgMult` は削除。
- **不具合修正**: 勝利時に撃破された隊員の耐久が元に戻っていた → 出撃した全員を `syncBattleHp`（撃破=耐久1）。敵が撃破済みの味方を撃ち続けていた → 撃破は即時に取り除く（`removeDeadAllies`）。修理中の隊員が出撃できた → 出撃不可。敵が味方や他の敵と同じマスに出ることがあった → `spawnSpot` で空きマス。遊んでいる間に日付が変わっても任務が更新されなかった → 時計で確認。図鑑の見本が隊員番号を1つ消費していた。
- 工場依頼の副産物は旧「武装」（WEAPONS）ではなく装備（EQUIPMENTS）。旧武装の在庫は商店から今まで通り使える。
- 編成・出撃準備の小隊枠に耐久バー・要修理・修理中（§8 の項目）。

## 6.6 v0.8.0 画面の作りを全面刷新（2026-10-06）
- **横画面専用**。1200×720 の `#stage` を窓に合わせて拡大縮小（`fitStage`）。縦持ちでは「横にしてください」（`#rotate-hint`、全画面＋横向きロックのボタン付き）。位置は全部固定なので重ならない。
- 艦これの形：上の帯 `#hq`（司令部Level・階級・保有数・資源・戦績表示/図鑑表示/アイテム/模様替え/任務/購買部）、左上の大きな丸 `#scr-emblem`（画面名）、左の献立 `#sidemenu`（編成・補給・改装・整備・工廠＋縦長の「母港」＋時計）。母港では献立なし。
- 画面の切り替えは `showTab(tab, sub, scroll)`。`data-go` / `data-sub` / `data-scroll` を付けたボタンは `bindTabs` が自動で結線。`#stage[data-screen]` で見た目を変える。
- **編成**（艦これ式）：2列×3段の札（旗＝隊長、名前・Lv・★・耐久・火力/装甲/機動/射程・立ち絵の帯・経験値）、「詳細」「変更」。空き枠はシャッター。「変更」で隊員一覧（Lv/兵科/戦闘力/新着で並べ替え、別小隊からの移動・同じ小隊内の入れ替え、枠を外す）。随伴一括解除・部隊名。空きは前に詰める（`compactSquad`）。
- 出撃：戦域の一覧（推奨戦闘力・敵の種類・地形の見本）→ 出撃準備の窓（小隊を選ぶ）→ 戦闘。
- `style.css` は作り直し。色は変数（`--pan1/--pan2/--acc/--paper`）で、UIテーマ（`body[data-ui]`）が入れ替える。

## 7. 開発ルール（ユーザー指定）
- **作業ごとに `./backup.sh`** でバックアップ（backups/にタイムスタンプ）。
- **実装はOpusサブエージェント並列**を推奨（別ファイル単位で分ければ競合しない。例: game.js担当 と style.css担当 を同時起動）。モデルはOpus指定。
- 変更後は `node --check src/game.js` で構文確認＋preview_*で実機確認。
- 立ち絵・チビ絵の著作物は流用しない（敵はプレースホルダー図形）。

## 8. 既知の次やること（ユーザー要望・未着手/部分）
- 装備の**セット効果**、敵の多様化・**敵の本画像化**、空ユニット・ミサイル。
- 連続出撃のスタミナ設計、デイリー任務拡充。
- UIのさらなる作り込み（艦これ風）。テーマ毎の微調整。
- グリッドの本格ヘックス距離・入れ子マップ（保留中）。

## 9. よくある落とし穴
1. characters.json 編集後に characters.js 再生成を忘れる→反映されない。
2. 画像差し替え後に ASSET_V を上げ忘れ→キャッシュで古い絵。
3. file:// で開く→fetch失敗で真っ白＆音声無し。必ず起動.command。
4. 立ち絵が重い/暗いと「出ない」と言われる→800px最適化＆司令室は背景を暗くして立ち絵を明るく。
5. SAVE_KEY を変えると全プレイヤーデータがリセットされる。スキーマ追加は load() で後方互換の既定値補完で対応（例 `if(!state.equips) state.equips={}`）。
