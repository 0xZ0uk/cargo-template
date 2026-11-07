import type { CollectionBeforeOperationHook } from 'payload'

import { Forbidden } from 'payload'

import { OAUTH_STRATEGY } from './metadata.js'

/**
 * Credentials and auth state of an auth collection. A client that could write one of these could
 * keep access after its connection is revoked (an API key or password it chose, an email it
 * controls for a password reset), so OAuth requests never write them.
 */
const CREDENTIAL_FIELDS = [
  '_verificationToken',
  '_verified',
  'apiKey',
  'apiKeyIndex',
  'email',
  'enableAPIKey',
  'hash',
  'lockUntil',
  'loginAttempts',
  'password',
  'resetPasswordExpiration',
  'resetPasswordToken',
  'salt',
  'sessions',
  'username',
]

/** What an OAuth request may do on an auth collection; `update` only without credential fields. */
const ALLOWED = ['count', 'countVersions', 'delete', 'read', 'readDistinct', 'update']

/**
 * Added to every auth collection when `oauth` is on. A request authenticated with an OAuth access
 * token (`_strategy: 'mcp-oauth'`) may read, edit other fields and delete within the user's access,
 * but not create accounts, restore versions, run the auth operations, or write credentials:
 * revoking the connection must end the client's access. Server code that passes
 * `overrideAccess: true` is not the client and is not checked.
 */
export const guardCredentials: CollectionBeforeOperationHook = ({ args, operation, overrideAccess, req }) => {
  if (req.user?._strategy !== OAUTH_STRATEGY || overrideAccess === true) {
    return
  }
  if (!ALLOWED.includes(operation)) {
    throw new Forbidden(req.t)
  }
  if (operation === 'update') {
    const data = (args as { data?: unknown }).data
    if (data && typeof data === 'object' && CREDENTIAL_FIELDS.some((field) => field in data)) {
      throw new Forbidden(req.t)
    }
  }
}
