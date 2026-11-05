bash <<'SUPERDOC_QUICKSTART'
set -euo pipefail

git clone https://github.com/superdoc/demos.git
cd demos/canonical-collaboration-demo

# Build configuration
export COLLABORATION_API=on
export COLLABORATION_CLIENT=on
export COLLABORATION_AGENT=on

# Validate the production build for these components
make build

# Verify the build without starting servers when requested by CI
if [[ "${SUPERDOC_BUILD_ONLY:-0}" == "1" ]]; then
  exit 0
fi

# Runtime configuration for this demo
export COLLABORATION_AUTH=none
export COLLABORATION_STORAGE=memory
export COLLABORATION_DOCX=off

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  read -r -s -p "OpenAI API key: " OPENAI_API_KEY < /dev/tty
  echo
  export OPENAI_API_KEY
fi

touch .env
make dev
SUPERDOC_QUICKSTART
