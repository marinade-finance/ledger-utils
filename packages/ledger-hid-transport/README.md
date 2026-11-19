# @marinade.finance/ledger-hid-transport

[`@marinade.finance/ledger-hid-transport`](https://www.npmjs.com/package/@marinade.finance/ledger-hid-transport)

Ledger USB HID transport for Node.js. It is a `@ledgerhq/hw-transport` `Transport` on [`node-hid`](https://github.com/node-hid/node-hid) 3,
so Ledger app libraries like `@ledgerhq/hw-app-solana` work on it unchanged.
It replaces the deprecated `@ledgerhq/hw-transport-node-hid-noevents` without the rxjs based Ledger Device Management Kit.

```sh
pnpm add @marinade.finance/ledger-hid-transport
```

```ts
import Solana from '@ledgerhq/hw-app-solana'
import TransportNodeHid, { getDevices } from '@marinade.finance/ledger-hid-transport'

const [device] = await getDevices()
const transport = await TransportNodeHid.open(device.path)
transport.on('disconnect', () => console.log('Ledger disconnected'))
const solana = new Solana(transport)
const { address } = await solana.getAddress("44'/501'/0'/0'")
await transport.close()
```

Ledger app libraries pin their own `@ledgerhq/hw-transport` version. The runtime class is the same, but when the pinned copy differs from the one this package resolves, TypeScript needs `new Solana(transport as unknown as ConstructorParameters<typeof Solana>[0])`.

- `getDevices({ logger })` lists Ledger APDU interfaces by path. A product id unknown to `@ledgerhq/devices` is listed with `model` undefined and reported to the logger.
- `TransportNodeHid.open(path, { logger })` opens the device, exclusively on macOS (node-hid default), so share one transport per path within a process. The logger also traces APDUs.
- `exchange(apdu, { abortTimeoutMs })` waits for the user without a time limit unless `abortTimeoutMs` is set.
- A failed write or read, a malformed response frame or an `abortTimeoutMs` timeout closes the transport and emits `disconnect` once. The HID protocol has no request id, so a late response must never answer the next request. Open the device again to continue.

On Linux the device needs the [Ledger udev rules](https://github.com/LedgerHQ/udev-rules), the open error says so when access is denied.

The HID framing is ported from `@ledgerhq/hw-transport-node-hid-noevents`, Copyright Ledger, licensed under Apache-2.0 ([LICENSE-APACHE](./LICENSE-APACHE)) and modified.
