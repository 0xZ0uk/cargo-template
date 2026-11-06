/**
 * SEO Rules — Focus keyphrase quality (weight: 1, category: bonus).
 *
 * Advisory checks on the focus keyphrase itself, independent of the page content:
 * - keyphrase-length: number of content words (function words excluded)
 * - keyphrase-function-words-only: the keyphrase has no content word at all
 *
 * Registered under the `content` group, so `disabledRules: ['content']` and
 * `overrideWeights.content` also apply to these checks. Secondary keywords are not checked.
 */
import type { SeoCheck, SeoInput, AnalysisContext } from '../types.js'
import { analyzeKeyphrase } from '../helpers.js'
import {
  KEYPHRASE_CONTENT_WORDS_GOOD_MAX,
  KEYPHRASE_CONTENT_WORDS_WARN_MAX,
} from '../constants.js'
import { getTranslations } from '../i18n.js'

export function checkKeyphrase(input: SeoInput, ctx: AnalysisContext): SeoCheck[] {
  if (!ctx.normalizedKeyword) return []

  const r = getTranslations().rules.content
  const displayKeyphrase = (input.focusKeyword || ctx.normalizedKeyword).trim()
  const { quoted, contentWords, lengthWords } = analyzeKeyphrase(ctx.normalizedKeyword)
  const checks: SeoCheck[] = []

  // Nothing but function words: the keyphrase is too generic. The length check
  // is skipped, since a count of zero says nothing more.
  if (!quoted && contentWords.length === 0) {
    checks.push({
      id: 'keyphrase-function-words-only',
      label: r.keyphraseFunctionWordsLabel,
      status: 'fail',
      message: r.keyphraseFunctionWordsFail(displayKeyphrase),
      category: 'bonus',
      weight: 1,
      group: 'content',
      tip: r.keyphraseFunctionWordsTip,
    })
    return checks
  }

  checks.push({
    id: 'keyphrase-function-words-only',
    label: r.keyphraseFunctionWordsLabel,
    status: 'pass',
    message: r.keyphraseFunctionWordsPass,
    category: 'bonus',
    weight: 1,
    group: 'content',
  })

  if (lengthWords <= KEYPHRASE_CONTENT_WORDS_GOOD_MAX) {
    checks.push({
      id: 'keyphrase-length',
      label: r.keyphraseLengthLabel,
      status: 'pass',
      message: r.keyphraseLengthPass(lengthWords),
      category: 'bonus',
      weight: 1,
      group: 'content',
    })
  } else {
    const tooLong = lengthWords > KEYPHRASE_CONTENT_WORDS_WARN_MAX
    checks.push({
      id: 'keyphrase-length',
      label: r.keyphraseLengthLabel,
      status: tooLong ? 'fail' : 'warning',
      message: tooLong ? r.keyphraseLengthFail(lengthWords) : r.keyphraseLengthWarn(lengthWords),
      category: 'bonus',
      weight: 1,
      group: 'content',
      tip: r.keyphraseLengthTip,
    })
  }

  return checks
}
