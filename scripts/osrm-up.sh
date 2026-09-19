#!/usr/bin/env bash
# Builds and serves a local OSRM routing engine for one city and profile.
#
#   ./scripts/osrm-up.sh car     -> serves on :5000
#   ./scripts/osrm-up.sh foot    -> serves on :5001
#
# This is a BUILD-TIME tool. The travel-time matrix is computed once and stored
# in Postgres; the deployed application never talks to OSRM. Once the matrix is
# built you can stop the container and reclaim the disk.
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

# A state-sized extract wants ~6GB of RAM to build. A city-sized one builds in
# a couple of minutes on a laptop. Override with PBF_URL for another city.
PBF_URL="${PBF_URL:-https://download.geofabrik.de/asia/india/maharashtra-latest.osm.pbf}"
PBF="osrm-data/${CITY}-source.osm.pbf"

# Clipping the extract to the city keeps the build small. Same bounding box as
# the Overpass query, as west,south,east,north.
BBOX="${BBOX:-72.77,18.88,72.99,19.28}"

command -v docker >/dev/null || { echo "Docker not found. brew install colima docker && colima start"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Try: colima start"; exit 1; }

mkdir -p "$DATA_DIR"

if [ ! -f "$PBF" ]; then
  echo "Downloading $PBF_URL"
  echo "(a state extract is a few hundred MB; this is the slow part, and it happens once)"
  curl -sSL --fail -o "$PBF" "$PBF_URL"
fi

CLIPPED="$DATA_DIR/city.osm.pbf"
if [ ! -f "$CLIPPED" ]; then
  echo "Clipping to $BBOX so the build stays small..."
  docker run --rm -v "$PWD/osrm-data:/data" -v "$PWD/$DATA_DIR:/out" \
    stefda/osmium-tool osmium extract -b "$BBOX" "/data/$(basename "$PBF")" -o /out/city.osm.pbf --overwrite \
    || { echo "Clip failed; falling back to the full extract (slower, needs more RAM)"; cp "$PBF" "$CLIPPED"; }
fi

if [ ! -f "$DATA_DIR/city.osrm.mldgr" ]; then
  echo "Building the routing graph ($PROFILE)..."
  docker run --rm -t -v "$PWD/$DATA_DIR:/data" "$IMAGE" osrm-extract -p "$LUA" /data/city.osm.pbf
  docker run --rm -t -v "$PWD/$DATA_DIR:/data" "$IMAGE" osrm-partition /data/city.osrm
  docker run --rm -t -v "$PWD/$DATA_DIR:/data" "$IMAGE" osrm-customize /data/city.osrm
else
  echo "Graph already built, reusing $DATA_DIR"
fi

echo
echo "Serving $PROFILE on http://127.0.0.1:$PORT — leave this running, then in another terminal:"
echo "    npm run build-matrix"
echo
# --max-table-size must exceed the chunk size used by the matrix builder;
# osrm-routed's default of 100 is far too small and fails with a 400.
exec docker run --rm -t -p "$PORT:5000" -v "$PWD/$DATA_DIR:/data" "$IMAGE" \
  osrm-routed --algorithm mld --max-table-size 4000 /data/city.osrm
