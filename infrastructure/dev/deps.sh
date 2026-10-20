#!/bin/sh
# node_modules lives on the Mac (fast) while the repo lives in the SabiDev image on the SSD (slow for small files).
# Plain `npm install` in the repo replaces the node_modules symlink with a real folder on the SSD, so install
# in the Mac folder instead and copy package.json / package-lock.json back. Usage: npm run deps [-- <npm install args>]
set -e
top=$(git rev-parse --show-toplevel)
if [ "$(cd "$(git rev-parse --git-dir)" && pwd -P)" = "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)" ]; then name=main; else name=$(basename "$top"); fi
dir="${SABI_DEPS_DIR:-$HOME/Developer/.sabi-deps}/$name"
if [ -e "$top/node_modules" ] && [ ! -L "$top/node_modules" ]; then
  echo "deps: $top/node_modules is a real folder; move it to $dir/node_modules first" >&2; exit 1
fi
mkdir -p "$dir"
cp "$top/package.json" "$top/package-lock.json" "$dir/"
gitdir=$(cd "$(git rev-parse --git-dir)" && pwd -P) # so the `prepare` hook still configures this repo
(cd "$dir" && GIT_DIR="$gitdir" npm install --no-audit --no-fund "$@")
cp "$dir/package.json" "$dir/package-lock.json" "$top/"
[ -L "$top/node_modules" ] || ln -s "$dir/node_modules" "$top/node_modules"
echo "deps: $top/node_modules -> $dir/node_modules"
