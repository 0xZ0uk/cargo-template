import { describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'
import { rowPrefixes, stegaEncode } from '@cargo/onpage-core'
import { annotations, composite, stega } from '../locators.ts'
import { editable, editableOff, ATTR } from '../annotations.ts'

const REF = 'c:pages:5'
const m = (text: string, path: string, kind: 'text' | 'textarea' | 'richtext' | 'media' = 'text') =>
  stegaEncode(text, { ref: REF, path, kind })

function dom(html: string) {
  const w = new Window()
  w.document.body.innerHTML = html
  return w.document.body as unknown as HTMLElement
}

const summary = (ts: any[]) =>
  ts
    .map((t) => `${t.kind}:${t.path}@${t.el.tagName.toLowerCase()}${t.el.id ? '#' + t.el.id : ''}`)
    .sort()

describe('editable() annotations', () => {
  it('emits nothing when disabled or the doc has no id', () => {
    expect(editable({ collection: 'pages', doc: { id: 5 } }, { enabled: false })).toBe(editableOff)
    expect(editable({ collection: 'pages', doc: {} }, { enabled: true })).toBe(editableOff)
  })
  it('binds every attribute to the document', () => {
    const e = editable({ collection: 'pages', doc: { id: 5 } }, { enabled: true })
    expect(e.field('title', 'text', 'Title')).toEqual({
      [ATTR.ref]: REF,
      [ATTR.field]: 'title',
      [ATTR.kind]: 'text',
      [ATTR.label]: 'Title',
    })
    expect(editable({ global: 'header' }, { enabled: true }).row('links.0')).toEqual({
      [ATTR.ref]: 'g:header',
      [ATTR.row]: 'links.0',
    })
  })
})

describe('annotations() locator', () => {
  it('reads fields, rows and lists', () => {
    const root = dom(
      `<section id="s" data-onpage-ref="${REF}" data-onpage-row="layout.0"><h2 id="h" data-onpage-ref="${REF}" data-onpage-field="layout.0.heading" data-onpage-kind="text">x</h2><ul id="l" data-onpage-ref="${REF}" data-onpage-list="layout.0.items"></ul></section>`,
    )
    expect(summary(annotations().scan(root))).toEqual([
      'item:layout.0@section#s',
      'list:layout.0.items@ul#l',
      'text:layout.0.heading@h2#h',
    ])
  })
})

describe('stega() locator', () => {
  it('maps marked text and images with no annotations', () => {
    const root = dom(
      `<h1 id="t">${m('Home', 'title')}</h1><p id="s">${m('Hi', 'summary', 'textarea')}</p><img id="i" src="/a.jpg" alt="${m('Hero', 'hero', 'media')}"><p id="plain">No marker</p>`,
    )
    expect(summary(stega().scan(root))).toEqual([
      'media:hero@img#i',
      'text:title@h1#t',
      'textarea:summary@p#s',
    ])
  })

  it('maps a rich-text field to the element holding all its text', () => {
    const root = dom(
      `<div id="rt"><p>${m('One ', 'body', 'richtext')}<a href="/x">${m('link', 'body', 'richtext')}</a></p><ul><li>${m('Two', 'body', 'richtext')}</li></ul></div>`,
    )
    const t = stega()
      .scan(root)
      .filter((x) => x.kind === 'richtext')
    expect(t).toHaveLength(1)
    expect((t[0]!.el as any).id).toBe('rt')
  })

  it('infers rows and lists, without merging adjacent rows', () => {
    const root = dom(`
      <main>
        <section id="b0"><h2>${m('A', 'layout.0.heading')}</h2>
          <div id="cards"><div id="c0"><h3>${m('c0', 'layout.0.items.0.title')}</h3><p>${m('t0', 'layout.0.items.0.text', 'textarea')}</p></div>
          <div id="c1"><h3>${m('c1', 'layout.0.items.1.title')}</h3></div></div>
        </section>
        <section id="b1"><h2>${m('B', 'layout.1.heading')}</h2></section>
      </main>`)
    const ts = summary(
      stega()
        .scan(root)
        .filter((t) => t.kind === 'item' || t.kind === 'list'),
    )
    expect(ts).toEqual([
      'item:layout.0.items.0@div#c0',
      'item:layout.0.items.1@div#c1',
      'item:layout.0@section#b0',
      'item:layout.1@section#b1',
      'list:layout.0.items@div#cards',
      'list:layout@main',
    ])
  })

  it("ignores markers inside scripts and the editor's own UI", () => {
    const root = dom(
      `<script>"${m('x', 'title')}"</script><div data-onpage-ui><span>${m('y', 'title')}</span></div>`,
    )
    expect(stega().scan(root)).toEqual([])
  })

  it('rowPrefixes lists the row paths in a field path', () => {
    expect(rowPrefixes('layout.2.items.0.title')).toEqual(['layout.2', 'layout.2.items.0'])
    expect(rowPrefixes('title')).toEqual([])
  })
})

describe('composite()', () => {
  it('prefers annotations for the same row path', () => {
    const root = dom(
      `<section id="exact" data-onpage-ref="${REF}" data-onpage-row="layout.0"><div id="inner"><h2>${m('A', 'layout.0.heading')}</h2><p>${m('b', 'layout.0.text', 'textarea')}</p></div></section>`,
    )
    const rows = composite(annotations(), stega())
      .scan(root)
      .filter((t) => t.kind === 'item')
    expect(rows).toHaveLength(1)
    expect((rows[0]!.el as any).id).toBe('exact')
  })
})
