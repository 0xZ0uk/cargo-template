'use client'

import React, { useEffect, useState, useCallback, useRef, useMemo, useId } from 'react'
import { Banner, Button, Pill, PlusIcon, RefreshIcon, TrashIcon, XIcon } from '@payloadcms/ui'
import {
  TITLE_LENGTH_MIN,
  TITLE_LENGTH_MAX,
  META_DESC_LENGTH_MIN,
  META_DESC_LENGTH_MAX,
  MIN_WORDS_GENERIC,
  MIN_WORDS_POST,
  KEYWORD_DENSITY_MIN,
  KEYWORD_DENSITY_MAX,
  FLESCH_SCORE_PASS,
  SLUG_MAX_LENGTH,
} from '../constants.js'
import { useDashboardT } from '../hooks/useSeoLocale.js'
import { type DashboardTranslations } from '../dashboard-i18n.js'
import { Card, cx, DataTable, Field, Grid, LoadingState, ViewBody, ViewHeader } from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import './SeoConfigView.css'

// ---------------------------------------------------------------------------
// Rule group definitions (16 engine groups + accessibility)
// Built dynamically from i18n translations
// ---------------------------------------------------------------------------
const RULE_GROUP_KEYS = [
  'title',
  'meta-description',
  'url',
  'headings',
  'content',
  'images',
  'linking',
  'social',
  'schema',
  'readability',
  'quality',
  'secondary-keywords',
  'cornerstone',
  'freshness',
  'technical',
  'accessibility',
  'ecommerce',
] as const

function getRuleGroups(t: DashboardTranslations): Array<{ value: string; label: string }> {
  const labelMap: Record<string, string> = {
    'title': t.seoConfig.ruleGroupTitle,
    'meta-description': t.seoConfig.ruleGroupMetaDescription,
    'url': t.seoConfig.ruleGroupUrlSlug,
    'headings': t.seoConfig.ruleGroupHeadings,
    'content': t.seoConfig.ruleGroupContent,
    'images': t.seoConfig.ruleGroupImages,
    'linking': t.seoConfig.ruleGroupLinks,
    'social': t.seoConfig.ruleGroupSocial,
    'schema': t.seoConfig.ruleGroupStructuredData,
    'readability': t.seoConfig.ruleGroupReadability,
    'quality': t.seoConfig.ruleGroupQuality,
    'secondary-keywords': t.seoConfig.ruleGroupSecondaryKeywords,
    'cornerstone': t.seoConfig.ruleGroupCornerstone,
    'freshness': t.seoConfig.ruleGroupFreshness,
    'technical': t.seoConfig.ruleGroupTechnical,
    'accessibility': t.seoConfig.ruleGroupAccessibility,
    'ecommerce': t.seoConfig.ruleGroupEcommerce,
  }
  return RULE_GROUP_KEYS.map((key) => ({ value: key, label: labelMap[key] || key }))
}

// ---------------------------------------------------------------------------
// Threshold definitions (field name, label, default value)
// Built dynamically from i18n translations
// ---------------------------------------------------------------------------
function getThresholdFields(t: DashboardTranslations): Array<{ name: string; label: string; defaultValue: number }> {
  return [
    { name: 'titleLengthMin', label: t.seoConfig.thresholdTitleMin, defaultValue: TITLE_LENGTH_MIN },
    { name: 'titleLengthMax', label: t.seoConfig.thresholdTitleMax, defaultValue: TITLE_LENGTH_MAX },
    { name: 'metaDescLengthMin', label: t.seoConfig.thresholdMetaDescMin, defaultValue: META_DESC_LENGTH_MIN },
    { name: 'metaDescLengthMax', label: t.seoConfig.thresholdMetaDescMax, defaultValue: META_DESC_LENGTH_MAX },
    { name: 'minWordsGeneric', label: t.seoConfig.thresholdMinWordsPages, defaultValue: MIN_WORDS_GENERIC },
    { name: 'minWordsPost', label: t.seoConfig.thresholdMinWordsPosts, defaultValue: MIN_WORDS_POST },
    { name: 'keywordDensityMin', label: t.seoConfig.thresholdKeywordDensityMin, defaultValue: KEYWORD_DENSITY_MIN },
    { name: 'keywordDensityMax', label: t.seoConfig.thresholdKeywordDensityMax, defaultValue: KEYWORD_DENSITY_MAX },
    { name: 'fleschScorePass', label: t.seoConfig.thresholdFleschMin, defaultValue: FLESCH_SCORE_PASS },
    { name: 'slugMaxLength', label: t.seoConfig.thresholdSlugMaxLength, defaultValue: SLUG_MAX_LENGTH },
  ]
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PriorityOverride {
  slugPattern: string
  priority: number
  changefreq?: string
}

interface SitemapSettings {
  excludedSlugs?: Array<{ slug: string; id?: string }>
  defaultChangefreq?: string
  defaultPriority?: number | null
  priorityOverrides?: PriorityOverride[]
}

interface SitemapPreviewEntry {
  url: string
  collection: string
  title: string
  changefreq: string
  priority: number
  lastmod: string
}

interface SitemapPreviewData {
  config: {
    excludedSlugs: string[]
    defaultChangefreq: string
    defaultPriority: number
    priorityOverrides: PriorityOverride[]
  }
  preview: SitemapPreviewEntry[]
  stats: {
    totalPages: number
    excludedCount: number
    includedCount: number
  }
}

interface BreadcrumbSettings {
  enabled?: boolean
  homeLabel?: string
  separator?: string
  showOnHome?: boolean
}

interface Settings {
  siteName?: string
  ignoredSlugs?: Array<{ slug: string; id?: string }>
  disabledRules?: string[]
  thresholds?: Record<string, number | null | undefined>
  sitemap?: SitemapSettings
  breadcrumb?: BreadcrumbSettings
}

// ---------------------------------------------------------------------------
// Toast sub-component
// ---------------------------------------------------------------------------
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    // Announced, not just painted — see RedirectManagerView's Toast.
    <div
      className="seo-config__toast"
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      <Banner type={type === 'success' ? 'success' : 'danger'}>{message}</Banner>
    </div>
  )
}

/** Removable slug tag: the slug in mono text and a compact remove button. */
function SlugChip({ slug, removeLabel, onRemove }: { slug: string; removeLabel: string; onRemove: () => void }) {
  return (
    <span className="seo-config__chip">
      <span className="seo-mono">/{slug}</span>
      <button
        type="button"
        aria-label={removeLabel}
        className="seo-config__chip-remove"
        onClick={onRemove}
        title={removeLabel}
      >
        <XIcon size={16} />
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main SeoConfigView component
// ---------------------------------------------------------------------------
export function SeoConfigView() {
  const seoApi = useSeoApi()
  const t = useDashboardT()
  // useId(), never a literal id: nothing forbids a host from mounting this view
  // twice (a custom route reusing the component), and duplicate ids break the
  // very label association they are meant to create.
  const uid = useId()
  const siteNameId = `${uid}-site-name`
  const ignoredSlugId = `${uid}-ignored-slug`
  const excludedSlugId = `${uid}-excluded-slug`
  const changefreqId = `${uid}-changefreq`
  const priorityId = `${uid}-priority`
  const homeLabelId = `${uid}-home-label`
  const separatorId = `${uid}-separator`
  const RULE_GROUPS = useMemo(() => getRuleGroups(t), [t])
  const THRESHOLD_FIELDS = useMemo(() => getThresholdFields(t), [t])

  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Sitemap state
  const [newSitemapSlug, setNewSitemapSlug] = useState('')
  const [sitemapPreview, setSitemapPreview] = useState<SitemapPreviewData | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  // Slug input state + autocomplete
  const [newSlug, setNewSlug] = useState('')
  const [allSlugs, setAllSlugs] = useState<Array<{ slug: string; title: string; collection: string }>>([])
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const slugInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<HTMLDivElement>(null)

  // Fetch settings
  const fetchSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(seoApi('/settings'), { credentials: 'include', cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSettings(data.settings || {})
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.common.loadingError)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  // Fetch all page slugs for autocomplete
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(seoApi('/audit?limit=500'), { credentials: 'include', cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          const slugs = (data.results || []).map((r: { slug: string; title: string; collection: string }) => ({
            slug: r.slug,
            title: r.title,
            collection: r.collection,
          }))
          setAllSlugs(slugs)
        }
      } catch {
        // Non-critical
      }
    })()
  }, [])

  // Close autocomplete on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        autocompleteRef.current &&
        !autocompleteRef.current.contains(e.target as Node) &&
        slugInputRef.current &&
        !slugInputRef.current.contains(e.target as Node)
      ) {
        setShowAutocomplete(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Filtered slugs for autocomplete
  const filteredSlugs = useMemo(() => {
    const query = newSlug.trim().toLowerCase()
    const ignoredSet = new Set((settings.ignoredSlugs || []).map((s) => s.slug))
    return allSlugs
      .filter((s) => !ignoredSet.has(s.slug))
      .filter((s) => !query || s.slug.includes(query) || s.title.toLowerCase().includes(query))
      .slice(0, 8)
  }, [newSlug, allSlugs, settings.ignoredSlugs])

  // Save settings
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch(seoApi('/settings'), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.success) {
        setSettings(data.settings)
        setToast({ message: t.seoConfig.saved, type: 'success' })
      } else {
        throw new Error(t.common.serverError)
      }
    } catch (e: unknown) {
      setToast({
        message: e instanceof Error ? e.message : t.common.loadingError,
        type: 'error',
      })
    }
    setSaving(false)
  }, [settings])

  // Helpers
  const addSlug = useCallback(() => {
    const trimmed = newSlug.trim().toLowerCase().replace(/^\/+/, '')
    if (!trimmed) return
    const current = settings.ignoredSlugs || []
    if (current.some((s) => s.slug === trimmed)) return
    setSettings((prev) => ({
      ...prev,
      ignoredSlugs: [...(prev.ignoredSlugs || []), { slug: trimmed }],
    }))
    setNewSlug('')
  }, [newSlug, settings.ignoredSlugs])

  const removeSlug = useCallback((slug: string) => {
    setSettings((prev) => ({
      ...prev,
      ignoredSlugs: (prev.ignoredSlugs || []).filter((s) => s.slug !== slug),
    }))
  }, [])

  const toggleRule = useCallback((rule: string) => {
    setSettings((prev) => {
      const current = prev.disabledRules || []
      const isDisabled = current.includes(rule)
      return {
        ...prev,
        disabledRules: isDisabled ? current.filter((r) => r !== rule) : [...current, rule],
      }
    })
  }, [])

  const updateThreshold = useCallback((field: string, value: string) => {
    setSettings((prev) => ({
      ...prev,
      thresholds: {
        ...(prev.thresholds || {}),
        [field]: value === '' ? null : Number(value),
      },
    }))
  }, [])

  // Sitemap helpers
  const addSitemapSlug = useCallback(() => {
    const trimmed = newSitemapSlug.trim().toLowerCase().replace(/^\/+/, '')
    if (!trimmed) return
    const current = settings.sitemap?.excludedSlugs || []
    if (current.some((s) => s.slug === trimmed)) return
    setSettings((prev) => ({
      ...prev,
      sitemap: {
        ...(prev.sitemap || {}),
        excludedSlugs: [...(prev.sitemap?.excludedSlugs || []), { slug: trimmed }],
      },
    }))
    setNewSitemapSlug('')
  }, [newSitemapSlug, settings.sitemap?.excludedSlugs])

  const removeSitemapSlug = useCallback((slug: string) => {
    setSettings((prev) => ({
      ...prev,
      sitemap: {
        ...(prev.sitemap || {}),
        excludedSlugs: (prev.sitemap?.excludedSlugs || []).filter((s) => s.slug !== slug),
      },
    }))
  }, [])

  const updateSitemapField = useCallback((field: string, value: unknown) => {
    setSettings((prev) => ({
      ...prev,
      sitemap: {
        ...(prev.sitemap || {}),
        [field]: value,
      },
    }))
  }, [])

  const addPriorityOverride = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      sitemap: {
        ...(prev.sitemap || {}),
        priorityOverrides: [
          ...(prev.sitemap?.priorityOverrides || []),
          { slugPattern: '', priority: 0.5 },
        ],
      },
    }))
  }, [])

  const removePriorityOverride = useCallback((index: number) => {
    setSettings((prev) => ({
      ...prev,
      sitemap: {
        ...(prev.sitemap || {}),
        priorityOverrides: (prev.sitemap?.priorityOverrides || []).filter((_, i) => i !== index),
      },
    }))
  }, [])

  const updatePriorityOverride = useCallback((index: number, field: string, value: unknown) => {
    setSettings((prev) => {
      const overrides = [...(prev.sitemap?.priorityOverrides || [])]
      if (overrides[index]) {
        overrides[index] = { ...overrides[index], [field]: value }
      }
      return {
        ...prev,
        sitemap: {
          ...(prev.sitemap || {}),
          priorityOverrides: overrides,
        },
      }
    })
  }, [])

  // Breadcrumb helpers
  const updateBreadcrumbField = useCallback((field: string, value: unknown) => {
    setSettings((prev) => ({
      ...prev,
      breadcrumb: {
        ...(prev.breadcrumb || {}),
        [field]: value,
      },
    }))
  }, [])

  const fetchSitemapPreview = useCallback(async () => {
    setLoadingPreview(true)
    try {
      const res = await fetch(seoApi('/sitemap-config'), { credentials: 'include', cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSitemapPreview(data)
      setShowPreview(true)
    } catch {
      // Non-critical
    }
    setLoadingPreview(false)
  }, [])

  // Loading state
  if (loading) {
    return (
      <>
        <ViewHeader description={t.seoConfig.subtitle} title={t.seoConfig.title} />
        <ViewBody>
          <LoadingState label={t.seoConfig.loading} />
        </ViewBody>
      </>
    )
  }

  // Error state
  if (error) {
    return (
      <>
        <ViewHeader description={t.seoConfig.subtitle} title={t.seoConfig.title} />
        <ViewBody>
          <Banner type="danger">
            <div className="seo-stack seo-stack--tight">
              <strong>{t.common.loadingError}</strong>
              <span>{error}</span>
            </div>
          </Banner>
          <div>
            <Button buttonStyle="secondary" margin={false} onClick={fetchSettings}>
              {t.common.retry}
            </Button>
          </div>
        </ViewBody>
      </>
    )
  }

  const changefreqOptions = (
    <>
      <option value="daily">{t.seoConfig.daily}</option>
      <option value="weekly">{t.seoConfig.weekly}</option>
      <option value="monthly">{t.seoConfig.monthly}</option>
      <option value="yearly">{t.seoConfig.yearly}</option>
    </>
  )

  const saveLabel = saving ? t.common.saving : t.common.save

  return (
    <>
      <ViewHeader
        actions={
          <Button buttonStyle="primary" disabled={saving} margin={false} onClick={handleSave}>
            {saveLabel}
          </Button>
        }
        description={t.seoConfig.subtitle}
        title={t.seoConfig.title}
      />
      <ViewBody className="seo-config">
        {/* Toast notification */}
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

        {/* Section 1: General */}
        <Card title="General">
          <Field description={t.seoConfig.siteNameDesc} label={t.seoConfig.siteName}>
            <input
              id={siteNameId}
              type="text"
              className="seo-input"
              value={settings.siteName || ''}
              onChange={(e) => setSettings((prev) => ({ ...prev, siteName: e.target.value }))}
              placeholder="Ex: My Website"
            />
          </Field>
        </Card>

        {/* Section 2: Pages ignorees */}
        <Card title={t.seoConfig.ignoredPages}>
          <p className="seo-text seo-text--small seo-text--secondary">{t.seoConfig.ignoredPagesDesc}</p>

          {/* Add slug input with autocomplete */}
          <div className="seo-config__add-row">
            <div className="seo-config__autocomplete-anchor">
              <input
                ref={slugInputRef}
                id={ignoredSlugId}
                aria-label={t.seoConfig.ignoredPages}
                type="text"
                className="seo-input"
                value={newSlug}
                onChange={(e) => {
                  setNewSlug(e.target.value)
                  setShowAutocomplete(true)
                }}
                onFocus={() => setShowAutocomplete(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addSlug()
                    setShowAutocomplete(false)
                  }
                  if (e.key === 'Escape') {
                    setShowAutocomplete(false)
                  }
                }}
                placeholder={t.seoConfig.pageSlugPlaceholder}
              />
              {showAutocomplete && filteredSlugs.length > 0 && (
                <div ref={autocompleteRef} className="seo-config__autocomplete">
                  {filteredSlugs.map((item) => (
                    <button
                      type="button"
                      className="seo-config__option"
                      key={`${item.collection}-${item.slug}`}
                      onClick={() => {
                        setNewSlug(item.slug)
                        setShowAutocomplete(false)
                        // Auto-add
                        const trimmed = item.slug.trim().toLowerCase().replace(/^\/+/, '')
                        if (trimmed && !(settings.ignoredSlugs || []).some((s) => s.slug === trimmed)) {
                          setSettings((prev) => ({
                            ...prev,
                            ignoredSlugs: [...(prev.ignoredSlugs || []), { slug: trimmed }],
                          }))
                        }
                        setNewSlug('')
                      }}
                    >
                      {/* <span>, not <div>: a <button> only accepts phrasing content. */}
                      <span className="seo-row seo-row--between seo-row--nowrap">
                        <span className="seo-mono seo-text--brand">/{item.slug}</span>
                        <span className="seo-config__option-tag">{item.collection}</span>
                      </span>
                      {item.title && (
                        <span className="seo-config__option-title seo-text--secondary">{item.title}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button
              buttonStyle="secondary"
              icon={<PlusIcon />}
              iconPosition="left"
              margin={false}
              onClick={() => {
                addSlug()
                setShowAutocomplete(false)
              }}
            >
              {t.common.add}
            </Button>
          </div>

          {/* Slug chips */}
          <div className="seo-config__chips">
            {(settings.ignoredSlugs || []).length === 0 && (
              <p className="seo-text seo-text--small seo-text--secondary">{t.seoConfig.noIgnoredSlugs}</p>
            )}
            {(settings.ignoredSlugs || []).map((item) => (
              <SlugChip
                key={item.slug}
                onRemove={() => removeSlug(item.slug)}
                removeLabel={`${t.common.delete} /${item.slug}`}
                slug={item.slug}
              />
            ))}
          </div>
        </Card>

        {/* Section 3: Regles desactivees */}
        <Card title={t.seoConfig.disabledRules}>
          <p className="seo-text seo-text--small seo-text--secondary">{t.seoConfig.disabledRulesDesc}</p>
          <Grid>
            {RULE_GROUPS.map((group) => {
              const isDisabled = (settings.disabledRules || []).includes(group.value)
              return (
                <label
                  className={cx('seo-checkbox seo-config__rule', isDisabled && 'seo-config__rule--disabled')}
                  key={group.value}
                >
                  <input type="checkbox" checked={isDisabled} onChange={() => toggleRule(group.value)} />
                  {group.label}
                </label>
              )
            })}
          </Grid>
        </Card>

        {/* Section 4: Seuils personnalises */}
        <Card title={t.seoConfig.customThresholds}>
          <p className="seo-text seo-text--small seo-text--secondary">{t.seoConfig.customThresholdsDesc}</p>
          <Grid wide>
            {THRESHOLD_FIELDS.map((field) => {
              const currentValue = settings.thresholds?.[field.name]
              return (
                <Field key={field.name} label={field.label}>
                  <input
                    id={`${uid}-threshold-${field.name}`}
                    type="number"
                    className="seo-input"
                    value={currentValue != null ? String(currentValue) : ''}
                    onChange={(e) => updateThreshold(field.name, e.target.value)}
                    placeholder={`${t.seoConfig.defaultLabel} ${field.defaultValue}`}
                    step={field.name.includes('Density') ? '0.1' : '1'}
                  />
                </Field>
              )
            })}
          </Grid>
        </Card>

        {/* Section 5: Configuration Sitemap */}
        <Card title={t.seoConfig.sitemapConfig}>
          {/* Slugs exclus du sitemap */}
          <div className="seo-field">
            <label className="seo-field__label" htmlFor={excludedSlugId}>
              {t.seoConfig.sitemapExcludedSlugs}
            </label>
            <span className="seo-field__description">{t.seoConfig.ignoredPagesDesc}</span>
            <div className="seo-config__add-row">
              <input
                id={excludedSlugId}
                type="text"
                className="seo-input"
                value={newSitemapSlug}
                onChange={(e) => setNewSitemapSlug(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addSitemapSlug()
                  }
                }}
                placeholder={t.seoConfig.slugToExcludePlaceholder}
              />
              <Button
                buttonStyle="secondary"
                icon={<PlusIcon />}
                iconPosition="left"
                margin={false}
                onClick={addSitemapSlug}
              >
                {t.common.add}
              </Button>
            </div>
            <div className="seo-config__chips">
              {(settings.sitemap?.excludedSlugs || []).length === 0 && (
                <p className="seo-text seo-text--small seo-text--secondary">{t.seoConfig.noExcludedSlugs}</p>
              )}
              {(settings.sitemap?.excludedSlugs || []).map((item) => (
                <SlugChip
                  key={item.slug}
                  onRemove={() => removeSitemapSlug(item.slug)}
                  removeLabel={`${t.common.delete} /${item.slug}`}
                  slug={item.slug}
                />
              ))}
            </div>
          </div>

          {/* Frequence par defaut + Priorite par defaut */}
          <Grid wide>
            <Field label={t.seoConfig.defaultChangeFrequency}>
              <select
                id={changefreqId}
                className="seo-select"
                value={settings.sitemap?.defaultChangefreq || 'weekly'}
                onChange={(e) => updateSitemapField('defaultChangefreq', e.target.value)}
              >
                {changefreqOptions}
              </select>
            </Field>
            <Field description={t.seoConfig.defaultPriorityDesc} label={t.seoConfig.defaultPriority}>
              <input
                id={priorityId}
                type="number"
                className="seo-input"
                value={settings.sitemap?.defaultPriority != null ? String(settings.sitemap.defaultPriority) : ''}
                onChange={(e) =>
                  updateSitemapField(
                    'defaultPriority',
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
                placeholder="0.5"
                min={0}
                max={1}
                step={0.1}
              />
            </Field>
          </Grid>

          {/* Overrides de priorite */}
          <div className="seo-field">
            <span className="seo-field__label">{t.seoConfig.priorityOverrides}</span>
            <span className="seo-field__description">{t.seoConfig.priorityOverridesDesc}</span>

            {(settings.sitemap?.priorityOverrides || []).map((override, idx) => (
              <div className="seo-config__override" key={`override-${idx}`}>
                <input
                  aria-label={`${t.seoConfig.priorityOverrides} ${idx + 1} — ${t.seoConfig.patternPlaceholder}`}
                  type="text"
                  className="seo-input"
                  value={override.slugPattern}
                  onChange={(e) => updatePriorityOverride(idx, 'slugPattern', e.target.value)}
                  placeholder={t.seoConfig.patternPlaceholder}
                />
                <input
                  aria-label={`${t.seoConfig.priorityOverrides} ${idx + 1} — ${t.seoConfig.priority}`}
                  type="number"
                  className="seo-input"
                  value={String(override.priority)}
                  onChange={(e) =>
                    updatePriorityOverride(idx, 'priority', Number(e.target.value))
                  }
                  min={0}
                  max={1}
                  step={0.1}
                  placeholder={t.seoConfig.priority}
                />
                <select
                  aria-label={`${t.seoConfig.priorityOverrides} ${idx + 1} — ${t.seoConfig.defaultChangeFrequency}`}
                  className="seo-select"
                  value={override.changefreq || ''}
                  onChange={(e) =>
                    updatePriorityOverride(
                      idx,
                      'changefreq',
                      e.target.value || undefined,
                    )
                  }
                >
                  <option value="">{t.seoConfig.defaultShort}</option>
                  {changefreqOptions}
                </select>
                <Button
                  aria-label={t.common.delete}
                  buttonStyle="ghost"
                  icon={<TrashIcon />}
                  margin={false}
                  onClick={() => removePriorityOverride(idx)}
                  tooltip={t.common.delete}
                />
              </div>
            ))}

            <div>
              <Button
                buttonStyle="secondary"
                icon={<PlusIcon />}
                iconPosition="left"
                margin={false}
                onClick={addPriorityOverride}
              >
                {t.seoConfig.addOverride}
              </Button>
            </div>
          </div>

          {/* Preview du sitemap */}
          <div className="seo-field">
            <span className="seo-field__label">{t.seoConfig.sitemapPreview}</span>
            <div>
              <Button
                buttonStyle="secondary"
                disabled={loadingPreview}
                icon={showPreview ? <RefreshIcon /> : undefined}
                iconPosition="left"
                margin={false}
                onClick={fetchSitemapPreview}
              >
                {loadingPreview ? t.common.loading : showPreview ? t.seoConfig.refreshPreview : t.seoConfig.viewPreview}
              </Button>
            </div>

            {showPreview && sitemapPreview && (
              <>
                {/* Preview stats */}
                <div className="seo-row">
                  <Pill size="small">
                    {sitemapPreview.stats.totalPages} {t.seoConfig.pages}
                  </Pill>
                  <Pill pillStyle="success" size="small">
                    {sitemapPreview.stats.includedCount} {t.seoConfig.included}
                  </Pill>
                  <Pill pillStyle="error" size="small">
                    {sitemapPreview.stats.excludedCount} {t.seoConfig.excluded}
                  </Pill>
                </div>

                {/* Preview table */}
                <DataTable aria-label={t.seoConfig.sitemapPreview} className="seo-config__preview">
                  <thead>
                    <tr>
                      <th>{t.seoConfig.url}</th>
                      <th>Collection</th>
                      <th className="seo-table__num">{t.seoConfig.priority}</th>
                      <th>{t.seoConfig.frequency}</th>
                      <th>{t.seoConfig.lastModified}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sitemapPreview.preview.map((entry, idx) => (
                      <tr key={`preview-${idx}`}>
                        <td>
                          <span className="seo-mono seo-truncate seo-config__preview-url" title={entry.url}>
                            {entry.url}
                          </span>
                        </td>
                        <td>
                          <Pill pillStyle={entry.collection === 'pages' ? 'light' : 'light-gray'} size="small">
                            {entry.collection}
                          </Pill>
                        </td>
                        <td className="seo-table__num">{entry.priority}</td>
                        <td className="seo-text--secondary">{entry.changefreq}</td>
                        <td className="seo-text--secondary">
                          {entry.lastmod ? new Date(entry.lastmod).toLocaleDateString('en-US') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </>
            )}
          </div>
        </Card>

        {/* Section 6: Configuration Breadcrumb */}
        <Card title={t.seoConfig.breadcrumbConfig}>
          <p className="seo-text seo-text--small seo-text--secondary">{t.seoConfig.breadcrumbConfigDesc}</p>

          {/* Enabled checkbox */}
          <label className="seo-checkbox">
            <input
              type="checkbox"
              checked={settings.breadcrumb?.enabled !== false}
              onChange={(e) => updateBreadcrumbField('enabled', e.target.checked)}
            />
            {t.seoConfig.enableBreadcrumbs}
          </label>

          {/* Home label + Separator */}
          <Grid wide>
            <Field description={t.seoConfig.homePageLabel} label={t.seoConfig.homePageLabel}>
              <input
                id={homeLabelId}
                type="text"
                className="seo-input"
                value={settings.breadcrumb?.homeLabel ?? ''}
                onChange={(e) => updateBreadcrumbField('homeLabel', e.target.value)}
                placeholder={t.seoConfig.homeLabelDefault}
              />
            </Field>
            <Field description={t.seoConfig.separatorDesc} label={t.seoConfig.separator}>
              <select
                id={separatorId}
                className="seo-select"
                value={settings.breadcrumb?.separator || '>'}
                onChange={(e) => updateBreadcrumbField('separator', e.target.value)}
              >
                <option value=">">&gt;</option>
                <option value="/">/</option>
                <option value={'»'}>{'»'}</option>
                <option value={'→'}>{'→'}</option>
              </select>
            </Field>
          </Grid>

          {/* Show on home checkbox */}
          <div className="seo-field">
            <label className="seo-checkbox">
              <input
                type="checkbox"
                checked={settings.breadcrumb?.showOnHome || false}
                onChange={(e) => updateBreadcrumbField('showOnHome', e.target.checked)}
              />
              {t.seoConfig.showOnHomePage}
            </label>
            <span className="seo-field__description">{t.seoConfig.showOnHomePageDesc}</span>
          </div>

          {/* Live preview */}
          <div className="seo-inset seo-stack seo-stack--tight">
            <span className="seo-field__label">{t.seoConfig.preview}</span>
            <p className="seo-text">
              {settings.breadcrumb?.homeLabel || t.seoConfig.homeLabelDefault}
              <span className="seo-config__separator seo-text--secondary">{settings.breadcrumb?.separator || '>'}</span>
              Services
              <span className="seo-config__separator seo-text--secondary">{settings.breadcrumb?.separator || '>'}</span>
              <span className="seo-text--strong">{t.seoConfig.websiteCreation}</span>
            </p>
          </div>
        </Card>

        {/* Bottom save button */}
        <div className="seo-config__save">
          <Button buttonStyle="primary" disabled={saving} margin={false} onClick={handleSave}>
            {saveLabel}
          </Button>
        </div>
      </ViewBody>
    </>
  )
}
