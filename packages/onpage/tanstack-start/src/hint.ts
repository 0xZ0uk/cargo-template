/**
 * The client-visible hint cookie. The session sets it next to every credential
 * cookie so `<OnPage />` can skip its state fetch for visitors (who have no
 * cookies at all). It is not a credential: the server never trusts it, and
 * holding it grants nothing by itself.
 */
export const HINT_COOKIE = 'onpage_hint'
