import { describe, expect, it } from 'vitest'

import { bulletList, numberedList } from '@/blocks/shared/lexical'

describe('list helpers', () => {
  it("numbers items like Lexical: a nested list's wrapper doesn't take a number", () => {
    const list = numberedList('a', { text: 'b', list: bulletList('x') }, 'c') as unknown as {
      children: { value: number }[]
    }
    // a, b, wrapper of b's nested list, c: the wrapper shares c's value, so c renders as 3.
    expect(list.children.map((item) => item.value)).toEqual([1, 2, 3, 3])
  })
})
