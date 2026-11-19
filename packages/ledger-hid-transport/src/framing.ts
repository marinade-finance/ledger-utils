/*! Ported from @ledgerhq/hw-transport-node-hid-noevents hid-framing, Copyright Ledger, Apache-2.0, modified */
import { TransportError } from '@ledgerhq/hw-transport'

export const FRAME_SIZE = 64
const TAG = 0x05
const HEADER_SIZE = 5
const MAX_APDU_LENGTH = 0xffff

export function encodeApdu(apdu: Uint8Array, channel: number): Buffer[] {
  if (apdu.length === 0) {
    throw new TransportError('APDU is empty', 'InvalidApdu')
  }
  if (apdu.length > MAX_APDU_LENGTH) {
    throw new TransportError(
      `APDU is longer than ${MAX_APDU_LENGTH} bytes`,
      'InvalidApdu',
    )
  }
  const blockSize = FRAME_SIZE - HEADER_SIZE
  const data = Buffer.alloc(2 + apdu.length)
  data.writeUInt16BE(apdu.length, 0)
  data.set(apdu, 2)
  const frames: Buffer[] = []
  for (let i = 0; i * blockSize < data.length; i++) {
    const frame = Buffer.alloc(FRAME_SIZE)
    frame.writeUInt16BE(channel, 0)
    frame.writeUInt8(TAG, 2)
    frame.writeUInt16BE(i, 3)
    data.copy(frame, HEADER_SIZE, i * blockSize, (i + 1) * blockSize)
    frames.push(frame)
  }
  return frames
}

export function createResponseDecoder(
  channel: number,
): (frame: Uint8Array) => Buffer | undefined {
  let sequence = 0
  let length = 0
  let data = Buffer.alloc(0)
  return frame => {
    const chunk = Buffer.from(frame)
    if (chunk.readUInt16BE(0) !== channel) {
      throw new TransportError('Invalid channel', 'InvalidChannel')
    }
    if (chunk.readUInt8(2) !== TAG) {
      throw new TransportError('Invalid tag', 'InvalidTag')
    }
    if (chunk.readUInt16BE(3) !== sequence) {
      throw new TransportError('Invalid sequence', 'InvalidSequence')
    }
    if (sequence === 0) {
      length = chunk.readUInt16BE(HEADER_SIZE)
    }
    data = Buffer.concat([
      data,
      chunk.subarray(sequence === 0 ? HEADER_SIZE + 2 : HEADER_SIZE),
    ])
    sequence++
    return data.length >= length ? data.subarray(0, length) : undefined
  }
}
