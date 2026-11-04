'use client'

import React, { useState } from 'react'
import { Banner, Button, Pill } from '@payloadcms/ui'
import { Card } from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import './ContentBriefPanel.css'

const S = {
  fr: {
    title: 'Brief de contenu IA',
    subtitle: 'Génère un plan rédactionnel optimisé pour un mot-clé (plan, entités, questions, longueur cible).',
    placeholder: 'Mot-clé cible (ex : plombier paris)',
    keywordLabel: 'Mot-clé cible',
    generate: 'Générer le brief',
    generating: 'Génération…',
    outline: 'Plan suggéré',
    entities: 'Entités / termes à couvrir',
    questions: 'Questions à traiter',
    links: 'Idées de liens internes',
    words: 'Longueur recommandée',
    wordsUnit: 'mots',
    notes: 'Conseils',
    noKey: 'Clé API OpenRouter requise (OPENROUTER_API_KEY).',
    disabled: 'Fonction IA désactivée (features.aiFeatures).',
  },
  en: {
    title: 'AI content brief',
    subtitle: 'Generate an optimized writing brief for a keyword (outline, entities, questions, target length).',
    placeholder: 'Target keyword (e.g. paris plumber)',
    keywordLabel: 'Target keyword',
    generate: 'Generate brief',
    generating: 'Generating…',
    outline: 'Suggested outline',
    entities: 'Entities / terms to cover',
    questions: 'Questions to answer',
    links: 'Internal link ideas',
    words: 'Recommended length',
    wordsUnit: 'words',
    notes: 'Tips',
    noKey: 'OpenRouter API key required (OPENROUTER_API_KEY).',
    disabled: 'AI feature disabled (features.aiFeatures).',
  },
} as const

interface Brief {
  outline: Array<{ level: 'h2' | 'h3'; text: string }>
  entities: string[]
  questions: string[]
  internalLinkIdeas: string[]
  recommendedWordCount: number
  notes: string[]
}

export function ContentBriefPanel({ locale }: { locale: 'fr' | 'en' }) {
  const seoApi = useSeoApi()
  const s = S[locale] ?? S.fr
  const [keyword, setKeyword] = useState('')
  const [brief, setBrief] = useState<Brief | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    if (!keyword.trim()) return
    setBusy(true)
    setError(null)
    setBrief(null)
    try {
      const res = await fetch(seoApi('/ai-content-brief'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim() }),
      })
      if (res.status === 404) {
        setError(s.disabled)
        return
      }
      const json = await res.json()
      if (!res.ok) {
        setError(json.code === 'no_api_key' ? s.noKey : json.error || `Error ${res.status}`)
        return
      }
      setBrief(json.brief as Brief)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  const canGenerate = !busy && keyword.trim().length > 0

  return (
    <Card title={s.title}>
      <p className="seo-text seo-text--small seo-text--secondary">{s.subtitle}</p>

      <div className="seo-brief__form">
        <input
          aria-label={s.keywordLabel}
          className="seo-input"
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void generate()
          }}
          placeholder={s.placeholder}
          value={keyword}
        />
        <Button buttonStyle="primary" disabled={!canGenerate} margin={false} onClick={() => void generate()}>
          {busy ? s.generating : s.generate}
        </Button>
      </div>

      {error && (
        <div role="alert">
          <Banner type="danger">{error}</Banner>
        </div>
      )}

      {brief && (
        <div className="seo-stack">
          {brief.recommendedWordCount > 0 && (
            <p className="seo-text seo-text--small seo-text--secondary">
              {s.words}:{' '}
              <strong className="seo-text--strong">
                ~{brief.recommendedWordCount} {s.wordsUnit}
              </strong>
            </p>
          )}

          {brief.outline.length > 0 && (
            <section className="seo-stack seo-stack--tight">
              <h4 className="seo-text seo-text--strong">{s.outline}</h4>
              <ul className="seo-brief__list">
                {brief.outline.map((o, i) => (
                  <li
                    className={o.level === 'h3' ? 'seo-brief__outline-h3' : 'seo-brief__outline-h2'}
                    key={i}
                  >
                    {o.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {brief.entities.length > 0 && (
            <section className="seo-stack seo-stack--tight">
              <h4 className="seo-text seo-text--strong">{s.entities}</h4>
              <div className="seo-row">
                {brief.entities.map((e, i) => (
                  <Pill key={i} pillStyle="light" size="small">
                    {e}
                  </Pill>
                ))}
              </div>
            </section>
          )}

          {brief.questions.length > 0 && (
            <section className="seo-stack seo-stack--tight">
              <h4 className="seo-text seo-text--strong">{s.questions}</h4>
              <ul className="seo-brief__list">
                {brief.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </section>
          )}

          {brief.internalLinkIdeas.length > 0 && (
            <section className="seo-stack seo-stack--tight">
              <h4 className="seo-text seo-text--strong">{s.links}</h4>
              <div className="seo-row">
                {brief.internalLinkIdeas.map((l, i) => (
                  <Pill key={i} pillStyle="light" size="small">
                    {l}
                  </Pill>
                ))}
              </div>
            </section>
          )}

          {brief.notes.length > 0 && (
            <section className="seo-stack seo-stack--tight">
              <h4 className="seo-text seo-text--strong">{s.notes}</h4>
              <ul className="seo-brief__list seo-brief__list--notes">
                {brief.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Card>
  )
}
