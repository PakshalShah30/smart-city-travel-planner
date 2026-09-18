#!/usr/bin/env bash
# Fetches a city's raw OpenStreetMap extract into src/db/ingest/fixtures/.
#
# Run from the repo root:  ./scripts/fetch-overpass.sh mumbai
#
# The raw response is gitignored — it is large and reproducible. The ingestion
# tests run against a trimmed fixture committed alongside it.
set -euo pipefail

CITY="${1:-mumbai}"
QUERY="src/db/ingest/queries/${CITY}.overpass"
OUT="src/db/ingest/fixtures/${CITY}-overpass.raw.json"

[ -f "$QUERY" ] || { echo "No query file at $QUERY"; exit 1; }

# kumi.systems is a mirror with more generous rate limits than the main instance.
ENDPOINT="${OVERPASS_ENDPOINT:-https://overpass-api.de/api/interpreter}"

echo "Querying $ENDPOINT for $CITY (this usually takes 30-90 seconds)..."
curl -sS --fail --max-time 300 \
  -X POST "$ENDPOINT" \
  --data-urlencode "data@${QUERY}" \
  -o "$OUT"

BYTES=$(wc -c < "$OUT" | tr -d ' ')
ELEMENTS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$OUT','utf8')).elements.length)")
echo "Wrote $OUT — $((BYTES / 1024)) KB, $ELEMENTS elements"
