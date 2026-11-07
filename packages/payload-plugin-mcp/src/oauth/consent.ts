/**
 * The consent page of the authorize endpoint: plain server-rendered HTML, no scripts, in English
 * or Portuguese (the admin's language). Everything that comes from the request, a client
 * registration or the config is escaped.
 */

export type Language = 'en' | 'pt'

const text = {
  en: {
    actsAs: 'It will act on your behalf, as',
    allow: 'Allow',
    allows:
      'It will be able to read and edit the site content, with your permissions, through MCP.',
    deny: 'Deny',
    errors: {
      forbidden:
        'The request did not come from this page, or it expired. Start the connection again in the AI client.',
      notAllowed: 'Your account is not allowed to connect AI clients.',
      redirectMismatch: 'The return address does not match the one this client registered.',
      unknownClient: 'This client is not registered. Add the connection again in the AI client.',
    },
    errorTitle: 'Cannot connect',
    heading: (client: string, resource: string) => `Allow ${client} to access ${resource}?`,
    redirect: 'After you approve, you return to',
    revoke: 'You can revoke access at any time in the admin panel, under AI connections.',
    title: 'Connect an AI client',
    warning:
      'Only approve if you just started this connection from ChatGPT, Claude or another client you know.',
  },
  pt: {
    actsAs: 'Vai agir em seu nome, como',
    allow: 'Permitir',
    allows:
      'Poderá ler e editar o conteúdo do site, com as suas permissões, através do MCP.',
    deny: 'Recusar',
    errors: {
      forbidden:
        'O pedido não veio desta página ou expirou. Volte a iniciar a ligação no cliente de IA.',
      notAllowed: 'A sua conta não tem permissão para ligar clientes de IA.',
      redirectMismatch: 'O endereço de retorno não corresponde ao registado por este cliente.',
      unknownClient:
        'Este cliente não está registado. Volte a adicionar a ligação no cliente de IA.',
    },
    errorTitle: 'Não é possível ligar',
    heading: (client: string, resource: string) => `Permitir que ${client} aceda a ${resource}?`,
    redirect: 'Depois de aprovar, regressa a',
    revoke: 'Pode revogar o acesso a qualquer momento no painel, em Ligações de IA.',
    title: 'Ligar um cliente de IA',
    warning:
      'Só aprove se acabou de iniciar esta ligação no ChatGPT, no Claude ou noutro cliente que conhece.',
  },
} as const

export type ErrorKey = keyof (typeof text)['en']['errors']

export const languageOf = (value: string | undefined): Language =>
  value?.toLowerCase().startsWith('pt') ? 'pt' : 'en'

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const STYLE = `
:root{color-scheme:light dark;--bg:#f4f4f5;--card:#fff;--fg:#18181b;--muted:#52525b}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--card:#18181b;--fg:#fafafa;--muted:#a1a1aa}}
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:34rem;margin:3rem auto;padding:2rem;background:var(--card);border-radius:8px}
@media (max-width:36rem){main{margin:0;border-radius:0;padding:1.5rem 1rem}}
h1{font-size:1.4rem;line-height:1.3;margin:0 0 1rem;overflow-wrap:anywhere}
p{overflow-wrap:anywhere}
.small{font-size:.9rem;color:var(--muted)}
.actions{display:flex;gap:.75rem;margin-top:1.5rem}
button{font:inherit;padding:.6rem 1.4rem;border-radius:6px;border:1px solid var(--fg);cursor:pointer}
button[value=allow]{background:var(--fg);color:var(--card)}
button[value=deny]{background:transparent;color:var(--fg)}
`

/**
 * Headers of every page of the authorize endpoint. `frame-ancestors 'none'` (and the older
 * `X-Frame-Options`) stops another site from framing the page and tricking a click on Allow.
 * `form-action` limits the form to this origin and the client's redirect (where the browser goes
 * after a decision). `Referrer-Policy: same-origin` keeps the `Origin` header on the form POST.
 */
const pageHeaders = (formTargets: string[] = []): HeadersInit => ({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `form-action ${["'self'", ...formTargets].join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; '),
  'Content-Type': 'text/html; charset=utf-8',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
})

const page = (language: Language, title: string, body: string) =>
  `<!doctype html><html lang="${language}"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<meta name="robots" content="noindex"><title>${escape(title)}</title>` +
  `<style>${STYLE}</style></head><body><main>${body}</main></body></html>`

/** An error that can't be sent back to the client (unknown client, wrong redirect, no access). */
export const errorPage = (language: Language, error: ErrorKey, status: number): Response =>
  new Response(
    page(
      language,
      text[language].errorTitle,
      `<h1>${escape(text[language].errorTitle)}</h1><p>${escape(text[language].errors[error])}</p>`,
    ),
    { headers: pageHeaders(), status },
  )

export const consentPage = ({
  action,
  clientName,
  description,
  fields,
  language,
  redirectUri,
  resourceName,
  userLabel,
}: {
  /** Where the form posts: the authorize endpoint. */
  action: string
  clientName: string
  /** What a client can do (`oauth.consentDescription`); a generic sentence otherwise. */
  description?: string
  /** Hidden form fields: the authorization request and the CSRF token. */
  fields: Record<string, string>
  language: Language
  redirectUri: string
  resourceName: string
  /** The signed-in user, as they know themselves (email or username). */
  userLabel: string
}): Response => {
  const t = text[language]
  const redirect = new URL(redirectUri)
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`)
    .join('')
  const body =
    `<h1>${escape(t.heading(clientName, resourceName))}</h1>` +
    `<p>${escape(t.redirect)} <strong>${escape(redirect.host)}</strong>.</p>` +
    `<p>${escape(t.actsAs)} <strong>${escape(userLabel)}</strong>.</p>` +
    `<p>${escape(description || t.allows)}</p>` +
    `<p class="small">${escape(t.warning)}</p>` +
    `<form method="post" action="${escape(action)}">${hidden}<div class="actions">` +
    `<button type="submit" name="decision" value="allow">${escape(t.allow)}</button>` +
    `<button type="submit" name="decision" value="deny">${escape(t.deny)}</button>` +
    `</div></form>` +
    `<p class="small">${escape(t.revoke)}</p>`
  return new Response(page(language, t.title, body), {
    headers: pageHeaders([redirect.origin]),
    status: 200,
  })
}
