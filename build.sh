#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

have_zip=0
have_py=0
command -v zip >/dev/null 2>&1 && have_zip=1
command -v python3 >/dev/null 2>&1 && have_py=1
if [ "${have_zip}" -eq 0 ] && [ "${have_py}" -eq 0 ]; then
  echo "ERROR: need either 'zip' or 'python3' to create the package." >&2
  exit 1
fi

VERSION=$(node -e "process.stdout.write(require('./manifest.json').version)")
NAME="mcp-group-cleanup-v${VERSION}"
DIST="dist"

rm -rf "${DIST}"
mkdir -p "${DIST}/${NAME}"

echo "==> Running tests..."
bash tests/run.sh

echo "==> Staging files into ${DIST}/${NAME}/"
cp manifest.json bg.js popup.html popup.js matcher.js cleanup-logic.js "${DIST}/${NAME}/"
cp -r icons "${DIST}/${NAME}/"

ZIP_PATH="${DIST}/${NAME}.zip"
echo "==> Creating zip at ${ZIP_PATH}..."
if [ "${have_zip}" -eq 1 ]; then
  ( cd "${DIST}" && zip -r -q "${NAME}.zip" "${NAME}" )
else
  python3 - "${DIST}" "${NAME}" <<'PY'
import os, sys, zipfile
dist, name = sys.argv[1], sys.argv[2]
src = os.path.join(dist, name)
out = os.path.join(dist, name + ".zip")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, _dirs, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f)
            arc = os.path.relpath(p, dist)
            zf.write(p, arc)
PY
fi

SIZE_KB=$(du -k "${ZIP_PATH}" | cut -f1)
echo "==> Done: ${ZIP_PATH} (${SIZE_KB} KB)"
echo "    Files in zip:"
python3 -c "
import zipfile, sys
with zipfile.ZipFile('${ZIP_PATH}') as zf:
    for n in zf.namelist():
        print('      ' + n)
"
