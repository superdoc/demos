#!/bin/sh
set -eu
# Railway attaches volumes after image build, initially owned by root.
mkdir -p "$DEMO_AGENT_DATA_DIR"
chown node:node "$DEMO_AGENT_DATA_DIR"
chmod 700 "$DEMO_AGENT_DATA_DIR"
exec su-exec node "$@"
