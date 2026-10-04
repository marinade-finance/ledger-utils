import Transport from '@ledgerhq/hw-transport'

import { deriveKeypair, signEd25519 } from './slip10'

const INS_GET_ADDR = 0x05
const INS_SIGN = 0x06
const INS_SIGN_OFFCHAIN = 0x07
const P2_EXTEND = 0x01
const P2_MORE = 0x02

export type FakeLedgerBehavior = {
  // status word returned to every APDU, e.g. 0x5515 locked device
  status?: number
  // status word returned to signing APDUs, e.g. 0x6985 user rejection
  signStatus?: number
}

export type SignRequest = { ins: number; path: number[]; message: Buffer }

// Ledger Solana app speaking APDUs with real SLIP-10 keys derived from the seed
export class FakeLedgerTransport extends Transport {
  public readonly signRequests: SignRequest[] = []
  public readonly displayedPaths: number[][] = []
  private chunks: Buffer[] = []

  constructor(
    private readonly seed: Buffer,
    public behavior: FakeLedgerBehavior = {},
  ) {
    super()
  }

  override async exchange(apdu: Buffer): Promise<Buffer> {
    const [, ins, p1, p2] = apdu
    const data = apdu.subarray(5, 5 + apdu[4]!)
    if (this.behavior.status !== undefined) {
      return statusWord(this.behavior.status)
    }
    if (ins === INS_GET_ADDR) {
      const { path } = readPath(data)
      if (p1 === 0x01) {
        this.displayedPaths.push(path)
      }
      return Buffer.concat([
        deriveKeypair(this.seed, path).publicKey.toBuffer(),
        statusWord(0x9000),
      ])
    }
    if (ins === INS_SIGN || ins === INS_SIGN_OFFCHAIN) {
      if ((p2! & P2_EXTEND) === 0) {
        this.chunks = []
      }
      this.chunks.push(Buffer.from(data))
      if ((p2! & P2_MORE) !== 0) {
        return statusWord(0x9000)
      }
      if (this.behavior.signStatus !== undefined) {
        return statusWord(this.behavior.signStatus)
      }
      const payload = Buffer.concat(this.chunks)
      // payload: [signers count = 1][path][message]
      const { path, length } = readPath(payload.subarray(1))
      const message = payload.subarray(1 + length)
      this.signRequests.push({ ins, path, message })
      return Buffer.concat([
        signEd25519(deriveKeypair(this.seed, path), message),
        statusWord(0x9000),
      ])
    }
    return statusWord(0x6d00)
  }

  override async close(): Promise<void> {}
}

function readPath(data: Buffer): { path: number[]; length: number } {
  const count = data[0]!
  const path: number[] = []
  for (let i = 0; i < count; i++) {
    path.push(data.readUInt32BE(1 + i * 4) & 0x7fffffff)
  }
  return { path, length: 1 + count * 4 }
}

function statusWord(code: number): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16BE(code)
  return buffer
}
