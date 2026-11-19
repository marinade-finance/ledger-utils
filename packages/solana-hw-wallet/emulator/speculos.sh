#!/usr/bin/env bash
# Builds the Ledger Solana app once and starts the Speculos emulator with the `all` x12 seed.
set -euo pipefail

APP_SOLANA_COMMIT=af6ed454f0ed39cad8a5e1bca544ced18350a403
BUILDER_IMAGE=ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder-lite@sha256:5cad527ef257c03a8f4ecc87851e84945beaa18a20cfe8f1165d906fc3d5790f
SPECULOS_IMAGE=ghcr.io/ledgerhq/speculos@sha256:56c7ec84c903147dac28e68706d3241218a3d9beb9562dd4a8c02947b2a24f47
TARGET=nanos2
MNEMONIC='all all all all all all all all all all all all'

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
SOURCES=$ROOT/build/app-solana
APPS=$ROOT/build/ledger-app

if [ ! -f "$APPS/app.elf" ]; then
  rm -rf "$SOURCES"
  git init -q "$SOURCES"
  git -C "$SOURCES" fetch -q --depth 1 https://github.com/LedgerHQ/app-solana "$APP_SOLANA_COMMIT"
  git -C "$SOURCES" checkout -q FETCH_HEAD
  docker run --rm -v "$SOURCES:/app" -w /app "$BUILDER_IMAGE" bash -c 'make BOLOS_SDK=$NANOSP_SDK'
  mkdir -p "$APPS"
  cp "$SOURCES/build/$TARGET/bin/app.elf" "$APPS/app.elf"
fi

docker rm -f speculos > /dev/null 2>&1 || true
docker run -d --name speculos --network host -v "$APPS:/speculos/apps:ro" "$SPECULOS_IMAGE" \
  --model nanosp --display headless --seed "$MNEMONIC" --apdu-port 9999 --api-port 5000 apps/app.elf
