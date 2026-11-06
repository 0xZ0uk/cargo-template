# Changelog

## [Unreleased]

### Added

- Package scaffold (#60): `assistantPlugin(options)` registers `POST /api/assistant/chat` and the `/admin/assistant` view. The endpoint checks sign-in (401), `access` (403), configuration (503), `rateLimit` (429), then answers `501 { error: "not implemented" }`; the view is a placeholder. No collections, globals or fields, so no migration and no import-map change beyond the view.
- Options: `enabled`, `access`, `models`, `defaultModel`, `apiKey`, `instructions`, `maxSteps`, `toolFilter`, `conversations: { namespace }`, `rateLimit`. A missing `apiKey` warns and leaves the assistant unconfigured: the endpoint and view are registered either way and report "not configured".
- Access: `access({ user, req })` guards both the endpoint (403) and the admin view (redirect to `admin.routes.unauthorized`; anonymous visitors go to login). The default admits only users of the admin auth collection (`config.admin.user`), not any signed-in user, so a session on another auth collection can't spend OpenRouter credit or reach the admin shell. The function reaches the view through `serverProps` only, never the client config.
- OpenRouter provider routing defaults (`requireParameters`, `dataCollection: 'deny'`), camelCase on purpose.
