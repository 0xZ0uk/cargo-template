/**
 * SEO Plugin — string dictionary (English only).
 * Holds the plugin's view strings and all rule messages/labels/tips.
 * No external dependencies.
 */

// ---------------------------------------------------------------------------
// Rule translations interface — one sub-object per rule group
// ---------------------------------------------------------------------------

export interface RuleTranslations {
  title: {
    missingLabel: string
    missingMessage: string
    missingTip: string
    lengthLabel: string
    lengthShort: (len: number) => string
    lengthShortTip: string
    lengthLong: (len: number) => string
    lengthLongTip: string
    lengthPass: (len: number) => string
    keywordLabel: string
    keywordPass: (kw: string) => string
    keywordFail: (kw: string) => string
    keywordPositionLabel: string
    keywordPositionPass: string
    keywordPositionFail: string
    duplicateBrandLabel: string
    duplicateBrandFail: string
    duplicateBrandTip: string
    duplicateBrandPass: string
    powerWordsLabel: string
    powerWordsPass: (count: number, words: string) => string
    powerWordsFail: string
    powerWordsTip: string
    pixelWidthLabel: string
    pixelWidthPass: (px: number) => string
    pixelWidthWarn: (px: number) => string
    hasNumberLabel: string
    hasNumberPass: string
    hasNumberFail: string
    hasNumberTip: string
    isQuestionLabel: string
    isQuestionPass: string
    isQuestionFail: string
    isQuestionTip: string
    sentimentLabel: string
    sentimentPass: (count: number, words: string) => string
    sentimentFail: string
    sentimentTip: string
  }
  metaDescription: {
    missingLabel: string
    missingMessage: string
    missingTip: string
    lengthLabel: string
    lengthShort: (len: number) => string
    lengthShortTip: string
    lengthLong: (len: number) => string
    lengthLongTip: string
    lengthPass: (len: number) => string
    keywordLabel: string
    keywordPass: (kw: string) => string
    keywordFail: (kw: string) => string
    ctaLabel: string
    ctaPass: string
    ctaFail: string
    ctaTip: string
  }
  headings: {
    h1MissingLabel: string
    h1MissingMessage: string
    h1MissingTip: string
    h1UniqueLabel: string
    h1MultipleMessage: (count: number) => string
    h1UniquePass: string
    h1KeywordLabel: string
    h1KeywordPass: string
    h1KeywordFail: (kw: string) => string
    hierarchyLabel: string
    hierarchyPass: string
    hierarchyFail: (text: string, level: number, previousLevel: number, more: number) => string
    hierarchyTip: string
    h2KeywordLabel: string
    h2KeywordPass: string
    h2KeywordFail: (kw: string) => string
    frequencyLabel: string
    frequencyPass: (count: number, words: number) => string
    frequencyFail: (count: number, words: number) => string
    frequencyTip: string
    h1TitleDiffLabel: string
    h1TitleDiffFail: string
    h1TitleDiffTip: string
    h1TitleDiffPass: string
  }
  url: {
    missingLabel: string
    missingMessage: string
    lengthLabel: string
    lengthFail: (len: number) => string
    lengthPass: (len: number) => string
    formatLabel: string
    formatFail: string
    formatPass: string
    keywordLabel: string
    keywordPass: string
    keywordFail: (kw: string) => string
    keywordUtilityPass: string
    stopwordsLabel: string
    stopwordsFail: (words: string) => string
    stopwordsPass: string
  }
  content: {
    keyphraseLengthLabel: string
    keyphraseLengthPass: (count: number) => string
    keyphraseLengthWarn: (count: number) => string
    keyphraseLengthFail: (count: number) => string
    keyphraseLengthTip: string
    keyphraseFunctionWordsLabel: string
    keyphraseFunctionWordsPass: string
    keyphraseFunctionWordsFail: (keyphrase: string) => string
    keyphraseFunctionWordsTip: string
    wordcountLabel: string
    wordcountFail: (count: number, minLabel: string) => string
    wordcountFailTip: string
    wordcountWarn: (count: number, minLabel: string) => string
    wordcountWarnTip: string
    wordcountPass: (count: number) => string
    keywordIntroLabel: string
    keywordIntroPass: string
    keywordIntroFail: (kw: string) => string
    densityLabel: string
    densityOverstuffed: (density: string) => string
    densityHigh: (density: string) => string
    densityPass: (density: string) => string
    densityPassWordLevel: (density: string) => string
    densityLowWordLevel: (density: string) => string
    densityLow: (density: string) => string
    densityMissing: (kw: string) => string
    placeholderLabel: string
    placeholderFail: string
    placeholderPass: string
    placeholderTip: string
    thinLabel: string
    thinWarnLabel: string
    thinWarn: (count: number) => string
    thinWarnTip: string
    thinPass: string
    thinPassLabel: string
    distributionLabel: string
    distributionPass: (tiers: number) => string
    distributionWarn: string
    distributionWarnTip: string
    distributionFail: string
    distributionFailTip: string
    listsLabel: string
    listsPass: (count: number) => string
    listsFail: string
    listsTip: string
    // Min word labels by page type
    minWordsPost: string
    minWordsForm: string
    minWordsLegal: string
    minWordsGeneric: string
  }
  secondaryKeywords: {
    titleLabel: (suffix: string) => string
    titlePass: (kw: string) => string
    titleFail: (kw: string) => string
    descLabel: (suffix: string) => string
    descPass: (kw: string) => string
    descFail: (kw: string) => string
    contentLabel: (suffix: string) => string
    contentPass: (kw: string, count: number, density: string) => string
    contentFail: (kw: string) => string
    headingLabel: (suffix: string) => string
    headingPass: (kw: string) => string
    headingFail: (kw: string) => string
  }
  images: {
    altLabel: string
    altAllPass: (total: number) => string
    altSomeFail: (missing: number, total: number) => string
    altMostFail: (missing: number, total: number) => string
    altKeywordLabel: string
    altKeywordPass: string
    altKeywordFail: string
    presentLabel: string
    presentPass: (total: number) => string
    presentFail: string
    presentUtilityPass: string
    quantityLabel: string
    quantityPass: (total: number) => string
    quantityFail: string
    formatLabel: string
    formatPass: string
    formatFail: (count: number) => string
    dimensionsLabel: string
    dimensionsPass: string
    dimensionsFail: (count: number) => string
    filenameLabel: string
    filenamePass: string
    filenameFail: (count: number) => string
  }
  linking: {
    internalLabel: string
    internalNone: string
    internalFew: (count: number) => string
    internalGood: (count: number) => string
    externalLabel: string
    externalNone: string
    externalPass: (count: number) => string
    externalUtilityPass: string
    genericAnchorsLabel: string
    genericAnchorsFail: (count: number) => string
    genericAnchorsPassLabel: string
    genericAnchorsPass: string
    emptyLinksLabel: string
    emptyLinksFail: (count: number) => string
    emptyLinksPassLabel: string
    emptyLinksPass: string
    competingLabel: string
    competingFail: (keyphrase: string, urls: string) => string
    competingTip: string
    competingPass: (keyphrase: string) => string
  }
  cornerstone: {
    wordcountLabel: string
    wordcountPass: (count: number) => string
    wordcountFail: (count: number) => string
    internalLinksLabel: string
    internalLinksPass: (count: number) => string
    internalLinksFail: (count: number) => string
    focusKeywordLabel: string
    focusKeywordPass: string
    focusKeywordFail: string
    metaDescLabel: string
    metaDescPass: (len: number) => string
    metaDescWarn: (len: number) => string
    metaDescFail: string
  }
  readability: {
    fleschLabel: string
    fleschPass: (score: number) => string
    fleschWarn: (score: number, target: number) => string
    fleschFail: (score: number, target: number) => string
    longSentencesLabelFail: string
    longSentencesLabelPass: string
    longSentencesFail: (long: number, total: number, pct: number, words: number, maxPct: number) => string
    longSentencesPass: (pct: number) => string
    longParagraphsLabel: string
    longParagraphsFail: string
    longParagraphsPass: string
    passiveLabelFail: string
    passiveLabelPass: string
    passiveFail: (count: number, total: number, pct: number, maxPct: number) => string
    passivePass: (pct: number) => string
    transitionsLabel: string
    transitionsFail: (pct: number, minPct: number) => string
    transitionsPass: (pct: number) => string
    consecutiveLabelFail: string
    consecutiveLabelPass: string
    consecutiveFail: (count: number) => string
    consecutivePass: string
    longSectionsLabelFail: string
    longSectionsLabelPass: string
    longSectionsFail: (count: number) => string
    longSectionsPass: string
  }
  freshness: {
    ageLabel: string
    ageEvergreenWarn: (days: number) => string
    ageEvergreenPass: (days: number) => string
    ageFail: (days: number) => string
    ageWarn: (days: number) => string
    agePass: (days: number) => string
    reviewLabel: string
    reviewWarn: (days: number) => string
    reviewPass: (days: number) => string
    yearRefLabel: string
    yearRefWarn: (oldest: number, current: number, last: number) => string
    yearRefPass: (year: number) => string
    thinAgingLabel: string
    thinAgingFail: (words: number, days: number) => string
    fakeRefreshLabel: string
    fakeRefreshWarn: (displayedDays: number, updatedDays: number) => string
    fakeRefreshTip: string
  }
  schema: {
    readinessLabel: string
    readinessPass: string
    readinessFail: string
    coverageLabel: string
    coverageOptional: string
    coveragePass: (type: string) => string
    coverageMissing: (type: string, fields: string) => string
    coverageMissingTip: string
    coverageRemind: (type: string, fields: string) => string
    faqNoRichResultLabel: string
    faqNoRichResult: string
  }
  technical: {
    canonicalMissingLabel: string
    canonicalMissingMessage: string
    canonicalInvalidLabel: string
    canonicalInvalidMessage: (url: string) => string
    canonicalExternalLabel: string
    canonicalExternalMessage: string
    canonicalCrossLabel: string
    canonicalCrossMessage: (target: string) => string
    canonicalOkLabel: string
    canonicalOkMessage: string
    robotsNoindexLabel: string
    robotsNoindexAcceptable: (pageType: string) => string
    robotsNoindexFail: string
    robotsNofollowLabel: string
    robotsNofollowMessage: string
    robotsOkLabel: string
    robotsOkMessage: string
  }
  social: {
    ogImageLabel: string
    ogImageFail: string
    ogImagePass: string
    titleTruncLabel: string
    titleTruncFail: (len: number) => string
    titleTruncPass: string
    descLengthLabel: string
    descLengthFail: (len: number) => string
    descLengthPass: string
  }
  accessibility: {
    shortAnchorsLabel: string
    shortAnchorsFail: (count: number, example: string) => string
    shortAnchorsPass: string
    shortAnchorsTip: string
    altQualityLabel: string
    altQualityFail: (count: number, example: string) => string
    altQualityPass: string
    altQualityTip: string
    emptyHeadingsLabel: string
    emptyHeadingsFail: (count: number, tags: string) => string
    emptyHeadingsPass: string
    emptyHeadingsTip: string
    duplicateLinksLabel: string
    duplicateLinksFail: (count: number) => string
    duplicateLinksPass: string
    duplicateLinksTip: string
    allCapsLabel: string
    allCapsFail: (count: number, example: string) => string
    allCapsPass: string
    allCapsTip: string
    linkDensityLabel: string
    linkDensityFail: (pct: number) => string
    linkDensityWarn: (pct: number) => string
    linkDensityPass: (pct: number) => string
    linkDensityNoContent: string
    linkDensityTip: string
    imageFilenameLabel: string
    imageFilenameFail: (count: number, example: string) => string
    imageFilenamePass: string
    imageFilenameTip: string
    altDuplicatesLabel: string
    altDuplicatesFail: (count: number, example: string) => string
    altDuplicatesPass: string
    altDuplicatesTip: string
  }
  quality: {
    noDuplicateLabel: string
    noDuplicateFail: string
    noDuplicatePass: string
    substantialLabel: string
    substantialFail: (count: number) => string
    substantialWarn: (count: number) => string
    substantialPass: (count: number) => string
  }
  ecommerce: {
    priceLabel: string
    pricePass: string
    priceFail: string
    priceTip: string
    descriptionLabel: string
    descriptionPass: (count: number) => string
    descriptionFail: (count: number, min: number) => string
    descriptionTip: string
    imagesLabel: string
    imagesPass: (count: number) => string
    imagesWarn: (count: number, min: number) => string
    imagesFail: string
    imagesTip: string
    brandLabel: string
    brandPass: string
    brandFailKw: (kw: string) => string
    brandFailNoKw: string
    brandTip: string
    metaPriceLabel: string
    metaPricePass: string
    metaPriceFail: string
    metaPriceTip: string
    reviewLabel: string
    reviewPass: string
    reviewFail: string
    reviewTip: string
    availabilityLabel: string
    availabilityPass: string
    availabilityFail: string
    availabilityTip: string
  }
}

// Translation keys organized by view/section
export interface SeoTranslations {
  // Common
  common: {
    loading: string
    error: string
    save: string
    cancel: string
    refresh: string
    export: string
    exportCsv: string
    search: string
    noResults: string
    total: string
    actions: string
    edit: string
    delete: string
    add: string
    close: string
    copy: string
    copied: string
    confirm: string
    back: string
  }
  // Nav
  nav: {
    seoGroup: string
    dashboard: string
    sitemapAudit: string
    redirects: string
    cannibalization: string
    configuration: string
    schemaBuilder: string
    performance: string
    keywordResearch: string
    linkGraph: string
  }
  // Dashboard
  dashboard: {
    title: string
    totalPages: string
    avgScore: string
    good: string
    needsWork: string
    critical: string
    noKeyword: string
    exportPdf: string
    filters: { noMeta: string; noH1: string; lowReadability: string }
  }
  // Link graph
  linkGraph: {
    title: string
    subtitle: string
    nodes: string
    edges: string
    orphanNodes: string
    hubNodes: string
    zoomIn: string
    zoomOut: string
    resetView: string
    showLabels: string
    hideLabels: string
    filterByCollection: string
    all: string
    clickToOpen: string
    incomingLinks: string
    outgoingLinks: string
  }
  // Schema builder
  schemaBuilder: {
    title: string
    selectType: string
    preview: string
    copyJsonLd: string
    copyScript: string
  }
  // Performance
  performance: {
    title: string
    period7d: string
    period30d: string
    period90d: string
    totalClicks: string
    totalImpressions: string
    avgCtr: string
    avgPosition: string
    topPages: string
    topQueries: string
    importData: string
    importCsv: string
    noData: string
  }
  // Keyword research
  keywordResearch: {
    title: string
    unused: string
    related: string
    trending: string
    longTail: string
    suggestedFor: string
    usedBy: string
    frequency: string
    score: string
  }
  // Meta fields (auto-created)
  metaFields: {
    titleLabel: string
    descriptionLabel: string
    imageLabel: string
    generateBtn: string
    generating: string
    characters: string
    completeness: string
    complete: string
    almostComplete: string
    partial: string
    incomplete: string
    defined: string
    missing: string
    serpPreview: string
    desktop: string
    mobile: string
    noTitle: string
    noDescription: string
    globalSkip: string
  }
  // Rule translations
  rules: RuleTranslations
}

// ---------------------------------------------------------------------------
// English rule translations
// ---------------------------------------------------------------------------

const rulesEn: RuleTranslations = {
  title: {
    missingLabel: 'Meta title',
    missingMessage: 'Meta title is missing — Add a title for search engine optimization.',
    missingTip: 'Write a 30-60 character title containing the focus keyword and brand name.',
    lengthLabel: 'Title length',
    lengthShort: (len) => `Meta title (${len} chars) — Too short. Aim for 30 to 60 characters.`,
    lengthShortTip: 'Add descriptive words or the brand name to reach at least 30 characters.',
    lengthLong: (len) => `Meta title (${len} chars) — Too long, will be truncated in Google. Reduce to 60 max.`,
    lengthLongTip: 'Google truncates beyond ~60 characters. Remove unnecessary words and keep the essentials.',
    lengthPass: (len) => `Meta title (${len} chars) — Ideal length.`,
    keywordLabel: 'Keyword in title',
    keywordPass: (kw) => `The keyword "${kw}" is present in the meta title.`,
    keywordFail: (kw) => `The keyword "${kw}" is not in the meta title — Add it for better SEO.`,
    keywordPositionLabel: 'Keyword position',
    keywordPositionPass: 'The keyword is placed at the beginning of the title — Ideal position.',
    keywordPositionFail: 'The keyword is at the end of the title — Place it at the beginning for better impact.',
    duplicateBrandLabel: 'Duplicate brand name',
    duplicateBrandFail: 'The title contains a duplicated part (e.g. "Brand | Brand") — Remove the duplicate.',
    duplicateBrandTip: 'Check that the meta title generator does not automatically add the brand name if you already included it.',
    duplicateBrandPass: 'No duplication in the title.',
    powerWordsLabel: 'Power words in title',
    powerWordsPass: (count, words) => `The title contains ${count} power word(s): ${words}`,
    powerWordsFail: 'The title contains no power words — Add a word like "free", "guide", "ultimate" to boost CTR.',
    powerWordsTip: 'Power words (free, exclusive, guide, ultimate, essential...) attract attention in search results.',
    pixelWidthLabel: 'Title pixel width',
    pixelWidthPass: (px) => `Estimated width ${px}px — under the SERP truncation threshold (~600px).`,
    pixelWidthWarn: (px) => `Estimated width ${px}px — may be truncated in Google (~600px). Informational.`,
    hasNumberLabel: 'Number in title',
    hasNumberPass: 'The title contains a number — list-style format, often more engaging.',
    hasNumberFail: 'No number in the title — Titles with numbers (e.g. "5 tips", "Top 10") attract more clicks.',
    hasNumberTip: 'Add a number to create a list-type title (e.g. "7 tips for...", "The 3 mistakes to avoid").',
    isQuestionLabel: 'Question title',
    isQuestionPass: 'The title is phrased as a question — Ideal for Google Featured Snippets.',
    isQuestionFail: 'The title is not a question — Question titles favor featured snippets.',
    isQuestionTip: 'Rephrase as a question if relevant (e.g. "How to optimize your SEO?").',
    sentimentLabel: 'Emotional words in title',
    sentimentPass: (count, words) => `The title contains ${count} emotional word(s): ${words}`,
    sentimentFail: 'The title contains no emotional words — High-emotion words increase click-through rate.',
    sentimentTip: 'Add an emotional word to capture attention (e.g. "mistake", "secret", "incredible").',
  },
  metaDescription: {
    missingLabel: 'Meta description',
    missingMessage: 'Meta description is missing — Add a description for search engine optimization.',
    missingTip: 'Write a 120-160 character sentence that summarizes the page and encourages clicks. Include the focus keyword.',
    lengthLabel: 'Description length',
    lengthShort: (len) => `Meta description (${len} chars) — Too short. Aim for 120 to 160 characters.`,
    lengthShortTip: 'Complete with page benefits or a call to action (e.g. "Free quote within 24h").',
    lengthLong: (len) => `Meta description (${len} chars) — Too long, will be truncated. Reduce to 160 max.`,
    lengthLongTip: 'Google truncates beyond ~160 characters. Remove secondary details and keep the essentials.',
    lengthPass: (len) => `Meta description (${len} chars) — Ideal length.`,
    keywordLabel: 'Keyword in description',
    keywordPass: (kw) => `The keyword "${kw}" is present in the meta description.`,
    keywordFail: (kw) => `The keyword "${kw}" is not in the meta description.`,
    ctaLabel: 'Action verb (CTA)',
    ctaPass: 'The meta description contains a compelling element — Good for click-through rate.',
    ctaFail: 'Add an action verb (discover, contact, get...) to encourage clicks.',
    ctaTip: 'Start with an imperative verb (Discover, Enjoy, Get) or use a number ("5 reasons to...").',
  },
  headings: {
    h1MissingLabel: 'H1 heading',
    h1MissingMessage: 'No H1 heading detected — Add a main heading in the hero section.',
    h1MissingTip: 'The H1 is the main heading of the page. It should contain the keyword and summarize the topic in one sentence.',
    h1UniqueLabel: 'Unique H1 heading',
    h1MultipleMessage: (count) => `${count} H1 headings detected — Keep only one H1 per page.`,
    h1UniquePass: 'Only one H1 detected — Perfect.',
    h1KeywordLabel: 'Keyword in H1',
    h1KeywordPass: 'The keyword is present in the H1 heading.',
    h1KeywordFail: (kw) => `The keyword "${kw}" is not in the H1 — Add it to the main heading.`,
    hierarchyLabel: 'Heading hierarchy',
    hierarchyPass: 'The heading hierarchy is correct (h2 before h3, etc.).',
    hierarchyFail: (text, level, previousLevel, more) =>
      `${text ? `"${text}"` : 'An empty heading'} (h${level}) follows an h${previousLevel}. Make it an h${previousLevel + 1}, or add an h${previousLevel + 1} above it.${more > 0 ? ` ${more} more heading(s) skip a level.` : ''}`,
    hierarchyTip:
      'Keep heading levels in order: a heading can go one level deeper than the one before it, or back up any number of levels.',
    h2KeywordLabel: 'Keyword in an H2',
    h2KeywordPass: 'The keyword is present in at least one H2 subheading.',
    h2KeywordFail: (kw) => `Add the keyword "${kw}" to one of the H2 subheadings.`,
    frequencyLabel: 'Subheading frequency',
    frequencyPass: (count, words) => `${count} subheading(s) for ${words} words — Good structure.`,
    frequencyFail: (count, words) => `Only ${count} subheading(s) for ${words} words — Add a subheading every ~300 words.`,
    frequencyTip: 'Break up long paragraphs with H2/H3 subheadings that summarize each section.',
    h1TitleDiffLabel: 'H1 different from meta title',
    h1TitleDiffFail: 'The H1 and meta title are identical — Differentiate them to cover more keyword variations.',
    h1TitleDiffTip: 'The meta title is optimized for Google (with brand name). The H1 can be more descriptive or catchy for visitors.',
    h1TitleDiffPass: 'The H1 and meta title are different — Good practice for semantic diversity.',
  },
  url: {
    missingLabel: 'Slug (URL)',
    missingMessage: 'Slug is missing — Define a URL for this page.',
    lengthLabel: 'Slug length',
    lengthFail: (len) => `Slug too long (${len} chars) — Keep it under 75 characters.`,
    lengthPass: (len) => `Valid slug (${len} chars).`,
    formatLabel: 'Slug format',
    formatFail: 'Slug contains special characters or uppercase — Use only lowercase, numbers and hyphens.',
    formatPass: 'Slug format is correct (lowercase, numbers, hyphens).',
    keywordLabel: 'Keyword in slug',
    keywordPass: 'The keyword is present in the URL.',
    keywordFail: (kw) => `The keyword "${kw}" is not in the URL — Add it if possible.`,
    keywordUtilityPass: 'Utility page — The standard slug is appropriate.',
    stopwordsLabel: 'Stop words in slug',
    stopwordsFail: (words) => `The slug contains stop words (${words}) — Remove them for a cleaner slug.`,
    stopwordsPass: 'The slug does not contain unnecessary stop words.',
  },
  content: {
    keyphraseLengthLabel: 'Keyphrase length',
    keyphraseLengthPass: (count) => `The keyphrase has ${count} content word(s) — Focused enough to target.`,
    keyphraseLengthWarn: (count) => `The keyphrase has ${count} content words — Long phrases are harder to match; aim for 4 or fewer.`,
    keyphraseLengthFail: (count) => `The keyphrase has ${count} content words — Too long to be a realistic search query.`,
    keyphraseLengthTip: 'Shorten the focus keyphrase to its core topic (1 to 4 content words) and move the rest into secondary keywords.',
    keyphraseFunctionWordsLabel: 'Keyphrase content words',
    keyphraseFunctionWordsPass: 'The keyphrase contains meaningful content words.',
    keyphraseFunctionWordsFail: (keyphrase) => `The keyphrase "${keyphrase}" has only function words (such as "the", "of", "how", "best") — It is too generic to target.`,
    keyphraseFunctionWordsTip: 'Choose a keyphrase that names the actual topic, for example "coffee grinder" instead of "the best".',
    wordcountLabel: 'Content volume',
    wordcountFail: (count, minLabel) => `Only ${count} words — Aim for at least ${minLabel} for good SEO.`,
    wordcountFailTip: 'Add sections with H2 subheadings, concrete examples, an FAQ or testimonials.',
    wordcountWarn: (count, minLabel) => `${count} words — Decent but insufficient. Aim for ${minLabel}.`,
    wordcountWarnTip: 'Expand the content with explanatory paragraphs, examples or an FAQ section.',
    wordcountPass: (count) => `${count} words — Sufficient content volume.`,
    keywordIntroLabel: 'Keyword in introduction',
    keywordIntroPass: 'The keyword appears in the first paragraph — Good practice.',
    keywordIntroFail: (kw) => `Add the keyword "${kw}" in the first sentences of the content.`,
    densityLabel: 'Keyword density',
    densityOverstuffed: (density) => `Keyword density: ${density}% — Too high (>3%), risk of keyword stuffing.`,
    densityHigh: (density) => `Keyword density: ${density}% — Slightly high; keep it natural to avoid over-optimisation.`,
    densityPass: (density) => `Keyword density: ${density}% — Natural usage, no stuffing detected.`,
    densityPassWordLevel: (density) => `Keyword components are present in the content (estimated density: ${density}%).`,
    densityLowWordLevel: (density) => `Keyword components are present but infrequent (estimated density: ${density}%). Strengthen their presence.`,
    densityLow: (density) => `Keyword density: ${density}% — Too low. Aim for 0.5% to 2.5%.`,
    densityMissing: (kw) => `The keyword "${kw}" does not appear in the body — focus on covering the topic naturally rather than repeating it.`,
    placeholderLabel: 'Placeholder content',
    placeholderFail: 'Placeholder content detected (lorem ipsum, TODO, etc.) — Replace with real content.',
    placeholderPass: 'No placeholder content detected.',
    placeholderTip: 'Search for "lorem", "TODO", "TBD" in the editor and replace with real business content.',
    thinLabel: 'Thin content',
    thinWarnLabel: 'Thin content',
    thinWarn: (count) => `Only ${count} words of content — Pages with fewer than 100 words risk being ignored by Google.`,
    thinWarnTip: 'Expand the content with explanatory paragraphs, concrete examples or an FAQ.',
    thinPass: 'The content is rich enough to be indexed.',
    thinPassLabel: 'Substantial content',
    distributionLabel: 'Keyword distribution',
    distributionPass: (tiers) => `Keyword present in ${tiers}/3 content sections — Good distribution.`,
    distributionWarn: 'Keyword present in only 1/3 of the content — Distribute it throughout the text.',
    distributionWarnTip: 'Use the keyword naturally in the introduction, body and conclusion of the text.',
    distributionFail: 'Keyword absent from content sections — It should appear in at least 2 of 3 thirds.',
    distributionFailTip: 'Insert the keyword in the introduction, in at least one H2 subheading and in the conclusion.',
    listsLabel: 'Lists in content',
    listsPass: (count) => `${count} list(s) detected — Lists improve readability and featured snippet chances.`,
    listsFail: 'No list detected — Add bullet or numbered lists to structure the content.',
    listsTip: 'Use lists to enumerate steps, benefits or features. Google often uses them for featured snippets.',
    minWordsPost: '800 words (article)',
    minWordsForm: '150 words (form page)',
    minWordsLegal: '200 words (legal page)',
    minWordsGeneric: '300 words (page)',
  },
  secondaryKeywords: {
    titleLabel: (suffix) => `Secondary keyword in title${suffix}`,
    titlePass: (kw) => `The secondary keyword "${kw}" is present in the meta title.`,
    titleFail: (kw) => `The secondary keyword "${kw}" is not in the meta title.`,
    descLabel: (suffix) => `Secondary keyword in description${suffix}`,
    descPass: (kw) => `The secondary keyword "${kw}" is present in the meta description.`,
    descFail: (kw) => `The secondary keyword "${kw}" is not in the meta description.`,
    contentLabel: (suffix) => `Secondary keyword in content${suffix}`,
    contentPass: (kw, count, density) => `The secondary keyword "${kw}" appears ${count} time(s) (${density}%).`,
    contentFail: (kw) => `The secondary keyword "${kw}" does not appear in the content.`,
    headingLabel: (suffix) => `Secondary keyword in H2/H3${suffix}`,
    headingPass: (kw) => `The secondary keyword "${kw}" is present in an H2 or H3 subheading.`,
    headingFail: (kw) => `Add the secondary keyword "${kw}" to an H2 or H3 subheading.`,
  },
  images: {
    altLabel: 'Image alt text',
    altAllPass: (total) => `${total} image(s) with alt text — Perfect.`,
    altSomeFail: (missing, total) => `${missing}/${total} image(s) without alt text — Add descriptive alt texts.`,
    altMostFail: (missing, total) => `${missing}/${total} image(s) without alt text — Accessibility and SEO suffer.`,
    altKeywordLabel: 'Keyword in alt text',
    altKeywordPass: 'The keyword or a descriptive alt text is present on at least one image.',
    altKeywordFail: 'Add the keyword to the alt text of at least one image.',
    presentLabel: 'Images present',
    presentPass: (total) => `${total} image(s) detected.`,
    presentFail: 'No image detected — Add visuals to enrich the content.',
    presentUtilityPass: 'Utility page — Images are not essential.',
    quantityLabel: 'Number of images',
    quantityPass: (total) => `${total} image(s) — Visuals present.`,
    quantityFail: 'No image in this article — Articles without images are less engaging.',
    formatLabel: 'Image format',
    formatPass: 'All images use an optimized format (WebP/AVIF).',
    formatFail: (count) => `${count} image(s) not using an optimized format (WebP/AVIF) — Convert for better performance.`,
    dimensionsLabel: 'Image dimensions',
    dimensionsPass: 'All images have width/height dimensions defined.',
    dimensionsFail: (count) => `${count} image(s) without width/height dimensions — Add them to prevent CLS.`,
    filenameLabel: 'Image filenames',
    filenamePass: 'All images have descriptive filenames.',
    filenameFail: (count) => `${count} image(s) with generic filenames (IMG_, screenshot...) — Rename them for SEO.`,
  },
  linking: {
    internalLabel: 'Internal links',
    internalNone: 'No internal link detected — Add links to other pages on the site.',
    internalFew: (count) => `${count} internal link(s) — OK. Aim for 3+ to strengthen internal linking.`,
    internalGood: (count) => `${count} internal links — Excellent internal linking.`,
    externalLabel: 'External links',
    externalNone: 'No external link — Add links to reliable sources to strengthen credibility.',
    externalPass: (count) => `${count} external link(s) detected.`,
    externalUtilityPass: 'Utility page — External links are not essential.',
    genericAnchorsLabel: 'Generic anchors',
    genericAnchorsFail: (count) => `${count} link(s) with generic anchors ("click here", "here"...) — Use descriptive text.`,
    genericAnchorsPassLabel: 'Descriptive anchors',
    genericAnchorsPass: 'All links use descriptive anchor text.',
    emptyLinksLabel: 'Empty links',
    emptyLinksFail: (count) => `${count} empty link(s) detected (href="" or href="#") — Add valid destinations.`,
    emptyLinksPassLabel: 'Valid links',
    emptyLinksPass: 'No empty link detected.',
    competingLabel: 'Competing anchors',
    competingFail: (keyphrase, urls) =>
      `Internal link(s) use the focus keyphrase "${keyphrase}" as their anchor text (${urls}) — They compete with this page for that phrase.`,
    competingTip: 'Reword the anchor text of these links (e.g. add context) or point them at this page, so only this page targets the keyphrase.',
    competingPass: (keyphrase) => `No internal link to another page uses "${keyphrase}" as its anchor text.`,
  },
  cornerstone: {
    wordcountLabel: 'Pillar content length',
    wordcountPass: (count) => `${count} words — The pillar content is comprehensive enough.`,
    wordcountFail: (count) => `${count} words — Pillar content seems thin; expand topical coverage (without targeting an arbitrary word count).`,
    internalLinksLabel: 'Pillar content internal linking',
    internalLinksPass: (count) => `${count} internal links — Good linking for pillar content.`,
    internalLinksFail: (count) => `${count} internal link(s) — Pillar content should have at least 5 internal links to related content.`,
    focusKeywordLabel: 'Pillar content focus keyword',
    focusKeywordPass: 'A focus keyword is defined for this pillar content.',
    focusKeywordFail: 'Pillar content MUST have a focus keyword — Define it in the sidebar.',
    metaDescLabel: 'Pillar content meta description',
    metaDescPass: (len) => `Meta description of ${len} characters — Optimal for pillar content.`,
    metaDescWarn: (len) => `Meta description of ${len} characters — Aim for 120 to 160 characters for pillar content.`,
    metaDescFail: 'Pillar content MUST have a meta description — Essential for CTR in SERPs.',
  },
  readability: {
    fleschLabel: 'Readability score',
    fleschPass: (score) => `Flesch score: ${score}/100 — Text is accessible.`,
    fleschWarn: (score, target) => `Flesch score: ${score}/100 (aim for ${target}+) — Text is fairly difficult. Simplify sentences.`,
    fleschFail: (score, target) => `Flesch score: ${score}/100 (aim for ${target}+) — Text is hard to read. Shorten sentences and simplify vocabulary.`,
    longSentencesLabelFail: 'Long sentences',
    longSentencesLabelPass: 'Sentence length',
    longSentencesFail: (long, total, pct, words, maxPct) =>
      `${long}/${total} sentences over ${words} words (${pct}%) — Recommended max: ${maxPct}%.`,
    longSentencesPass: (pct) => `${pct}% long sentences — Good distribution.`,
    longParagraphsLabel: 'Long paragraphs',
    longParagraphsFail: 'Paragraphs with more than 150 words detected — Break them up for easier reading.',
    longParagraphsPass: 'No excessively long paragraphs.',
    passiveLabelFail: 'Passive voice',
    passiveLabelPass: 'Active voice',
    passiveFail: (count, total, pct, maxPct) =>
      `${count}/${total} passive voice sentences (${pct}%) — Recommended max: ${maxPct}%.`,
    passivePass: (pct) => `${pct}% passive voice — Good use of active voice.`,
    transitionsLabel: 'Transition words',
    transitionsFail: (pct, minPct) => `${pct}% of sentences contain transition words — Aim for ${minPct}%+.`,
    transitionsPass: (pct) => `${pct}% of sentences with transition words — Good flow.`,
    consecutiveLabelFail: 'Repetitive sentence starts',
    consecutiveLabelPass: 'Sentence variety',
    consecutiveFail: (count) => `${count} consecutive sentences start with the same word — Vary sentence beginnings.`,
    consecutivePass: 'Sentence beginnings are sufficiently varied.',
    longSectionsLabelFail: 'Sections without subheading',
    longSectionsLabelPass: 'Section structure',
    longSectionsFail: (count) => `${count} section(s) over 400 words without a subheading — Break up with h2/h3.`,
    longSectionsPass: 'Sections are well divided with subheadings.',
  },
  freshness: {
    ageLabel: 'Content age',
    ageEvergreenWarn: (days) => `Content not updated for ${days} days (>\u00A024 months) — Verify that legal information is still current.`,
    ageEvergreenPass: (days) => `Evergreen page — Updated ${days} day${days !== 1 ? 's' : ''} ago.`,
    ageFail: (days) => `Content not updated for ${days} days (>\u00A012 months) — This content is potentially outdated.`,
    ageWarn: (days) => `Content not updated for ${days} days (>\u00A06 months) — Consider refreshing it.`,
    agePass: (days) => `Content updated ${days} day${days !== 1 ? 's' : ''} ago.`,
    reviewLabel: 'Content review',
    reviewWarn: (days) => `Last review ${days} days ago (>\u00A06 months) — Verify the content is still up to date.`,
    reviewPass: (days) => `Content reviewed ${days} day${days !== 1 ? 's' : ''} ago.`,
    yearRefLabel: 'Year references',
    yearRefWarn: (oldest, current, last) => `The content mentions year ${oldest} without reference to ${current} or ${last} — Potentially outdated.`,
    yearRefPass: (year) => `The content references the current year (${year}).`,
    thinAgingLabel: 'Thin and old content',
    thinAgingFail: (words, days) => `Only ${words} words and not updated for ${days} days — Thin old content loses relevance quickly.`,
    fakeRefreshLabel: 'Fake refresh',
    fakeRefreshWarn: (displayedDays, updatedDays) => `The displayed date (${displayedDays} days ago) is newer than the last real modification (${updatedDays} days ago) — avoid bumping the date without a real content update.`,
    fakeRefreshTip: 'Google detects the real modification date. Update the actual content, not just the displayed date.',
  },
  schema: {
    readinessLabel: 'Structured data',
    readinessPass: 'The page has sufficient metadata to generate JSON-LD (title, description, image).',
    readinessFail: 'Complete the title, description and add an image to fully leverage structured data.',
    coverageLabel: 'Structured data coverage',
    coverageOptional: 'Structured data is optional for this page type.',
    coveragePass: (type) => `Enough CMS data to generate a valid ${type} schema.`,
    coverageMissing: (type, fields) => `${type} schema expected for this page — required field(s) missing in the CMS: ${fields}.`,
    coverageMissingTip: 'Complete these fields, or make sure the matching JSON-LD is injected at render time (frontend).',
    coverageRemind: (type, fields) => `${type} schema: required CMS fields are present. Also confirm these required fields the analyzer cannot detect: ${fields}.`,
    faqNoRichResultLabel: 'FAQ / structured data',
    faqNoRichResult: 'FAQPage detected — markup is valid and still read by search/AI engines, but Google no longer renders FAQ rich results (2026). Keep the markup; do not expect an enhanced SERP snippet.',
  },
  technical: {
    canonicalMissingLabel: 'Canonical URL',
    canonicalMissingMessage: 'Empty canonical URL — Define a canonical URL to avoid duplicate content.',
    canonicalInvalidLabel: 'Canonical URL',
    canonicalInvalidMessage: (url) => `Canonical URL "${url}" is invalid — Use an absolute URL (https://...).`,
    canonicalExternalLabel: 'Canonical URL',
    canonicalExternalMessage: 'Canonical URL points to an external domain — Verify this is intentional.',
    canonicalCrossLabel: 'Canonical URL',
    canonicalCrossMessage: (target) => `Canonical URL points to a DIFFERENT page (${target}) — this page de-indexes itself in favor of that URL. Verify this is intentional.`,
    canonicalOkLabel: 'Canonical URL',
    canonicalOkMessage: 'Canonical URL is correctly defined.',
    robotsNoindexLabel: 'Robots noindex',
    robotsNoindexAcceptable: (pageType) => `Page is noindex — Acceptable for a ${pageType} page, but verify this is intended.`,
    robotsNoindexFail: 'Page is noindex — This page will NOT be indexed by Google. Remove noindex unless intentional.',
    robotsNofollowLabel: 'Robots nofollow',
    robotsNofollowMessage: 'Page is nofollow — Links on this page will not pass "link juice". Verify this is intentional.',
    robotsOkLabel: 'Robots meta',
    robotsOkMessage: 'Robots directives are correct — The page is indexable and followed.',
  },
  social: {
    ogImageLabel: 'OG image (meta)',
    ogImageFail: 'No meta image defined — Add an image for social media sharing.',
    ogImagePass: 'Meta image defined — Perfect for social sharing.',
    titleTruncLabel: 'Title on social networks',
    titleTruncFail: (len) => `The title (${len} chars) will be truncated on some social networks (max ~65 chars).`,
    titleTruncPass: 'The title will not be truncated on social networks.',
    descLengthLabel: 'Social description',
    descLengthFail: (len) => `The description (${len} chars) will be truncated on Facebook/LinkedIn (max ~155 chars).`,
    descLengthPass: 'The description is suitable for social sharing.',
  },
  accessibility: {
    shortAnchorsLabel: 'Short anchor links',
    shortAnchorsFail: (count, example) => `${count} link(s) with anchor text under 3 characters (e.g. "${example}") — Screen readers cannot interpret these links.`,
    shortAnchorsPass: 'All links have sufficiently long anchor text.',
    shortAnchorsTip: 'Replace short anchors with descriptive text (e.g. "learn more about our services" instead of "->").',
    altQualityLabel: 'Alt text quality',
    altQualityFail: (count, example) => `${count} image(s) with generic or filename-like alt text (e.g. "${example}") — A descriptive alt improves accessibility.`,
    altQualityPass: 'All alt texts are descriptive.',
    altQualityTip: 'Write alt text that describes the image content (e.g. "Company logo" instead of "image1").',
    emptyHeadingsLabel: 'Empty headings',
    emptyHeadingsFail: (count, tags) => `${count} empty heading(s) detected (${tags}) — Empty headings disrupt screen reader navigation.`,
    emptyHeadingsPass: 'No empty headings detected.',
    emptyHeadingsTip: 'Add text to each heading or remove empty headings.',
    duplicateLinksLabel: 'Adjacent duplicate links',
    duplicateLinksFail: (count) => `${count} pair(s) of adjacent links pointing to the same URL — Merge them to simplify navigation.`,
    duplicateLinksPass: 'No adjacent duplicate links.',
    duplicateLinksTip: 'Combine adjacent links into a single wrapping link (e.g. image + text in one <a>).',
    allCapsLabel: 'All-caps headings',
    allCapsFail: (count, example) => `${count} heading(s) in ALL CAPS (e.g. "${example}") — Screen readers may spell out each letter.`,
    allCapsPass: 'No all-caps headings detected.',
    allCapsTip: 'Use normal case and apply text-transform: uppercase in CSS if needed.',
    linkDensityLabel: 'Link density',
    linkDensityFail: (pct) => `Link text represents ${pct}% of content — Ratio too high, the page looks like spam.`,
    linkDensityWarn: (pct) => `Link text represents ${pct}% of content — High ratio, reduce links or increase text content.`,
    linkDensityPass: (pct) => `Link text represents ${pct}% of content — Balanced ratio.`,
    linkDensityNoContent: 'No text content to calculate link density.',
    linkDensityTip: 'Reduce the number of links or enrich the text content to balance the ratio.',
    imageFilenameLabel: 'Filenames in alt text',
    imageFilenameFail: (count, example) => `${count} image(s) with alt text resembling a filename (e.g. "${example}") — Write a description of the image content.`,
    imageFilenamePass: 'No filename-like alt text detected.',
    imageFilenameTip: 'Replace filenames (IMG_001, DSC_234) with a useful description of the image.',
    altDuplicatesLabel: 'Alt identical to heading',
    altDuplicatesFail: (count, example) => `${count} image(s) with alt text identical to a page heading (e.g. "${example}") — Redundant for screen readers.`,
    altDuplicatesPass: 'No alt text redundant with page headings.',
    altDuplicatesTip: 'Differentiate alt text from headings by specifically describing what the image shows.',
  },
  quality: {
    noDuplicateLabel: 'Original content',
    noDuplicateFail: 'Generic or duplicate content detected — Replace with unique and relevant content.',
    noDuplicatePass: 'The content appears original and unique.',
    substantialLabel: 'Substantial content',
    substantialFail: (count) => `Only ${count} words — Insufficient content to provide value to the reader.`,
    substantialWarn: (count) => `${count} words — Content is thin. Enrich it to better answer search intent.`,
    substantialPass: (count) => `${count} words — Adequate content volume.`,
  },
  ecommerce: {
    priceLabel: 'Price in content',
    pricePass: 'The content mentions a price — Users can identify the product cost.',
    priceFail: 'No price detected in the content — Mention the price or a price indication to improve conversion rate.',
    priceTip: 'Add the product price or a "starting from $X" mention in the description.',
    descriptionLabel: 'Product description length',
    descriptionPass: (count) => `Product description of ${count} words — Detailed enough for SEO.`,
    descriptionFail: (count, min) => `Product description of ${count} words (recommended minimum: ${min}) — Longer descriptions improve ranking and conversion.`,
    descriptionTip: 'Enrich the description with features, benefits, use cases and product specifications.',
    imagesLabel: 'Product images',
    imagesPass: (count) => `${count} image(s) found — Good number of images to showcase the product.`,
    imagesWarn: (count, min) => `${count} image found (recommended: ${min}+) — Add more images to show the product from different angles.`,
    imagesFail: 'No image found — Products without photos are very difficult to sell online.',
    imagesTip: 'Add photos from different angles, detail close-ups and a lifestyle photo.',
    brandLabel: 'Brand in title',
    brandPass: 'The title contains the product/brand keyword — Good for product SEO.',
    brandFailKw: (kw) => `The title does not contain the keyword "${kw}" — Include the product or brand name in the title.`,
    brandFailNoKw: 'No focus keyword defined — Set the product name as the focus keyword to optimize the title.',
    brandTip: 'Place the product or brand name at the beginning of the meta title.',
    metaPriceLabel: 'Price in meta description',
    metaPricePass: 'The meta description mentions the price — Improves click-through rate in search results.',
    metaPriceFail: 'The meta description does not mention the price — Including the price or "starting from $X" improves CTR.',
    metaPriceTip: 'Add the price or a price range in your meta description (e.g. "starting from $29").',
    reviewLabel: 'Reviews and ratings',
    reviewPass: 'The content references reviews/ratings — Good trust signal for buyers.',
    reviewFail: 'No mention of reviews or ratings detected — Customer reviews increase trust and conversion rate.',
    reviewTip: 'Add a customer reviews section or integrate Review/AggregateRating structured data.',
    availabilityLabel: 'Product availability',
    availabilityPass: 'Availability information detected — Buyers know if the product is available.',
    availabilityFail: 'No availability information detected — Clearly indicate if the product is in stock, on order, etc.',
    availabilityTip: 'Add an availability mention (in stock, on order, delivery time).',
  },
}

// ---------------------------------------------------------------------------
// English translations
// ---------------------------------------------------------------------------

const en: SeoTranslations = {
  common: {
    loading: 'Loading...',
    error: 'An error occurred',
    save: 'Save',
    cancel: 'Cancel',
    refresh: 'Refresh',
    export: 'Export',
    exportCsv: 'Export CSV',
    search: 'Search...',
    noResults: 'No results',
    total: 'Total',
    actions: 'Actions',
    edit: 'Edit',
    delete: 'Delete',
    add: 'Add',
    close: 'Close',
    copy: 'Copy',
    copied: 'Copied!',
    confirm: 'Confirm',
    back: 'Back',
  },
  nav: {
    seoGroup: 'SEO',
    dashboard: 'SEO Dashboard',
    sitemapAudit: 'Sitemap Audit',
    redirects: 'Redirects',
    cannibalization: 'Cannibalization',
    configuration: 'Configuration',
    schemaBuilder: 'Schema Builder',
    performance: 'Performance',
    keywordResearch: 'Keyword Research',
    linkGraph: 'Link Graph',
  },
  dashboard: {
    title: 'SEO Dashboard',
    totalPages: 'Total pages',
    avgScore: 'Average score',
    good: 'Good',
    needsWork: 'Needs work',
    critical: 'Critical',
    noKeyword: 'No keyword',
    exportPdf: 'Export PDF',
    filters: {
      noMeta: 'No meta',
      noH1: 'No H1',
      lowReadability: 'Low readability',
    },
  },
  linkGraph: {
    title: 'Internal Link Graph',
    subtitle: 'Link structure visualization',
    nodes: 'Pages',
    edges: 'Links',
    orphanNodes: 'Orphan',
    hubNodes: 'Hubs',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetView: 'Reset view',
    showLabels: 'Show labels',
    hideLabels: 'Hide labels',
    filterByCollection: 'Filter by collection',
    all: 'All',
    clickToOpen: 'Click to open',
    incomingLinks: 'Incoming links',
    outgoingLinks: 'Outgoing links',
  },
  schemaBuilder: {
    title: 'Schema.org Builder',
    selectType: 'Select a schema type',
    preview: 'JSON-LD Preview',
    copyJsonLd: 'Copy JSON-LD',
    copyScript: 'Copy script tag',
  },
  performance: {
    title: 'SEO Performance',
    period7d: '7 days',
    period30d: '30 days',
    period90d: '90 days',
    totalClicks: 'Clicks',
    totalImpressions: 'Impressions',
    avgCtr: 'Avg CTR',
    avgPosition: 'Avg position',
    topPages: 'Top pages',
    topQueries: 'Top queries',
    importData: 'Import data',
    importCsv: 'Import CSV',
    noData: 'No data. Import your Google Search Console data.',
  },
  keywordResearch: {
    title: 'Keyword Research',
    unused: 'Unused',
    related: 'Related',
    trending: 'Trending',
    longTail: 'Long-tail',
    suggestedFor: 'Suggested for',
    usedBy: 'Used by',
    frequency: 'Frequency',
    score: 'Score',
  },
  metaFields: {
    titleLabel: 'Meta Title',
    descriptionLabel: 'Meta Description',
    imageLabel: 'Meta Image',
    generateBtn: 'Generate',
    generating: 'Generating...',
    characters: 'characters',
    completeness: 'Meta completeness',
    complete: 'Complete',
    almostComplete: 'Almost complete',
    partial: 'Partial',
    incomplete: 'Incomplete',
    defined: 'Defined',
    missing: 'Missing',
    serpPreview: 'Google Preview',
    desktop: 'Desktop',
    mobile: 'Mobile',
    noTitle: 'No meta title',
    noDescription: 'No meta description',
    globalSkip: 'Global content — URL checks are not applicable.',
  },
  rules: rulesEn,
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Get the plugin's string dictionary (English). */
export function getTranslations(): SeoTranslations {
  return en
}

/** Shorthand: get a translation value by dot-path */
export function t(path: string): string {
  let result: unknown = en
  for (const key of path.split('.')) {
    if (result && typeof result === 'object' && key in result) {
      result = (result as Record<string, unknown>)[key]
    } else {
      return path // fallback: return the key path
    }
  }
  return typeof result === 'string' ? result : path
}
