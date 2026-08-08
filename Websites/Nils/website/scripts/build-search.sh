#!/usr/bin/env bash
# Generate Pagefind search index from the static blog HTML.
# Run after adding or updating posts in blog/posts/.
set -euo pipefail

SITE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SITE_ROOT"

echo "-> Building Pagefind index over $SITE_ROOT/blog ..."
npx pagefind --site . --output-path "$SITE_ROOT/pagefind" --glob "blog/**/*.html"
echo "Done. Pagefind index built at $SITE_ROOT/pagefind/"
