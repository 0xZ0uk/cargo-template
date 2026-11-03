/**
 * Document cap for the whole-site scans that analyze every doc (`/audit`,
 * `/indexation-audit`). Env `SEO_AUDIT_MAX_DOCS`, default 1500.
 *
 * On a deployed Worker the audit costs ~10 ms CPU per doc, so the default 30 s CPU
 * limit is reached around 2,800 docs. Keep the cap below that, or raise `limits.cpu_ms`.
 */
export function auditMaxDocs(): number {
  return Math.max(1, parseInt(process.env.SEO_AUDIT_MAX_DOCS || '1500', 10) || 1500)
}
