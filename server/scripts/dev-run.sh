#!/bin/sh
# Runs the dev server with `server/` as its working directory.
#
# Air starts whatever `entrypoint` names from its own root, which for this
# project is the repository (so it can watch server/ui - air only watches
# directories under its root). The server reads `./.env` and writes
# `data/tabversed.db` relative to its working directory, and both belong in
# server/ where server/README.md says they are. This is the one place that puts
# it back.
#
# `exec` so the process air started *is* the server: air's stop and restart then
# signal the server itself rather than a shell that has to forward them.

cd "$(dirname "$0")/.." || exit 1
exec ./bin/tabversed "$@"