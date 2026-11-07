'use client'

/**
 * Image editor: pick from the upload collection (search, pages) or upload a
 * new file, through the MediaLibrary port. The chosen document goes into state
 * populated, so a client-rendered page shows it at once; saving sends its id.
 * A new file asks for its alt text first; the current image's alt text can be
 * changed here too (on the media document).
 */
import {
  errorText,
  relationId,
  stegaClean,
  type MediaItem,
  type RelationField,
} from '@shipment/onpage-core'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useOnPage } from '../context.tsx'
import type { FieldEditorProps } from '../types.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { useDebouncedSearch } from './useDebouncedSearch.ts'

export function UploadEditor({ field, value, commit, close, t }: FieldEditorProps<RelationField>) {
  const { media, report } = useOnPage()
  const relationTo =
    (Array.isArray(field.relationTo) ? field.relationTo[0] : field.relationTo) ?? 'media'
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const search = useCallback(
    (query: string, page: number, signal: AbortSignal) =>
      media
        ? media.search({ query, page, relationTo, signal })
        : Promise.resolve({ items: [] as MediaItem[], hasMore: false }),
    [media, relationTo],
  )
  const results = useDebouncedSearch<MediaItem>(media ? search : null)
  const currentId = relationId(value)
  // The current image's alt text, without the marker it carries in edit mode.
  const currentAlt =
    value && typeof value === 'object' && 'alt' in value && typeof value.alt === 'string'
      ? stegaClean(value.alt)
      : null

  // A file waiting for its alt text, with a preview URL.
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null)
  const [alt, setAlt] = useState('')
  useEffect(() => (pending?.url ? () => URL.revokeObjectURL(pending.url) : undefined), [pending])
  // The alt step appears after the dialog opened, so `data-autofocus` doesn't reach it.
  const altInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (pending) altInput.current?.focus()
  }, [pending])
  const [editedAlt, setEditedAlt] = useState(currentAlt ?? '')
  const altId = useId()

  const choose = (m: MediaItem) => {
    commit(m.doc)
    close()
  }
  const pick = (file: File) => {
    setUploadError(null)
    setAlt('')
    // A preview only for images, and only from a blob: URL the browser made for this file.
    const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
    setPending({ file, url: /^blob:/.test(url) ? url : '' })
  }
  const upload = async () => {
    if (!media?.upload || !pending) return
    setUploading(true)
    try {
      choose(await media.upload(pending.file, { relationTo, alt: alt.trim() }))
    } catch (e) {
      report({ type: 'error', where: 'media', error: e })
      setUploadError(errorText(e))
    } finally {
      setUploading(false)
    }
  }
  const saveAlt = async () => {
    if (!media?.updateAlt || currentId == null) return
    setUploading(true)
    try {
      choose(await media.updateAlt(currentId, { relationTo, alt: editedAlt.trim() }))
    } catch (e) {
      report({ type: 'error', where: 'media', error: e })
      setUploadError(errorText(e))
    } finally {
      setUploading(false)
    }
  }

  const actions = (
    <>
      <input
        className="po-input po-search"
        aria-label={t('media.search')}
        placeholder={t('media.search')}
        value={results.query}
        data-autofocus
        onChange={(e) => results.setQuery(e.target.value)}
        data-testid="onpage-media-search"
      />
      {media?.upload && (
        <>
          <button
            type="button"
            className="po-btn"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            data-testid="onpage-media-upload"
          >
            {t('media.upload')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) pick(file)
              e.target.value = '' // choosing the same file again still fires
            }}
          />
        </>
      )}
      {!field.required && currentId != null && (
        <button
          type="button"
          className="po-btn"
          onClick={() => {
            commit(null)
            close()
          }}
          data-testid="onpage-media-remove"
        >
          {t('common.remove')}
        </button>
      )}
    </>
  )

  return (
    <Dialog
      title={field.label}
      onClose={close}
      t={t}
      actions={actions}
      testId="onpage-media-picker"
    >
      {(results.error ?? uploadError) && <p className="po-error">{results.error ?? uploadError}</p>}
      {pending ? (
        <form
          className="po-alt"
          onSubmit={(e) => {
            e.preventDefault()
            void upload()
          }}
          data-testid="onpage-media-alt-form"
        >
          {pending.url && <img src={pending.url} alt="" />}
          <div className="po-row">
            <label htmlFor={altId}>{t('media.alt')}</label>
            <input
              ref={altInput}
              id={altId}
              className="po-input"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              aria-describedby={`${altId}-hint`}
              data-testid="onpage-media-alt"
            />
            <small id={`${altId}-hint`}>{t('media.altHint')}</small>
          </div>
          <div className="po-actions">
            <button type="submit" className="po-btn po-primary" disabled={uploading}>
              {t('media.uploadFile', { name: pending.file.name })}
            </button>
            <button type="button" className="po-btn" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <>
          {media?.updateAlt && currentId != null && currentAlt !== null && (
            <form
              className="po-row po-alt-current"
              onSubmit={(e) => {
                e.preventDefault()
                void saveAlt()
              }}
            >
              <label htmlFor={altId}>{t('media.alt')}</label>
              <div className="po-alt-line">
                <input
                  id={altId}
                  className="po-input"
                  value={editedAlt}
                  onChange={(e) => setEditedAlt(e.target.value)}
                  aria-describedby={`${altId}-hint`}
                  data-testid="onpage-media-alt-current"
                />
                <button type="submit" className="po-btn" disabled={uploading}>
                  {t('media.altSave')}
                </button>
              </div>
              <small id={`${altId}-hint`}>{t('media.altHint')}</small>
            </form>
          )}
          <div className="po-grid">
            {results.items.map((m) => (
              <button
                key={String(m.id)}
                type="button"
                className="po-tile"
                onClick={() => choose(m)}
                aria-current={String(m.id) === String(currentId)}
                data-testid={`onpage-media-${m.id}`}
              >
                <img src={m.thumbnailUrl ?? m.url ?? ''} alt={m.alt ?? ''} loading="lazy" />
                <span>{m.alt || m.filename}</span>
              </button>
            ))}
          </div>
          {!results.busy && !results.items.length && <p className="po-muted">{t('media.empty')}</p>}
          {results.hasMore && (
            <div className="po-center">
              <button
                type="button"
                className="po-btn"
                onClick={results.more}
                disabled={results.busy}
              >
                {t('media.more')}
              </button>
            </div>
          )}
        </>
      )}
      {(results.busy || uploading) && <p className="po-muted">{t('media.loading')}</p>}
    </Dialog>
  )
}
