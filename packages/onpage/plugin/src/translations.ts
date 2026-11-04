import type { NestedKeysStripped } from '@payloadcms/translations'
/**
 * Admin UI strings, registered with Payload's i18n under the `onpage` namespace
 * (so the admin language applies). Add or override languages with
 * `i18n.translations` in your Payload config.
 */
const en = {
  onpage: {
    editOnPage: 'Edit on page',
    copyPreviewLink: 'Copy preview link',
    copyPreviewLinkHint: 'Copy a read-only link to this draft',
    linkCopied: 'Preview link copied — valid until {{date}}',
    linkFailed: "Couldn't create a preview link: {{message}}",
  },
}

/** Every language must translate every key: a missing or extra one is a compile error. */
type Table = { onpage: Record<keyof (typeof en)['onpage'], string> }

export const translations = {
  en,
  es: {
    onpage: {
      editOnPage: 'Editar en la página',
      copyPreviewLink: 'Copiar enlace de vista previa',
      copyPreviewLinkHint: 'Copiar un enlace de solo lectura a este borrador',
      linkCopied: 'Enlace copiado: válido hasta {{date}}',
      linkFailed: 'No se pudo crear el enlace: {{message}}',
    },
  },
  fr: {
    onpage: {
      editOnPage: 'Modifier sur la page',
      copyPreviewLink: 'Copier le lien d’aperçu',
      copyPreviewLinkHint: 'Copier un lien en lecture seule vers ce brouillon',
      linkCopied: 'Lien copié — valide jusqu’au {{date}}',
      linkFailed: 'Impossible de créer le lien : {{message}}',
    },
  },
  de: {
    onpage: {
      editOnPage: 'Auf der Seite bearbeiten',
      copyPreviewLink: 'Vorschaulink kopieren',
      copyPreviewLinkHint: 'Einen schreibgeschützten Link zu diesem Entwurf kopieren',
      linkCopied: 'Vorschaulink kopiert – gültig bis {{date}}',
      linkFailed: 'Vorschaulink konnte nicht erstellt werden: {{message}}',
    },
  },
} satisfies Record<string, Table>

export type OnPageTranslationKey = NestedKeysStripped<typeof en>
