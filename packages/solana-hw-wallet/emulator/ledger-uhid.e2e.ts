import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { getDevices } from '@marinade.finance/ledger-hid-transport'
import { PublicKey } from '@solana/web3.js'

import { ALL_0_0, KEY_0_0, legacyMessage, transfer } from './ledger-fixtures'
import { APPROVE, SpeculosTransport, navigate } from './speculos'
import { createUhidLedger } from './uhid'
import { LedgerWallet } from '../src/ledger'
import { signEd25519 } from '../test-utils/slip10'

import type { UhidLedger } from './uhid'

// real node-hid and kernel hidraw: a virtual Ledger on /dev/uhid forwards the APDUs to Speculos
void describe('LedgerWallet over a uhid Ledger backed by Speculos', () => {
  let speculos: SpeculosTransport
  let uhid: UhidLedger
  let wallet: LedgerWallet

  before(async () => {
    speculos = await SpeculosTransport.connect()
    uhid = createUhidLedger(apdu => speculos.exchange(apdu))
    for (let i = 0; i < 100 && (await getDevices()).length === 0; i++) {
      await new Promise(resolve => {
        setTimeout(resolve, 100)
      })
    }
    const devices = await getDevices()
    assert.equal(devices.length, 1, 'unplug real Ledger devices first')
    assert.equal(devices[0]!.productId, 0x5011)
    assert.equal(devices[0]!.model, 'nanoSP')
    wallet = await LedgerWallet.instance('usb://ledger?key=0/0')
  })

  after(async () => {
    uhid.destroy()
    await speculos.close()
  })

  void it('derives the address over hidraw', () => {
    assert.equal(wallet.address, ALL_0_0)
  })

  void it('signs a legacy transfer over hidraw', async () => {
    const message = legacyMessage(transfer(new PublicKey(ALL_0_0)))
    const [signature] = await Promise.all([
      wallet.signTransactionMessage(message),
      navigate(APPROVE),
    ])
    assert.deepEqual(
      Buffer.from(signature),
      signEd25519(KEY_0_0, Buffer.from(message)),
    )
  })
})
