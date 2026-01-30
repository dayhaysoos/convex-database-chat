#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$ROOT_DIR/example"

usage() {
  echo "Usage: ./dev-link.sh [link|unlink]"
  echo
  echo "Commands:"
  echo "  link   Link the local package into example/ (default)"
  echo "  unlink Restore example/ to the published package"
}

command="${1:-link}"

case "$command" in
  link)
    echo "Linking local package into example..."
    (cd "$ROOT_DIR" && npm link)
    (cd "$EXAMPLE_DIR" && npm link @dayhaysoos/convex-database-chat)
    echo
    echo "Done. For live rebuilds, run: npm run build:watch"
    ;;
  unlink)
    echo "Removing local link and restoring published package..."
    (cd "$EXAMPLE_DIR" && npm unlink @dayhaysoos/convex-database-chat)
    (cd "$EXAMPLE_DIR" && npm install)
    echo "Done."
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage >&2
    exit 1
    ;;
esac
