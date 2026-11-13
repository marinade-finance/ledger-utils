import { connect } from 'node:net'

import Transport from '@ledgerhq/hw-transport'

import type { Socket } from 'node:net'

const [APDU_HOST = '127.0.0.1', APDU_PORT = '9999'] = (
  process.env.SPECULOS_APDU ?? '127.0.0.1:9999'
).split(':')
const API_URL = process.env.SPECULOS_API ?? 'http://127.0.0.1:5000'
const MAX_PRESSES = 40

// Speculos APDU TCP: request `u32BE length | apdu`, reply `u32BE data length | data | status word`
export class SpeculosTransport extends Transport {
  private received = Buffer.alloc(0)
  private onReceived: (() => void) | undefined

  private constructor(private readonly socket: Socket) {
    super()
    socket.on('data', chunk => {
      this.received = Buffer.concat([this.received, chunk])
      this.onReceived?.()
    })
  }

  static async connect(): Promise<SpeculosTransport> {
    const socket = connect(Number(APDU_PORT), APDU_HOST)
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    return new SpeculosTransport(socket)
  }

  override async exchange(apdu: Buffer): Promise<Buffer> {
    return this.exchangeAtomicImpl(
      () =>
        new Promise<Buffer>((resolve, reject) => {
          this.onReceived = () => {
            const length =
              this.received.length >= 4 ? this.received.readUInt32BE(0) + 2 : 0
            if (length > 0 && this.received.length >= 4 + length) {
              this.onReceived = undefined
              resolve(this.received.subarray(4, 4 + length))
              this.received = this.received.subarray(4 + length)
            }
          }
          const header = Buffer.alloc(4)
          header.writeUInt32BE(apdu.length)
          this.socket.write(Buffer.concat([header, apdu]), e => {
            if (e) {
              reject(e)
            }
          })
        }),
    )
  }

  override async close(): Promise<void> {
    this.socket.destroy()
  }
}

export async function pressButton(
  which: 'left' | 'right' | 'both',
): Promise<void> {
  const response = await fetch(`${API_URL}/button/${which}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'press-and-release' }),
  })
  if (!response.ok) {
    throw new Error(`Speculos button ${which}: HTTP ${response.status}`)
  }
}

export async function screenText(): Promise<string> {
  const response = await fetch(`${API_URL}/events?currentscreenonly=true`)
  const { events } = (await response.json()) as { events: { text: string }[] }
  return events.map(e => e.text).join(' ')
}

// press right until the screen matches, then both, as a user reviewing on a Nano S Plus
export async function navigate(pattern: RegExp): Promise<void> {
  for (let i = 0; i < MAX_PRESSES; i++) {
    await new Promise(resolve => {
      setTimeout(resolve, 200)
    })
    const text = await screenText()
    if (pattern.test(text)) {
      await pressButton('both')
      return
    }
    if (!text.includes('app is ready')) {
      await pressButton('right')
    }
  }
  throw new Error(
    `Speculos screen did not show ${String(pattern)}, last: ${await screenText()}`,
  )
}
