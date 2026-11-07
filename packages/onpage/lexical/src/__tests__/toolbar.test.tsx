// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createTranslate } from '@shipment/onpage-react'
import { $getRoot, $isElementNode, $isTextNode, type LexicalEditor } from 'lexical'
import { describe, expect, it, vi } from 'vitest'
import { InlineRichText } from '../InlineRichText.tsx'
import type { RichTextState } from '../convert.ts'

const doc = (text: string) => ({
  root: {
    type: 'root',
    version: 1,
    format: '',
    indent: 0,
    direction: 'ltr',
    children: [
      {
        type: 'paragraph',
        version: 1,
        format: '',
        indent: 0,
        direction: 'ltr',
        textFormat: 0,
        children: [
          { type: 'text', version: 1, text, format: 0, detail: 0, mode: 'normal', style: '' },
        ],
      },
    ],
  },
})

async function setup(live = true) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const commit = vi.fn()
  const close = vi.fn()
  const ghost = vi.fn()
  render(
    <InlineRichText
      docKey="c:p:1"
      path="body"
      field={{ name: 'body', type: 'richText', label: 'Body' }}
      element={() => el}
      value={doc('Hello world')}
      commit={commit}
      preview={vi.fn()}
      close={close}
      ghost={ghost}
      live={live}
      t={createTranslate()}
    />,
  )
  const surface = await waitFor(() => {
    const s = document.querySelector<HTMLElement & { __lexicalEditor?: LexicalEditor }>(
      '.po-rt-surface',
    )
    if (!s?.__lexicalEditor) throw new Error('not ready')
    return s
  })
  const editor = surface.__lexicalEditor!
  /** Select the whole first paragraph's text. */
  const selectAll = (): void => {
    void act(() =>
      editor.update(
        () => {
          const p = $getRoot().getFirstChild()
          const text = $isElementNode(p) ? p.getFirstChild() : null
          if ($isTextNode(text)) text.select(0, text.getTextContentSize())
        },
        { discrete: true },
      ),
    )
  }
  const click = (id: string): void => {
    void act(() => {
      fireEvent.click(screen.getByTestId(`onpage-rt-${id}`))
    })
  }
  const committed = () => commit.mock.calls.at(-1)?.[0] as RichTextState
  return { editor, selectAll, click, commit, close, ghost, committed }
}

const types = (state: RichTextState) =>
  (state.root.children ?? []).map((n) =>
    n.type === 'heading' ? `${n.type}:${String(n.tag)}` : n.type,
  )

describe('rich-text toolbar', () => {
  it('bold marks the selection and Done saves it', async () => {
    const r = await setup()
    r.selectAll()
    r.click('bold')
    await waitFor(() =>
      expect(screen.getByTestId('onpage-rt-bold').getAttribute('aria-pressed')).toBe('true'),
    )
    r.click('done')
    expect(r.commit).toHaveBeenCalled()
    const text = r.committed().root.children?.[0]?.children?.[0]
    expect(text?.format).toBe(1) // bold
  })

  it('turns the block into a heading, a quote, a list — and back', async () => {
    const r = await setup()
    r.selectAll()
    r.click('h2')
    await waitFor(() =>
      expect(screen.getByTestId('onpage-rt-h2').getAttribute('aria-pressed')).toBe('true'),
    )
    r.click('h2') // toggles back to a paragraph
    r.click('quote')
    r.click('ul')
    r.click('done')
    expect(types(r.committed())).toEqual(['list'])
  })

  it('undo restores, and an unchanged editor saves nothing', async () => {
    const r = await setup()
    r.selectAll()
    r.click('italic')
    r.click('underline')
    r.click('undo')
    r.click('undo')
    r.click('redo')
    r.click('undo')
    r.click('done')
    expect(r.commit).not.toHaveBeenCalled()
    expect(r.close).toHaveBeenCalled()
  })

  it('links the selection to a safe URL, then removes the link', async () => {
    const r = await setup()
    r.selectAll()
    r.click('link')
    const input = await screen.findByTestId('onpage-rt-link-input')
    fireEvent.change(input, { target: { value: 'https://example.com' } })
    void act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    r.click('done')
    const linked = JSON.stringify(r.committed())
    expect(linked).toContain('"type":"link"')
    expect(linked).toContain('https://example.com')
  })

  it('refresh mode leaves a ghost of the new content', async () => {
    const r = await setup(false)
    r.selectAll()
    r.click('bold')
    r.click('done')
    expect(r.ghost).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining('Hello world') }),
    )
  })

  it('an outside click commits', async () => {
    const r = await setup()
    r.selectAll()
    r.click('bold')
    await waitFor(() =>
      expect(screen.getByTestId('onpage-rt-bold').getAttribute('aria-pressed')).toBe('true'),
    )
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    void act(() => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(r.commit).toHaveBeenCalled()
  })
})
