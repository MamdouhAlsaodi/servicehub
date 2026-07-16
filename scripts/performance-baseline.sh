#!/bin/sh
# Repeatable HTTP timing baseline for an already-running ServiceHub API.
# No credentials, database access, or server startup is performed here.

set -eu

API_BASE_URL=${API_BASE_URL:-}
ITERATIONS=${ITERATIONS:-20}
CURL_CONNECT_TIMEOUT_SECONDS=${CURL_CONNECT_TIMEOUT_SECONDS:-5}
CURL_MAX_TIME_SECONDS=${CURL_MAX_TIME_SECONDS:-15}

usage() {
  printf '%s\n' "Usage: API_BASE_URL=https://api.example.test [ITERATIONS=20] sh scripts/performance-baseline.sh" >&2
}

fail() {
  printf 'performance baseline: %s\n' "$1" >&2
  exit 1
}

[ -n "$API_BASE_URL" ] || { usage; fail 'API_BASE_URL is required.'; }
case "$ITERATIONS" in
  ''|*[!0-9]*) fail 'ITERATIONS must be a positive integer.' ;;
esac
[ "$ITERATIONS" -gt 0 ] || fail 'ITERATIONS must be greater than zero.'
case "$CURL_CONNECT_TIMEOUT_SECONDS" in ''|*[!0-9]*) fail 'CURL_CONNECT_TIMEOUT_SECONDS must be a non-negative integer.' ;; esac
case "$CURL_MAX_TIME_SECONDS" in ''|*[!0-9]*) fail 'CURL_MAX_TIME_SECONDS must be a non-negative integer.' ;; esac
command -v curl >/dev/null 2>&1 || fail 'curl is required but was not found in PATH.'
command -v awk >/dev/null 2>&1 || fail 'awk is required but was not found in PATH.'
command -v sort >/dev/null 2>&1 || fail 'sort is required but was not found in PATH.'

# Strip only trailing slashes, retaining the URL scheme/host/path supplied by the operator.
while [ "${API_BASE_URL%/}" != "$API_BASE_URL" ]; do
  API_BASE_URL=${API_BASE_URL%/}
done
[ -n "$API_BASE_URL" ] || fail 'API_BASE_URL must include a scheme and host.'

TMP_DIR=${TMPDIR:-/tmp}
SAMPLES_FILE=$(mktemp "$TMP_DIR/servicehub-performance.XXXXXX") || fail 'could not create a temporary sample file.'
trap 'rm -f "$SAMPLES_FILE"' EXIT HUP INT TERM

sample_endpoint() {
  endpoint_name=$1
  endpoint_path=$2
  endpoint_url="$API_BASE_URL$endpoint_path"
  sample=1

  printf 'Sampling %s (%s) %s time(s)\n' "$endpoint_name" "$endpoint_url" "$ITERATIONS"
  : > "$SAMPLES_FILE"
  while [ "$sample" -le "$ITERATIONS" ]; do
    # One curl invocation yields both HTTP status and total elapsed seconds.
    result=$(curl --silent --show-error --output /dev/null \
      --connect-timeout "$CURL_CONNECT_TIMEOUT_SECONDS" \
      --max-time "$CURL_MAX_TIME_SECONDS" \
      --write-out '%{http_code} %{time_total}' \
      "$endpoint_url") || fail "$endpoint_name request $sample/$ITERATIONS failed; endpoint unavailable: $endpoint_url"
    http_status=${result%% *}
    elapsed_seconds=${result#* }
    case "$http_status" in
      2??) ;;
      *) fail "$endpoint_name request $sample/$ITERATIONS returned HTTP $http_status; expected a 2xx response: $endpoint_url" ;;
    esac
    case "$elapsed_seconds" in
      *[!0-9.]*|'') fail "$endpoint_name request $sample/$ITERATIONS returned an invalid timing value: $elapsed_seconds" ;;
    esac
    # Store integer milliseconds so sorting and percentile selection are portable.
    awk -v seconds="$elapsed_seconds" 'BEGIN { printf "%d\n", (seconds * 1000) + 0.5 }' >> "$SAMPLES_FILE"
    sample=$((sample + 1))
  done

  count=$(wc -l < "$SAMPLES_FILE" | tr -d ' ')
  mean_ms=$(awk '{ sum += $1 } END { if (NR == 0) exit 1; printf "%.2f", sum / NR }' "$SAMPLES_FILE") || fail "could not calculate $endpoint_name mean."
  p95_rank=$(awk -v count="$count" 'BEGIN { rank = int((count * 95 + 99) / 100); if (rank < 1) rank = 1; print rank }')
  p95_ms=$(sort -n "$SAMPLES_FILE" | awk -v rank="$p95_rank" 'NR == rank { print; found = 1; exit } END { if (!found) exit 1 }') || fail "could not calculate $endpoint_name p95."

  printf '%s: count=%s mean_ms=%s p95_ms=%s\n' "$endpoint_name" "$count" "$mean_ms" "$p95_ms"
}

sample_endpoint 'public health' '/api/v1/health'
sample_endpoint 'API docs JSON' '/api/docs-json'
