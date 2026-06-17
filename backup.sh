#!/bin/bash
# 陸これ バックアップ：作業内容(コード/設定)だけを軽量保存。
#  - 重い assets(画像38MB) と docs(静的な参照画像) は除外（静的で変化しないため）
#  - backups 自身も除外
#  - 直近20世代だけ残して古いものは自動削除
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
TS=$(date +%Y%m%d_%H%M%S)
DEST="$ROOT/backups/backup_$TS"
mkdir -p "$DEST"
# 変更が入る必要最小限のみコピー
for d in src data HANDOFF_codex.md README.md serve.py 起動.command backup.sh index.html; do
  [ -e "$ROOT/$d" ] && cp -R "$ROOT/$d" "$DEST/"
done
# 直近20世代だけ残す
ls -dt "$ROOT"/backups/backup_*/ 2>/dev/null | tail -n +21 | while read -r old; do rm -rf "$old"; done
echo "✅ 軽量バックアップ作成: $DEST ($(du -sh "$DEST" | cut -f1))"
echo "（画像 assets は静的なため除外。総backups容量: $(du -sh "$ROOT/backups" | cut -f1)）"
