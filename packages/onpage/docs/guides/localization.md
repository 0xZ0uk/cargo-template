# Localization

## Content locales

The editor edits one content locale: `<OnPage locale="es" />`, else the page's `<html lang>`. Reads, saves and the schema use it.

- Text edits apply to that locale only.
- Adding, moving or removing rows changes the shared structure, as in the admin. The dock says so when you're not editing the default locale.

## Editor UI strings

Every string the on-page editor shows is in `defaultMessages` (`@shipment/onpage-react`). Override any subset:

```tsx
<OnPage messages={{ 'dock.publish': 'Publicar', 'dock.saved': 'Borrador guardado {ago}' }} />
```

Spanish, French and German ship with the editor:

```tsx
'use client'
import { OnPageMount, type OnPageMountProps } from '@shipment/onpage-next/client'
import { es } from '@shipment/onpage-react/locales/es' // or fr, de

export const Mount = (p: OnPageMountProps) => <OnPageMount {...p} messages={es} uiLocale="es" />
// <OnPage mount={Mount} />
```

Spread one to change a few strings (`{ ...es, 'dock.publish': 'Publicar ya' }`). For another language, pass your own `messages`.

Pass `uiLocale`, the language of your `messages`, so plurals, relative times ("2 minutes ago") and dates match them. It defaults to `"en"`, the language of the built-in strings:

```tsx
<OnPage uiLocale="pl" messages={polish} />
```

A message with `{count}` can have a plural form for each [plural category](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules/select) of that language. The plain key is the fallback:

```ts
const polish = {
  'dock.documents': '{count} dokumentów',
  'dock.documents.one': '{count} dokument',
  'dock.documents.few': '{count} dokumenty',
}
```

Keyboard shortcuts in hints (`⌘Z`, `Ctrl+Z`) follow the editor's platform.

## Right-to-left

With a right-to-left `uiLocale` (Arabic, Hebrew, Persian, Urdu…), the editor's own UI is laid out right to left. Toolbars and popovers follow the page instead: on a right-to-left page (`dir="rtl"`), a section's toolbar sits at its top-left, and popovers line up with an element's right edge. The inline text editor takes each element's direction.

## Admin strings

"Edit on page" and "Copy preview link" use Payload's i18n (`onpage:*` keys) and follow the admin language. English, Spanish, French and German ship. Add or override others in your Payload config:

```ts
i18n: { translations: { it: { onpage: { editOnPage: 'Modifica nella pagina', copyPreviewLink: 'Copia link anteprima' } } } }
```

Field and block labels come from your Payload config, translated with Payload's `getTranslation` into the admin language.
