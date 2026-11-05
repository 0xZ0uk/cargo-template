'use client'

import React, { useState, useCallback, useMemo, useId } from 'react'
import { Banner, Button, PlusIcon, Tabs } from '@payloadcms/ui'
import { useDashboardT } from '../hooks/useSeoLocale.js'
import { Card, Field, TonePill, ViewBody, ViewHeader } from '../ui/index.js'
import { SchemaFromPage, type SchemaPreviewProps } from './SchemaFromPage.js'
import type { DashboardTranslations } from '../dashboard-i18n.js'
import './SchemaBuilderView.css'

// ---------------------------------------------------------------------------
// Schema type definitions
// ---------------------------------------------------------------------------

type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'datetime' | 'array'

interface SchemaField {
  name: string
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  options?: Array<{ label: string; value: string }>
  /** For array fields — the sub-fields of each item */
  subFields?: SchemaField[]
}

interface SchemaTypeDef {
  label: string
  jsonType: string
  fields: SchemaField[]
}

function getSchemaTypes(t: DashboardTranslations): Record<string, SchemaTypeDef> {
  return {
    LocalBusiness: {
      label: t.schemaBuilder.localBusiness,
      jsonType: 'LocalBusiness',
      fields: [
        { name: 'name', label: t.schemaBuilder.name, type: 'text', required: true, placeholder: 'Acme Bakery' },
        { name: 'description', label: t.schemaBuilder.description, type: 'textarea', placeholder: 'Artisan bakery since 1985...' },
        { name: 'streetAddress', label: t.schemaBuilder.address, type: 'text', placeholder: '123 Main Street' },
        { name: 'addressLocality', label: t.schemaBuilder.city, type: 'text', placeholder: 'Springfield' },
        { name: 'postalCode', label: t.schemaBuilder.postalCode, type: 'text', placeholder: '62701' },
        { name: 'addressCountry', label: t.schemaBuilder.country, type: 'text', placeholder: 'US' },
        { name: 'telephone', label: t.schemaBuilder.phone, type: 'text', placeholder: '+1 555 123 4567' },
        { name: 'email', label: t.schemaBuilder.email, type: 'text', placeholder: 'contact@acmebakery.com' },
        { name: 'openingHours', label: t.schemaBuilder.openingHours, type: 'text', placeholder: 'Mo-Fr 07:00-19:00, Sa 08:00-18:00' },
        { name: 'latitude', label: t.schemaBuilder.latitude, type: 'text', placeholder: '39.7817' },
        { name: 'longitude', label: t.schemaBuilder.longitude, type: 'text', placeholder: '-89.6501' },
        { name: 'image', label: t.schemaBuilder.imageUrl, type: 'text', placeholder: 'https://example.com/photo.jpg' },
        { name: 'priceRange', label: t.schemaBuilder.priceRange, type: 'text', placeholder: '$$' },
        { name: 'url', label: t.schemaBuilder.website, type: 'text', placeholder: 'https://acmebakery.com' },
      ],
    },
    Article: {
      label: t.schemaBuilder.article,
      jsonType: 'Article',
      fields: [
        { name: 'headline', label: t.schemaBuilder.title, type: 'text', required: true, placeholder: 'How to bake bread at home' },
        { name: 'authorName', label: t.schemaBuilder.author, type: 'text', placeholder: 'Jane Doe' },
        { name: 'authorSameAs', label: t.schemaBuilder.authorSameAs, type: 'textarea', placeholder: 'https://www.wikidata.org/wiki/Q..., https://linkedin.com/in/...' },
        { name: 'datePublished', label: t.schemaBuilder.publicationDate, type: 'datetime' },
        { name: 'dateModified', label: t.schemaBuilder.modificationDate, type: 'datetime' },
        { name: 'image', label: t.schemaBuilder.imageUrl, type: 'text', placeholder: 'https://example.com/article.jpg' },
        { name: 'publisherName', label: t.schemaBuilder.publisherName, type: 'text', placeholder: 'My Blog' },
        { name: 'publisherLogo', label: t.schemaBuilder.publisherLogo, type: 'text', placeholder: 'https://example.com/logo.png' },
        { name: 'description', label: t.schemaBuilder.description, type: 'textarea', placeholder: 'A complete guide to...' },
      ],
    },
    Product: {
      label: t.schemaBuilder.product,
      jsonType: 'Product',
      fields: [
        { name: 'name', label: t.schemaBuilder.productName, type: 'text', required: true, placeholder: 'Organic sourdough loaf' },
        { name: 'description', label: t.schemaBuilder.description, type: 'textarea', placeholder: 'Artisan bread made with natural sourdough...' },
        { name: 'image', label: t.schemaBuilder.imageUrl, type: 'text', placeholder: 'https://example.com/bread.jpg' },
        { name: 'sku', label: t.schemaBuilder.sku, type: 'text', placeholder: 'BREAD-ORG-001' },
        { name: 'brand', label: t.schemaBuilder.brand, type: 'text', placeholder: 'Acme Bakery' },
        { name: 'price', label: t.schemaBuilder.price, type: 'number', placeholder: '4.50' },
        { name: 'priceCurrency', label: t.schemaBuilder.currency, type: 'text', placeholder: 'USD' },
        {
          name: 'availability',
          label: t.schemaBuilder.availability,
          type: 'select',
          options: [
            { label: t.schemaBuilder.inStock, value: 'https://schema.org/InStock' },
            { label: t.schemaBuilder.outOfStock, value: 'https://schema.org/OutOfStock' },
            { label: t.schemaBuilder.preOrder, value: 'https://schema.org/PreOrder' },
            { label: t.schemaBuilder.madeToOrder, value: 'https://schema.org/MadeToOrder' },
          ],
        },
        { name: 'reviewCount', label: t.schemaBuilder.reviewCount, type: 'number', placeholder: '42' },
        { name: 'ratingValue', label: t.schemaBuilder.ratingValue, type: 'number', placeholder: '4.5' },
      ],
    },
    FAQ: {
      label: t.schemaBuilder.faq,
      jsonType: 'FAQPage',
      fields: [
        {
          name: 'questions',
          label: t.schemaBuilder.questionsAnswers,
          type: 'array',
          subFields: [
            { name: 'question', label: t.schemaBuilder.question, type: 'text', required: true, placeholder: 'What are your opening hours?' },
            { name: 'answer', label: t.schemaBuilder.answer, type: 'textarea', required: true, placeholder: 'We are open Monday to...' },
          ],
        },
      ],
    },
    HowTo: {
      label: t.schemaBuilder.howTo,
      jsonType: 'HowTo',
      fields: [
        { name: 'name', label: t.schemaBuilder.guideTitle, type: 'text', required: true, placeholder: 'How to make a chocolate cake' },
        { name: 'description', label: t.schemaBuilder.description, type: 'textarea', placeholder: 'A step-by-step guide to...' },
        {
          name: 'steps',
          label: t.schemaBuilder.steps,
          type: 'array',
          subFields: [
            { name: 'name', label: t.schemaBuilder.stepTitle, type: 'text', required: true, placeholder: 'Prepare the ingredients' },
            { name: 'text', label: t.schemaBuilder.stepDescription, type: 'textarea', required: true, placeholder: 'Weigh 200g of flour...' },
            { name: 'image', label: t.schemaBuilder.imageLabel, type: 'text', placeholder: 'https://example.com/step1.jpg' },
          ],
        },
      ],
    },
    Organization: {
      label: t.schemaBuilder.organization,
      jsonType: 'Organization',
      fields: [
        { name: 'name', label: t.schemaBuilder.name, type: 'text', required: true, placeholder: 'My Company' },
        { name: 'url', label: t.schemaBuilder.website, type: 'text', placeholder: 'https://example.com' },
        { name: 'logo', label: t.schemaBuilder.logoUrl, type: 'text', placeholder: 'https://example.com/logo.png' },
        { name: 'contactEmail', label: t.schemaBuilder.contactEmail, type: 'text', placeholder: 'contact@example.com' },
        { name: 'contactPhone', label: t.schemaBuilder.phone, type: 'text', placeholder: '+1 555 987 6543' },
        {
          name: 'sameAs',
          label: t.schemaBuilder.socialMediaUrls,
          type: 'array',
          subFields: [
            { name: 'url', label: t.schemaBuilder.urlLabel, type: 'text', required: true, placeholder: 'https://linkedin.com/company/...' },
          ],
        },
        {
          name: 'knowsAbout',
          label: t.schemaBuilder.knowsAbout,
          type: 'textarea',
          placeholder: 'SEO, content marketing, web analytics',
        },
      ],
    },
    Event: {
      label: t.schemaBuilder.event,
      jsonType: 'Event',
      fields: [
        { name: 'name', label: t.schemaBuilder.name, type: 'text', required: true, placeholder: 'Web Summit 2026' },
        { name: 'startDate', label: t.schemaBuilder.startDate, type: 'datetime' },
        { name: 'endDate', label: t.schemaBuilder.endDate, type: 'datetime' },
        { name: 'locationName', label: t.schemaBuilder.location, type: 'text', placeholder: 'Convention Center' },
        { name: 'locationAddress', label: t.schemaBuilder.locationAddress, type: 'text', placeholder: '100 Convention Way, Springfield' },
        { name: 'description', label: t.schemaBuilder.description, type: 'textarea', placeholder: 'The biggest digital event of the year...' },
        { name: 'offerPrice', label: t.schemaBuilder.price, type: 'number', placeholder: '25' },
        { name: 'offerCurrency', label: t.schemaBuilder.currency, type: 'text', placeholder: 'USD' },
        { name: 'offerUrl', label: t.schemaBuilder.ticketUrl, type: 'text', placeholder: 'https://example.com/tickets' },
        { name: 'image', label: t.schemaBuilder.imageLabel, type: 'text', placeholder: 'https://example.com/event.jpg' },
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// JSON-LD builder — converts form data to structured JSON-LD
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildJsonLd(type: string, values: Record<string, any>): Record<string, unknown> {
  switch (type) {
    case 'LocalBusiness': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
      }
      if (values.name) result.name = values.name
      if (values.description) result.description = values.description
      if (values.telephone) result.telephone = values.telephone
      if (values.email) result.email = values.email
      if (values.url) result.url = values.url
      if (values.image) result.image = values.image
      if (values.priceRange) result.priceRange = values.priceRange
      if (values.openingHours) result.openingHoursSpecification = values.openingHours

      // Address
      if (values.streetAddress || values.addressLocality || values.postalCode) {
        result.address = {
          '@type': 'PostalAddress',
          ...(values.streetAddress && { streetAddress: values.streetAddress }),
          ...(values.addressLocality && { addressLocality: values.addressLocality }),
          ...(values.postalCode && { postalCode: values.postalCode }),
          ...(values.addressCountry && { addressCountry: values.addressCountry }),
        }
      }

      // Geo
      if (values.latitude && values.longitude) {
        result.geo = {
          '@type': 'GeoCoordinates',
          latitude: Number(values.latitude),
          longitude: Number(values.longitude),
        }
      }

      return result
    }

    case 'Article': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': 'Article',
      }
      if (values.headline) result.headline = values.headline
      if (values.description) result.description = values.description
      if (values.image) result.image = values.image
      if (values.datePublished) result.datePublished = values.datePublished
      if (values.dateModified) result.dateModified = values.dateModified

      if (values.authorName) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const author: Record<string, any> = { '@type': 'Person', name: values.authorName }
        // Author entity disambiguation (E-E-A-T) — comma/newline separated profile URLs.
        const sameAs = String(values.authorSameAs || '').split(/[,\n]/).map((x: string) => x.trim()).filter(Boolean)
        if (sameAs.length > 0) author.sameAs = sameAs
        result.author = author
      }

      if (values.publisherName) {
        result.publisher = {
          '@type': 'Organization',
          name: values.publisherName,
          ...(values.publisherLogo && {
            logo: { '@type': 'ImageObject', url: values.publisherLogo },
          }),
        }
      }

      return result
    }

    case 'Product': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
      }
      if (values.name) result.name = values.name
      if (values.description) result.description = values.description
      if (values.image) result.image = values.image
      if (values.sku) result.sku = values.sku
      if (values.brand) result.brand = { '@type': 'Brand', name: values.brand }

      if (values.price) {
        result.offers = {
          '@type': 'Offer',
          price: Number(values.price),
          priceCurrency: values.priceCurrency || 'EUR',
          ...(values.availability && { availability: values.availability }),
        }
      }

      if (values.ratingValue && values.reviewCount) {
        result.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: Number(values.ratingValue),
          reviewCount: Number(values.reviewCount),
        }
      }

      return result
    }

    case 'FAQ': {
      const questions = (values.questions || []) as Array<{ question: string; answer: string }>
      return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: questions
          .filter((q) => q.question && q.answer)
          .map((q) => ({
            '@type': 'Question',
            name: q.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: q.answer,
            },
          })),
      }
    }

    case 'HowTo': {
      const steps = (values.steps || []) as Array<{ name: string; text: string; image?: string }>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
      }
      if (values.name) result.name = values.name
      if (values.description) result.description = values.description
      result.step = steps
        .filter((s) => s.name && s.text)
        .map((s) => ({
          '@type': 'HowToStep',
          name: s.name,
          text: s.text,
          ...(s.image && { image: s.image }),
        }))
      return result
    }

    case 'Organization': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
      }
      if (values.name) result.name = values.name
      if (values.url) result.url = values.url
      if (values.logo) result.logo = values.logo

      if (values.contactEmail || values.contactPhone) {
        result.contactPoint = {
          '@type': 'ContactPoint',
          ...(values.contactEmail && { email: values.contactEmail }),
          ...(values.contactPhone && { telephone: values.contactPhone }),
        }
      }

      const sameAs = (values.sameAs || []) as Array<{ url: string }>
      const urls = sameAs.filter((s) => s.url).map((s) => s.url)
      if (urls.length > 0) result.sameAs = urls

      // knowsAbout (topical authority) — comma/newline separated topics.
      const knowsAbout = String(values.knowsAbout || '')
        .split(/[,\n]/)
        .map((x: string) => x.trim())
        .filter(Boolean)
      if (knowsAbout.length > 0) result.knowsAbout = knowsAbout

      return result
    }

    case 'Event': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': 'Event',
      }
      if (values.name) result.name = values.name
      if (values.description) result.description = values.description
      if (values.startDate) result.startDate = values.startDate
      if (values.endDate) result.endDate = values.endDate
      if (values.image) result.image = values.image

      if (values.locationName) {
        result.location = {
          '@type': 'Place',
          name: values.locationName,
          ...(values.locationAddress && {
            address: { '@type': 'PostalAddress', streetAddress: values.locationAddress },
          }),
        }
      }

      if (values.offerPrice) {
        result.offers = {
          '@type': 'Offer',
          price: Number(values.offerPrice),
          priceCurrency: values.offerCurrency || 'EUR',
          ...(values.offerUrl && { url: values.offerUrl }),
        }
      }

      return result
    }

    default:
      return {}
  }
}

// ---------------------------------------------------------------------------
// JSON syntax highlighter (inline spans)
// ---------------------------------------------------------------------------

/** Token colors come from the admin's text tones, so the sample follows light/dark mode. */
const TOKEN_CLASS: Record<'key' | 'string' | 'number' | 'boolean' | 'null', string> = {
  key: 'seo-text--brand',
  string: 'seo-text--success',
  number: 'seo-text--warning',
  boolean: 'seo-text--secondary',
  null: 'seo-text--danger',
}

function syntaxHighlight(json: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Regex to match JSON tokens
  const tokenRegex = /("(?:\\.|[^"\\])*")\s*:/g
  const valueRegex = /:\s*("(?:\\.|[^"\\])*"|true|false|null|\d+(?:\.\d+)?)/g
  const lines = json.split('\n')

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const parts: React.ReactNode[] = []
    let lastIdx = 0

    // Find keys and values
    const allMatches: Array<{ start: number; end: number; type: 'key' | 'string' | 'number' | 'boolean' | 'null'; text: string }> = []

    // Keys
    let m: RegExpExecArray | null
    const keyRe = new RegExp(tokenRegex.source, 'g')
    while ((m = keyRe.exec(line)) !== null) {
      allMatches.push({ start: m.index, end: m.index + m[1].length, type: 'key', text: m[1] })
    }

    // Values
    const valRe = new RegExp(valueRegex.source, 'g')
    while ((m = valRe.exec(line)) !== null) {
      const val = m[1]
      const valStart = m.index + m[0].indexOf(val)
      let valType: 'string' | 'number' | 'boolean' | 'null' = 'string'
      if (val === 'true' || val === 'false') valType = 'boolean'
      else if (val === 'null') valType = 'null'
      else if (/^\d/.test(val)) valType = 'number'
      // Only add if not overlapping with a key
      if (!allMatches.some((am) => valStart >= am.start && valStart < am.end)) {
        allMatches.push({ start: valStart, end: valStart + val.length, type: valType, text: val })
      }
    }

    allMatches.sort((a, b) => a.start - b.start)

    for (const match of allMatches) {
      // Add text before this match
      if (match.start > lastIdx) {
        parts.push(line.slice(lastIdx, match.start))
      }

      parts.push(
        <span className={TOKEN_CLASS[match.type]} key={`${li}-${match.start}`}>
          {match.text}
        </span>,
      )
      lastIdx = match.end
    }

    // Remaining text
    if (lastIdx < line.length) {
      parts.push(line.slice(lastIdx))
    }

    nodes.push(
      <div className="seo-schema__code-line" key={`line-${li}`}>
        {parts.length > 0 ? parts : ' '}
      </div>,
    )
  }

  return nodes
}

// ---------------------------------------------------------------------------
// Toast sub-component
// ---------------------------------------------------------------------------

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className="seo-schema__toast" role="status">
      <Banner type="success">{message}</Banner>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preview card (both modes)
// ---------------------------------------------------------------------------

function SchemaPreviewCard({
  jsonString,
  scriptTag,
  badge,
  onCopy,
}: SchemaPreviewProps & { onCopy: (text: string, label: string) => void }) {
  const t = useDashboardT()
  const highlighted = useMemo(() => syntaxHighlight(jsonString), [jsonString])
  return (
    <Card
      actions={badge}
      footer={
        <>
          <Button buttonStyle="primary" onClick={() => onCopy(jsonString, 'JSON-LD')} type="button">
            {t.schemaBuilder.copyJsonLd}
          </Button>
          <Button buttonStyle="secondary" onClick={() => onCopy(scriptTag, 'Script tag')} type="button">
            {t.schemaBuilder.copyScriptTag}
          </Button>
        </>
      }
      title={t.schemaBuilder.jsonLdPreview}
    >
      <div
        aria-label={t.schemaBuilder.jsonLdPreview}
        className="seo-inset seo-mono seo-schema__code"
        role="region"
        tabIndex={0}
      >
        {highlighted}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main SchemaBuilderView component
// ---------------------------------------------------------------------------

export function SchemaBuilderView() {
  const t = useDashboardT()
  // One base id per mount; every generated field id hangs off it, so two mounts
  // of this view never collide.
  const uid = useId()

  const [mode, setMode] = useState<'manual' | 'page'>('manual')
  const [selectedType, setSelectedType] = useState<string>('LocalBusiness')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [values, setValues] = useState<Record<string, any>>({})
  const [toast, setToast] = useState<string | null>(null)

  const schemaTypes = useMemo(() => getSchemaTypes(t), [t])
  const def = schemaTypes[selectedType]

  // Reset values when type changes
  const handleTypeChange = useCallback((type: string) => {
    setSelectedType(type)
    setValues({})
  }, [])

  // Update a single field value
  const updateField = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  // Update an array field item
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateArrayItem = useCallback((arrayName: string, index: number, fieldName: string, value: any) => {
    setValues((prev) => {
      const arr = [...(prev[arrayName] || [])]
      if (!arr[index]) arr[index] = {}
      arr[index] = { ...arr[index], [fieldName]: value }
      return { ...prev, [arrayName]: arr }
    })
  }, [])

  const addArrayItem = useCallback((arrayName: string) => {
    setValues((prev) => ({
      ...prev,
      [arrayName]: [...(prev[arrayName] || []), {}],
    }))
  }, [])

  const removeArrayItem = useCallback((arrayName: string, index: number) => {
    setValues((prev) => ({
      ...prev,
      [arrayName]: (prev[arrayName] || []).filter((_: unknown, i: number) => i !== index),
    }))
  }, [])

  // Build JSON-LD
  const jsonLd = useMemo(() => buildJsonLd(selectedType, values), [selectedType, values])
  const jsonString = useMemo(() => JSON.stringify(jsonLd, null, 2), [jsonLd])
  // An FAQPage with no question and answer has an empty mainEntity, which Google rejects.
  const faqEmpty = selectedType === 'FAQ' && (jsonLd.mainEntity as unknown[]).length === 0
  const scriptTag = useMemo(
    () => `<script type="application/ld+json">\n${jsonString}\n</script>`,
    [jsonString],
  )

  // Copy helpers
  const copyToClipboard = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setToast(`${label} ${t.schemaBuilder.copied}`)
      } catch {
        setToast(t.schemaBuilder.copyError)
      }
    },
    [t],
  )

  // The preview card, shared by both modes: highlighted JSON-LD plus the copy buttons.
  const renderPreview = (props: SchemaPreviewProps) => (
    <SchemaPreviewCard {...props} onCopy={copyToClipboard} />
  )

  // Render a single field
  const renderField = (field: SchemaField, parentArray?: string, arrayIndex?: number) => {
    const fieldKey = parentArray ? `${parentArray}.${arrayIndex}.${field.name}` : field.name

    if (field.type === 'array') {
      const items = (values[field.name] || []) as Array<Record<string, unknown>>
      return (
        <div className="seo-field" key={fieldKey}>
          <span className="seo-field__label">
            {field.label}
            {field.required && <span className="seo-text--danger"> *</span>}
          </span>
          {items.map((item, idx) => (
            <Card
              actions={
                <Button buttonStyle="destructive" onClick={() => removeArrayItem(field.name, idx)} type="button">
                  {t.common.delete}
                </Button>
              }
              key={`${fieldKey}-${idx}`}
              muted
              title={`#${idx + 1}`}
            >
              {(field.subFields || []).map((subField) => (
                <Field
                  key={`${fieldKey}-${idx}-${subField.name}`}
                  label={
                    <>
                      {subField.label}
                      {subField.required && <span className="seo-text--danger"> *</span>}
                    </>
                  }
                >
                  {subField.type === 'textarea' ? (
                    <textarea
                      className="seo-textarea"
                      id={`${uid}-${fieldKey}-${idx}-${subField.name}`}
                      onChange={(e) => updateArrayItem(field.name, idx, subField.name, e.target.value)}
                      placeholder={subField.placeholder}
                      rows={3}
                      value={(item[subField.name] as string) || ''}
                    />
                  ) : (
                    <input
                      className="seo-input"
                      id={`${uid}-${fieldKey}-${idx}-${subField.name}`}
                      onChange={(e) => updateArrayItem(field.name, idx, subField.name, e.target.value)}
                      placeholder={subField.placeholder}
                      type={subField.type === 'number' ? 'number' : 'text'}
                      value={(item[subField.name] as string) || ''}
                    />
                  )}
                </Field>
              ))}
            </Card>
          ))}
          <Button
            buttonStyle="secondary"
            className="seo-schema__add"
            icon={<PlusIcon />}
            onClick={() => addArrayItem(field.name)}
            type="button"
          >
            {t.schemaBuilder.addButton}
          </Button>
        </div>
      )
    }

    // Get current value
    const currentValue = parentArray
      ? ((values[parentArray] || [])[arrayIndex!] || {})[field.name] || ''
      : values[field.name] || ''

    const onChangeHandler = parentArray
      ? (val: string) => updateArrayItem(parentArray, arrayIndex!, field.name, val)
      : (val: string) => updateField(field.name, val)

    return (
      <Field
        key={fieldKey}
        label={
          <>
              {field.label}
              {field.required && <span className="seo-text--danger"> *</span>}
          </>
        }
      >
        {field.type === 'textarea' ? (
          <textarea
            className="seo-textarea"
            id={`${uid}-${fieldKey}`}
            onChange={(e) => onChangeHandler(e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            value={currentValue}
          />
        ) : field.type === 'select' ? (
          <select
            className="seo-select"
            id={`${uid}-${fieldKey}`}
            onChange={(e) => onChangeHandler(e.target.value)}
            value={currentValue}
          >
            <option value="">{t.schemaBuilder.choose}</option>
            {(field.options || []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : field.type === 'datetime' ? (
          <input
            className="seo-input"
            id={`${uid}-${fieldKey}`}
            onChange={(e) => onChangeHandler(e.target.value)}
            type="datetime-local"
            value={currentValue}
          />
        ) : (
          <input
            className="seo-input"
            id={`${uid}-${fieldKey}`}
            onChange={(e) => onChangeHandler(e.target.value)}
            placeholder={field.placeholder}
            step={field.type === 'number' ? 'any' : undefined}
            type={field.type === 'number' ? 'number' : 'text'}
            value={currentValue}
          />
        )}
      </Field>
    )
  }

  return (
    <>
      <ViewHeader description={t.schemaBuilder.visualGeneratorDesc} title="Schema.org Builder" />
      <ViewBody>
        {/* Input mode: the manual builder (default) or the JSON-LD generated for a real page.
            Payload's Tabs takes no aria-label, so the group carries it (see #34). */}
        <div aria-label={t.schemaBuilder.modeLabel} role="group">
          <Tabs
            onChange={(value: string) => setMode(value === 'page' ? 'page' : 'manual')}
            tabs={[
              { label: t.schemaBuilder.manualMode, value: 'manual' },
              { label: t.schemaBuilder.pageMode, value: 'page' },
            ]}
            value={mode}
          />
        </div>

        {mode === 'page' ? (
          <SchemaFromPage renderPreview={renderPreview} />
        ) : (
          <>
          {/* Schema type selector */}
          <Tabs
            onChange={handleTypeChange}
            tabs={Object.entries(schemaTypes).map(([key, typeDef]) => ({ label: typeDef.label, value: key }))}
            value={selectedType}
          />

          {/* Main content: Form + Preview */}
          <div className="seo-schema__layout">
            {/* Left: Form */}
            <Card actions={<TonePill tone="neutral">{def.jsonType}</TonePill>} title={def.label}>
              {def.fields.map((field) => renderField(field))}
            </Card>

            {/* Right: Preview */}
            <div className="seo-schema__preview">
              {renderPreview({
                jsonString,
                scriptTag,
                badge: <TonePill tone="success">{t.schemaBuilder.liveUpdate}</TonePill>,
              })}

              {faqEmpty && <Banner type="warning">{t.schemaBuilder.faqNeedsAnswer}</Banner>}

              {/* Validation hint */}
              <Banner type="default">
                <strong>{t.schemaBuilder.tip}</strong> {t.schemaBuilder.validateOnRichResults}{' '}
                <strong>search.google.com/test/rich-results</strong> {t.schemaBuilder.beforeDeploying}
              </Banner>
            </div>
          </div>
          </>
        )}

        {/* Toast notification */}
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </ViewBody>
    </>
  )
}
