import { describe, it, expect } from 'vitest'
import { RingBuffer } from './ring-buffer'

describe('RingBuffer', () => {
  it('빈 버퍼는 빈 Buffer를 replay한다', () => {
    expect(new RingBuffer(100).replay()).toEqual(Buffer.alloc(0))
  })

  it('append한 청크를 순서대로 이어붙여 replay한다', () => {
    const rb = new RingBuffer(100)
    rb.append(Buffer.from('가'))
    rb.append(Buffer.from('나'))
    expect(rb.replay().toString('utf-8')).toBe('가나')
  })

  it('maxBytes 초과 시 가장 오래된 청크부터 버린다', () => {
    const rb = new RingBuffer(6)
    rb.append(Buffer.from('가'))
    rb.append(Buffer.from('나'))
    rb.append(Buffer.from('다'))
    expect(rb.replay().toString('utf-8')).toBe('나다')
  })

  it('단일 청크가 maxBytes보다 커도 최신 청크는 유지한다', () => {
    const rb = new RingBuffer(2)
    rb.append(Buffer.from('가'))
    expect(rb.replay().toString('utf-8')).toBe('가')
  })

  it('clear()는 버퍼를 비운다', () => {
    const rb = new RingBuffer(100)
    rb.append(Buffer.from('x'))
    rb.clear()
    expect(rb.replay()).toEqual(Buffer.alloc(0))
  })
})
