'use client'

import { Banner, Button, toast, useConfig, useListDrawer } from '@payloadcms/ui'
import React, { useCallback, useEffect, useState } from 'react'

import type { PlatformId } from '../constants.js'
import type { SocialDraftMedia } from '../types/index.js'

import { PLATFORM_IDS, PLATFORM_LABELS } from '../constants.js'
import { resolveSocialsEndpointBase } from './accessModel.js'
import { fetchSocialPublish } from './fetchSocialPublish.js'
import { type ComposerDestination, getPlatformDescriptor } from './platforms/index.js'
import {
  buildStandaloneInitialState,
  compileStandalonePublishBody,
  mergeDraftMedia,
  normalizeSelectedUploadMedia,
  parseComposeResponse,
  reorderSelectedMedia,
  resolveMediaLibraryOptions,
  type StandaloneComposerState,
} from './socialComposerModel.js'
import { asRecord, inferMediaFormat } from './socialComposerViewModel.js'
import { VideoTile } from './SocialMediaPreview.js'
import { Card, Check, cx, Field, Fieldset } from './ui/index.js'
import { useSocialsAccess } from './useSocialsAccess.js'
import './ui/styles.css'
import './socials.css'

type Destination = ComposerDestination

const StandaloneComposerAuthorized: React.FC = () => {
  const { config } = useConfig()

  const socials = asRecord(asRecord(config.admin?.custom)?.socials)

  const enabledPlatforms = Array.isArray(socials?.enabledPlatforms)
    ? socials.enabledPlatforms.filter(
        (value): value is PlatformId =>
          typeof value === 'string' && PLATFORM_IDS.includes(value as PlatformId),
      )
    : []
  const apiRoute = typeof config.routes?.api === 'string' ? config.routes.api : '/api'
  const basePath = typeof socials?.apiBasePath === 'string' ? socials.apiBasePath : '/socials'
  const endpointBase = `${apiRoute.replace(/\/$/, '')}${basePath}`

  const [state, setState] = useState<StandaloneComposerState>(() =>
    buildStandaloneInitialState(enabledPlatforms),
  )
  const [perChannelFormat, setPerChannelFormat] = useState<Partial<Record<PlatformId, string>>>({})
  const [destinations, setDestinations] = useState<Partial<Record<PlatformId, Destination[]>>>({})
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<
    Array<{
      error?: string
      ok: boolean
      platform: PlatformId
      publishedRef?: {
        externalId: string
        externalUrl?: string
        meta?: Record<string, unknown>
        platform: PlatformId
      }
    }>
  >([])

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

  // Load destinations for selected channels
  useEffect(() => {
    const controllers: AbortController[] = []
    for (const platform of state.channels) {
      if (destinations[platform]) {
        continue
      }
      const controller = new AbortController()
      controllers.push(controller)
      void (async () => {
        try {
          const descriptor = getPlatformDescriptor(platform)
          const response = await fetch(`${endpointBase}${descriptor.destination.path}`, {
            signal: controller.signal,
          })
          const body = (await response.json()) as Record<string, unknown>
          if (!response.ok) {
            return
          }
          const next = descriptor.destination.parse(body)
          setDestinations((current) => ({ ...current, [platform]: next }))
        } catch {
          // Silently ignore on abort
        }
      })()
    }
    return () => controllers.forEach((c) => c.abort())
  }, [endpointBase, state.channels, destinations])

  const toggleChannel = (platform: PlatformId): void => {
    setState((current) => ({
      ...current,
      channels: current.channels.includes(platform)
        ? current.channels.filter((p) => p !== platform)
        : [...current.channels, platform],
    }))
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
        setState((current) => ({ ...current, media: mergeDraftMedia(current.media, [newAsset]) }))
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
    setState((current) => ({ ...current, media: mergeDraftMedia(current.media, [newAsset]) }))
    setUrlInput('')
    toast.success('Media added by URL')
  }, [urlInput, urlTypeOverride])

  const publish = async (): Promise<void> => {
    if (!state.title.trim()) {
      toast.error('Title is required.')
      return
    }
    if (state.channels.length === 0) {
      toast.error('Select at least one channel.')
      return
    }
    setLoading(true)
    setResults([])
    try {
      const body = compileStandalonePublishBody(state, perChannelFormat)
      const response = await fetchSocialPublish(
        `${endpointBase}/compose/publish`,
        {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
        { endpointBase },
      )
      const rawBody: unknown = await response.json()
      const parsed = parseComposeResponse(response.ok, rawBody)
      if (!parsed.ok) {
        toast.error(parsed.error)
        return
      }
      setResults(parsed.data.results)
      if (parsed.data.anyPublished) {
        toast.success('Published to at least one channel.')
      } else {
        toast.error('All channels failed.')
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  // Media order is the provider order for carousel and multi-photo targets.
  const mediaReorderable = state.channels.some((platform) =>
    getPlatformDescriptor(platform).supportsMultipleMedia(perChannelFormat[platform] ?? ''),
  )
  const moveMedia = (from: number, to: number): void => {
    setState((current) => {
      const urls = current.media.map((asset) => asset.url)
      const reordered = reorderSelectedMedia(urls, from, to)
      if (reordered === urls) {
        return current
      }
      const byUrl = new Map(current.media.map((asset) => [asset.url, asset]))
      return {
        ...current,
        media: reordered.flatMap((url) => {
          const asset = byUrl.get(url)
          return asset ? [asset] : []
        }),
      }
    })
  }

  return (
    <Card
      description="Compose one post from scratch and publish it to multiple channels at once."
      headingLevel="h2"
      title="Standalone composer"
    >
      <Field label="Title *">
        <input
          aria-label="Post title"
          className="socials-input"
          onChange={(event) => setState((s) => ({ ...s, title: event.target.value }))}
          required
          value={state.title}
        />
      </Field>

      <Field label="Body">
        <textarea
          aria-label="Post body"
          className="socials-textarea"
          onChange={(event) => setState((s) => ({ ...s, body: event.target.value }))}
          rows={6}
          value={state.body}
        />
      </Field>

      <Field label="Link (optional)">
        <input
          aria-label="Post link"
          className="socials-input"
          onChange={(event) => setState((s) => ({ ...s, link: event.target.value }))}
          type="url"
          value={state.link}
        />
      </Field>

      <Fieldset legend={`Media ${mediaReorderable ? '(drag to order 2-10)' : ''}`}>
        {state.media.length > 0 && (
          <div className="socials-media__grid" role="list">
            {state.media.map((asset, index) => (
              // Drag reorder is a progressive enhancement; the per-tile arrow
              // buttons provide the keyboard/touch-accessible path.
              <div
                className={cx(
                  'socials-media__asset',
                  'socials-media__asset--selected',
                  mediaReorderable && 'socials-media__asset--draggable',
                )}
                draggable={mediaReorderable}
                key={asset.url}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={mediaReorderable ? (event) => event.preventDefault() : undefined}
                onDragStart={
                  mediaReorderable
                    ? (event) => {
                        setDragFrom(index)
                        event.dataTransfer.effectAllowed = 'move'
                      }
                    : undefined
                }
                onDrop={
                  mediaReorderable
                    ? (event) => {
                        event.preventDefault()
                        if (dragFrom !== null) {
                          moveMedia(dragFrom, index)
                        }
                        setDragFrom(null)
                      }
                    : undefined
                }
                role="listitem"
              >
                {asset.type === 'image' ? (
                  <img alt={asset.altText ?? ''} src={asset.url} />
                ) : (
                  <VideoTile asset={asset} />
                )}
                {mediaReorderable && <span className="socials-media__order">{index + 1}</span>}
                {mediaReorderable && (
                  <div className="socials-media__arrows">
                    <button
                      aria-label="Move media earlier"
                      disabled={index <= 0}
                      onClick={() => moveMedia(index, index - 1)}
                      type="button"
                    >
                      ‹
                    </button>
                    <button
                      aria-label="Move media later"
                      disabled={index >= state.media.length - 1}
                      onClick={() => moveMedia(index, index + 1)}
                      type="button"
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
              onChange={(event) => setUrlTypeOverride(event.target.value as 'image' | 'video')}
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

      <Fieldset legend="Channels">
        <div className="socials-chips">
          {enabledPlatforms.map((platform) => (
            <Check
              aria-label={PLATFORM_LABELS[platform]}
              checked={state.channels.includes(platform)}
              className={cx(
                'socials-chip',
                state.channels.includes(platform) && 'socials-chip--active',
              )}
              key={platform}
              label={PLATFORM_LABELS[platform]}
              onChange={() => toggleChannel(platform)}
            />
          ))}
        </div>

        {state.channels.map((platform) => (
          <div className="socials-pair" key={platform}>
            <Field label={`${PLATFORM_LABELS[platform]} destination`}>
              <select
                className="socials-select"
                onChange={(event) =>
                  setState((s) => ({
                    ...s,
                    destinations: { ...s.destinations, [platform]: event.target.value },
                  }))
                }
                value={state.destinations[platform] ?? ''}
              >
                <option value="">Select…</option>
                {(destinations[platform] ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`${PLATFORM_LABELS[platform]} format`}>
              <select
                className="socials-select"
                onChange={(event) =>
                  setPerChannelFormat((f) => ({ ...f, [platform]: event.target.value }))
                }
                value={perChannelFormat[platform] ?? ''}
              >
                <option value="">Default</option>
                {getPlatformDescriptor(platform).formats.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ))}
      </Fieldset>

      {results.length > 0 && (
        <ul aria-label="Publish results" className="socials-list">
          {results.map((r) => (
            <li key={r.platform}>
              <Banner type={r.ok ? 'success' : 'danger'}>
                <strong>{PLATFORM_LABELS[r.platform]}</strong>{' '}
                {r.ok ? (
                  <span>
                    Published
                    {r.publishedRef?.externalUrl && (
                      <>
                        {' '}
                        <a href={r.publishedRef.externalUrl} rel="noreferrer" target="_blank">
                          View
                        </a>
                      </>
                    )}
                  </span>
                ) : (
                  <span>{r.error ?? 'Failed'}</span>
                )}
              </Banner>
            </li>
          ))}
        </ul>
      )}

      <div className="socials-row">
        <Button
          buttonStyle="primary"
          disabled={loading || state.channels.length === 0 || !state.title.trim()}
          margin={false}
          onClick={() => {
            void publish()
          }}
        >
          {loading ? 'Publishing…' : 'Publish to selected channels'}
        </Button>
      </div>

      <ListDrawer onSelect={handleLibrarySelect as never} />
    </Card>
  )
}

/**
 * Visibility gate for the standalone composer. Same contract as the source-mode
 * gate: probe once, render nothing until allowed, mount the composer only for a
 * `publisher`.
 */
export const StandaloneSocialComposer: React.FC = () => {
  const { config } = useConfig()
  const { loading, publisher } = useSocialsAccess(resolveSocialsEndpointBase(config))
  if (loading || !publisher) {
    return null
  }
  return <StandaloneComposerAuthorized />
}
