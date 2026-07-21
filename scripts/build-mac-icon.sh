#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT_DIR/assets/icon.svg"
OUTPUT="$ROOT_DIR/assets/icon.icns"

for tool in "$ROOT_DIR/node_modules/.bin/electron" /usr/bin/sips /usr/bin/iconutil; do
  [[ -x "$tool" ]] || { echo "missing required tool: $tool" >&2; exit 1; }
done
[[ -s "$SOURCE" ]] || { echo "missing icon source: $SOURCE" >&2; exit 1; }

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/quotix-icon.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
ICONSET="$WORK_DIR/icon.iconset"
mkdir -p "$ICONSET"

MASTER="$WORK_DIR/icon.png"
env -u ELECTRON_RUN_AS_NODE "$ROOT_DIR/node_modules/.bin/electron" "$ROOT_DIR/scripts/rasterize-mac-icon.cjs" "$SOURCE" "$MASTER"
[[ -s "$MASTER" ]] || { echo "failed to rasterize $SOURCE" >&2; exit 1; }

make_png() {
  local pixels="$1" name="$2"
  /usr/bin/sips -z "$pixels" "$pixels" "$MASTER" --out "$ICONSET/$name" >/dev/null
  [[ -s "$ICONSET/$name" ]] || { echo "failed to create $name" >&2; exit 1; }
}

make_png 16 icon_16x16.png
make_png 32 icon_16x16@2x.png
make_png 32 icon_32x32.png
make_png 64 icon_32x32@2x.png
make_png 128 icon_128x128.png
make_png 256 icon_128x128@2x.png
make_png 256 icon_256x256.png
make_png 512 icon_256x256@2x.png
make_png 512 icon_512x512.png
make_png 1024 icon_512x512@2x.png

/usr/bin/iconutil -c icns "$ICONSET" -o "$WORK_DIR/icon.icns"
[[ -s "$WORK_DIR/icon.icns" ]] || { echo "failed to create icon.icns" >&2; exit 1; }
mv "$WORK_DIR/icon.icns" "$OUTPUT"
echo "Created $OUTPUT"
