function envCap(name: string, fallback: number): number {
  return Math.max(1, parseInt(process.env[name] || String(fallback), 10) || fallback)
}

/**
 * Document cap for the dashboard audit (`/audit`). Env `SEO_AUDIT_MAX_DOCS`, default 5000.
 *
 * On Workers the audit builds in steps (see `auditStepBudget` in `endpoints/audit.ts`), so
 * the cap is about the size of the stored result (~1.5 KB per doc) and the memory needed
 * to finish it, not about the CPU limit.
 */
export function auditMaxDocs(): number {
  return envCap('SEO_AUDIT_MAX_DOCS', 5000)
}

/**
 * Document cap for `/indexation-audit`, which still scans in one request. Env
 * `SEO_INDEXATION_MAX_DOCS`, default 1500.
 *
 * On a deployed Worker a scan costs ~10 ms CPU per doc, so the default 30 s CPU limit is
 * reached around 2,800 docs. Keep the cap below that, or raise `limits.cpu_ms`.
 */
export function indexationMaxDocs(): number {
  return envCap('SEO_INDEXATION_MAX_DOCS', 1500)
}
