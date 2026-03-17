#!/bin/zsh
set -euo pipefail

PROFILE_DIR="${HOME}/.opennft-neoline-chrome-profile-v3"
DEFAULT_URL="https://nft.neomini.app/collections/new"
TARGET_URL="${1:-$DEFAULT_URL}"

mkdir -p "$PROFILE_DIR"
find "$PROFILE_DIR" -maxdepth 1 -name 'Singleton*' -delete 2>/dev/null || true

open -na "Google Chrome" --args \
  "--user-data-dir=$PROFILE_DIR" \
  "--profile-directory=Default" \
  "$TARGET_URL"
