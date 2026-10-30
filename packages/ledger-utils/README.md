# @marinade.finance/ledger-utils (deprecated)

Use [`@marinade.finance/solana-hw-wallet`](https://www.npmjs.com/package/@marinade.finance/solana-hw-wallet), it supports Ledger and Trezor.

This package re-exports it with `parseLedgerWallet` as an alias of `parseHardwareWallet`
and installs the Ledger libraries as regular dependencies.

`signOffchainMessage` and `verifyOffchainMessage` for software keys moved to
[`@marinade.finance/web3js-kit`](https://www.npmjs.com/package/@marinade.finance/web3js-kit). They take a
`CryptoKeyPair` (`createKeyPairFromBytes(keypair.secretKey)` for a web3.js `Keypair`) and return `SignatureBytes`.
