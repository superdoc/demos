bash <<'SUPERDOC_QUICKSTART'
set -euo pipefail

git clone https://github.com/superdoc/demos.git
cd demos/version-history
npx --yes pnpm@10.25.0 install --frozen-lockfile
npx --yes pnpm@10.25.0 dev
SUPERDOC_QUICKSTART
