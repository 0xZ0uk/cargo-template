/**
 * The Claude model of the AI endpoints (optimize, alt text, content brief), and the one the
 * health endpoint reports: one definition, so the report cannot drift from what runs.
 * Sonnet 4.6 by default (quality/cost balance, vision-capable); SEO_AI_MODEL overrides it,
 * for example `claude-opus-4-8` for maximum quality.
 */
export const DEFAULT_AI_MODEL = 'claude-sonnet-4-6'

export function aiModel(): string {
  return process.env.SEO_AI_MODEL || DEFAULT_AI_MODEL
}
