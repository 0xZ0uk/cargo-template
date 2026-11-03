'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Banner, Button, RefreshIcon } from '@payloadcms/ui'
import { Card, EmptyState, LoadingState, TonePill } from '../ui/index.js'
import './AltTextPanel.css'

const S = {
  fr: {
    title: 'Alt-text IA des images',
    subtitle: "Génère l'attribut alt des images qui n'en ont pas (Claude vision), pour l'accessibilité et le SEO.",
    none: 'Toutes les images ont un alt.',
    forbidden: 'Réservé aux administrateurs.',
    disabled: 'Fonction IA désactivée (features.aiFeatures).',
    missing: 'image(s) sans alt',
    generate: 'Générer',
    generating: '…',
    apply: 'Appliquer',
    applied: 'Appliqué',
    noKey: 'Clé API Claude requise (ANTHROPIC_API_KEY).',
    loading: 'Chargement…',
    refresh: 'Rafraîchir',
    altLabel: 'Texte alternatif',
  },
  en: {
    title: 'AI image alt-text',
    subtitle: 'Generate alt text for images that lack one (Claude vision), for accessibility and SEO.',
    none: 'All images have alt text.',
    forbidden: 'Admins only.',
    disabled: 'AI feature disabled (features.aiFeatures).',
    missing: 'image(s) without alt',
    generate: 'Generate',
    generating: '…',
    apply: 'Apply',
    applied: 'Applied',
    noKey: 'Claude API key required (ANTHROPIC_API_KEY).',
    loading: 'Loading…',
    refresh: 'Refresh',
    altLabel: 'Alt text',
  },
} as const

interface Item {
  id: string
  filename: string
  url: string
  mimeType: string
  alt: string
}
interface RowState {
  busy?: boolean
  alt?: string
  applied?: boolean
  error?: string
}

export function AltTextPanel({ locale }: { locale: 'fr' | 'en' }) {
  const s = S[locale] ?? S.fr
  const [items, setItems] = useState<Item[] | null>(null)
  const [collection, setCollection] = useState('media')
  const [missingCount, setMissingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<Record<string, RowState>>({})
  const [status, setStatus] = useState<'ok' | 'forbidden' | 'disabled'>('ok')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/seo-plugin/alt-text-audit', { credentials: 'include', cache: 'no-store' })
      if (res.status === 404) {
        setStatus('disabled')
        return
      }
      if (res.status === 403) {
        setStatus('forbidden')
        return
      }
      const json = await res.json()
      setStatus('ok')
      setItems((json.items as Item[]) || [])
      setMissingCount(json.missingCount || 0)
      setCollection(json.collection || 'media')
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setRow = (id: string, patch: RowState) =>
    setState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const generate = async (item: Item) => {
    setRow(item.id, { busy: true, error: undefined })
    try {
      const res = await fetch('/api/seo-plugin/ai-alt-text', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, id: item.id, apply: false }),
      })
      const json = await res.json()
      if (!res.ok) {
        setRow(item.id, { busy: false, error: json.code === 'no_api_key' ? s.noKey : json.error || `Error ${res.status}` })
        return
      }
      setRow(item.id, { busy: false, alt: json.alt })
    } catch (e) {
      setRow(item.id, { busy: false, error: e instanceof Error ? e.message : 'Network error' })
    }
  }

  const apply = async (item: Item) => {
    const alt = state[item.id]?.alt
    if (!alt) return
    setRow(item.id, { busy: true, error: undefined })
    try {
      const res = await fetch('/api/seo-plugin/ai-alt-text', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, id: item.id, apply: true, altText: alt }),
      })
      const json = await res.json()
      if (!res.ok) {
        setRow(item.id, { busy: false, error: json.error || `Error ${res.status}` })
        return
      }
      setRow(item.id, { busy: false, applied: true })
    } catch (e) {
      setRow(item.id, { busy: false, error: e instanceof Error ? e.message : 'Network error' })
    }
  }

  return (
    <Card
      actions={
        status === 'ok' ? (
          <Button buttonStyle="secondary" icon={<RefreshIcon />} margin={false} onClick={() => void load()} size="medium">
            {s.refresh}
          </Button>
        ) : undefined
      }
      title={s.title}
    >
      <p className="seo-text seo-text--small seo-text--secondary">{s.subtitle}</p>

      {status === 'forbidden' && <Banner type="default">{s.forbidden}</Banner>}
      {status === 'disabled' && <Banner type="default">{s.disabled}</Banner>}

      {status === 'ok' && (
        <>
          {loading && <LoadingState label={s.loading} />}
          {!loading && items && items.length === 0 && <EmptyState title={s.none} />}
          {!loading && items && items.length > 0 && (
            <>
              <p className="seo-text seo-text--small seo-text--secondary">
                {missingCount} {s.missing}
              </p>
              <div className="seo-stack seo-stack--tight">
                {items.map((item) => {
                  const rs = state[item.id] || {}
                  return (
                    <div className="seo-inset seo-alt__item" key={item.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" className="seo-alt__thumb" src={item.url} />
                      <div className="seo-alt__body seo-stack seo-stack--tight">
                        <span className="seo-text seo-text--small seo-text--secondary seo-truncate">{item.filename}</span>
                        {rs.alt !== undefined ? (
                          <input
                            aria-label={`${s.altLabel} — ${item.filename}`}
                            className="seo-input"
                            disabled={rs.applied}
                            maxLength={125}
                            onChange={(e) => setRow(item.id, { alt: e.target.value })}
                            value={rs.alt}
                          />
                        ) : (
                          <span className="seo-text seo-text--secondary">—</span>
                        )}
                        {rs.error && (
                          <span className="seo-text seo-text--small seo-text--danger" role="alert">
                            {rs.error}
                          </span>
                        )}
                      </div>
                      <div className="seo-alt__action">
                        {rs.applied ? (
                          <TonePill tone="success">{s.applied}</TonePill>
                        ) : rs.alt !== undefined ? (
                          <Button
                            buttonStyle="primary"
                            disabled={rs.busy}
                            margin={false}
                            onClick={() => void apply(item)}
                            size="medium"
                          >
                            {rs.busy ? s.generating : s.apply}
                          </Button>
                        ) : (
                          <Button
                            buttonStyle="secondary"
                            disabled={rs.busy}
                            margin={false}
                            onClick={() => void generate(item)}
                            size="medium"
                          >
                            {rs.busy ? s.generating : s.generate}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  )
}
