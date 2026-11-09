#!/bin/sh
set -eu
host=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
ELECTRON_RUN_AS_NODE=1 exec "$host/../../MacOS/MuMa" --expose-internals "$host/cli.mjs" "$@"
