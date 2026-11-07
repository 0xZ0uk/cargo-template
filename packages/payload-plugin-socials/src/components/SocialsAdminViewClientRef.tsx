'use client'

// The server view imports its client island through the package's own `client`
// entry: tsup keeps that import external, so the RSC boundary survives bundling
// (the `rsc` bundle would otherwise inline the client component).
// @ts-ignore: self-reference through the package exports, resolved by the host
export { SocialsAdminViewClient } from '@shipment/payload-plugin-socials/client'
