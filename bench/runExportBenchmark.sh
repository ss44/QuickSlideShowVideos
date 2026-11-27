#!/usr/bin/env bash
# Start the Vite server first, then run bench/runExportBenchmark.sh 'photos=12&slideSeconds=5'.
set -eu

query="${1:-photos=12&slideSeconds=5}"
browser="${2:-${CHROMIUM_BIN:-chromium}}"
profile_dir="$(mktemp -d)"
mkfifo "$profile_dir/log"
timeout "${TIMEOUT_SECONDS:-1800}" "$browser" --headless=new \
  --disable-background-timer-throttling --user-data-dir="$profile_dir" \
  --enable-logging=stderr --remote-debugging-port=0 \
  "${DEV_SERVER_URL:-http://localhost:5173}/bench/export-benchmark.html?$query" \
  > "$profile_dir/log" 2>&1 &
browser_pid=$!
cleanup() {
  kill "$browser_pid" 2>/dev/null || true
  wait "$browser_pid" 2>/dev/null || true
  rm -rf "$profile_dir"
}
trap cleanup EXIT

while IFS= read -r line; do
  case "$line" in
    *BENCH_RESULT*) echo "$line"; exit 0 ;;
    *BENCH_ERROR*) echo "$line" >&2; exit 1 ;;
    *BENCH:*) echo "$line" ;;
    *FATAL*|*"No usable sandbox"*) echo "$line" >&2 ;;
  esac
done < "$profile_dir/log"
echo "Chromium exited or timed out before the benchmark finished." >&2
exit 1
