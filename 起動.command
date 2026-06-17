#!/bin/bash
# 陸これ ワンクリック起動
#  - VOICEVOX を起動（音声用）
#  - キャッシュ無効サーバ(serve.py)を必ず現在のフォルダから起動
#  - ブラウザを開く
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${RIKUKORE_PORT:-8765}"
MAX_PORT=$((PORT + 20))
PID_FILE="$ROOT/.rikukore-server.pid"

APP_VERSION="$(/usr/bin/awk -F'"' '/"version"/{ print $4; exit }' "$ROOT/data/characters.json" 2>/dev/null)"
[ -n "$APP_VERSION" ] || APP_VERSION="dev"

pid_cwd() {
  /usr/sbin/lsof -a -p "$1" -d cwd -Fn 2>/dev/null | /usr/bin/sed -n 's/^n//p' | /usr/bin/head -1
}

listener_pids() {
  /usr/sbin/lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null
}

echo "=== 陸これ v$APP_VERSION を起動します ==="
echo "配信元: $ROOT"

if [ ! -f "$ROOT/serve.py" ]; then
  echo "ERROR: serve.py が見つかりません。最新版を配信できません。"
  exit 1
fi

# 1) VOICEVOX（音声）。起動済みなら何もしない
if [ "${RIKUKORE_SKIP_VOICEVOX:-0}" = "1" ]; then
  echo "VOICEVOX 起動チェックをスキップします"
elif ! curl -fsS -m2 "http://127.0.0.1:50021/version" >/dev/null 2>&1; then
  echo "VOICEVOX を起動中…（音声エンジンの準備に少し時間がかかります）"
  open -a VOICEVOX 2>/dev/null || echo "※VOICEVOXが見つかりません（音声なしでも遊べます）"
fi

# 2) 現在のフォルダの旧サーバだけ止める。別フォルダ/別アプリなら別ポートへ逃がす。
while :; do
  PORT_USERS="$(listener_pids "$PORT" | /usr/bin/tr '\n' ' ')"
  if [ -z "$PORT_USERS" ]; then
    break
  fi

  CAN_USE_PORT=1
  for PID in $PORT_USERS; do
    if [ "$(pid_cwd "$PID")" = "$ROOT" ]; then
      echo "現行フォルダの旧サーバを停止します (pid $PID, port $PORT)"
      kill "$PID" 2>/dev/null || true
      CAN_USE_PORT=1
    else
      CAN_USE_PORT=0
    fi
  done

  if [ "$CAN_USE_PORT" = "1" ]; then
    sleep 0.5
    break
  fi

  echo "port $PORT は別のサーバが使用中のため、次のポートを試します"
  PORT=$((PORT + 1))
  if [ "$PORT" -gt "$MAX_PORT" ]; then
    echo "ERROR: 空きポートが見つかりませんでした ($((MAX_PORT - 20))-$MAX_PORT)"
    exit 1
  fi
done

echo "ゲームサーバを最新版で起動中… (port $PORT)"
nohup python3 "$ROOT/serve.py" "$PORT" >/tmp/rikukore_http_$PORT.log 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"
sleep 1

if ! curl -fsS -m2 "http://127.0.0.1:$PORT/src/index.html" >/dev/null 2>&1; then
  echo "ERROR: ゲームサーバを起動できませんでした。ログ: /tmp/rikukore_http_$PORT.log"
  exit 1
fi

# 3) ブラウザで開く（URLにも版数と時刻を付けて確実に最新を取得）
URL="http://127.0.0.1:$PORT/src/index.html?v=$APP_VERSION-$(date +%s)"
echo "ブラウザを開きます → $URL"
if [ "${RIKUKORE_NO_OPEN:-0}" = "1" ]; then
  echo "ブラウザ自動起動をスキップします"
else
  open "$URL" || {
    echo "ブラウザを自動で開けませんでした。次のURLを開いてください:"
    echo "$URL"
  }
fi

echo ""
echo "最新版が表示されます。遊び終わったらこのウィンドウは閉じてOKです。"
echo "サーバを完全に止めたい場合は、次を実行してください: kill $SERVER_PID"
