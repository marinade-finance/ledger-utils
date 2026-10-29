# CLAUDE.md

pnpm workspace. `packages/solana-hw-wallet` is the library (Ledger + Trezor signing for Node.js CLIs). `packages/ledger-utils` is a deprecated shim re-exporting it, plus `parseLedgerWallet` as an alias of `parseHardwareWallet`.

## Commands

- `pnpm fix` after every change, then `pnpm build` and `pnpm test`.
- `pnpm -C packages/solana-hw-wallet test:emulator` runs the Trezor firmware emulator e2e. It needs a running `trezor-user-env` container; see `.github/workflows/lint_and_test.yml` for the image and flags. Locally the container runs under podman.

## SDK design

- The core is kit-native. `LedgerWallet` / `TrezorWallet` (`src/ledger.ts`, `src/trezor.ts`) carry an `Address` and sign raw message bytes via `signTransactionMessage`. They are structural kit `TransactionPartialSigner` + `MessagePartialSigner`, with no type or runtime import of `@solana/signers`.
- `@solana/web3.js` 1.x is reached only through `toWeb3Wallet` in `src/web3js.ts`, by `await import()`. Every other file imports it as `import type` only. `__tests__/no-web3.spec.ts` guards this.
- The package has a single entry point. Consumers compile with moduleResolution `node` (CommonJS) and `nodenext`, so subpath exports are off the table.
- Runtime dependencies are only `@solana/*` 8.x leaf packages (`addresses`, `keys`, `errors`, `offchain-messages`). The vendor libraries and web3.js are optional peers, loaded lazily with an install hint.
- Tests use kit leaf packages as devDependencies. Do not add `@solana/kit` itself: it re-resolves the `@solana/sysvars` peer of `@trezor/connect`'s `token-2022` to 8.x.

## Signing semantics

- v1 transactions:
  - The Ledger Solana app parses v1 as v0 and fails (LedgerHQ/app-solana#248). Trezor firmware supports only legacy and v0 (trezor-firmware#7865).
  - Both wallets refuse v1 before any device call via `assertTransactionMessageVersion` in `src/signer.ts`.
  - web3.js 1.99 can deserialize `MessageV1` but not serialize it.
- kit `signMessages` gets the encoded off-chain message (signing domain + preamble + body):
  - Ledger passes the bytes unchanged. The app accepts v0 formats 0/1 and v1.
  - Trezor decodes v1 into text + signers, because the firmware builds the envelope itself. It refuses v0.
- `formatOffchainMessage` (v0) picks the short format by catching the library's `MAXIMUM_LENGTH_EXCEEDED` error, not by a hardcoded limit.

## Testing

- `test-utils/fake-ledger.ts` speaks APDUs and `test-utils/fake-trezor.ts` stands in for `@trezor/connect`. Both use SLIP-10 keys from `test-utils/slip10.ts`. Expected keys and signatures are the trezor-suite fixtures for the `all` x12 mnemonic.
- Jest cannot `require` the ESM `@trezor/connect`, so specs `jest.mock` it with the fake and `jest.resetModules()` per test. The module keeps per-process connect state.
- The emulator e2e uses `node:test` on the compiled output, not Jest.
