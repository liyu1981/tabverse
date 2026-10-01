#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../doc/tabverse-website"
pnpm run build