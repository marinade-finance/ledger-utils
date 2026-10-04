# @marinade.finance/solana-hw-wallet

[`@marinade.finance/solana-hw-wallet`](https://www.npmjs.com/package/@marinade.finance/solana-hw-wallet)

Ledger and Trezor signing for Node.js Solana CLI tools.
A wallet is selected by the same `usb://` url as in the [Solana CLI](https://docs.anza.xyz/cli/intro/#keypair-url)
and is returned as an Anchor compatible [`Wallet`](./src/wallet.ts).

## Installation

Vendor libraries are optional peer dependencies. Install only the ones for the devices you use.

```sh
pnpm add @marinade.finance/solana-hw-wallet
# Ledger
pnpm add @ledgerhq/hw-app-solana @ledgerhq/hw-transport-node-hid-noevents
# Trezor
pnpm add @trezor/connect
```

`@trezor/connect` is an ES module, it is loaded through `require(esm)` that needs Node.js 20.19+ or 22.12+.

## Usage

```ts
import { parseHardwareWallet } from '@marinade.finance/solana-hw-wallet'

const wallet = await parseHardwareWallet('usb://trezor?key=0/0', logger)
if (wallet === null) {
  // not a hardware wallet url, e.g. a keypair file path
}
await wallet.signTransaction(tx)
```

`LedgerWallet` and `TrezorWallet` also provide `signOffchainMessage` and `confirmPublicKey` (address shown on the device, `--confirm-key` in Solana CLI).
Ledger signs off-chain message format v0 (check with `verifyOffchainMessage`), Trezor supports only format v1 (check with `verifyOffchainMessageV1`).

## Wallet url

`usb://<ledger|trezor>[/<wallet-id>][?key=<account>[/<change>]]`

Every derivation path index is hardened, `key=0/1` and `key=0'/1'` are both `m/44'/501'/0'/1'`.

| url | device | derivation path |
|---|---|---|
| `usb://ledger` | the only connected | `44'/501'` |
| `usb://trezor?key=0/1` | the only connected | `44'/501'/0'/1'` |
| `usb://ledger/<pubkey>?key=0/1` | whose `44'/501'` key (Solana CLI wallet id) or `44'/501'/0'/1'` key is `<pubkey>` | `44'/501'/0'/1'` |
| `usb://trezor/<pubkey>` | whose `44'/501'` key is `<pubkey>`, or found by account search | `44'/501'` or the found one |

With more devices connected the url has to contain the wallet id, the error message lists the ids of the connected devices.
Account search runs only when `key` is not set. It derives `44'/501'/a'` and `44'/501'/a'/c'` for `a, c <= 20` ([BIP-44 gap limit](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#address-gap-limit)), so it takes a while.
An explicit `key` is never replaced by the search.

## Trezor in a CLI

`@trezor/connect` keeps the Node.js event loop busy. The library closes it after one second without a wallet call and opens it again on the next call, so the CLI exits on its own. `closeTrezorConnect()` closes it right away.
Trezor Safe 7 pairs over THP. The pairing code is read from the terminal and the pairing lasts for the process lifetime.
A passphrase is always entered on the device.

## Testing

Unit tests run against simulated devices that derive SLIP-10 keys from the `all all ... all` mnemonic,
the expected keys and signatures come from the [trezor-suite e2e fixtures](https://github.com/trezor/trezor-suite/tree/develop/packages/connect-core/e2e/__fixtures__).
The `trezor-emulator` CI job signs with the Trezor firmware emulator ([trezor-user-env](https://github.com/trezor/trezor-user-env)).
