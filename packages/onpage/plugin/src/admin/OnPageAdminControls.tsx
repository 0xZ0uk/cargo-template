'use client'

/**
 * Document controls added by payload-onpage: open this document's page in edit
 * mode, or copy a sealed read-only preview link. Hidden for users who can't
 * update the document; "Edit on page" is also hidden while the document's
 * `hideEditWhen` field has a value.
 */
import { payloadRest } from '@shipment/onpage-core/payload'
import {
  Button,
  toast,
  useConfig,
  useDocumentInfo,
  useFormFields,
  useLocale,
  useTranslation,
} from '@payloadcms/ui'
import { errorText, ROUTES, type DocRef } from '@shipment/onpage-core'
import { formatAdminURL } from 'payload/shared'
import { useMemo, useState } from 'react'
import type { OnPageTranslationKey, translations } from '../translations.ts'

export interface OnPageAdminControlsProps {
  kind: DocRef['kind']
  slug: string
  /** Plugin endpoint prefix (`routePrefix`). */
  prefix: `/${string}`
  /** Top-level field that, when set on the document, hides "Edit on page" (`hideEditWhen`). */
  hideEditWhen?: string
}

/**
 * Same-origin POST (the endpoint refuses cross-site requests) opened in a new tab.
 * A detached form: these controls render inside the admin's document <form>, and forms can't nest.
 */
function postInNewTab(action: string) {
  const form = document.createElement('form')
  form.method = 'post'
  form.action = action
  form.target = '_blank'
  // The opened tab is same-origin: without noopener it would keep a handle on
  // the admin document via window.opener.
  form.rel = 'noopener'
  document.body.appendChild(form)
  form.submit()
  form.remove()
}

export function OnPageAdminControls({
  kind,
  slug,
  prefix,
  hideEditWhen,
}: OnPageAdminControlsProps) {
  const { id, hasSavePermission } = useDocumentInfo()
  const hideEdit = useFormFields(([fields]) => {
    if (!hideEditWhen) return false
    const value: unknown = fields[hideEditWhen]?.value
    return value != null && value !== '' && value !== false
  })
  const { config } = useConfig()
  const locale = useLocale()
  const { t } = useTranslation<(typeof translations)['en'], OnPageTranslationKey>()
  const [busy, setBusy] = useState(false)
  // Built like Payload's own API URLs: routes.api, serverURL, Next's basePath.
  const apiBase = formatAdminURL({ apiRoute: config.routes.api, serverURL: config.serverURL })
  const dataSource = useMemo(() => payloadRest({ apiBase, prefix }), [apiBase, prefix])

  if (hasSavePermission === false) return null
  const ref: DocRef | null =
    kind === 'global' ? { kind, slug } : id != null ? { kind, slug, id } : null
  if (!ref) return null
  const params = new URLSearchParams({ kind, slug, mode: 'edit' })
  if (kind === 'collection') params.set('id', String(id))
  if (locale?.code) params.set('locale', locale.code)

  const copyLink = async () => {
    setBusy(true)
    try {
      const link = await dataSource.createPreviewLink(ref, { locale: locale?.code })
      await navigator.clipboard.writeText(link.url)
      toast.success(t('onpage:linkCopied', { date: new Date(link.expiresAt).toLocaleString() }))
    } catch (e) {
      toast.error(t('onpage:linkFailed', { message: errorText(e) }))
    } finally {
      setBusy(false)
    }
  }

  const style = { whiteSpace: 'nowrap' as const, flexShrink: 0 }
  return (
    <div style={{ display: 'flex', gap: 6 }} data-testid="onpage-admin-controls">
      {hideEdit ? null : (
        <Button
          buttonStyle="secondary"
          size="medium"
          onClick={() => postInNewTab(`${apiBase}${prefix}${ROUTES.enter}?${params}`)}
          extraButtonProps={{ style, 'data-testid': 'onpage-edit-on-page' }}
        >
          {t('onpage:editOnPage')}
        </Button>
      )}
      <Button
        buttonStyle="ghost"
        size="medium"
        onClick={() => void copyLink()}
        disabled={busy}
        tooltip={t('onpage:copyPreviewLinkHint')}
        extraButtonProps={{ style, 'data-testid': 'onpage-copy-preview-link' }}
      >
        {t('onpage:copyPreviewLink')}
      </Button>
    </div>
  )
}

export default OnPageAdminControls
