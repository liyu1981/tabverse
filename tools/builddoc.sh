#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../doc/tabverse-website"
# The GitHub Pages build, whatever this shell was used for last: `officialserver`
# switches the site's baseUrl and url for the copy that goes inside the binary
# (adr/0024), and this one has to stay at /tabverse/ on liyu1981.github.io.
unset officialserver
pnpm run build
