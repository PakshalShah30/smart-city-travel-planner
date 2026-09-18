#!/usr/bin/env bash
# Fetches a city's raw OpenStreetMap extract into src/db/ingest/fixtures/.
#
#   ./scripts/fetch-overpass.sh mumbai
#
# Deliberately does NOT use curl --fail. Overpass reports query errors in the
# response body with a useful message; --fail throws the body away and leaves
# you with a bare status code.
set -uo pipefail

CITY="${1:-mumbai}"
QUERY="src/db/ingest/queries/${CITY}.overpass"
OUT="src/db/ingest/fixtures/${CITY}-overpass.raw.json"

[ -f "$QUERY" ] || { echo "No query file at $QUERY"; exit 1; }
mkdir -p "$(dirname "$OUT")"

# Overpass asks clients to identify themselves, and some instances answer a
# bare "curl/8.x" with 406.
UA="smart-city-travel-planner/0.1 (https://github.com/PakshalShah30/smart-city-travel-planner)"
ENDPOINT="${OVERPASS_ENDPOINT:-https://overpass-api.de/api/interpreter}"

echo "Querying $ENDPOINT for $CITY (usually 30-90 seconds)..."
STATUS=$(curl -sS --max-time 300 \
  -A "$UA" \
  -H 'Accept: application/json' \
  -X POST "$ENDPOINT" \
  --data-urlencode "data@${QUERY}" \
  -o "$OUT" -w '%{http_code}')

if ! node -e "JSON.parse(require('fs').readFileSync('$OUT','utf8'))" 2>/dev/null; then
  echo
  echo "HTTP $STATUS, and the response is not JSON. Overpass said:"
  echo "----------------------------------------------------------"
  head -c 2000 "$OUT"
  echo
  echo "----------------------------------------------------------"
  exit 1
fi

BYTES=$(wc -c < "$OUT" | tr -d ' ')
ELEMENTS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$OUT','utf8')).elements.length)")
echo "HTTP $STATUS · wrote $OUT — $((BYTES / 1024)) KB, $ELEMENTS elements"
