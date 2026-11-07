# Compatibility

The fork builds against the versions in the workspace catalog (`pnpm-workspace.yaml`), the same ones the Shipment app uses. Bump them there, together.

|                | Version                                          | Notes                                                                                                  |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Payload        | `4.0.0-beta.6`                                   | Peer range `>=4.0.0-beta.6 <5.0.0`. Payload 3 and Next.js are not supported (the adapter was dropped). |
| TanStack Start | `@tanstack/react-start` / `react-router` catalog | One copy for the app and the adapter: two copies lose the router context.                              |
| Lexical        | `0.53.0`                                         | Exactly what `@payloadcms/richtext-lexical` depends on; bump it with Payload.                          |
| React          | `19.3.x`                                         | Peer `^19.0.0`.                                                                                        |
| Runtime        | Cloudflare Workers (workerd), Node `>=22.12`     | Sealing uses Web Crypto only. The e2e spec passes on `vite dev` (Node) and `vite preview` (workerd).   |
| Database       | Any Payload adapter                              | The plugin uses Payload's API only. Tests run on in-memory SQLite; the app runs on D1.                 |
