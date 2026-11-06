'use client'

import {
  Banner,
  Button,
  Collapsible,
  Pill,
  Tabs,
  toast,
  useConfig,
  useDocumentInfo,
  useListDrawer,
} from '@payloadcms/ui'
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { PlatformId } from '../constants.js'
import type {
  PlatformCapabilities,
  PreviewResult,
  PublishedRef,
  SocialDraft,
  SocialDraftMedia,
  ValidationResult,
} from '../types/index.js'

import { PLATFORM_IDS, PLATFORM_LABELS } from '../constants.js'
import { resolveSocialsEndpointBase } from './accessModel.js'
import { fetchSocialPublish } from './fetchSocialPublish.js'
import {
  acceptedMediaTypes,
  buildInitialComposerState,
  compileComposerInput,
  type ComposerState,
  filterMediaBySearch,
  filterTemplatesForContext,
  formatLocalDateTimeMin,
  getEffectiveAssets,
  mediaToggleLabel,
  mergeDraftMedia,
  normalizeSelectedUploadMedia,
  pickDefaultTemplate,
  pruneSelectedMedia,
  reorderSelectedMedia,
  resolveMediaLibraryOptions,
  shouldFetchEnvelope,
  supportsMultipleMedia,
} from './socialComposerModel.js'
import {
  asRecord,
  type ComposerDestination,
  destinationPath,
  inferMediaFormat,
  platformFormats,
} from './socialComposerViewModel.js'
import { VideoPreviewPane, VideoTile } from './SocialMediaPreview.js'
import { StandaloneSocialComposer } from './StandaloneSocialComposer.js'
import { Card, Check, cx, Field, Fieldset, LoadingState, PILL_STYLE, type Tone } from './ui/index.js'
import { useSocialsAccess } from './useSocialsAccess.js'
import './ui/styles.css'
import './socials.css'

type Props =
  | {
      mode: 'standalone'
      sourceKind?: never
    }
  | {
      mode?: 'source'
      sourceKind?: string
    }
type Destination = ComposerDestination
type HistoryRow = {
  externalUrl?: string
  id: number | string
  publishedAt?: string
  scheduledAt?: null | string
  status?: string
}
type ResolvedTemplate = {
  appliesTo: PlatformId[]
  description?: string
  id: number | string
  isDefault?: boolean
  name: string
  resolved: {
    facebookMessage?: string
    gbpSummary?: string
    instagramCaption?: string
    pinterestAltText?: string
    pinterestDescription?: string
    pinterestHashtags?: string[]
    pinterestTitle?: string
  }
  sourceKind?: string
}
/** Pill tone for a history row's status. */
const historyStatusTone = (status: string | undefined): Tone =>
  status === 'published' ? 'success' : status === 'queued' ? 'warning' : 'neutral'

type PreviewEnvelope = {
  capabilities: PlatformCapabilities
  draft: SocialDraft
  error?: string
  preview: PreviewResult
}

// ===========================================================================
// Source-mode composer (existing behavior, overhauled)
// ===========================================================================

const SourceComposerAuthorized: React.FC<{ sourceKind: string }> = ({ sourceKind }) => {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const uid = useId()

  // Payload serializes plugin client configuration under admin.custom.
  const socials = asRecord(asRecord(config.admin?.custom)?.socials)

  const enabledPlatforms = Array.isArray(socials?.enabledPlatforms)
    ? socials.enabledPlatforms.filter(
        (value): value is PlatformId =>
          typeof value === 'string' && PLATFORM_IDS.includes(value as PlatformId),
      )
    : []
  const [platform, setPlatform] = useState<PlatformId>(enabledPlatforms[0] ?? 'pinterest')
  const [envelopes, setEnvelopes] = useState<Partial<Record<PlatformId, PreviewEnvelope>>>({})
  const envelopesRef = useRef(envelopes)
  const [states, setStates] = useState<Partial<Record<PlatformId, ComposerState>>>({})
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [templates, setTemplates] = useState<ResolvedTemplate[]>([])
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  // Platforms whose default template has already been auto-applied. Kept in a
  // ref so re-applying does not fight an operator who switched back to
  // "Platform defaults": the default is offered once per platform, not on every
  // render where no template is selected.
  const autoAppliedRef = useRef<Set<PlatformId>>(new Set())
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [scheduledAt, setScheduledAt] = useState('')
  const [validation, setValidation] = useState<ValidationResult>()
  const [publishedRef, setPublishedRef] = useState<PublishedRef>()
  const [loading, setLoading] = useState(false)
  // Two-step delete/cancel/mark-deleted confirm: stores the post id that is armed.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | string>()
  const [deletingId, setDeletingId] = useState<number | string>()
  // The media pool is shared while selection and ordering remain per platform.
  const [extraMedia, setExtraMedia] = useState<SocialDraftMedia[]>([])
  const [mediaSearch, setMediaSearch] = useState('')

  const mediaLibrary = resolveMediaLibraryOptions(socials)
  const [ListDrawer, , { closeDrawer, openDrawer }] = useListDrawer({
    collectionSlugs: mediaLibrary.collectionSlugs as never,
    filterOptions: mediaLibrary.filterOptions as never,
    uploads: true,
  })

  // URL input state
  const [urlInput, setUrlInput] = useState('')
  const [urlTypeOverride, setUrlTypeOverride] = useState<'image' | 'video'>('image')
  const [dragFrom, setDragFrom] = useState<null | number>(null)

  const apiRoute = typeof config.routes?.api === 'string' ? config.routes.api : '/api'
  const basePath = typeof socials?.apiBasePath === 'string' ? socials.apiBasePath : '/socials'
  const endpointBase = `${apiRoute.replace(/\/$/, '')}${basePath}`
  const sourceBase = useMemo(
    () =>
      `${endpointBase}/${platform}/${encodeURIComponent(sourceKind)}/${encodeURIComponent(String(id ?? ''))}`,
    [endpointBase, id, platform, sourceKind],
  )
  const envelope = envelopes[platform]
  const state = states[platform]
  // Resolver and operator media remain separate so cached previews are immutable.
  const mergedDraft = useMemo(
    () =>
      envelope
        ? { ...envelope.draft, media: mergeDraftMedia(envelope.draft.media, extraMedia) }
        : undefined,
    [envelope, extraMedia],
  )
  const input = useMemo(
    () => (state && mergedDraft ? compileComposerInput(platform, state, mergedDraft) : undefined),
    [mergedDraft, platform, state],
  )

  useEffect(() => {
    envelopesRef.current = envelopes
  }, [envelopes])

  const updateState = useCallback(
    (patch: Partial<ComposerState>): void => {
      setStates((current) => {
        const existing = current[platform]
        return existing ? { ...current, [platform]: { ...existing, ...patch } } : current
      })
    },
    [platform],
  )

  // Format change handler: prune invalid media and toast
  const handleFormatChange = useCallback(
    (newFormat: string): void => {
      setStates((current) => {
        const existing = current[platform]
        if (!existing) {
          return current
        }
        const draft = envelopes[platform]?.draft
        if (!draft) {
          return { ...current, [platform]: { ...existing, format: newFormat } }
        }
        const { pruned, removed } = pruneSelectedMedia(
          existing.selectedMedia,
          mergeDraftMedia(draft.media, extraMedia),
          platform,
          newFormat,
        )
        if (removed.length > 0) {
          toast.info(
            `${removed.length} media item${removed.length > 1 ? 's' : ''} removed (not available for this format)`,
          )
        }
        return {
          ...current,
          [platform]: { ...existing, format: newFormat, selectedMedia: pruned },
        }
      })
    },
    [envelopes, extraMedia, platform],
  )

  const loadHistory = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const historyResponse = await fetch(`${sourceBase}/history`, { signal })
        const historyBody = (await historyResponse.json()) as {
          error?: string
          posts?: HistoryRow[]
        }
        if (!historyResponse.ok) {
          throw new Error(historyBody.error ?? 'History failed')
        }
        setHistory(historyBody.posts ?? [])
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          toast.error(caught instanceof Error ? caught.message : String(caught))
        }
      }
    },
    [sourceBase],
  )

  // Cache previews per platform so tab switches preserve operator state.
  useEffect(() => {
    if (!id) {
      return
    }
    if (!shouldFetchEnvelope(envelopesRef.current, platform)) {
      return
    }
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const [previewResponse, historyResponse] = await Promise.all([
          fetch(`${sourceBase}/preview`, { signal: controller.signal }),
          fetch(`${sourceBase}/history`, { signal: controller.signal }),
        ])
        const previewBody = (await previewResponse.json()) as PreviewEnvelope
        const historyBody = (await historyResponse.json()) as {
          error?: string
          posts?: HistoryRow[]
        }
        if (!previewResponse.ok) {
          throw new Error(previewBody.error ?? 'Preview failed')
        }
        if (!historyResponse.ok) {
          throw new Error(historyBody.error ?? 'History failed')
        }
        setEnvelopes((current) => ({ ...current, [platform]: previewBody }))
        setStates((current) =>
          current[platform]
            ? current
            : { ...current, [platform]: buildInitialComposerState(platform, previewBody) },
        )
        setHistory(historyBody.posts ?? [])
      } catch (caught) {
        if (!controller.signal.aborted) {
          toast.error(caught instanceof Error ? caught.message : String(caught))
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [id, platform, sourceBase])

  useEffect(() => {
    if (!id) {
      return
    }
    const controller = new AbortController()
    void fetch(
      `${endpointBase}/templates/${encodeURIComponent(sourceKind)}/${encodeURIComponent(String(id))}`,
      {
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const body = (await response.json()) as { templates?: ResolvedTemplate[] }
        if (response.ok) {
          setTemplates(body.templates ?? [])
          setTemplatesLoaded(true)
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [endpointBase, id, sourceKind])

  useEffect(() => {
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`${endpointBase}${destinationPath[platform]}`, {
          signal: controller.signal,
        })
        const body = (await response.json()) as Record<string, unknown>
        if (!response.ok) {
          throw new Error(
            typeof body.error === 'string' ? body.error : 'Destination discovery failed',
          )
        }
        const values =
          platform === 'pinterest'
            ? body.boards
            : platform === 'facebook'
              ? body.pages
              : platform === 'instagram'
                ? body.accounts
                : body.locations
        const rows = Array.isArray(values)
          ? values.map(asRecord).filter((row): row is Record<string, unknown> => row !== undefined)
          : []
        const next = rows.flatMap((row) => {
          const idValue =
            platform === 'instagram' ? row.igUserId : platform === 'gbp' ? row.resourceName : row.id
          if (typeof idValue !== 'string') {
            return []
          }
          const label =
            [row.name, row.pageName, row.title, row.storeCode].find(
              (value): value is string => typeof value === 'string',
            ) ?? idValue
          return [{ id: idValue, label }]
        })
        setDestinations(next)
        if (next.length === 1) {
          setStates((current) => {
            const existing = current[platform]
            if (!existing || existing.destinationId) {
              return current
            }
            return { ...current, [platform]: { ...existing, destinationId: next[0].id } }
          })
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setDestinations([])
          toast.error(caught instanceof Error ? caught.message : String(caught))
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [endpointBase, platform])

  useEffect(() => {
    if (!input) {
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void fetch(`${sourceBase}/validate`, {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as { validation?: ValidationResult }
          if (response.ok) {
            setValidation(body.validation)
          }
        })
        .catch(() => undefined)
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [input, sourceBase])

  const applyTemplate = useCallback(
    (templateId: string): void => {
      setSelectedTemplateId(templateId)
      const template = templates.find((candidate) => String(candidate.id) === templateId)
      if (!template) {
        return
      }
      const resolved = template.resolved
      if (platform === 'pinterest') {
        const tags = resolved.pinterestHashtags?.join(' ')
        updateState({
          altText: resolved.pinterestAltText ?? state?.altText,
          copy: [resolved.pinterestDescription, tags].filter(Boolean).join('\n\n') || state?.copy,
          title: resolved.pinterestTitle ?? state?.title,
        })
      } else if (platform === 'instagram' && resolved.instagramCaption) {
        updateState({ copy: resolved.instagramCaption })
      } else if (platform === 'facebook' && resolved.facebookMessage) {
        updateState({ copy: resolved.facebookMessage })
      } else if (platform === 'gbp' && resolved.gbpSummary) {
        updateState({ copy: resolved.gbpSummary })
      }
    },
    [platform, state?.altText, state?.copy, state?.title, templates, updateState],
  )

  // Auto-apply the default template for a platform the first time its composer
  // state is ready. Runs once per platform (autoAppliedRef guard) so switching
  // back to "Platform defaults" is not immediately overridden.
  useEffect(() => {
    if (!templatesLoaded) {
      return
    }
    if (!states[platform]) {
      return
    }
    if (autoAppliedRef.current.has(platform)) {
      return
    }
    autoAppliedRef.current.add(platform)
    const preferred = pickDefaultTemplate(
      filterTemplatesForContext(templates, sourceKind, platform),
    )
    if (preferred) {
      applyTemplate(String(preferred.id))
    }
  }, [applyTemplate, platform, sourceKind, states, templates, templatesLoaded])

  const toggleMedia = (url: string): void => {
    if (!state) {
      return
    }
    if (!supportsMultipleMedia(platform, state.format)) {
      updateState({ selectedMedia: [url] })
      return
    }
    const selected = state.selectedMedia.includes(url)
      ? state.selectedMedia.filter((value) => value !== url)
      : [...state.selectedMedia, url]
    updateState({ selectedMedia: selected })
  }

  // Payload's ListDrawer does not close itself after selection.
  const handleLibrarySelect = useCallback(
    async (doc: { collectionSlug: string; docID: string }) => {
      closeDrawer()
      try {
        const response = await fetch(`${apiRoute}/${doc.collectionSlug}/${doc.docID}`)
        if (!response.ok) {
          toast.error('Failed to load media document')
          return
        }
        const mediaDoc = (await response.json()) as Record<string, unknown>
        const newAsset = normalizeSelectedUploadMedia(mediaDoc, {
          apiRoute,
          collectionSlug: doc.collectionSlug,
          origin: window.location.origin,
        })
        if (!newAsset) {
          toast.error('Selected media has no usable file URL')
          return
        }
        setExtraMedia((current) => mergeDraftMedia(current, [newAsset]))
        toast.success('Media added from library')
      } catch {
        toast.error('Failed to load media from library')
      }
    },
    [apiRoute, closeDrawer],
  )

  const handleAddByUrl = useCallback(() => {
    if (!urlInput.trim()) {
      return
    }
    const url = urlInput.trim()
    const newAsset: SocialDraftMedia = {
      type: urlTypeOverride,
      format: inferMediaFormat(url),
      url: url.startsWith('/') ? `${window.location.origin}${url}` : url,
    }
    setExtraMedia((current) => mergeDraftMedia(current, [newAsset]))
    setUrlInput('')
    toast.success('Media added by URL')
  }, [urlInput, urlTypeOverride])

  const publish = async (): Promise<void> => {
    if (!input) {
      return
    }
    if (validation && !validation.ok) {
      toast.error('Resolve the validation errors before publishing.')
      return
    }
    setLoading(true)
    setPublishedRef(undefined)
    try {
      const body = { ...input }
      if (scheduledAt) {
        body.scheduledAt = new Date(scheduledAt).toISOString()
      }
      const response = await fetchSocialPublish(
        `${sourceBase}/publish`,
        {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
        { endpointBase },
      )
      const result = (await response.json()) as {
        error?: string
        publishedRef?: PublishedRef
        scheduled?: boolean
      }
      if (!response.ok) {
        throw new Error(result.error ?? `Publish failed (${response.status})`)
      }
      const ref = result.publishedRef ?? { externalId: '', meta: { scheduled: true }, platform }
      setPublishedRef(ref)
      toast.success(ref.meta?.scheduled ? 'Scheduled successfully.' : 'Published successfully.')
      // Refresh the history list after a successful publish.
      await loadHistory()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  /**
   * Normal delete: calls the platform adapter upstream and soft-deletes the row.
   * Not used for Instagram (see markDeletedPost below).
   */
  const deletePost = async (postId: number | string): Promise<void> => {
    setDeletingId(postId)
    setConfirmingDeleteId(undefined)
    try {
      const response = await fetch(`${endpointBase}/posts/${encodeURIComponent(String(postId))}`, {
        method: 'DELETE',
      })
      const result = (await response.json()) as { error?: string; ok?: boolean }
      if (!response.ok) {
        throw new Error(result.error ?? `Delete failed (${response.status})`)
      }
      toast.success('Post deleted.')
      await loadHistory()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setDeletingId(undefined)
    }
  }

  /** Cancel a queued row without an upstream mutation. */
  const cancelPost = async (postId: number | string): Promise<void> => {
    setDeletingId(postId)
    setConfirmingDeleteId(undefined)
    try {
      const response = await fetch(`${endpointBase}/posts/${encodeURIComponent(String(postId))}`, {
        method: 'DELETE',
      })
      const result = (await response.json()) as { error?: string; ok?: boolean; status?: string }
      if (!response.ok) {
        throw new Error(result.error ?? `Cancel failed (${response.status})`)
      }
      toast.success('Scheduled post cancelled.')
      await loadHistory()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setDeletingId(undefined)
    }
  }

  /**
   * Instagram reconcile path: skips the upstream API entirely and marks the row
   * deleted locally (deletedLocalOnly: true). Use this after manually deleting
   * the post in the Instagram app so the local ledger stays in sync.
   */
  const markDeletedPost = async (postId: number | string): Promise<void> => {
    setDeletingId(postId)
    setConfirmingDeleteId(undefined)
    try {
      const response = await fetch(
        `${endpointBase}/posts/${encodeURIComponent(String(postId))}?localOnly=true`,
        { method: 'DELETE' },
      )
      const result = (await response.json()) as { error?: string; ok?: boolean }
      if (!response.ok) {
        throw new Error(result.error ?? `Mark-deleted failed (${response.status})`)
      }
      toast.success('Post marked as deleted locally.')
      await loadHistory()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setDeletingId(undefined)
    }
  }

  if (!id) {
    return <Banner type="default">Save this document before publishing to socials.</Banner>
  }
  if (!state || !envelope || !mergedDraft) {
    return (
      <Card aria-busy>
        <LoadingState label="Loading social composer…" />
      </Card>
    )
  }

  const filteredTemplates = filterTemplatesForContext(templates, sourceKind, platform)
  const assets = mergedDraft.media
  const accepted = acceptedMediaTypes(platform, state.format)
  const isMultiMedia = supportsMultipleMedia(platform, state.format)
  const moveSelected = (from: number, to: number): void => {
    updateState({ selectedMedia: reorderSelectedMedia(state.selectedMedia, from, to) })
  }
  // In multi mode the grid lists selected assets first (in publish order) so the
  // 1-based badges read contiguously and drag/arrow moves feel natural.
  const orderedAssets = isMultiMedia
    ? [
        ...state.selectedMedia.flatMap((url) => {
          const found = assets.find((asset) => asset.url === url)
          return found ? [found] : []
        }),
        ...assets.filter((asset) => !state.selectedMedia.includes(asset.url)),
      ]
    : assets
  const visibleAssets = filterMediaBySearch(orderedAssets, mediaSearch)
  const previewAsset = getEffectiveAssets(platform, state, mergedDraft)[0]
  const mediaRequired =
    state.format !== 'LINK' && state.format !== 'STANDARD' && state.format !== 'ALERT'
  const copyLimit = envelope.capabilities.limits.captionMaxChars

  // Whether the active platform uses the localOnly reconcile path instead of a
  // live upstream delete. Instagram posts cannot be removed via the API.
  const isInstagram = platform === 'instagram'

  // datetime-local values must use local fields rather than an ISO UTC wall clock.
  const scheduleMin = formatLocalDateTimeMin(new Date())

  const errorIssues = validation?.issues.filter((issue) => issue.severity === 'error') ?? []

  return (
    <Card
      actions={
        // Payload's Tabs takes no aria-label, so the group carries it (see #34).
        <div aria-label="Social platform" role="group">
          <Tabs<PlatformId>
            onChange={(idValue) => {
              setPlatform(idValue)
              setSelectedTemplateId('')
            }}
            tabs={enabledPlatforms.map((idValue) => ({
              id: `${uid}-tab-${idValue}`,
              label: PLATFORM_LABELS[idValue],
              panelID: `${uid}-panel`,
              value: idValue,
            }))}
            value={platform}
          />
        </div>
      }
      description="Compose, validate, preview, and publish without leaving this document."
      headingLevel="h2"
      title="Social composer"
    >
      <div className="socials-composer__layout">
        <div
          aria-labelledby={`${uid}-tab-${platform}`}
          className="socials-stack"
          id={`${uid}-panel`}
          role="tabpanel"
        >
          <Field label="Template">
            <select
              className="socials-select"
              onChange={(event) => applyTemplate(event.target.value)}
              value={selectedTemplateId}
            >
              <option value="">Platform defaults</option>
              {filteredTemplates.map((template) => (
                <option key={template.id} value={String(template.id)}>
                  {template.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="socials-pair">
            <Field label="Destination">
              <select
                className="socials-select"
                onChange={(event) => updateState({ destinationId: event.target.value })}
                required
                value={state.destinationId}
              >
                <option value="">Select a destination…</option>
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Format">
              <select
                className="socials-select"
                onChange={(event) => handleFormatChange(event.target.value)}
                value={state.format}
              >
                {platformFormats[platform].map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {platform === 'pinterest' && (
            <Field label="Pin title">
              <input
                aria-label="Pin title"
                className="socials-input"
                maxLength={100}
                onChange={(event) => updateState({ title: event.target.value })}
                value={state.title}
              />
            </Field>
          )}

          {(platform === 'instagram' || platform === 'facebook') && (
            <Field
              description="Instagram and Facebook have no separate title field; this becomes the first line of the caption/message."
              label="Title (first line)"
            >
              <input
                aria-label="Title (first line)"
                className="socials-input"
                onChange={(event) => updateState({ title: event.target.value })}
                placeholder="Optional. Becomes the first line of the caption/message."
                value={state.title}
              />
            </Field>
          )}

          <Field
            description={`${state.copy.length}${copyLimit ? ` / ${copyLimit}` : ''} characters`}
            descriptionTone={copyLimit && state.copy.length > copyLimit ? 'danger' : undefined}
            label={
              platform === 'gbp'
                ? 'Summary'
                : platform === 'instagram'
                  ? 'Caption'
                  : platform === 'facebook'
                    ? 'Message'
                    : 'Description'
            }
          >
            <textarea
              aria-label="Post copy"
              className="socials-textarea"
              onChange={(event) => updateState({ copy: event.target.value })}
              rows={7}
              value={state.copy}
            />
          </Field>

          {(platform === 'pinterest' || (platform === 'facebook' && state.format === 'LINK')) && (
            <Field label="Outbound link">
              <input
                aria-label="Outbound link"
                className="socials-input"
                onChange={(event) => updateState({ link: event.target.value })}
                type="url"
                value={state.link}
              />
            </Field>
          )}
          {((platform === 'pinterest' && state.format === 'IMAGE') ||
            (platform === 'instagram' && state.format === 'IMAGE') ||
            (platform === 'facebook' && state.format === 'PHOTO')) && (
            <Field label="Accessibility text">
              <textarea
                aria-label="Accessibility text"
                className="socials-textarea"
                onChange={(event) => updateState({ altText: event.target.value })}
                rows={3}
                value={state.altText}
              />
            </Field>
          )}
          {platform === 'facebook' && state.format === 'VIDEO' && (
            <Field label="Video title">
              <input
                aria-label="Video title"
                className="socials-input"
                onChange={(event) => updateState({ videoTitle: event.target.value })}
                value={state.videoTitle}
              />
            </Field>
          )}
          {platform === 'instagram' && state.format === 'REELS' && (
            <Check
              aria-label="Also share Reel to Feed"
              checked={state.shareToFeed}
              label="Also share Reel to Feed"
              onChange={(event) => updateState({ shareToFeed: event.target.checked })}
            />
          )}

          {platform === 'gbp' && (
            <>
              <div className="socials-pair">
                <Field label="CTA">
                  <select
                    className="socials-select"
                    onChange={(event) =>
                      updateState({
                        callToAction: event.target.value as ComposerState['callToAction'],
                      })
                    }
                    value={state.callToAction}
                  >
                    <option value="">No button</option>
                    {['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'].map((value) => (
                      <option key={value} value={value}>
                        {value.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </Field>
                {state.callToAction !== 'CALL' && (
                  <Field label={state.format === 'OFFER' ? 'Redeem URL' : 'CTA URL'}>
                    <input
                      aria-label={state.format === 'OFFER' ? 'Redeem URL' : 'CTA URL'}
                      className="socials-input"
                      onChange={(event) => updateState({ callToActionUrl: event.target.value })}
                      type="url"
                      value={state.callToActionUrl}
                    />
                  </Field>
                )}
              </div>
              {(state.format === 'EVENT' || state.format === 'OFFER') && (
                <>
                  <Field label="Event title">
                    <input
                      aria-label="Event title"
                      className="socials-input"
                      onChange={(event) => updateState({ eventTitle: event.target.value })}
                      value={state.eventTitle}
                    />
                  </Field>
                  <div className="socials-pair">
                    <Field label="Starts">
                      <input
                        aria-label="Event starts"
                        className="socials-input"
                        onChange={(event) => updateState({ eventStart: event.target.value })}
                        type="datetime-local"
                        value={state.eventStart}
                      />
                    </Field>
                    <Field label="Ends">
                      <input
                        aria-label="Event ends"
                        className="socials-input"
                        onChange={(event) => updateState({ eventEnd: event.target.value })}
                        type="datetime-local"
                        value={state.eventEnd}
                      />
                    </Field>
                  </div>
                </>
              )}
              {state.format === 'OFFER' && (
                <div className="socials-pair">
                  <Field label="Coupon code">
                    <input
                      aria-label="Coupon code"
                      className="socials-input"
                      onChange={(event) => updateState({ offerCode: event.target.value })}
                      value={state.offerCode}
                    />
                  </Field>
                  <Field label="Terms">
                    <textarea
                      aria-label="Offer terms"
                      className="socials-textarea"
                      onChange={(event) => updateState({ offerTerms: event.target.value })}
                      rows={3}
                      value={state.offerTerms}
                    />
                  </Field>
                </div>
              )}
              {state.format === 'ALERT' && (
                <Field label="Alert type">
                  <select
                    className="socials-select"
                    onChange={(event) =>
                      updateState({ alertType: event.target.value as ComposerState['alertType'] })
                    }
                    value={state.alertType}
                  >
                    <option value="">Select…</option>
                    <option value="COVID_19">COVID-19</option>
                  </select>
                </Field>
              )}
              <Field label="Language code (optional)">
                <input
                  aria-label="Language code"
                  className="socials-input"
                  onChange={(event) => updateState({ languageCode: event.target.value })}
                  placeholder="en-US"
                  value={state.languageCode}
                />
              </Field>
            </>
          )}

          {(mediaRequired || assets.length > 0) && (
            <Fieldset
              legend={`Media ${supportsMultipleMedia(platform, state.format) ? '(choose and order 2-10)' : ''}`}
            >
              {assets.length === 0 && (
                <p className="socials-text--secondary">No source media is available.</p>
              )}
              <Field label="Find media">
                <input
                  aria-label="Find media"
                  className="socials-input"
                  onChange={(event) => setMediaSearch(event.target.value)}
                  placeholder="Search media descriptions"
                  type="search"
                  value={mediaSearch}
                />
              </Field>
              <p aria-live="polite" className="socials-text--secondary">
                {`${visibleAssets.length} of ${assets.length} media items, ${state.selectedMedia.length} selected`}
              </p>
              {mediaSearch.trim() && visibleAssets.length === 0 && (
                <p className="socials-text--secondary">
                  No matching media. Clear the search to see everything.
                </p>
              )}
              <div className="socials-media__grid" role="list">
                {visibleAssets.map((asset) => {
                  const orderIndex = state.selectedMedia.indexOf(asset.url)
                  const selected = orderIndex >= 0
                  const isAccepted = accepted.includes(asset.type)
                  const reorderable = isMultiMedia && selected
                  return (
                    // Drag reorder is a progressive enhancement; the per-tile
                    // arrow buttons provide the keyboard/touch-accessible path.
                    <div
                      className={cx(
                        'socials-media__asset',
                        selected && 'socials-media__asset--selected',
                        !isAccepted && 'socials-media__asset--disabled',
                        reorderable && 'socials-media__asset--draggable',
                      )}
                      draggable={reorderable}
                      key={asset.url}
                      onDragEnd={() => setDragFrom(null)}
                      onDragOver={reorderable ? (event) => event.preventDefault() : undefined}
                      onDragStart={
                        reorderable
                          ? (event) => {
                              setDragFrom(orderIndex)
                              event.dataTransfer.effectAllowed = 'move'
                            }
                          : undefined
                      }
                      onDrop={
                        reorderable
                          ? (event) => {
                              event.preventDefault()
                              if (dragFrom !== null) {
                                moveSelected(dragFrom, orderIndex)
                              }
                              setDragFrom(null)
                            }
                          : undefined
                      }
                      role="listitem"
                    >
                      {asset.type === 'image' ? (
                        <img alt={asset.altText ?? ''} loading="lazy" src={asset.url} />
                      ) : (
                        <VideoTile asset={asset} />
                      )}
                      <button
                        aria-label={mediaToggleLabel(asset, selected, isAccepted)}
                        aria-pressed={selected}
                        className="socials-media__toggle"
                        disabled={!isAccepted}
                        onClick={() => isAccepted && toggleMedia(asset.url)}
                        title={isAccepted ? asset.altText : 'Not available for this format'}
                        type="button"
                      />
                      {asset.altText && (
                        <span className="socials-media__caption">{asset.altText}</span>
                      )}
                      {reorderable && (
                        <span className="socials-media__order">{orderIndex + 1}</span>
                      )}
                      {reorderable && (
                        <div className="socials-media__arrows">
                          <button
                            aria-label="Move media earlier"
                            disabled={orderIndex <= 0}
                            onClick={() => moveSelected(orderIndex, orderIndex - 1)}
                            type="button"
                          >
                            ‹
                          </button>
                          <button
                            aria-label="Move media later"
                            disabled={orderIndex >= state.selectedMedia.length - 1}
                            onClick={() => moveSelected(orderIndex, orderIndex + 1)}
                            type="button"
                          >
                            ›
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="socials-row">
                <Button buttonStyle="secondary" margin={false} onClick={openDrawer} size="medium">
                  Media library
                </Button>
                <div className="socials-media__add-url">
                  <input
                    aria-label="Media URL"
                    className="socials-input"
                    onChange={(event) => setUrlInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleAddByUrl()
                      }
                    }}
                    placeholder="https://..."
                    type="url"
                    value={urlInput}
                  />
                  <select
                    aria-label="URL media type"
                    className="socials-select socials-select--inline"
                    onChange={(event) =>
                      setUrlTypeOverride(event.target.value as 'image' | 'video')
                    }
                    value={urlTypeOverride}
                  >
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                  <Button
                    buttonStyle="secondary"
                    disabled={!urlInput.trim()}
                    margin={false}
                    onClick={handleAddByUrl}
                    size="medium"
                  >
                    Add URL
                  </Button>
                </div>
              </div>
            </Fieldset>
          )}

          <Field label="Schedule (optional)">
            <input
              aria-label="Schedule post"
              className="socials-input"
              min={scheduleMin}
              onChange={(event) => setScheduledAt(event.target.value)}
              type="datetime-local"
              value={scheduledAt}
            />
          </Field>

          <div aria-live="polite">
            {validation?.issues.length ? (
              <Banner type={errorIssues.length > 0 ? 'danger' : 'warning'}>
                <ul className="socials-banner-list">
                  {validation.issues.map((issue, index) => (
                    <li
                      data-severity={issue.severity}
                      key={`${issue.field ?? 'general'}-${index}`}
                    >
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </Banner>
            ) : (
              <Banner type="success">Ready to publish</Banner>
            )}
          </div>
          {publishedRef && (
            <Banner type="success">
              {publishedRef.meta?.scheduled ? 'Scheduled successfully.' : 'Published successfully.'}{' '}
              {publishedRef.externalUrl && (
                <a href={publishedRef.externalUrl} rel="noreferrer" target="_blank">
                  View post
                </a>
              )}
            </Banner>
          )}
          <div className="socials-row">
            <Button
              buttonStyle="primary"
              disabled={loading || validation?.ok === false}
              margin={false}
              onClick={() => {
                void publish()
              }}
            >
              {loading ? 'Publishing…' : scheduledAt ? 'Schedule post' : 'Publish now'}
            </Button>
          </div>
        </div>

        <aside aria-label={`${PLATFORM_LABELS[platform]} preview`} className="socials-preview">
          <Pill className="socials-preview__platform" size="small">
            {PLATFORM_LABELS[platform]}
          </Pill>
          {previewAsset?.type === 'image' && <img alt={state.altText} src={previewAsset.url} />}
          {previewAsset?.type === 'video' && (
            <VideoPreviewPane
              asset={previewAsset}
              label={state.altText || 'Selected video preview'}
            />
          )}
          <strong>{state.title || envelope.draft.content.title}</strong>
          <p className="socials-preview__copy">{state.copy}</p>
          {state.link && (platform === 'pinterest' || state.format === 'LINK') && (
            <small className="socials-text--secondary">{state.link}</small>
          )}
          <p className="socials-text--secondary">
            API preview - final rendering may vary by platform and device.
          </p>
        </aside>
      </div>

      {history.length > 0 && (
        <Collapsible
          header={`Recent ${PLATFORM_LABELS[platform]} history (${history.length})`}
          initCollapsed
        >
          <ul className="socials-list">
            {history.slice(0, 5).map((row) => (
              <li className="socials-list__item" key={row.id}>
                <span className="socials-list__main">
                  <span className="socials-row">
                    <Pill pillStyle={PILL_STYLE[historyStatusTone(row.status)]} size="small">
                      {row.status ?? 'unknown'}
                    </Pill>
                    <span className="socials-text--secondary">
                      {row.status === 'queued' && row.scheduledAt
                        ? `scheduled for ${new Date(row.scheduledAt).toLocaleString()}`
                        : row.publishedAt
                          ? new Date(row.publishedAt).toLocaleString()
                          : ''}
                    </span>
                    {row.externalUrl && (
                      <a href={row.externalUrl} rel="noreferrer" target="_blank">
                        open
                      </a>
                    )}
                  </span>
                </span>
                {/* Published rows: delete / mark-deleted action */}
                {row.status === 'published' &&
                  (confirmingDeleteId === row.id ? (
                    <span className="socials-row">
                      <Button
                        buttonStyle="destructive"
                        disabled={deletingId === row.id}
                        margin={false}
                        onClick={() => {
                          if (isInstagram) {
                            void markDeletedPost(row.id)
                          } else {
                            void deletePost(row.id)
                          }
                        }}
                      >
                        {isInstagram ? 'Confirm mark deleted' : 'Confirm delete'}
                      </Button>
                      <Button
                        buttonStyle="ghost"
                        margin={false}
                        onClick={() => setConfirmingDeleteId(undefined)}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button
                      buttonStyle="secondary"
                      disabled={deletingId === row.id}
                      margin={false}
                      onClick={() => setConfirmingDeleteId(row.id)}
                    >
                      {isInstagram ? 'Mark deleted (removed in app)' : 'Delete'}
                    </Button>
                  ))}
                {row.status === 'queued' &&
                  (confirmingDeleteId === row.id ? (
                    <span className="socials-row">
                      <Button
                        buttonStyle="destructive"
                        disabled={deletingId === row.id}
                        margin={false}
                        onClick={() => void cancelPost(row.id)}
                      >
                        Confirm cancel
                      </Button>
                      <Button
                        buttonStyle="ghost"
                        margin={false}
                        onClick={() => setConfirmingDeleteId(undefined)}
                      >
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <Button
                      buttonStyle="secondary"
                      disabled={deletingId === row.id}
                      margin={false}
                      onClick={() => setConfirmingDeleteId(row.id)}
                    >
                      Cancel
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      <ListDrawer onSelect={handleLibrarySelect as never} />
    </Card>
  )
}

/**
 * Visibility gate for the source-mode composer. Probes `{basePath}/access` once
 * and mounts the composer only for a `publisher`. Everyone else gets an empty
 * panel body (the injected Socials tab shows nothing) with no fetches and no
 * toasts. Mounting the authorized composer only when allowed also means its
 * preview/history/destination fetches never fire for an unauthorized user.
 */
const SourceComposer: React.FC<{ sourceKind: string }> = ({ sourceKind }) => {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const { loading, publisher } = useSocialsAccess(resolveSocialsEndpointBase(config))
  if (loading || !publisher) {
    return null
  }
  // Remount per record so selections, search and fetched envelopes never
  // carry over when the admin navigates between documents in place.
  return <SourceComposerAuthorized key={`${sourceKind}:${String(id)}`} sourceKind={sourceKind} />
}

// ===========================================================================
// Entry point
// ===========================================================================

export const SocialPublishPanelClient: React.FC<Props> = ({ mode = 'source', sourceKind }) => {
  if (mode === 'standalone') {
    return <StandaloneSocialComposer />
  }

  const normalizedSourceKind = sourceKind?.trim()
  if (!normalizedSourceKind) {
    return (
      <div role="alert">
        <Banner type="danger">
          <strong>Socials source is not configured.</strong>{' '}
          <span>
            Set <code>{"clientProps: { sourceKind: '<your-kind>' }"}</code> on this admin component.
          </span>
        </Banner>
      </div>
    )
  }

  return <SourceComposer sourceKind={normalizedSourceKind} />
}
