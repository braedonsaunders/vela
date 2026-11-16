#!/bin/sh
# Type-check client/modules/apple against the tvOS SDK in seconds, without an Exact build:
# Exact's module API is stood in by a minimal declaration of the parts Vela uses.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
media=${VELA_MEDIA:-$HOME/.scratch/vela-build/tvos/media-out}/VelaMedia.xcframework/tvos-arm64
stub=$root/native/apple/typecheck/ExactStub.swift
xcrun --sdk appletvos swiftc -typecheck -target arm64-apple-tvos17.0 -sdk "$(xcrun --sdk appletvos --show-sdk-path)" -F "$media" \
  "$stub" $(ls "$root"/client/modules/apple/*.swift | grep -v VelaOrigin.swift)
