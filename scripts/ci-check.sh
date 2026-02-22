#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== 1/6 version:check ==="
npm run version:check

echo ""
echo "=== 2/6 eslint ==="
npm run lint

echo ""
echo "=== 3/6 vite build ==="
npm run build

echo ""
echo "=== 4/6 cargo fmt ==="
cd src-tauri
cargo fmt --all -- --check

echo ""
echo "=== 5/6 cargo clippy ==="
cargo clippy --all-targets --all-features -- -D warnings

echo ""
echo "=== 6/6 cargo test ==="
cargo test --all

echo ""
echo "✅ All CI checks passed!"
