'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Banner,
  Button,
  CheckIcon,
  ChevronIcon,
  Collapsible,
  CopyIcon,
  InfoIcon,
  NewTabIcon,
  useAllFormFields,
  WarningIcon,
  XIcon,
} from '@payloadcms/ui'
import {
  analyzeSeo,
  extractTextFromLexical,
  type SeoAnalysis,
  type SeoCheck,
  type CheckCategory,
  type RuleGroup,
} from '../index.js'
import { SCORE_GOOD, SCORE_OK } from '../constants.js'
import { formatAdminURL } from 'payload/shared'
import { SeoSocialPreview } from './SeoSocialPreview.js'
import { useDashboardT, useSeoAnalysisLocale, type SeoAnalysisLocaleOptions } from '../hooks/useSeoLocale.js'
import { type DashboardTranslations } from '../dashboard-i18n.js'
import { withSeoErrorBoundary } from './withSeoErrorBoundary.js'
import { Card, Checklist, cx, ScoreRing, statusTone, TonePill, type Tone } from '../ui/index.js'
import { useAdminRoute, useSeoApi } from '../hooks/useSeoApi.js'
import './SeoAnalyzer.css'

// ---------------------------------------------------------------------------
// Group labels (i18n)
// ---------------------------------------------------------------------------
function getGroupLabels(t: DashboardTranslations): Record<RuleGroup, string> {
  return {
    'title': t.seoAnalyzer.groupTitle,
    'meta-description': t.seoAnalyzer.groupDescription,
    'url': t.seoAnalyzer.groupUrlSlug,
    'headings': t.seoAnalyzer.groupHeadings,
    'content': t.seoAnalyzer.groupContent,
    'images': t.seoAnalyzer.groupImages,
    'linking': t.seoAnalyzer.groupLinks,
    'social': t.seoAnalyzer.groupSocial,
    'schema': t.seoAnalyzer.groupStructuredData,
    'readability': t.seoAnalyzer.groupReadability,
    'quality': t.seoAnalyzer.groupQuality,
    'secondary-keywords': t.seoAnalyzer.groupSecondaryKeywords,
    'cornerstone': t.seoAnalyzer.groupCornerstone,
    'freshness': t.seoAnalyzer.groupFreshness,
    'technical': t.seoAnalyzer.groupTechnical,
    'accessibility': t.seoAnalyzer.groupAccessibility,
    'ecommerce': t.seoAnalyzer.groupEcommerce,
    'eeat': t.seoAnalyzer.groupEeat,
    'geo': t.seoAnalyzer.groupGeo,
    'hreflang': t.seoAnalyzer.groupHreflang,
  }
}

// Ordered display of groups within each category
const GROUP_ORDER: RuleGroup[] = [
  'title',
  'meta-description',
  'quality',
  'content',
  'url',
  'headings',
  'readability',
  'images',
  'linking',
  'social',
  'schema',
  'secondary-keywords',
  'cornerstone',
  'freshness',
  'technical',
  'accessibility',
  'eeat',
  'geo',
  'hreflang',
  'ecommerce',
]

// ---------------------------------------------------------------------------
// Score level helpers
// ---------------------------------------------------------------------------

/** Same cut-offs as the analyzer's levels, so the ring and the level pill agree. */
const LEVEL_THRESHOLDS = { good: SCORE_GOOD, ok: SCORE_OK }

function getLevelTone(level: SeoAnalysis['level']): Tone {
  switch (level) {
    case 'excellent':
    case 'good':
      return 'success'
    case 'ok':
      return 'warning'
    default:
      return 'danger'
  }
}

function getLevelLabel(level: SeoAnalysis['level'], t: DashboardTranslations): string {
  switch (level) {
    case 'excellent':
      return t.seoAnalyzer.levelExcellent
    case 'good':
      return t.seoAnalyzer.levelGood
    case 'ok':
      return t.seoAnalyzer.levelFair
    case 'poor':
      return t.seoAnalyzer.levelNeedsImprovement
    default:
      return ''
  }
}

function getCategoryLabel(cat: CheckCategory, t: DashboardTranslations): string {
  switch (cat) {
    case 'critical':
      return t.seoAnalyzer.categoryCritical
    case 'important':
      return t.seoAnalyzer.categoryImportant
    case 'bonus':
      return t.seoAnalyzer.categoryBonus
    default:
      return ''
  }
}

/** Icon for a tone: check, warning, cross, or info for anything unknown. */
function toneIcon(tone: Tone): React.ReactNode {
  switch (tone) {
    case 'success':
      return <CheckIcon size={16} />
    case 'warning':
      return <WarningIcon size={16} />
    case 'danger':
      return <XIcon size={16} />
    default:
      return <InfoIcon />
  }
}

/** Small toned icon used in collapsible headers. */
function StatusMark({ tone }: { tone: Tone }) {
  return <span className={cx('seo-analyzer__status', tone !== 'neutral' && `seo-analyzer__status--${tone}`)}>{toneIcon(tone)}</span>
}

/** Tone of a set of checks: any failure, else any warning, else success. */
function groupTone(checks: SeoCheck[]): Tone {
  if (checks.some((c) => c.status === 'fail')) return 'danger'
  if (checks.some((c) => c.status === 'warning')) return 'warning'
  return 'success'
}

// ---------------------------------------------------------------------------
// Group sub-section (within a category)
// ---------------------------------------------------------------------------
function GroupSubSection({
  group,
  checks,
  t,
}: {
  group: RuleGroup
  checks: SeoCheck[]
  t: DashboardTranslations
}) {
  const [open, setOpen] = useState(true)

  const passCount = checks.filter((c) => c.status === 'pass').length
  const total = checks.length

  // Summary icon for the group header
  const tone = groupTone(checks)

  return (
    <Collapsible
      className="seo-analyzer__group"
      header={
        <>
          <StatusMark tone={tone} />
          <span className="row-label">{getGroupLabels(t)[group] || group}</span>
          <TonePill tone="neutral">
            {passCount}/{total}
          </TonePill>
        </>
      }
      isCollapsed={!open}
      onToggle={(collapsed) => setOpen(!collapsed)}
    >
      <Checklist
        items={checks.map((check) => {
          const itemTone = statusTone(check.status)
          return {
            id: check.id,
            tone: itemTone,
            icon: toneIcon(itemTone),
            content: (
              <>
                <span className="seo-text seo-text--small seo-text--strong">{check.label}</span>
                <span className="seo-text seo-text--small seo-text--secondary">{check.message}</span>
                {check.tip && check.status !== 'pass' && (
                  <span className="seo-text seo-text--small seo-text--secondary seo-analyzer__tip">{check.tip}</span>
                )}
              </>
            ),
          }
        })}
      />
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Category accordion (with sub-groups)
// ---------------------------------------------------------------------------
function CategorySection({
  category,
  checks,
  defaultOpen,
  t,
}: {
  category: CheckCategory
  checks: SeoCheck[]
  defaultOpen: boolean
  t: DashboardTranslations
}) {
  const [open, setOpen] = useState(defaultOpen)

  const passCount = checks.filter((c) => c.status === 'pass').length
  const total = checks.length

  // Group checks by their rule group, preserving display order
  const groupedChecks = useMemo(() => {
    const groups: Array<{ group: RuleGroup; checks: SeoCheck[] }> = []
    const seen = new Set<RuleGroup>()

    for (const ruleGroup of GROUP_ORDER) {
      const groupChecks = checks.filter((c) => c.group === ruleGroup)
      if (groupChecks.length > 0 && !seen.has(ruleGroup)) {
        groups.push({ group: ruleGroup, checks: groupChecks })
        seen.add(ruleGroup)
      }
    }

    // Add any groups not in GROUP_ORDER (safety net)
    for (const check of checks) {
      if (!seen.has(check.group)) {
        const groupChecks = checks.filter((c) => c.group === check.group)
        groups.push({ group: check.group, checks: groupChecks })
        seen.add(check.group)
      }
    }

    return groups
  }, [checks])

  return (
    <Collapsible
      className="seo-analyzer__category"
      header={
        <>
          <span className="row-label">{getCategoryLabel(category, t)}</span>
          <TonePill tone={groupTone(checks)}>
            {passCount}/{total}
          </TonePill>
        </>
      }
      isCollapsed={!open}
      onToggle={(collapsed) => setOpen(!collapsed)}
    >
      <div className="seo-stack seo-stack--tight">
        {groupedChecks.map(({ group, checks: groupChecks }) => (
          <GroupSubSection key={group} group={group} checks={groupChecks} t={t} />
        ))}
      </div>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Keyword duplicate check hook
// ---------------------------------------------------------------------------
/** Admin edit path of a page that uses the keyword: collections by id, globals by slug. */
export function keywordUsageEditPath(page: { id?: string | number; collection: string }): `/${string}` {
  if (page.collection.startsWith('global:')) return `/globals/${page.collection.slice('global:'.length)}`
  return `/collections/${page.collection}/${encodeURIComponent(String(page.id ?? ''))}`
}

interface KeywordUsage {
  used: boolean
  pages: Array<{ id?: string | number; title: string; slug: string; collection: string }>
}

function useKeywordDuplicateCheck(
  keyword: string | undefined,
  documentId: string | undefined,
): KeywordUsage | null {
  const seoApi = useSeoApi()
  const [result, setResult] = useState<KeywordUsage | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevKeyword = useRef<string | undefined>(undefined)

  const checkKeyword = useCallback(
    async (kw: string) => {
      try {
        const params = new URLSearchParams({ keyword: kw })
        if (documentId) params.set('excludeId', documentId)
        const res = await fetch(seoApi(`/check-keyword?${params.toString()}`), {
          credentials: 'include',
          cache: 'no-store',
        })
        if (res.ok) {
          const data = await res.json()
          setResult({ used: data.used, pages: data.pages || [] })
        }
      } catch {
        // Silently fail — non-critical feature
      }
    },
    [documentId],
  )

  useEffect(() => {
    const kw = keyword?.trim()
    if (!kw || kw === prevKeyword.current) return
    prevKeyword.current = kw

    // Debounce 800ms
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      checkKeyword(kw)
    }, 800)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [keyword, checkKeyword])

  return result
}

// ---------------------------------------------------------------------------
// Internal linking suggestions hook
// ---------------------------------------------------------------------------
interface LinkSuggestion {
  title: string
  slug: string
  collection: string
  score: number
  contextPhrase: string
  matchType: 'keyword' | 'title' | 'slug'
}

function useInternalLinkSuggestions(
  documentId: string | undefined,
  collection: string | undefined,
  textContent: string,
): { suggestions: LinkSuggestion[]; loading: boolean } {
  const seoApi = useSeoApi()
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevContentRef = useRef<string>('')

  useEffect(() => {
    const trimmed = textContent.trim()
    if (!trimmed || trimmed.length < 50) {
      setSuggestions([])
      return
    }

    // Only re-fetch if content changed significantly (first 500 chars)
    const contentKey = trimmed.substring(0, 500)
    if (contentKey === prevContentRef.current) return
    prevContentRef.current = contentKey

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(seoApi('/suggest-links'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentId,
            collection: collection || 'pages',
            content: trimmed,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          setSuggestions(data.suggestions || [])
        }
      } catch {
        // Non-critical feature
      }
      setLoading(false)
    }, 2000)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [textContent, documentId, collection])

  return { suggestions, loading }
}

// ---------------------------------------------------------------------------
// AI optimize — "current → suggested" diff row (presentational)
// ---------------------------------------------------------------------------
function AiDiffRow({
  label,
  current,
  suggested,
  labelCurrent,
  labelSuggested,
  emptyValue,
}: {
  label: string
  current: string
  suggested: string
  labelCurrent: string
  labelSuggested: string
  emptyValue: string
}) {
  return (
    <div className="seo-stack seo-stack--tight">
      <span className="seo-field__label">{label}</span>
      <div className="seo-text seo-text--small seo-text--secondary">
        <span className="seo-text--strong">{labelCurrent}: </span>
        <span className={cx(current && 'seo-analyzer__struck')}>{current || emptyValue}</span>
      </div>
      <div className="seo-inset seo-text seo-text--small seo-analyzer__suggested">
        <TonePill tone="success">{labelSuggested}</TonePill>
        <span>{suggested || emptyValue}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI generate — one generated meta value with its length and a copy button
// ---------------------------------------------------------------------------
function AiMetaValue({
  label,
  value,
  min,
  max,
  copied,
  onCopy,
  copyLabel,
  emptyValue,
}: {
  label: string
  value: string
  min: number
  max: number
  copied: boolean
  onCopy: () => void
  copyLabel: string
  emptyValue: string
}) {
  return (
    <div className="seo-stack seo-stack--tight">
      <div className="seo-row seo-row--between seo-row--nowrap">
        <span className="seo-field__label">{label}</span>
        <div className="seo-row seo-row--nowrap">
          <TonePill tone={value.length >= min && value.length <= max ? 'success' : 'warning'}>
            {value.length}/{max}
          </TonePill>
          <Button
            buttonStyle="ghost"
            icon={copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            margin={false}
            onClick={onCopy}
            size="medium"
            type="button"
          >
            {copyLabel}
          </Button>
        </div>
      </div>
      <div className="seo-inset seo-text seo-text--small">{value || emptyValue}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface SeoAnalyzerFieldProps {
  /** Client field config; `admin.custom` carries the plugin's locale options (see seoFields()). */
  field?: { admin?: { custom?: SeoAnalysisLocaleOptions } }
}

const SeoAnalyzerInner: React.FC<SeoAnalyzerFieldProps> = ({ field }) => {
  const seoApi = useSeoApi()
  const adminRoute = useAdminRoute()
  const analysisLocale = useSeoAnalysisLocale(field?.admin?.custom)
  const t = useDashboardT()
  const [formFields, dispatchFields] = useAllFormFields()
  const initialScoreRef = useRef<number | null>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(true)
  const [cannibalizationExpanded, setCannibalizationExpanded] = useState(false)
  const [linkingSectionOpen, setLinkingSectionOpen] = useState(false)
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiResult, setAiResult] = useState<{ metaTitle: string; metaDescription: string } | null>(null)
  const [aiCopied, setAiCopied] = useState<'title' | 'desc' | null>(null)
  // AI "scan → propose → apply" optimize flow (meta only)
  const [aiOptimizing, setAiOptimizing] = useState(false)
  const [aiOptimizeResult, setAiOptimizeResult] = useState<{
    method: 'ai' | 'heuristic'
    model?: string
    current: { metaTitle: string; metaDescription: string; focusKeyword: string }
    suggestions: { metaTitle: string; metaDescription: string; focusKeyword: string; rationale: string[] }
  } | null>(null)
  const [aiOptimizeApplied, setAiOptimizeApplied] = useState(false)
  const [aiOptimizeError, setAiOptimizeError] = useState(false)

  // Helper to get field value from form state
  const getFieldValue = useCallback(
    (path: string): unknown => {
      if (!formFields) return undefined
      const field = formFields[path]
      return field?.value ?? undefined
    },
    [formFields],
  )

  // Extract focusKeyword, cornerstone flag and document ID
  const focusKeyword = getFieldValue('focusKeyword') as string | undefined
  const isCornerstone = getFieldValue('isCornerstone') as boolean | undefined
  const documentId = getFieldValue('id') as string | undefined
  const updatedAt = getFieldValue('updatedAt') as string | undefined
  const contentLastReviewed = getFieldValue('contentLastReviewed') as string | undefined

  // Check if the primary keyword is already used by another document
  const keywordUsage = useKeywordDuplicateCheck(focusKeyword, documentId)

  // Extract secondary keywords from form state (array field: focusKeywords.N.keyword)
  const focusKeywords: string[] = useMemo(() => {
    if (!formFields) return []
    const keywords: string[] = []
    let idx = 0
    while (true) {
      const kw = getFieldValue(`focusKeywords.${idx}.keyword`) as string | undefined
      if (kw === undefined && idx > 0) break
      if (kw && kw.trim()) keywords.push(kw.trim())
      idx++
      if (idx > 10) break // safety
    }
    return keywords
  }, [formFields, getFieldValue])

  // Extract values from form state and run analysis
  const { analysis, wordCount } = useMemo(() => {
    if (!formFields) return { analysis: { score: 0, level: 'poor' as const, checks: [] }, wordCount: 0 }

    const metaTitle = getFieldValue('meta.title') as string | undefined
    const metaDescription = getFieldValue('meta.description') as string | undefined
    const metaImage = getFieldValue('meta.image')
    const slug = getFieldValue('slug') as string | undefined

    // Hero fields (Pages)
    const heroRichText = getFieldValue('hero.richText')
    const heroMedia = getFieldValue('hero.media')

    // Hero CTA links (linkGroup: hero.links.N.link)
    const heroLinks: Record<string, unknown>[] = []
    let heroLinkIdx = 0
    while (true) {
      const linkType = getFieldValue(`hero.links.${heroLinkIdx}.link.type`) as string | undefined
      if (linkType === undefined && heroLinkIdx > 0) break
      if (linkType !== undefined) {
        const linkUrl = getFieldValue(`hero.links.${heroLinkIdx}.link.url`) as string | undefined
        const linkLabel = getFieldValue(`hero.links.${heroLinkIdx}.link.label`) as string | undefined
        const linkRef = getFieldValue(`hero.links.${heroLinkIdx}.link.reference`)
        heroLinks.push({ link: { type: linkType, url: linkUrl, label: linkLabel, reference: linkRef } })
      }
      heroLinkIdx++
      if (heroLinkIdx > 10) break
    }

    // Post content (Lexical richText)
    const content = getFieldValue('content')

    // Detect if we're editing a post (content field present means post)
    const isPost = !!content

    // heroTitle: for posts = document title (rendered as <h1> by PostHero)
    // for pages = not needed for H1 counting (allHeadings handles it)
    const pageTitle = getFieldValue('title') as string | undefined
    let heroTitle: string | undefined
    if (isPost) {
      heroTitle = pageTitle
    } else if (heroRichText) {
      const text = extractTextFromLexical(heroRichText)
      if (text.trim()) heroTitle = text.trim().split('\n')[0]
    }

    // Layout blocks (Pages)
    const blocks: unknown[] = []

    // Collect blocks from layout — form state stores them as layout.0, layout.1, etc.
    let blockIdx = 0
    while (true) {
      const blockType = getFieldValue(`layout.${blockIdx}.blockType`) as string | undefined
      if (!blockType) break

      const block: Record<string, unknown> = { blockType }

      // For Content blocks with columns (+ enableLink/link for link extraction)
      let colIdx = 0
      const columns: Record<string, unknown>[] = []
      while (true) {
        const colRichText = getFieldValue(`layout.${blockIdx}.columns.${colIdx}.richText`)
        if (colRichText === undefined && colIdx > 0) break
        if (colRichText !== undefined) {
          const enableLink = getFieldValue(`layout.${blockIdx}.columns.${colIdx}.enableLink`) as boolean | undefined
          const colEntry: Record<string, unknown> = { richText: colRichText }
          if (enableLink) {
            colEntry.enableLink = true
            const linkType = getFieldValue(`layout.${blockIdx}.columns.${colIdx}.link.type`) as string | undefined
            const linkUrl = getFieldValue(`layout.${blockIdx}.columns.${colIdx}.link.url`) as string | undefined
            const linkLabel = getFieldValue(`layout.${blockIdx}.columns.${colIdx}.link.label`) as string | undefined
            const linkRef = getFieldValue(`layout.${blockIdx}.columns.${colIdx}.link.reference`)
            colEntry.link = { type: linkType, url: linkUrl, label: linkLabel, reference: linkRef }
          }
          columns.push(colEntry)
        }
        colIdx++
        if (colIdx > 20) break // safety
      }
      if (columns.length > 0) block.columns = columns

      // For blocks with direct richText
      const richText = getFieldValue(`layout.${blockIdx}.richText`)
      if (richText) block.richText = richText

      // MediaBlock
      const media = getFieldValue(`layout.${blockIdx}.media`)
      if (media) block.media = media

      // Services block — extract titles, descriptions and links
      if (blockType === 'services') {
        const services: Record<string, unknown>[] = []
        let svcIdx = 0
        while (true) {
          const svcTitle = getFieldValue(`layout.${blockIdx}.services.${svcIdx}.title`) as string | undefined
          if (svcTitle === undefined && svcIdx > 0) break
          if (svcTitle !== undefined) {
            const svcDesc = getFieldValue(`layout.${blockIdx}.services.${svcIdx}.description`) as string | undefined
            const svcLink = getFieldValue(`layout.${blockIdx}.services.${svcIdx}.link`) as string | undefined
            services.push({ title: svcTitle, description: svcDesc || '', link: svcLink || '' })
          }
          svcIdx++
          if (svcIdx > 50) break // safety
        }
        if (services.length > 0) block.services = services
      }

      // CTA block — extract linkGroup links
      if (blockType === 'cta' || blockType === 'callToAction') {
        const links: Record<string, unknown>[] = []
        let linkIdx = 0
        while (true) {
          const linkType = getFieldValue(`layout.${blockIdx}.links.${linkIdx}.link.type`) as string | undefined
          if (linkType === undefined && linkIdx > 0) break
          if (linkType !== undefined) {
            const linkUrl = getFieldValue(`layout.${blockIdx}.links.${linkIdx}.link.url`) as string | undefined
            const linkLabel = getFieldValue(`layout.${blockIdx}.links.${linkIdx}.link.label`) as string | undefined
            const linkRef = getFieldValue(`layout.${blockIdx}.links.${linkIdx}.link.reference`)
            links.push({ link: { type: linkType, url: linkUrl, label: linkLabel, reference: linkRef } })
          }
          linkIdx++
          if (linkIdx > 10) break
        }
        if (links.length > 0) block.links = links
      }

      // LatestPosts block — extract CTA link
      if (blockType === 'latestPosts') {
        const ctaLink = getFieldValue(`layout.${blockIdx}.ctaLink`) as string | undefined
        const ctaLabel = getFieldValue(`layout.${blockIdx}.ctaLabel`) as string | undefined
        if (ctaLink) {
          block.ctaLink = ctaLink
          block.ctaLabel = ctaLabel || ''
        }
      }

      // Portfolio block — extract project links
      if (blockType === 'portfolio') {
        const projects: Record<string, unknown>[] = []
        let projIdx = 0
        while (true) {
          const projTitle = getFieldValue(`layout.${blockIdx}.projects.${projIdx}.title`) as string | undefined
          if (projTitle === undefined && projIdx > 0) break
          if (projTitle !== undefined) {
            const projLink = getFieldValue(`layout.${blockIdx}.projects.${projIdx}.link`) as string | undefined
            projects.push({ title: projTitle, link: projLink || '' })
          }
          projIdx++
          if (projIdx > 50) break
        }
        if (projects.length > 0) block.projects = projects
      }

      // Testimonials block — extract quotes for word count
      if (blockType === 'testimonials') {
        const testimonials: Record<string, unknown>[] = []
        let tIdx = 0
        while (true) {
          const quote = getFieldValue(`layout.${blockIdx}.testimonials.${tIdx}.quote`) as string | undefined
          if (quote === undefined && tIdx > 0) break
          if (quote !== undefined) {
            testimonials.push({ quote })
          }
          tIdx++
          if (tIdx > 20) break // safety
        }
        if (testimonials.length > 0) block.testimonials = testimonials
      }

      blocks.push(block)
      blockIdx++
      if (blockIdx > 100) break // safety
    }

    const result = analyzeSeo(
      {
        metaTitle,
        metaDescription,
        metaImage,
        slug,
        focusKeyword,
        focusKeywords: focusKeywords.length > 0 ? focusKeywords : undefined,
        heroTitle,
        heroRichText,
        heroLinks: heroLinks.length > 0 ? heroLinks : undefined,
        heroMedia: heroMedia || undefined,
        blocks: blocks.length > 0 ? blocks : undefined,
        content: content || undefined,
        isPost,
        isCornerstone: !!isCornerstone,
        updatedAt: updatedAt || undefined,
        contentLastReviewed: contentLastReviewed || undefined,
      },
      { locale: analysisLocale },
    )

    // Compute word count from the content check (reuse the check message or compute separately)
    let wc = 0
    const wcCheck = result.checks.find((c) => c.id === 'content-wordcount')
    if (wcCheck) {
      const match = wcCheck.message.match(/(\d+)\s*(?:mots|words)/)
      if (match) wc = parseInt(match[1], 10)
    }

    return { analysis: result, wordCount: wc }
  }, [formFields, focusKeyword, focusKeywords, isCornerstone, updatedAt, contentLastReviewed, getFieldValue, analysisLocale])

  // The page host for the social preview. Read after mount: during SSR there is no
  // window, and reading it in render made the server and client markup disagree
  // (hydration error once the preview body is rendered while collapsed).
  const [hostname, setHostname] = useState('example.com')
  useEffect(() => {
    setHostname(window.location.hostname)
  }, [])

  // Social preview data — extracted from form state
  const socialPreviewData = useMemo(() => {
    const metaTitle = getFieldValue('meta.title') as string | undefined
    const metaDescription = getFieldValue('meta.description') as string | undefined
    const metaImage = getFieldValue('meta.image')
    const slug = getFieldValue('slug') as string | undefined

    // Try to build image URL from meta image
    let imageUrl: string | undefined
    if (metaImage && typeof metaImage === 'object' && 'url' in metaImage) {
      imageUrl = (metaImage as { url?: string }).url || undefined
    }

    return { metaTitle, metaDescription, imageUrl, hostname, slug }
  }, [formFields, getFieldValue, hostname])

  // Internal linking — extract text content for suggestions
  const textContentForLinks = useMemo(() => {
    if (!formFields) return ''
    const parts: string[] = []

    // Hero richText
    const heroRichText = getFieldValue('hero.richText')
    if (heroRichText) parts.push(extractTextFromLexical(heroRichText))

    // Layout blocks
    let blockIdx = 0
    while (blockIdx < 100) {
      const blockType = getFieldValue(`layout.${blockIdx}.blockType`) as string | undefined
      if (!blockType) break

      // RichText blocks
      const richText = getFieldValue(`layout.${blockIdx}.richText`)
      if (richText) parts.push(extractTextFromLexical(richText))

      // Columns
      let colIdx = 0
      while (colIdx < 20) {
        const colRichText = getFieldValue(`layout.${blockIdx}.columns.${colIdx}.richText`)
        if (colRichText === undefined && colIdx > 0) break
        if (colRichText) parts.push(extractTextFromLexical(colRichText))
        colIdx++
      }

      blockIdx++
    }

    // Post content
    const content = getFieldValue('content')
    if (content) parts.push(extractTextFromLexical(content))

    return parts.join(' ')
  }, [formFields, getFieldValue])

  // Detect collection from current URL
  const currentCollection = useMemo(() => {
    if (typeof window === 'undefined') return 'pages'
    const match = window.location.pathname.match(/\/collections\/([^/]+)\//)
    return match ? match[1] : 'pages'
  }, [])

  const { suggestions: linkSuggestions, loading: linkSuggestionsLoading } =
    useInternalLinkSuggestions(documentId, currentCollection, textContentForLinks)

  // Reading time: ~200 words per minute, minimum 1 minute
  const readingTime = Math.max(1, Math.round(wordCount / 200))

  // Feature 1: Capture initial score on first valid analysis
  useEffect(() => {
    if (initialScoreRef.current === null && analysis.checks.length > 0) {
      initialScoreRef.current = analysis.score
    }
  }, [analysis.score, analysis.checks.length])

  const scoreDelta = initialScoreRef.current !== null ? analysis.score - initialScoreRef.current : null

  const levelLabel = getLevelLabel(analysis.level, t)

  // Group checks by category
  const criticalChecks = analysis.checks.filter((c) => c.category === 'critical')
  const importantChecks = analysis.checks.filter((c) => c.category === 'important')
  const bonusChecks = analysis.checks.filter((c) => c.category === 'bonus')

  // Summary stats
  const totalChecks = analysis.checks.length
  const passChecks = analysis.checks.filter((c) => c.status === 'pass').length
  const failChecks = analysis.checks.filter((c) => c.status === 'fail').length
  const warnChecks = analysis.checks.filter((c) => c.status === 'warning').length

  // Feature 2: Smart Suggestions based on failed/warning checks
  const suggestions = useMemo(() => {
    const items: Array<{ tone: Tone; text: string; checkId: string }> = []

    // Collect failed and warning checks sorted by priority
    const prioritized: SeoCheck[] = []
    const critFails = analysis.checks.filter((c) => c.category === 'critical' && c.status === 'fail')
    const impFails = analysis.checks.filter((c) => c.category === 'important' && c.status === 'fail')
    const critWarns = analysis.checks.filter((c) => c.category === 'critical' && c.status === 'warning')
    const impWarns = analysis.checks.filter((c) => c.category === 'important' && c.status === 'warning')
    prioritized.push(...critFails, ...impFails, ...critWarns, ...impWarns)

    for (const check of prioritized) {
      if (items.length >= 5) break

      // Avoid duplicate suggestions for same group
      const alreadyHasGroup = items.some((s) => {
        const existingCheck = analysis.checks.find((c) => c.id === s.checkId)
        return existingCheck?.group === check.group
      })
      if (alreadyHasGroup) continue

      let text = ''

      if (check.id.startsWith('title-length') || check.id.startsWith('title-')) {
        const match = check.message.match(/(\d+)\s*caract|\b(\d+)\s*char/)
        const charCount = match ? (match[1] || match[2]) : '?'
        text = `${t.seoAnalyzer.adjustTitle} (${t.seoAnalyzer.currently} ${charCount} ${t.seoAnalyzer.titleCharactersIdeal})`
      } else if (check.id.startsWith('meta-desc')) {
        text = t.seoAnalyzer.writeMetaDesc
      } else if (check.id === 'content-wordcount') {
        text = t.seoAnalyzer.enrichContent
      } else if (check.id === 'keyword-in-title') {
        text = t.seoAnalyzer.includeKeywordInTitle
      } else if (check.id === 'keyword-in-meta') {
        text = t.seoAnalyzer.includeKeywordInDesc
      } else if (check.id.startsWith('images-alt') || check.id === 'images-alt') {
        text = t.seoAnalyzer.addAltText
      } else if (check.id.startsWith('linking-internal') || check.id === 'linking-internal') {
        text = t.seoAnalyzer.addInternalLinks
      } else {
        // Generic: use tip or message
        text = check.tip || check.message
      }

      if (text) {
        items.push({ tone: statusTone(check.status), text, checkId: check.id })
      }
    }

    return items
  }, [analysis.checks, t])

  const handleAiGenerate = async () => {
    setAiGenerating(true)
    setAiResult(null)
    try {
      const title = getFieldValue('title') as string || ''
      const slug = getFieldValue('slug') as string || ''
      const content = getFieldValue('content')
      const heroRichTextVal = getFieldValue('hero.richText')

      // Extract text from content for the AI endpoint
      let textContent = ''
      if (content) textContent += extractTextFromLexical(content)
      if (heroRichTextVal) textContent += ' ' + extractTextFromLexical(heroRichTextVal)

      // Also extract from layout blocks
      let blockIdx = 0
      while (blockIdx < 100) {
        const blockType = getFieldValue(`layout.${blockIdx}.blockType`) as string | undefined
        if (!blockType) break
        const rt = getFieldValue(`layout.${blockIdx}.richText`)
        if (rt) textContent += ' ' + extractTextFromLexical(rt)
        let colIdx = 0
        while (colIdx < 20) {
          const colRt = getFieldValue(`layout.${blockIdx}.columns.${colIdx}.richText`)
          if (colRt === undefined && colIdx > 0) break
          if (colRt) textContent += ' ' + extractTextFromLexical(colRt)
          colIdx++
        }
        blockIdx++
      }

      const res = await fetch(seoApi('/ai-generate'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          focusKeyword: focusKeyword || '',
          content: textContent.trim(),
          slug,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setAiResult(data)
      }
    } catch {
      // Silently fail
    }
    setAiGenerating(false)
  }

  const handleAiOptimize = async () => {
    setAiOptimizing(true)
    setAiOptimizeResult(null)
    setAiOptimizeApplied(false)
    setAiOptimizeError(false)
    try {
      const res = await fetch(seoApi('/ai-optimize'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: currentCollection, id: documentId }),
      })
      if (res.ok) {
        setAiOptimizeResult(await res.json())
      } else {
        setAiOptimizeError(true)
      }
    } catch {
      setAiOptimizeError(true)
    }
    setAiOptimizing(false)
  }

  // Cannibalization risk grows with the number of other pages using the keyword
  const cannibalizationHigh = (keywordUsage?.pages.length ?? 0) > 2

  return (
    <div className="seo-sidebar seo-analyzer">
      {/* Header with score ring */}
      <Card
        actions={
          /* Feature 1: Score delta badge */
          scoreDelta !== null && scoreDelta !== 0 ? (
            <TonePill tone={scoreDelta > 0 ? 'success' : 'danger'}>
              {scoreDelta > 0 ? '+' : ''}
              {scoreDelta}
            </TonePill>
          ) : undefined
        }
        title={t.seoAnalyzer.seoScore}
      >
        <div className="seo-analyzer__score">
          <ScoreRing
            aria-label={`${analysis.score} ${t.seoAnalyzer.outOf100}`}
            label={
              <span className="seo-analyzer__ring-label">
                <span className="seo-analyzer__ring-value">{analysis.score}</span>
                <span className="seo-analyzer__ring-caption">{t.seoAnalyzer.outOf100}</span>
              </span>
            }
            score={analysis.score}
            size={80}
            thresholds={LEVEL_THRESHOLDS}
          />

          <div className="seo-stack seo-stack--tight seo-analyzer__score-meta">
            <div className="seo-row">
              <TonePill tone={getLevelTone(analysis.level)}>{levelLabel}</TonePill>
              {isCornerstone && <TonePill tone="brand">{t.seoAnalyzer.cornerstoneLabel}</TonePill>}
              {analysis.aiReadiness && (
                <span title={t.seoAnalyzer.aiReadinessTooltip}>
                  <TonePill tone={getLevelTone(analysis.aiReadiness.level)}>
                    {t.seoAnalyzer.aiReadiness} {analysis.aiReadiness.score}
                  </TonePill>
                </span>
              )}
            </div>
            <p className="seo-text seo-text--small seo-text--secondary">
              {passChecks} / {totalChecks} {t.seoAnalyzer.checksPassed}
              {failChecks > 0 && (
                <span className="seo-text--danger seo-text--strong">
                  {' '}
                  ({failChecks} {t.seoAnalyzer.errorsCount})
                </span>
              )}
              {failChecks === 0 && warnChecks > 0 && (
                <span className="seo-text--warning seo-text--strong">
                  {' '}
                  ({warnChecks} {t.seoAnalyzer.warningsCount})
                </span>
              )}
            </p>
          </div>
        </div>
      </Card>

      {/* Reading time + word count info bar */}
      {wordCount > 0 && (
        <div className="seo-inset seo-text seo-text--small seo-text--secondary seo-analyzer__facts">
          <span className="seo-text seo-text--small seo-text--strong">
            {t.seoAnalyzer.readingTime.replace('{n}', String(readingTime))}
          </span>
          <span>{wordCount} {t.seoAnalyzer.wordsLabel}</span>
          {focusKeywords.length > 0 && (
            <span>{focusKeywords.length} {t.seoAnalyzer.secondaryKeywords}</span>
          )}
        </div>
      )}

      {/* AI Meta Generation */}
      <div className="seo-stack seo-stack--tight">
        <Button
          buttonStyle="secondary"
          className="seo-analyzer__action"
          disabled={aiGenerating}
          margin={false}
          onClick={handleAiGenerate}
          size="medium"
          type="button"
        >
          {aiGenerating ? t.common.generating : t.seoAnalyzer.generateMeta}
        </Button>

        {/* AI Results panel */}
        {aiResult && (
          <Card>
            {/* Generated meta title */}
            <AiMetaValue
              copied={aiCopied === 'title'}
              copyLabel={t.common.copy}
              emptyValue={t.seoAnalyzer.emptyValue}
              label={t.seoAnalyzer.metaTitle}
              max={60}
              min={50}
              onCopy={() => {
                navigator.clipboard.writeText(aiResult.metaTitle)
                setAiCopied('title')
                setTimeout(() => setAiCopied(null), 1500)
              }}
              value={aiResult.metaTitle}
            />

            {/* Generated meta description */}
            <AiMetaValue
              copied={aiCopied === 'desc'}
              copyLabel={t.common.copy}
              emptyValue={t.seoAnalyzer.emptyValue}
              label={t.seoAnalyzer.metaDescription}
              max={160}
              min={120}
              onCopy={() => {
                navigator.clipboard.writeText(aiResult.metaDescription)
                setAiCopied('desc')
                setTimeout(() => setAiCopied(null), 1500)
              }}
              value={aiResult.metaDescription}
            />
          </Card>
        )}
      </div>

      {/* AI Optimize — scan → propose → apply (meta only) */}
      <div className="seo-stack seo-stack--tight">
        <Button
          buttonStyle="secondary"
          className="seo-analyzer__action"
          disabled={aiOptimizing || !documentId}
          extraButtonProps={!documentId ? { title: t.seoAnalyzer.applySaveHint } : undefined}
          margin={false}
          onClick={handleAiOptimize}
          size="medium"
          type="button"
        >
          {aiOptimizing ? t.seoAnalyzer.optimizeRunning : t.seoAnalyzer.optimizeWithAi}
        </Button>

        {aiOptimizeError && <Banner type="danger">{t.common.loadingError}</Banner>}

        {aiOptimizeResult && (
          <Card>
            {aiOptimizeResult.method === 'heuristic' && (
              <p className="seo-text seo-text--small seo-text--secondary">{t.seoAnalyzer.heuristicNote}</p>
            )}

            {/* Title: current → suggested */}
            <AiDiffRow
              label={t.seoAnalyzer.metaTitle}
              current={aiOptimizeResult.current.metaTitle}
              suggested={aiOptimizeResult.suggestions.metaTitle}
              labelCurrent={t.seoAnalyzer.labelCurrent}
              labelSuggested={t.seoAnalyzer.labelSuggested}
              emptyValue={t.seoAnalyzer.emptyValue}
            />
            {/* Description: current → suggested */}
            <AiDiffRow
              label={t.seoAnalyzer.metaDescription}
              current={aiOptimizeResult.current.metaDescription}
              suggested={aiOptimizeResult.suggestions.metaDescription}
              labelCurrent={t.seoAnalyzer.labelCurrent}
              labelSuggested={t.seoAnalyzer.labelSuggested}
              emptyValue={t.seoAnalyzer.emptyValue}
            />
            {/* Focus keyword — only when AI proposes filling an empty one */}
            {aiOptimizeResult.suggestions.focusKeyword &&
              aiOptimizeResult.suggestions.focusKeyword !== aiOptimizeResult.current.focusKeyword && (
                <AiDiffRow
                  label={t.seoAnalyzer.labelFocusKeyword}
                  current={aiOptimizeResult.current.focusKeyword}
                  suggested={aiOptimizeResult.suggestions.focusKeyword}
                  labelCurrent={t.seoAnalyzer.labelCurrent}
                  labelSuggested={t.seoAnalyzer.labelSuggested}
                  emptyValue={t.seoAnalyzer.emptyValue}
                />
              )}

            {/* Rationale */}
            {aiOptimizeResult.suggestions.rationale.length > 0 && (
              <div className="seo-stack seo-stack--tight">
                <span className="seo-field__label">{t.seoAnalyzer.whyChanges}</span>
                <ul className="seo-text seo-text--small seo-analyzer__bullets">
                  {aiOptimizeResult.suggestions.rationale.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Apply button */}
            <Button
              buttonStyle="primary"
              className="seo-analyzer__action"
              disabled={aiOptimizeApplied}
              icon={aiOptimizeApplied ? <CheckIcon size={16} /> : undefined}
              margin={false}
              onClick={() => {
                const sug = aiOptimizeResult.suggestions
                if (sug.metaTitle) dispatchFields({ type: 'UPDATE', path: 'meta.title', value: sug.metaTitle })
                if (sug.metaDescription) dispatchFields({ type: 'UPDATE', path: 'meta.description', value: sug.metaDescription })
                if (sug.focusKeyword && sug.focusKeyword !== aiOptimizeResult.current.focusKeyword) {
                  dispatchFields({ type: 'UPDATE', path: 'focusKeyword', value: sug.focusKeyword })
                }
                setAiOptimizeApplied(true)
              }}
              size="medium"
              type="button"
            >
              {aiOptimizeApplied ? t.seoAnalyzer.applied : t.seoAnalyzer.applyAll}
            </Button>
            {aiOptimizeApplied && (
              <p className="seo-text seo-text--small seo-text--secondary seo-analyzer__centered">
                {t.seoAnalyzer.applySaveHint}
              </p>
            )}
          </Card>
        )}
      </div>

      {/* Feature 2: Smart Suggestions */}
      {suggestions.length > 0 && (
        <Collapsible
          header={
            <>
              <span className="row-label">{t.seoAnalyzer.improvementSuggestions}</span>
              <TonePill tone="neutral">{suggestions.length}</TonePill>
            </>
          }
          isCollapsed={!suggestionsOpen}
          onToggle={(collapsed) => setSuggestionsOpen(!collapsed)}
        >
          <Checklist
            items={suggestions.map((suggestion, idx) => ({
              id: String(idx),
              tone: suggestion.tone,
              icon: toneIcon(suggestion.tone),
              content: <span className="seo-text seo-text--small seo-text--strong">{suggestion.text}</span>,
            }))}
          />
        </Collapsible>
      )}

      {/* Feature 3: Enhanced Keyword Cannibalization Warning */}
      {keywordUsage && keywordUsage.used && (
        <Banner type={cannibalizationHigh ? 'danger' : 'warning'}>
          <div className="seo-stack seo-stack--tight seo-analyzer__banner">
            <div className="seo-row seo-row--between">
              <strong>{t.seoAnalyzer.seoCannibalization}</strong>
              <TonePill tone={cannibalizationHigh ? 'danger' : 'warning'}>
                {cannibalizationHigh ? t.seoAnalyzer.highRisk : t.cannibalization.warning}
              </TonePill>
            </div>
            <div className="seo-text--small">
              &quot;{focusKeyword}&quot; —{' '}
              <strong>{keywordUsage.pages.length} {t.cannibalization.pages}</strong>.
              {cannibalizationHigh
                ? ` ${t.seoAnalyzer.duplicationHarmsRanking}`
                : ` ${t.seoAnalyzer.diluteRanking}`}
            </div>
            <div>
              <Button
                aria-expanded={cannibalizationExpanded}
                buttonStyle="ghost"
                icon={<ChevronIcon direction={cannibalizationExpanded ? 'up' : 'down'} />}
                iconPosition="right"
                margin={false}
                onClick={() => setCannibalizationExpanded(!cannibalizationExpanded)}
                size="medium"
                type="button"
              >
                {t.seoAnalyzer.viewPages} ({keywordUsage.pages.length})
              </Button>
            </div>
            {cannibalizationExpanded && (
              <ul className="seo-analyzer__list">
                {keywordUsage.pages.map((page, idx) => (
                  <li className="seo-analyzer__list-item" key={idx}>
                    <div className="seo-analyzer__list-main">
                      <div className="seo-text--small seo-text--strong seo-truncate">{page.title}</div>
                      <div className="seo-text--small">
                        {page.collection === 'pages' ? t.common.page : t.common.article} — /{page.slug}
                      </div>
                    </div>
                    <Button
                      buttonStyle="secondary"
                      el="anchor"
                      icon={<NewTabIcon size={16} />}
                      iconPosition="right"
                      margin={false}
                      newTab
                      size="medium"
                      url={formatAdminURL({ adminRoute, path: keywordUsageEditPath(page) })}
                    >
                      {t.common.edit}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="seo-text--small seo-analyzer__advice">{t.seoAnalyzer.uniqueKeywordAdvice}</div>
          </div>
        </Banner>
      )}

      {/* Social Preview */}
      <SeoSocialPreview
        metaTitle={socialPreviewData.metaTitle}
        metaDescription={socialPreviewData.metaDescription}
        imageUrl={socialPreviewData.imageUrl}
        hostname={socialPreviewData.hostname}
      />

      {/* Internal Linking Suggestions */}
      {(linkSuggestions.length > 0 || linkSuggestionsLoading) && (
        <Collapsible
          header={
            <>
              <span className="row-label">{t.seoAnalyzer.suggestedInternalLinks}</span>
              <TonePill tone="neutral">{linkSuggestionsLoading ? '...' : linkSuggestions.length}</TonePill>
            </>
          }
          isCollapsed={!linkingSectionOpen}
          onToggle={(collapsed) => setLinkingSectionOpen(!collapsed)}
        >
          {linkSuggestionsLoading && (
            <p className="seo-text seo-text--small seo-text--secondary seo-analyzer__centered">
              {t.seoAnalyzer.analyzingContent}
            </p>
          )}
          {!linkSuggestionsLoading && (
            <ul className="seo-analyzer__list">
              {linkSuggestions.map((link) => (
                <li className="seo-analyzer__list-item" key={`${link.collection}-${link.slug}`}>
                  <div className="seo-analyzer__list-main">
                    <div className="seo-row seo-row--nowrap">
                      <span className="seo-text seo-text--small seo-text--strong seo-truncate">{link.title}</span>
                      <TonePill tone={link.matchType === 'keyword' ? 'success' : link.matchType === 'title' ? 'neutral' : 'warning'}>
                        {link.matchType}
                      </TonePill>
                    </div>
                    <div className="seo-mono seo-text--secondary">/{link.slug}</div>
                    {link.contextPhrase && (
                      <div className="seo-text seo-text--small seo-text--secondary seo-analyzer__tip">
                        {link.contextPhrase}
                      </div>
                    )}
                  </div>
                  <Button
                    buttonStyle="secondary"
                    icon={copiedSlug === link.slug ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                    margin={false}
                    onClick={() => {
                      navigator.clipboard.writeText(`/${link.slug}`)
                      setCopiedSlug(link.slug)
                      setTimeout(() => setCopiedSlug(null), 1500)
                    }}
                    size="medium"
                    type="button"
                  >
                    {t.common.copy}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Collapsible>
      )}

      {/* Check categories */}
      {criticalChecks.length > 0 && (
        <CategorySection category="critical" checks={criticalChecks} defaultOpen={true} t={t} />
      )}
      {importantChecks.length > 0 && (
        <CategorySection category="important" checks={importantChecks} defaultOpen={true} t={t} />
      )}
      {bonusChecks.length > 0 && (
        <CategorySection category="bonus" checks={bonusChecks} defaultOpen={false} t={t} />
      )}
    </div>
  )
}


/**
 * Registered as the `seoAnalyzer` UI field on every target collection, so
 * Payload mounts it from the import map inside the document form. The boundary
 * lives here because the plugin never owns that parent: without it, one bad
 * analysis result takes down the whole edit screen, sidebar and save button
 * included.
 */
const SeoAnalyzer = withSeoErrorBoundary(SeoAnalyzerInner, { viewName: 'SeoAnalyzerField' })

export default SeoAnalyzer
