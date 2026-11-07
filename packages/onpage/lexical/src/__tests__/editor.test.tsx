// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createTranslate } from '@shipment/onpage-react'
import { describe, expect, it, vi } from 'vitest'
import { InlineRichText } from '../InlineRichText.tsx'
import { lexicalEditors } from '../index.ts'

const value = {
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
          {
            type: 'text',
            version: 1,
            text: 'Hello',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
    ],
  },
}

function setup(style?: { fontSize?: string; lineHeight?: string }) {
  const el = document.createElement('p')
  el.className = 'prose'
  el.textContent = 'Hello'
  if (style?.fontSize) el.style.fontSize = style.fontSize
  if (style?.lineHeight) el.style.lineHeight = style.lineHeight
  document.body.appendChild(el)
  const commit = vi.fn()
  const close = vi.fn()
  render(
    <InlineRichText
      docKey="c:pages:1"
      path="body"
      field={{ name: 'body', type: 'richText', label: 'Body' }}
      element={() => el}
      value={value}
      commit={commit}
      preview={vi.fn()}
      close={close}
      ghost={vi.fn()}
      live
      t={createTranslate()}
    />,
  )
  return { el, commit, close }
}

describe('lexical editor', () => {
  it('registers a lazy rich-text editor', () => {
    expect(lexicalEditors.richText?.mode).toBe('inline')
  })
  it('renders the toolbar, takes the element classes, hides the original', async () => {
    const { el } = setup()
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeTruthy()
    expect(screen.getByTestId('onpage-rt-bold').getAttribute('aria-pressed')).toBe('false')
    await waitFor(() =>
      expect(document.querySelector('.po-rt-surface')?.className).toContain('prose'),
    )
    expect(el.getAttribute('data-onpage-hidden')).toBe('true')
  })
  it('copies the element typography onto the surface', async () => {
    setup({ fontSize: '20px', lineHeight: '32px' })
    const surface = await waitFor(() => document.querySelector<HTMLElement>('.po-rt-surface')!)
    expect(surface.style.fontSize).toBe('20px')
    expect(surface.style.lineHeight).toBe('32px')
  })
  it('Done without changes closes without saving', async () => {
    const { commit, close } = setup()
    await waitFor(() => expect(document.querySelector('.po-rt-surface')).toBeTruthy())
    fireEvent.click(screen.getByTestId('onpage-rt-done'))
    expect(close).toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })
  it('Escape cancels', async () => {
    const { close, commit } = setup()
    const surface = await waitFor(() => document.querySelector<HTMLElement>('.po-rt-surface')!)
    surface.focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })
  it('refuses javascript: links', async () => {
    setup()
    fireEvent.click(screen.getByTestId('onpage-rt-link'))
    const input = await screen.findByTestId('onpage-rt-link-input')
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByTestId('onpage-rt-link-apply'))
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'))
  })
})
