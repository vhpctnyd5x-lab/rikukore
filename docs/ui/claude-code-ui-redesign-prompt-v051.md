# Claude Code 指示文: 陸これ UI 追加改善

あなたはコーディング担当です。対象プロジェクトは `/Volumes/MacMovedData/RikuKanColle` です。

## 参照画像

Codexが生成したUI完成イメージを参照してください。

`/Volumes/MacMovedData/RikuKanColle/docs/ui/rikukore-ui-reference-v051.png`

この画像は「そのままピクセルコピー」ではなく、アートディレクションです。既存ゲームのDOM構造と操作性を保ちながら、雰囲気・情報整理・視認性を近づけてください。

## 現状

- 起動コマンドは `/Volumes/MacMovedData/RikuKanColle/起動.command`
- ローカルサーバは `serve.py` で no-cache 配信
- 現在のUIバージョンは `0.5.1`
- 主な編集対象は `src/style.css`
- 必要な場合のみ `src/index.html` と `src/game.js` を最小限変更
- 既存画像は `assets/characters/`, `assets/chibi/`, `assets/ui/hq.png`

## 実装目標

1. 司令室画面をさらにリッチにする
   - `assets/ui/hq.png` を主役として活かす
   - 秘書キャラ、背景、情報パネル、右側ボタンが自然に重ならないよう調整
   - デスクトップでは1画面目に「キャラ」「背景」「主要操作」が気持ちよく収まるようにする

2. ヘッダーと資源表示を整理する
   - 参照画像のように、資源カウンターを読みやすく、軍用UIらしく整える
   - 文字が小さすぎたり詰まりすぎたりしないようにする
   - 既存の数値更新ロジックは壊さない

3. タブとカード類を改善する
   - タブは横スクロール可能なまま、スマホで文字が縦折れしないようにする
   - カード、パネル、モーダルは角丸8px以下を維持
   - カードの中にカードを入れない
   - 装飾のためだけの巨大なグラデーション球やぼかし玉は使わない

4. モバイル表示を必ず確認する
   - 390x844相当で、タブ、資源表示、司令室、右側ボタン、秘書情報が破綻しないこと
   - 文字がボタンやパネルからはみ出さないこと
   - 操作可能なボタンが小さすぎないこと

5. バージョンとキャッシュキーを更新する
   - 見た目に変更を入れたら `0.5.2` へ上げる
   - `src/index.html` の `style.css?v=...`, `game.js?v=...`, `characters.js?v=...` を揃える
   - `src/game.js` の `ASSET_V` も揃える
   - `data/characters.json` と `data/characters.js` の `"version"` も揃える

## 絶対に守ること

- 起動コマンドの最新版起動/no-cache仕様を壊さない
- `backups/` の中身を編集しない
- 既存のゲームロジックを不要に書き換えない
- 既存のキャラ画像を上書きしない
- 外部ライブラリやビルド環境を追加しない
- コンソールエラーを残さない
- デスクトップとスマホの両方でスクリーンショット確認する

## 推奨作業手順

1. `src/style.css`, `src/index.html`, `src/game.js`, `data/characters.json`, `data/characters.js` を読む
2. 参照画像 `/Volumes/MacMovedData/RikuKanColle/docs/ui/rikukore-ui-reference-v051.png` を確認する
3. まずCSS中心で改善する
4. 必要な場合だけHTMLに軽いラッパーやfaviconを追加する
5. 構文確認を行う
   - `node --check /Volumes/MacMovedData/RikuKanColle/src/game.js`
   - `python3 -m json.tool /Volumes/MacMovedData/RikuKanColle/data/characters.json`
6. 起動中サーバまたは `起動.command` で表示確認する
7. Playwright等でデスクトップとモバイルのスクリーンショットを確認する
8. 問題なければ `/Volumes/MacMovedData/RikuKanColle/backup.sh` を実行してバックアップを作成する

## 完了報告に含めること

- 変更したファイル
- どの画面をどう改善したか
- 実行した確認コマンド
- スクリーンショット確認の結果
- 作成したバックアップパス
