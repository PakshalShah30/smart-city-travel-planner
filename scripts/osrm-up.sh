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
OSMIUM_IMAGE="ghcr.io/osmcode/osmium-tool:latest"

case "$PROFILE" in
  car)  LUA=/opt/car.lua;     PORT=5000 ;;
  foot) LUA=/opt/foot.lua;    PORT=5001 ;;
  bike) LUA=/opt/bicycle.lua; PORT=5002 ;;
  *) echo "Unknown profile '$PROFILE'. Use car, foot or bike."; exit 1 ;;
esac

PBF="osrm-data/${CITY}-source.osm.pbf"

# The bounding box the graph is cut down to. Anything bigger than a metro area
# is wasted work: osrm-extract wants roughly ten times the extract size in RAM.
BBOX="${BBOX:-72.77,18.88,72.99,19.28}"

# Candidates tried in order, smallest first. A city-sized extract is ideal, but
# a country one is fine now that oversized sources are clipped automatically.
# Override entirely with PBF_URL=... for another city.
BBBIKE_CITY="${BBBIKE_CITY:-Mumbai}"
CANDIDATES=(
  "https://download.bbbike.org/osm/bbbike/${BBBIKE_CITY}/${BBBIKE_CITY}.osm.pbf"
  "https://download.geofabrik.de/asia/india-latest.osm.pbf"
)
[ -n "${PBF_URL:-}" ] && CANDIDATES=("$PBF_URL")

# Sources above this clip themselves. A whole-country file is about 1.7 GB and
# will exhaust any laptop-sized Docker VM if handed straight to osrm-extract.
CLIP_THRESHOLD_BYTES="${CLIP_THRESHOLD_BYTES:-262144000}"   # 250 MB

bytes() { wc -c < "$1" | tr -d ' '; }
mib()   { echo $(( $(bytes "$1") / 1024 / 1024 )); }

# A real .osm.pbf opens with a blob header naming OSMHeader. Checking this is
# the difference between a clear error and osrm-extract dying on an HTML error
# page ten minutes later — Geofabrik serves its index with a 200 for a path
# that does not exist, so an HTTP status alone proves nothing.
valid_pbf() {
  local f="$1"
  [ -s "$f" ] || return 1
  [ "$(bytes "$f")" -gt 100000 ] || return 1
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
      echo "  got $(mib "$PBF") MB"
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
  PBF_URL="https://download.bbbike.org/osm/bbbike/Berlin/Berlin.osm.pbf" ./scripts/osrm-up.sh car
HELP
  exit 1
fi

# Clip when the source is bigger than a city. CLIP=1 forces it on, CLIP=0 off.
SOURCE_BYTES="$(bytes "$PBF")"
if [ -n "${CLIP:-}" ]; then
  DO_CLIP="$CLIP"
elif [ "$SOURCE_BYTES" -gt "$CLIP_THRESHOLD_BYTES" ]; then
  DO_CLIP=1
else
  DO_CLIP=0
fi

CLIPPED="$DATA_DIR/city.osm.pbf"
if [ -f "$CLIPPED" ] && ! valid_pbf "$CLIPPED"; then
  echo "Discarding a bad $CLIPPED from an earlier run."
  rm -f "$CLIPPED"
fi

# A clipped file left over from a previous run is only reusable if it really
# was clipped. One the same size as the source is last run's straight copy.
if [ -f "$CLIPPED" ] && [ "$DO_CLIP" = "1" ] && [ "$(bytes "$CLIPPED")" -ge "$SOURCE_BYTES" ]; then
  echo "$CLIPPED is an unclipped copy from an earlier run — redoing it."
  rm -f "$CLIPPED"
fi

if [ ! -f "$CLIPPED" ]; then
  if [ "$DO_CLIP" = "1" ]; then
    echo "Source is $(mib "$PBF") MB — clipping to $BBOX before building."
    # complete_ways keeps roads whole across the boundary; simple is a
    # single low-memory pass that truncates them. Try the good one first.
    clip() {
      docker run --rm -v "$PWD/osrm-data:/data" "$OSMIUM_IMAGE" \
        osmium extract -s "$1" -b "$BBOX" "/data/$(basename "$PBF")" \
          -o "/data/${CITY}-${PROFILE}/city.osm.pbf" --overwrite
    }
    clip complete_ways || {
      echo "complete_ways failed — retrying with the single-pass simple strategy."
      rm -f "$CLIPPED"
      clip simple
    }
    valid_pbf "$CLIPPED" || { echo "Clip produced an invalid file; aborting."; exit 1; }
    echo "  clipped to $(mib "$CLIPPED") MB"
  else
    # Hard-link rather than copy: a second full-size file buys nothing.
    ln "$PBF" "$CLIPPED" 2>/dev/null || cp "$PBF" "$CLIPPED"
  fi
fi

# osrm-extract wants roughly ten times the extract size in RAM and dies with
# std::bad_alloc rather than anything readable when it does not get it.
DOCKER_MEM="$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)"
NEEDED=$(( $(bytes "$CLIPPED") * 10 ))
[ "$NEEDED" -lt 2147483648 ] && NEEDED=2147483648
if [ "$DOCKER_MEM" -gt 0 ] && [ "$DOCKER_MEM" -lt "$NEEDED" ]; then
  cat <<MEM

Docker has $(( DOCKER_MEM / 1024 / 1024 )) MB of memory; this build wants about $(( NEEDED / 1024 / 1024 )) MB.
osrm-extract will fail with std::bad_alloc. Give the VM more and re-run:

    colima stop && colima start --memory 8 --cpu 4

(Use --memory 6 if this machine has 8 GB of RAM.)
MEM
  exit 1
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
