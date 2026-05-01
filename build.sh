#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

have_zip=0
have_py=0
have_node=0
command -v zip >/dev/null 2>&1 && have_zip=1
command -v python3 >/dev/null 2>&1 && have_py=1
command -v node >/dev/null 2>&1 && have_node=1
if [ "${have_zip}" -eq 0 ] && [ "${have_py}" -eq 0 ]; then
  echo "ERROR: need either 'zip' or 'python3' to create the package." >&2
  exit 1
fi

if [ "${have_node}" -eq 1 ]; then
  VERSION=$(node -e "process.stdout.write(require('./manifest.json').version)")
elif [ "${have_py}" -eq 1 ]; then
  VERSION=$(python3 -c 'import json,sys;print(json.load(open("manifest.json"))["version"])')
else
  VERSION=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' manifest.json | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
fi

if [ -z "${VERSION}" ]; then
  echo "ERROR: could not extract version from manifest.json" >&2
  exit 1
fi

NAME="mcp-group-cleanup-v${VERSION}"
DIST="dist"

rm -rf "${DIST}"
mkdir -p "${DIST}/${NAME}"

echo "==> Running tests..."
bash tests/run.sh

echo "==> Staging files into ${DIST}/${NAME}/"
cp manifest.json bg.js popup.html popup.js matcher.js cleanup-logic.js constants.js "${DIST}/${NAME}/"
cp -r icons "${DIST}/${NAME}/"

ZIP_PATH="${DIST}/${NAME}.zip"
echo "==> Creating zip at ${ZIP_PATH}..."
if [ "${have_zip}" -eq 1 ]; then
  ( cd "${DIST}" && zip -r -X -q "${NAME}.zip" "${NAME}" )
else
  python3 - "${DIST}" "${NAME}" <<'PY'
import os, sys, zipfile
dist, name = sys.argv[1], sys.argv[2]
src = os.path.join(dist, name)
out = os.path.join(dist, name + ".zip")
EPOCH = (1980, 1, 1, 0, 0, 0)
files = []
for root, _dirs, _files in os.walk(src):
    _dirs.sort()
    for f in sorted(_files):
        files.append(os.path.join(root, f))
files.sort()
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for p in files:
        arc = os.path.relpath(p, dist)
        info = zipfile.ZipInfo(arc, EPOCH)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = (0o644 << 16)
        with open(p, "rb") as fh:
            zf.writestr(info, fh.read())
PY
fi

SIZE_KB=$(du -k "${ZIP_PATH}" | cut -f1)
echo "==> Done: ${ZIP_PATH} (${SIZE_KB} KB)"
echo "    Files in zip:"
python3 -c "
import zipfile
with zipfile.ZipFile('${ZIP_PATH}') as zf:
    for n in sorted(zf.namelist()):
        print('      ' + n)
"
