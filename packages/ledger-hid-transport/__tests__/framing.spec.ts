import { FRAME_SIZE, createResponseDecoder, encodeApdu } from '../src/framing'
import {
  RECEIVER_CHANNEL,
  RESPONSE_GET_VERSION,
  RESPONSE_LIST_APPS,
  RESPONSE_LOCKED_DEVICE,
  SENDER_CHANNEL,
  SENDER_VECTORS,
} from '../test-utils/ledger-dmk-vectors'

const hex = (value: string) => Buffer.from(value, 'hex')

function padded(value: string): Buffer {
  const frame = Buffer.alloc(FRAME_SIZE)
  hex(value).copy(frame)
  return frame
}

function decodeAll(channel: number, frames: Buffer[]): Buffer | undefined {
  const decode = createResponseDecoder(channel)
  let response: Buffer | undefined
  for (const frame of frames) {
    response = decode(frame)
  }
  return response
}

function apduOf(length: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, i) => i % 251))
}

describe('encodeApdu', () => {
  it.each(SENDER_VECTORS)(
    'matches Ledger framing of $name',
    ({ apdu, frames }) => {
      expect(
        encodeApdu(hex(apdu), SENDER_CHANNEL).map(f => f.toString('hex')),
      ).toEqual(frames.map(f => padded(f).toString('hex')))
    },
  )

  it.each([
    [1, 1],
    [57, 1],
    [58, 2],
    [59, 2],
    [60, 2],
    [116, 2],
    [117, 3],
    [260, 5],
  ])('splits a %i byte APDU into %i frames', (length, count) => {
    const apdu = apduOf(length)
    const frames = encodeApdu(apdu, 0x0102)
    expect(frames).toHaveLength(count)
    frames.forEach((frame, i) => {
      expect(frame).toHaveLength(FRAME_SIZE)
      expect(frame.readUInt16BE(0)).toBe(0x0102)
      expect(frame[2]).toBe(0x05)
      expect(frame.readUInt16BE(3)).toBe(i)
    })
    expect(frames[0]!.readUInt16BE(5)).toBe(length)
    expect(decodeAll(0x0102, frames)).toEqual(apdu)
  })

  it('encodes the longest APDU', () => {
    expect(encodeApdu(apduOf(0xffff), 1)).toHaveLength(
      Math.ceil((0xffff + 2) / 59),
    )
  })

  it.each([
    [0, 'APDU is empty'],
    [0x10000, 'APDU is longer than 65535 bytes'],
  ])('refuses a %i byte APDU', (length, message) => {
    expect(() => encodeApdu(apduOf(length), 1)).toThrow(message)
  })
})

describe('createResponseDecoder', () => {
  it('decodes the Ledger GetVersion response', () => {
    const frame = hex(RESPONSE_GET_VERSION)
    expect(createResponseDecoder(RECEIVER_CHANNEL)(frame)).toEqual(
      frame.subarray(7, 7 + 0x21),
    )
  })

  it('decodes the Ledger locked device response', () => {
    expect(
      createResponseDecoder(RECEIVER_CHANNEL)(hex(RESPONSE_LOCKED_DEVICE)),
    ).toEqual(hex('5515'))
  })

  it('decodes the Ledger 3 frame ListApps response', () => {
    const frames = RESPONSE_LIST_APPS.map(hex)
    const decode = createResponseDecoder(RECEIVER_CHANNEL)
    expect(decode(frames[0]!)).toBeUndefined()
    expect(decode(frames[1]!)).toBeUndefined()
    const response = decode(frames[2]!)!
    expect(response).toEqual(
      Buffer.concat([
        frames[0]!.subarray(7),
        frames[1]!.subarray(5),
        frames[2]!.subarray(5, 47),
      ]),
    )
    expect(response).toHaveLength(158)
    expect(response.subarray(-2)).toEqual(hex('9000'))
  })

  it('decodes two responses with two decoders', () => {
    expect(decodeAll(RECEIVER_CHANNEL, [hex(RESPONSE_LOCKED_DEVICE)])).toEqual(
      hex('5515'),
    )
    expect(decodeAll(RECEIVER_CHANNEL, [hex(RESPONSE_GET_VERSION)])).toEqual(
      hex(RESPONSE_GET_VERSION).subarray(7, 7 + 0x21),
    )
  })

  it('refuses a frame of another channel', () => {
    expect(() =>
      createResponseDecoder(0x1234)(hex(RESPONSE_LOCKED_DEVICE)),
    ).toThrow('Invalid channel')
  })

  it('refuses a frame with another tag', () => {
    const frame = hex(RESPONSE_LOCKED_DEVICE)
    frame[2] = 0x06
    expect(() => createResponseDecoder(RECEIVER_CHANNEL)(frame)).toThrow(
      'Invalid tag',
    )
  })

  it('refuses frames out of sequence', () => {
    const frames = RESPONSE_LIST_APPS.map(hex)
    expect(() => createResponseDecoder(RECEIVER_CHANNEL)(frames[1]!)).toThrow(
      'Invalid sequence',
    )
    const decode = createResponseDecoder(RECEIVER_CHANNEL)
    decode(frames[0]!)
    expect(() => decode(frames[0]!)).toThrow('Invalid sequence')
  })
})
