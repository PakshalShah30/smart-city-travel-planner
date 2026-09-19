#!/usr/bin/env bash
# Builds and serves a local OSRM routing engine for one city and profile.
#
#   ./scripts/osrm-up.sh car     -> serves on :5000
#   ./scripts/osrm-up.sh foot    -> serves on :5001
#
# This is a BUILD-TIME tool. The travel-time matrix is computed once and stored
# in Postgres; the deployed application never talks to OSRM. Once the matrix is
# built you can stop the container and delete osrm-data/.
#
# Needs Docker. On macOS, `brew install colima docker && colima start` is
# lighter than Docker Desktop and avoids its licensing terms.
set -euo pipefail

PROFILE="${1:-car}"
CITY="${CITY:-mumbai}"
DATA_DIR="osrm-data/${CITY}-${PROFILE}"
IMAGE="ghcr.io/project-osrm/osrm-backend:latest"

case "$PROFILE" in
  car)  LUA=/opt/car.lua;     PORT=5000 ;;
  foot) LUA=/opt/foot.lua;    PORT=5001 ;;
  bike) LUA=/opt/bicycle.lua; PORT=5002 ;;
  *) echo "Unknown profile '$PROFILE'. Use car, foot or bike."; exit 1 ;;
esac

PBF="osrm-data/${CITY}-source.osm.pbf"

# Candidates tried in order, smallest first. A city-sized extract needs no
# clipping and builds in a couple of minutes; a country one works but is slow.
# Override entirely with PBF_URL=... for another city.
CANDIDATES=(
  "https://download.bbbike.org/osm/bbbike/Mumbai/Mumbai.osm.pbf"
  "https://download.geofabrik.de/asia/india-latest.osm.pbf"
)
[ -n "${PBF_URL:-}" ] && CANDIDATES=("$PBF_URL")

# A real .osm.pbf opens with a blob header naming OSMHeader. Checking this is
# the difference between a clear error and osrm-extract dying on an HTML error
# page ten minutes later — Geofabrik serves its index with a 200 for a path
# that does not exist, so an HTTP status alone proves nothing.
valid_pbf() {
  local f="$1"
  [ -s "$f" ] || return 1
  [ "$(wc -c < "$f" | tr -d ' ')" -gt 100000 ] || return 1
  head -c 64 "$f" | grep -aq 'OSMHeader' || return 1
}

command -v docker >/dev/null || { echo "Docker not found. brew install colima docker && colima start"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Try: colima start"; exit 1; }

mkdir -p "$DATA_DIR" osrm-data

# Never trust a file left behind by a failed run.
if [ -f "$PBF" ] && ! valid_pbf "$PBF"; then
  echo "Discarding $PBF — not a valid OSM extract (probably a failed download)."
  rm -f "$PBF"
fi

if [ ! -f "$PBF" ]; then
  for url in "${CANDIDATES[@]}"; do
    echo "Trying $url"
    # Download to .part so a failure can never masquerade as a finished file.
    if curl -fSL --retry 2 --max-time 1800 -o "$PBF.part" "$url" 2>/dev/null && valid_pbf "$PBF.part"; then
      mv "$PBF.part" "$PBF"
      echo "  got $(( $(wc -c < "$PBF" | tr -d ' ') / 1024 / 1024 )) MB"
      break
    fi
    echo "  no usable extract there"
    rm -f "$PBF.part"
  done
fi

if ! valid_pbf "$PBF"; then
  cat <<'HELP'

Could not fetch a usable OSM extract.

Find one yourself and pass it in:
  - City-sized (best): https://download.bbbike.org/osm/bbbike/  — pick your city,
    then use the direct .osm.pbf link
  - Custom area:       https://extract.bbbike.org/  — draw a box, they email a link
  - Country/region:    https://download.geofabrik.de/

Then re-run with, for example:
  PBF_URL="https://download.bbbike.org/osm/bbbike/Mumbai/Mumbai.osm.pbf" ./scripts/osrm-up.sh car
HELP
  exit 1
fi

# Optional clip, for when the only available extract covers a whole country.
# Off by default: a city extract needs no clipping, and a clip that fails must
# never silently fall back to the unclipped file.
CLIPPED="$DATA_DIR/city.osm.pbf"
if [ -f "$CLIPPED" ] && ! valid_pbf "$CLIPPED"; then
  echo "Discarding a bad $CLIPPED from an earlier run."
  rm -f "$CLIPPED"
fi

if [ ! -f "$CLIPPED" ]; then
  if [ "${CLIP:-0}" = "1" ]; then
    BBOX="${BBOX:-72.77,18.88,72.99,19.28}"
    echo "Clipping to $BBOX..."
    docker run --rm -v "$PWD/osrm-data:/data" \
      ghcr.io/osmcode/osmium-tool:latest \
      osmium extract -b "$BBOX" "/data/$(basename "$PBF")" \
        -o "/data/${CITY}-${PROFILE}/city.osm.pbf" --overwrite
    valid_pbf "$CLIPPED" || { echo "Clip produced an invalid file; aborting."; exit 1; }
  else
    cp "$PBF" "$CLIPPED"
  fi
fi

if [ ! -f "$DATA_DIR/city.osrm.mldgr" ]; then
  echo "Building the routing graph ($PROFILE)... this is the slow part, and it happens once."
  docker run --rm -t -v "$PWD/$DATA_DIR:/data" "$IMAGE" osrm-extract -p "$LUA" /data/city.osm.pbf
  docker run --rm -t -v "$PWD/$DATA_DIR:/data" "$IMAGE" osrm-partition /data/city.osrm
  docker run --rm -t -v "$PWD/$DATA_DIR:/data" "$IMAGE" osrm-customize /data/city.osrm
else
  echo "Graph already built, reusing $DATA_DIR"
fi

echo
echo "Serving $PROFILE on http://127.0.0.1:$PORT — leave this running, then in another terminal:"
echo "    cd $(pwd) && npm run build-matrix"
echo
# --max-table-size must exceed the matrix builder's chunk size; the default
# of 100 is far too small and fails the request with a 400.
exec docker run --rm -t -p "$PORT:5000" -v "$PWD/$DATA_DIR:/data" "$IMAGE" \
  osrm-routed --algorithm mld --max-table-size 4000 /data/city.osrm
