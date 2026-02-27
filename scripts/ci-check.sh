#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")

echo "=== 1/7 version:check ==="
npm run version:check

echo ""
echo "=== 2/7 changelog:check ==="
node scripts/extract-changelog.mjs "$VERSION" > /dev/null
echo "Changelog OK for $VERSION"

echo ""
echo "=== 3/7 eslint ==="
npm run lint

echo ""
echo "=== 4/7 vite build ==="
npm run build

echo ""
echo "=== 5/7 cargo fmt ==="
cd src-tauri
cargo fmt --all -- --check

echo ""
echo "=== 6/7 cargo clippy ==="
cargo clippy --all-targets --all-features -- -D warnings

echo ""
echo "=== 7/7 cargo test ==="
cargo test --all

echo ""
echo "✅ All CI checks passed!"
