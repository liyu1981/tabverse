#!/bin/bash
# Prepares what the server embeds outside /console (adr/0024).
#
#   pnpm run site:prepare                    # default: nothing but the tracked
#                                            # redirect page answers "/"
#   officialserver=1 pnpm run site:prepare   # official: the documentation site
#                                            # answers "/" ...
#
# The flag is read here and nowhere else: `officialserver=1` also reaches the
# Docusaurus config (baseUrl, url, the Login link), so one variable decides both
# what gets built and where it lands.
#
# The directory is emptied first, on purpose. A binary is what go:embed saw at
# the moment it was compiled, so without this a default build run after an
# official one would quietly ship the docs - the flag would be a preference
# rather than a decision.
set -euo pipefail
cd "$(dirname "$0")/.."

DOCS_DIR="server/internal/webui/docs"

rm -rf "$DOCS_DIR"
mkdir -p "$DOCS_DIR"
# go:embed needs the directory to exist on a fresh clone, which is what the
# tracked .gitkeep is for; vite and docusaurus both empty their output
# directory, so it is put back after a build too.
touch "$DOCS_DIR/.gitkeep"

if [ "${officialserver:-0}" = "1" ]; then
  echo "officialserver=1: building the documentation site into $DOCS_DIR"
  (cd doc/tabverse-website && pnpm run build:official)
  touch "$DOCS_DIR/.gitkeep"
fi
