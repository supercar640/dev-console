import { describe, it, expect } from 'vitest'
import { chunkInput } from './chunk-input'

describe('chunkInput', () => {
  it('빈 문자열은 빈 배열', () => {
    expect(chunkInput('', 4)).toEqual([])
  })
  it('size 이하면 통째로 한 조각', () => {
    expect(chunkInput('abc', 4)).toEqual(['abc'])
    expect(chunkInput('abcd', 4)).toEqual(['abcd'])
  })
  it('size 초과면 size 단위로 분할', () => {
    expect(chunkInput('abcdef', 4)).toEqual(['abcd', 'ef'])
  })
  it('분할 후 이어붙이면 원본과 동일', () => {
    const s = 'x'.repeat(1300)
    expect(chunkInput(s, 512).join('')).toBe(s)
  })
  it('size가 0 이하면 예외', () => {
    expect(() => chunkInput('a', 0)).toThrow()
  })
})
