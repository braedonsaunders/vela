#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: tools/e2e-gate.sh /path/to/vela-e2e.env" >&2
  exit 2
fi

env_file=$1
if [ ! -f "$env_file" ]; then
  echo "Vela e2e environment file not found: $env_file" >&2
  exit 2
fi

permissions=$(stat -f '%Lp' "$env_file" 2>/dev/null || stat -c '%a' "$env_file")
if [ "$permissions" != 600 ]; then
  echo "Vela e2e environment file must be mode 600 (found $permissions)" >&2
  exit 2
fi

set -a
# The dedicated lab credentials remain in this process and the e2e secret store.
. "$env_file"
set +a

: "${VELA_E2E_SERVER:?VELA_E2E_SERVER is required}"
: "${VELA_E2E_USER:?VELA_E2E_USER is required}"
: "${VELA_E2E_PASSWORD:?VELA_E2E_PASSWORD is required}"
: "${VELA_E2E_VIEWER_ID:?VELA_E2E_VIEWER_ID is required}"

if [ -z "${VELA_E2E_BUN:-}" ]; then
  preferred_bun=$HOME/.scratch/tmp/vela/bun-1.4.2/bun-darwin-aarch64/bun
  if [ -x "$preferred_bun" ]; then VELA_E2E_BUN=$preferred_bun; else VELA_E2E_BUN=$(command -v bun); fi
  export VELA_E2E_BUN
fi

export PLAYWRIGHT_SKIP_BROWSER_GC=1
export VELA_MOCK_SILENT_MEDIA=1
export VELA_MOCK_MEDIA_ROOT=${VELA_MOCK_MEDIA_ROOT:-$HOME/.scratch/tmp/vela/media}
export VELA_MOCK_MUSIC_ROOT=${VELA_MOCK_MUSIC_ROOT:-$HOME/.scratch/tmp/vela/media-music}
export VELA_MOCK_BOOKS_ROOT=${VELA_MOCK_BOOKS_ROOT:-$HOME/.scratch/tmp/vela/media-books}
export VELA_E2E_PLEX_TOKEN_FILE=${VELA_E2E_PLEX_TOKEN_FILE:-$HOME/.scratch/tmp/thr_9jsg8ia37s/prod-readiness-private/owner-token}

umask 077
session_parent=$HOME/.scratch/tmp/${BB_THREAD_ID:-vela-e2e}
mkdir -p "$session_parent"
chmod 700 "$session_parent"
session_dir=$(mktemp -d "$session_parent/lab-sessions.XXXXXX")
export VELA_E2E_SESSION_DIR=$session_dir
export VELA_E2E_STATIC_ROOT=${VELA_E2E_STATIC_ROOT:-$session_dir/web}

cleanup_sessions() {
  [ -n "$session_dir" ] || return 0
  cleanup_dir=$session_dir
  session_dir=
  "$VELA_E2E_BUN" tests/e2e/revoke-lab-sessions.ts "$cleanup_dir"
}
trap 'cleanup_sessions || true' EXIT

if [ ! -f "$VELA_E2E_STATIC_ROOT/index.html" ]; then
  echo "==> export current Vela web build"
  (
    cd apps/vela
    VELA_WEB_BASE=/vela \
      EXPO_PUBLIC_VELA_PLAYER_ASSETS=0000000000000000000000000000000000000000000000000000000000000000 \
      "$VELA_E2E_BUN" x expo export --platform web --output-dir "$VELA_E2E_STATIC_ROOT"
  )
fi

if [ ! -f "$VELA_MOCK_MEDIA_ROOT/master.m3u8" ] || [ ! -f "$VELA_MOCK_MEDIA_ROOT/mse.json" ]; then
  "$VELA_E2E_BUN" mock-server/scripts/make-media.ts
fi
if [ ! -f "$VELA_MOCK_MUSIC_ROOT/gapless-sweep-1.m4a" ]; then
  "$VELA_E2E_BUN" mock-server/scripts/make-gapless-media.ts
fi
if [ ! -f "$VELA_MOCK_BOOKS_ROOT/book-harbour-of-bells.epub" ] || [ ! -f "$VELA_MOCK_BOOKS_ROOT/book-field-guide-imaginary-birds.pdf" ]; then
  "$VELA_E2E_BUN" mock-server/scripts/make-book-media.ts
fi

run_gate() {
  label=$1
  shift
  echo "==> $label"
  if npx --no-install e2e run --strict-cache --workers 1 --retries 0 "$@"; then
    echo "PASS: $label"
  else
    echo "FAIL: $label" >&2
    return 1
  fi
}

status=0
run_gate "deterministic web gate (Chromium + WebKit)" --config e2e.mock.config.ts --target mock-chromium,mock-webkit || status=1
run_gate "lab web gate (Chromium + WebKit)" --target chromium,webkit || status=1
cleanup_sessions || status=1

if [ "$status" -eq 0 ]; then
  echo "VELA RELEASE GATE: PASS"
else
  echo "VELA RELEASE GATE: FAIL" >&2
fi
exit "$status"
