/**
 * Dashboard strings — the English dictionary for all dashboard UI components.
 */

export interface DashboardTranslations {
  common: {
    loading: string
    loadingError: string
    retry: string
    save: string
    saving: string
    cancel: string
    refresh: string
    exportCsv: string
    exportJson: string
    exportPdf: string
    edit: string
    delete: string
    add: string
    noResults: string
    previous: string
    next: string
    page: string
    selected: string
    deselectAll: string
    characters: string
    generate: string
    generating: string
    copy: string
    serverError: string
    networkError: string
    noTitle: string
    none: string
    article: string
    ok: string
    modify: string
  }
  nav: {
    dashboard: string
    sitemapAudit: string
    redirects: string
    cannibalization: string
    performance: string
    keywords: string
    schemaOrg: string
    linkGraph: string
    settings: string
    seo: string
  }
  seoView: {
    loadingAudit: string
    buildingAudit: string
    /** `{time}`: when the shown audit was built. */
    staleAuditRefreshing: string
    staleAudit: string
    auditRefreshing: string
    buildTimeout: string
    runAudit: string
    auditNotRun: string
    errorSaving: string
    auditTitle: string
    pagesAnalyzed: string
    markCornerstone: string
    unmarkCornerstone: string
    bulkOptimizeMeta: string
    bulkOptimizing: string
    bulkConfirm: string
    optimizeSite: string
    optimizeSiteHint: string
    optimizeSiteNothing: string
    bulkPreviewFailed: string
    bulkPreviewTitle: string
    bulkApply: string
    bulkApplying: string
    bulkCancel: string
    bulkExport: string
    bulkNoChanges: string
    bulkCappedNote: string
    bulkAppliedNote: string
    searchPlaceholder: string
    allCollections: string
    allScores: string
    goodScores: string
    needsWork: string
    criticalScores: string
    missingMeta: string
    missingH1: string
    lowReadability: string
    averageScore: string
    goodLabel: string
    needsWorkLabel: string
    criticalLabel: string
    noKeyword: string
    wordsAvg: string
    metaTitle: string
    metaDesc: string
    cornerstone: string
    collection: string
    score: string
    keyword: string
    h1: string
    og: string
    internal: string
    external: string
    words: string
    readability: string
    updated: string
    seoReport: string
    overview: string
    missingMetaTitle: string
    missingMetaDescription: string
    missingKeyword: string
    shortContent: string
    lowReadabilityIssue: string
    missingOgImage: string
    noInternalLinks: string
    lowOverallScore: string
    shortMetaTitle: string
    longMetaTitle: string
    shortMetaDesc: string
    longMetaDesc: string
    top5PriorityActions: string
    perPageDetails: string
    title: string
    slug: string
    issues: string
    identifiedIssues: string
    scoreDistribution: string
    good: string
    critical: string
    generatedBy: string
    resultsDisplayed: string
    noKeywordLabel: string
    wordsAverage: string
    readabilityAvg: string
    noTitleDesc: string
    previousLabel: string
  }
  sitemapAudit: {
    loading404: string
    title: string
    totalPages: string
    internalLinks: string
    linksPerPage: string
    average: string
    orphaned: string
    fragile: string
    brokenLinks: string
    searchPlaceholder: string
    orphanedPages: string
    fragilePages: string
    linkHubs: string
    logs404: string
    externalLinks: string
    noOrphanedPages: string
    orphanedPagesDesc: string
    zeroIncomingLinks: string
    noFragilePages: string
    fragilePagesDesc: string
    oneIncomingLink: string
    from: string
    anchor: string
    noLinkHubs: string
    linkHubsDesc: string
    links: string
    brokenLinksDesc: string
    created: string
    errors: string
    selectedItems: string
    selectAll: string
    suggestion: string
    targetSlug: string
    createdLabel: string
    no404Errors: string
    pages404Desc: string
    last: string
    ref: string
    ignore: string
    checkExternalLinksDesc: string
    scanExternalLinks: string
    verificationInProgress: string
    noBrokenLinks: string
    noExternalLinks: string
    total: string
    broken: string
    timeout: string
    all: string
    brokenLabel: string
    rescan: string
    forceNewVerification: string
    /** External tab: link checker buckets, capped / partial scan state. */
    blocked: string
    unreachable: string
    unverified: string
    unverifiedLabel: string
    unverifiedNote: string
    externalCapped: string
    externalPartial: string
    externalStoppedBudget: string
    externalStoppedDeadline: string
    continueScan: string
    continuingScan: string
    analyzingInternal: string
    brokenLinkTo: string
    linkFrom: string
    /** Bulk 301 buttons on the broken-links tab (followed by the count). */
    redirectSelected: string
    redirectAll: string
  }
  seoConfig: {
    loading: string
    title: string
    subtitle: string
    saved: string
    siteName: string
    siteNameDesc: string
    ignoredPages: string
    ignoredPagesDesc: string
    pageSlugPlaceholder: string
    noIgnoredSlugs: string
    disabledRules: string
    disabledRulesDesc: string
    customThresholds: string
    customThresholdsDesc: string
    defaultLabel: string
    ruleGroupTitle: string
    ruleGroupMetaDescription: string
    ruleGroupUrlSlug: string
    ruleGroupHeadings: string
    ruleGroupContent: string
    ruleGroupImages: string
    ruleGroupLinks: string
    ruleGroupSocial: string
    ruleGroupStructuredData: string
    ruleGroupReadability: string
    ruleGroupQuality: string
    ruleGroupSecondaryKeywords: string
    ruleGroupCornerstone: string
    ruleGroupFreshness: string
    ruleGroupTechnical: string
    ruleGroupAccessibility: string
    ruleGroupEcommerce: string
    thresholdTitleMin: string
    thresholdTitleMax: string
    thresholdMetaDescMin: string
    thresholdMetaDescMax: string
    thresholdMinWordsPages: string
    thresholdMinWordsPosts: string
    thresholdKeywordDensityMin: string
    thresholdKeywordDensityMax: string
    thresholdFleschMin: string
    thresholdSlugMaxLength: string
    sitemapConfig: string
    sitemapExcludedSlugs: string
    slugToExcludePlaceholder: string
    noExcludedSlugs: string
    defaultChangeFrequency: string
    daily: string
    weekly: string
    monthly: string
    yearly: string
    defaultPriority: string
    defaultPriorityDesc: string
    priorityOverrides: string
    priorityOverridesDesc: string
    patternPlaceholder: string
    priority: string
    defaultShort: string
    addOverride: string
    sitemapPreview: string
    viewPreview: string
    refreshPreview: string
    pages: string
    included: string
    excluded: string
    url: string
    lastModified: string
    frequency: string
    breadcrumbConfig: string
    breadcrumbConfigDesc: string
    enableBreadcrumbs: string
    homePageLabel: string
    /** Breadcrumb home label used when the setting is empty (follows the analysis locale). */
    homeLabelDefault: string
    separator: string
    separatorDesc: string
    showOnHomePage: string
    showOnHomePageDesc: string
    preview: string
    websiteCreation: string
  }
  redirectManager: {
    loading: string
    title: string
    totalRedirects: string
    importCsv: string
    total: string
    permanent301: string
    temporary302: string
    addRedirect: string
    sourceUrl: string
    sourceUrlPlaceholder: string
    destinationUrl: string
    destinationUrlPlaceholder: string
    type: string
    adding: string
    searchPlaceholder: string
    urlToTestPlaceholder: string
    test: string
    noMatch: string
    sourceFrom: string
    destinationTo: string
    date: string
    actions: string
    noMatchingRedirects: string
    noRedirects: string
    redirectCreated: string
    redirectDeleted: string
    redirectsDeleted: string
    redirectModified: string
    noValidCsvRedirects: string
    redirectsExported: string
    exportError: string
    createdCount: string
    duplicatesCount: string
    errorsCount: string
  }
  performance: {
    days7: string
    days30: string
    days90: string
    loading: string
    title: string
    subtitle: string
    closeImport: string
    import: string
    importGscData: string
    fileType: string
    pasteJsonHint: string
    importing: string
    importedCount: string
    updatedCount: string
    noData: string
    noDataDesc: string
    truncatedNotice: string
    importData: string
    totalClicks: string
    totalImpressions: string
    averageCtr: string
    averagePosition: string
    topPages: string
    clicks: string
    impressions: string
    ctrPercent: string
    position: string
    topQueries: string
    query: string
    xlsxEntriesLoaded: string
    pages: string
    queries: string
  }
  schemaBuilder: {
    localBusiness: string
    article: string
    product: string
    faq: string
    howTo: string
    organization: string
    event: string
    choose: string
    jsonLdPreview: string
    liveUpdate: string
    copyJsonLd: string
    copyScriptTag: string
    copied: string
    copyError: string
    tip: string
    beforeDeploying: string
    faqNeedsAnswer: string
    visualGeneratorDesc: string
    addButton: string
    name: string
    description: string
    address: string
    city: string
    postalCode: string
    country: string
    phone: string
    email: string
    openingHours: string
    latitude: string
    longitude: string
    website: string
    contactEmail: string
    socialMediaUrls: string
    knowsAbout: string
    startDate: string
    endDate: string
    location: string
    locationAddress: string
    ticketUrl: string
    title: string
    author: string
    authorSameAs: string
    publisher: string
    imageUrl: string
    publicationDate: string
    sku: string
    brand: string
    price: string
    currency: string
    availability: string
    inStock: string
    outOfStock: string
    preOrder: string
    madeToOrder: string
    questionsAnswers: string
    question: string
    answer: string
    steps: string
    stepTitle: string
    stepDescription: string
    priceRange: string
    modificationDate: string
    publisherName: string
    publisherLogo: string
    productName: string
    reviewCount: string
    ratingValue: string
    guideTitle: string
    logoUrl: string
    imageLabel: string
    urlLabel: string
    validateOnRichResults: string
  }
  keywordResearch: {
    loading: string
    title: string
    subtitle: string
    activeKeywords: string
    uniqueTerms: string
    suggestions: string
    searchPlaceholder: string
    noSuggestions: string
    noSuggestionsDesc: string
    noMatchingSuggestions: string
    unused: string
    associated: string
    trending: string
    longTail: string
    all: string
    unusedPlural: string
    associatedPlural: string
    trendingPlural: string
    keyword: string
    freq: string
    seeLess: string
    type: string
    score: string
    frequency: string
    usedBy: string
    suggestedFor: string
  }
  cannibalization: {
    loading: string
    title: string
    subtitle: string
    conflicts: string
    affectedPages: string
    searchPlaceholder: string
    noCannibalization: string
    noCannibalizationDesc: string
    noMatchingConflicts: string
    highRisk: string
    warning: string
    pages: string
  }
  seoAnalyzer: {
    groupTitle: string
    groupDescription: string
    groupUrlSlug: string
    groupHeadings: string
    groupContent: string
    groupImages: string
    groupLinks: string
    groupSocial: string
    groupStructuredData: string
    groupReadability: string
    groupQuality: string
    groupSecondaryKeywords: string
    groupCornerstone: string
    groupFreshness: string
    groupTechnical: string
    groupAccessibility: string
    groupEcommerce: string
    groupEeat: string
    groupGeo: string
    groupHreflang: string
    levelExcellent: string
    levelGood: string
    levelFair: string
    levelNeedsImprovement: string
    categoryCritical: string
    categoryImportant: string
    categoryBonus: string
    seoScore: string
    aiReadiness: string
    aiReadinessTooltip: string
    outOf100: string
    cornerstoneLabel: string
    checksPassed: string
    errorsCount: string
    warningsCount: string
    improvementSuggestions: string
    adjustTitle: string
    currently: string
    titleCharactersIdeal: string
    writeMetaDesc: string
    enrichContent: string
    includeKeywordInTitle: string
    includeKeywordInDesc: string
    addAltText: string
    addInternalLinks: string
    seoCannibalization: string
    highRisk: string
    duplicationHarmsRanking: string
    diluteRanking: string
    viewPages: string
    uniqueKeywordAdvice: string
    suggestedInternalLinks: string
    analyzingContent: string
    readingTime: string
    wordsLabel: string
    secondaryKeywords: string
    generateMeta: string
    metaTitle: string
    metaDescription: string
    emptyValue: string
    optimizeWithAi: string
    optimizeIntro: string
    optimizeRunning: string
    applyAll: string
    applied: string
    whyChanges: string
    labelCurrent: string
    labelSuggested: string
    labelFocusKeyword: string
    heuristicNote: string
    applySaveHint: string
    /** Why "Optimize with AI" is disabled on a document that was never saved. */
    optimizeSaveFirst: string
    noMetaChange: string
  }
  scoreHistory: {
    loading: string
    loadingError: string
    noHistory: string
    noHistoryDesc: string
    improving: string
    declining: string
    stable: string
    scoreEvolution: string
    measures: string
    latestScore: string
  }
  contentDecay: {
    title: string
    lessThan3Months: string
    months3to6: string
    months6to12: string
    moreThan12Months: string
    description: string
    lastUpdate: string
    lastReview: string
    ageDays: string
    action: string
    reviewed: string
    markReviewed: string
    noData: string
  }
  socialPreview: {
    title: string
    facebook: string
    twitter: string
    ogImage: string
    cardImage: string
    previewTitle: string
    previewDescription: string
    characters: string
    pageTitlePlaceholder: string
    pageDescriptionPlaceholder: string
  }
  serpPreview: {
    title: string
    desktop: string
    mobile: string
    noMetaTitle: string
    noMetaDescription: string
    previewTitle: string
    previewDescription: string
    url: string
    characters: string
  }
  metaTitle: {
    label: string
    placeholder: string
    characters: string
    optimal: string
    charactersMissing: string
    charactersTooMany: string
    idealLength: string
  }
  metaDescription: {
    label: string
    placeholder: string
    characters: string
    optimal: string
    charactersMissing: string
    charactersTooMany: string
    idealLength: string
  }
  metaImage: {
    label: string
    imageSet: string
    noImage: string
    set: string
  }
  overview: {
    metaCompleteness: string
    incomplete: string
    partial: string
    almostComplete: string
    complete: string
    titleLabel: string
    descriptionLabel: string
    imageLabel: string
    set: string
    missing: string
  }
}

// ---------------------------------------------------------------------------
// English translations
// ---------------------------------------------------------------------------

const en: DashboardTranslations = {
  common: {
    loading: 'Loading...',
    loadingError: 'Loading error',
    retry: 'Retry',
    save: 'Save',
    saving: 'Saving...',
    cancel: 'Cancel',
    refresh: 'Refresh',
    exportCsv: 'Export CSV',
    exportJson: 'Export JSON',
    exportPdf: 'Export PDF',
    edit: 'Edit',
    delete: 'Delete',
    add: 'Add',
    noResults: 'No results.',
    previous: 'Previous',
    next: 'Next',
    page: 'Page',
    selected: 'selected',
    deselectAll: 'Deselect all',
    characters: 'characters',
    generate: 'Generate',
    generating: 'Generating...',
    copy: 'Copy',
    serverError: 'Server error',
    networkError: 'Network error',
    noTitle: '(no title)',
    none: 'None',
    article: 'Article',
    ok: 'OK',
    modify: 'Edit',
  },
  nav: {
    dashboard: 'Dashboard',
    sitemapAudit: 'Sitemap Audit',
    redirects: 'Redirects',
    cannibalization: 'Cannibalization',
    performance: 'Performance',
    keywords: 'Keywords',
    schemaOrg: 'Schema.org',
    linkGraph: 'Link Graph',
    settings: 'Settings',
    seo: 'SEO',
  },
  seoView: {
    loadingAudit: 'Loading SEO audit...',
    buildingAudit: 'Building the SEO audit… (computed in the background to avoid overloading the server — this can take a moment on a large site)',
    staleAuditRefreshing: 'Showing results from {time}; refreshing…',
    staleAudit: 'Showing results from {time}. Content has changed since; refresh to update.',
    auditRefreshing: 'Showing earlier results; refreshing…',
    buildTimeout: 'The audit is taking longer than expected. Please try again in a moment.',
    runAudit: 'Run site audit',
    auditNotRun: 'The audit analyzes all your pages and posts. It runs in the background (throttled so it won\'t slow the site down) — start it whenever you like.',
    errorSaving: 'Error during save',
    auditTitle: 'SEO Audit',
    pagesAnalyzed: 'pages analyzed',
    markCornerstone: 'Mark as cornerstone',
    unmarkCornerstone: 'Unmark cornerstone',
    bulkOptimizeMeta: 'Optimize meta (AI)',
    bulkOptimizing: 'Analyzing…',
    bulkConfirm: 'Confirm?',
    optimizeSite: 'Optimize site',
    optimizeSiteHint: 'Auto-targets pages that need work (missing meta, no keyword, low score) → preview → apply',
    optimizeSiteNothing: 'Nothing to optimize: every page has a meta title, a meta description, a focus keyword and a score of 70 or more. Select pages to optimize them anyway.',
    bulkPreviewFailed: 'Couldn\'t get AI suggestions ({status}). Try again in a minute.',
    bulkPreviewTitle: 'Proposed meta corrections',
    bulkApply: 'Apply',
    bulkApplying: 'Applying…',
    bulkCancel: 'Cancel',
    bulkExport: 'Export CSV',
    bulkNoChanges: 'No corrections needed on the selection.',
    bulkCappedNote: 'limit reached (narrow the selection)',
    bulkAppliedNote: 'Corrections applied. Refresh to recompute scores (once, after your batches).',
    searchPlaceholder: 'Search (title, slug, keyword)...',
    allCollections: 'All collections',
    allScores: 'All scores',
    goodScores: 'Good (>=80)',
    needsWork: 'Needs work (50-79)',
    criticalScores: 'Critical (<50)',
    missingMeta: 'Missing meta',
    missingH1: 'Missing H1',
    lowReadability: 'Low readability',
    averageScore: 'Average score',
    goodLabel: 'Good (>=80)',
    needsWorkLabel: 'Needs work',
    criticalLabel: 'Critical (<50)',
    noKeyword: 'No keyword',
    wordsAvg: 'Words (avg)',
    metaTitle: 'Meta title',
    metaDesc: 'Meta desc',
    cornerstone: 'Cornerstone',
    collection: 'Collection',
    score: 'Score',
    keyword: 'Keyword',
    h1: 'H1',
    og: 'OG',
    internal: 'Internal',
    external: 'External',
    words: 'Words',
    readability: 'Readability',
    updated: 'Updated',
    seoReport: 'SEO Report',
    overview: 'Overview',
    missingMetaTitle: 'Missing meta title',
    missingMetaDescription: 'Missing meta description',
    missingKeyword: 'Missing keyword',
    shortContent: 'Short content',
    lowReadabilityIssue: 'Low readability',
    missingOgImage: 'Missing OG image',
    noInternalLinks: 'No internal links',
    lowOverallScore: 'Low overall score',
    shortMetaTitle: 'Short meta title',
    longMetaTitle: 'Long meta title',
    shortMetaDesc: 'Short meta description',
    longMetaDesc: 'Long meta description',
    top5PriorityActions: 'Top 5 — Priority actions',
    perPageDetails: 'Per-page details',
    title: 'Title',
    slug: 'Slug',
    issues: 'Issues',
    identifiedIssues: 'Identified issues',
    scoreDistribution: 'Score distribution',
    good: 'Good',
    critical: 'Critical',
    generatedBy: 'Generated by SEO Analyzer',
    resultsDisplayed: 'results displayed',
    noKeywordLabel: 'No keyword',
    wordsAverage: 'Words (average)',
    readabilityAvg: 'Readability (avg)',
    noTitleDesc: 'No title / desc',
    previousLabel: 'Previous:',
  },
  sitemapAudit: {
    loading404: 'Loading 404 logs...',
    title: 'Sitemap & Link Audit',
    totalPages: 'Total pages',
    internalLinks: 'Internal links',
    linksPerPage: 'Links / page',
    average: 'Average',
    orphaned: 'Orphaned',
    fragile: 'Fragile',
    brokenLinks: 'Broken links',
    searchPlaceholder: 'Search (title, slug, target URL)...',
    orphanedPages: 'Orphaned pages',
    fragilePages: 'Fragile pages',
    linkHubs: 'Link hubs',
    logs404: '404 Logs',
    externalLinks: 'External links',
    noOrphanedPages: 'No orphaned pages detected. All pages are accessible via internal links.',
    orphanedPagesDesc: 'Pages with no incoming internal links (inaccessible from other pages)',
    zeroIncomingLinks: '0 incoming links',
    noFragilePages: 'No fragile pages detected. All pages have at least 2 incoming internal links.',
    fragilePagesDesc: 'Pages with only one incoming internal link (fragile — if this link disappears, the page becomes orphaned)',
    oneIncomingLink: '1 incoming link',
    from: 'from:',
    anchor: 'anchor:',
    noLinkHubs: 'No link hubs detected (no page with more than 10 outgoing links).',
    linkHubsDesc: 'Pages with more than 10 internal outgoing links — these pages distribute a lot of PageRank',
    links: 'links',
    brokenLinksDesc: 'Internal links pointing to non-existent slugs — to fix or redirect',
    created: 'created',
    errors: 'errors',
    selectedItems: 'selected',
    selectAll: 'Select all',
    suggestion: 'Suggestion:',
    targetSlug: 'target slug',
    createdLabel: 'Created',
    no404Errors: 'No 404 errors recorded. Enable logging in your Next.js middleware.',
    pages404Desc: '404 pages visited by your users — create 301 redirects to fix them',
    last: 'Last:',
    ref: 'Ref:',
    ignore: 'Ignore',
    checkExternalLinksDesc: 'Check your site\'s external links to detect broken links.',
    scanExternalLinks: 'Scan external links',
    verificationInProgress: 'Verification in progress... (this may take a few seconds)',
    noBrokenLinks: 'No broken links detected.',
    noExternalLinks: 'No external links found.',
    total: 'total',
    broken: 'broken',
    timeout: 'timeout',
    all: 'All',
    brokenLabel: 'Broken',
    rescan: 'Rescan',
    forceNewVerification: 'Force a new verification',
    blocked: 'blocked',
    unreachable: 'unreachable',
    unverified: 'couldn\'t verify',
    unverifiedLabel: 'Couldn\'t verify',
    unverifiedNote: 'Couldn\'t verify: the site answered 401, 403, 429, 451 or 999 (login, bot protection or rate limit). The link may still work in a browser.',
    externalCapped: 'Only the first {max} of {total} unique external links are checked.',
    externalPartial: '{checked} of {total} links checked, {pending} still pending.',
    externalStoppedBudget: 'This step stopped because it used its request budget.',
    externalStoppedDeadline: 'This step stopped because it ran out of time.',
    continueScan: 'Continue scan',
    continuingScan: 'Continuing…',
    analyzingInternal: 'Analyzing internal linking structure...',
    brokenLinkTo: 'broken link to',
    linkFrom: 'link from',
    redirectSelected: '301 selected',
    redirectAll: '301 all',
  },
  seoConfig: {
    loading: 'Loading configuration...',
    title: 'SEO Configuration',
    subtitle: 'Global parameters of the SEO analysis engine',
    saved: 'Configuration saved',
    siteName: 'Site name',
    siteNameDesc: 'Used for brand verification in titles (avoid duplication of site name)',
    ignoredPages: 'Ignored pages',
    ignoredPagesDesc: 'Pages excluded from the global SEO audit',
    pageSlugPlaceholder: 'page-slug',
    noIgnoredSlugs: 'No ignored slugs',
    disabledRules: 'Disabled rules',
    disabledRulesDesc: 'Check the rule groups to ignore during analysis. Disabled rules will not be executed.',
    customThresholds: 'Custom thresholds',
    customThresholdsDesc: 'Leave empty to use default values. Thresholds control the min/max limits of each rule.',
    defaultLabel: 'Default:',
    ruleGroupTitle: 'Title',
    ruleGroupMetaDescription: 'Meta description',
    ruleGroupUrlSlug: 'URL / Slug',
    ruleGroupHeadings: 'H1-H6 Headings',
    ruleGroupContent: 'Content',
    ruleGroupImages: 'Images',
    ruleGroupLinks: 'Links',
    ruleGroupSocial: 'Social networks',
    ruleGroupStructuredData: 'Structured data',
    ruleGroupReadability: 'Readability',
    ruleGroupQuality: 'Quality',
    ruleGroupSecondaryKeywords: 'Secondary keywords',
    ruleGroupCornerstone: 'Cornerstone content',
    ruleGroupFreshness: 'Freshness',
    ruleGroupTechnical: 'Technical',
    ruleGroupAccessibility: 'Accessibility',
    ruleGroupEcommerce: 'E-commerce',
    thresholdTitleMin: 'Title — min length',
    thresholdTitleMax: 'Title — max length',
    thresholdMetaDescMin: 'Meta desc — min length',
    thresholdMetaDescMax: 'Meta desc — max length',
    thresholdMinWordsPages: 'Min words (pages)',
    thresholdMinWordsPosts: 'Min words (posts)',
    thresholdKeywordDensityMin: 'Min keyword density (%)',
    thresholdKeywordDensityMax: 'Max keyword density (%)',
    thresholdFleschMin: 'Min Flesch score',
    thresholdSlugMaxLength: 'Max slug length',
    sitemapConfig: 'Sitemap Configuration',
    sitemapExcludedSlugs: 'Slugs excluded from sitemap',
    slugToExcludePlaceholder: 'slug-to-exclude',
    noExcludedSlugs: 'No excluded slugs',
    defaultChangeFrequency: 'Default change frequency',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    yearly: 'Yearly',
    defaultPriority: 'Default priority',
    defaultPriorityDesc: 'Value between 0 and 1 (default: 0.5)',
    priorityOverrides: 'Priority overrides',
    priorityOverridesDesc: 'Define priority for specific slug patterns',
    patternPlaceholder: 'Pattern (e.g. blog/*)',
    priority: 'Priority',
    defaultShort: 'Default',
    addOverride: 'Add an override',
    sitemapPreview: 'Sitemap preview',
    viewPreview: 'View preview',
    refreshPreview: 'Refresh preview',
    pages: 'pages',
    included: 'included',
    excluded: 'excluded',
    url: 'URL',
    lastModified: 'Last modified',
    frequency: 'Frequency',
    breadcrumbConfig: 'Breadcrumb Configuration',
    breadcrumbConfigDesc: 'Configuration of breadcrumbs and JSON-LD BreadcrumbList schema.',
    enableBreadcrumbs: 'Enable breadcrumbs',
    homePageLabel: 'Home page label',
    homeLabelDefault: 'Home',
    separator: 'Separator',
    separatorDesc: 'Character used between breadcrumb elements',
    showOnHomePage: 'Show on home page',
    showOnHomePageDesc: 'By default, breadcrumb is not displayed on the home page',
    preview: 'Preview',
    websiteCreation: 'Website creation',
  },
  redirectManager: {
    loading: 'Loading redirects...',
    title: 'Redirect Manager',
    totalRedirects: 'redirect(s) total',
    importCsv: 'Import CSV',
    total: 'Total',
    permanent301: '301 (permanent)',
    temporary302: '302 (temporary)',
    addRedirect: 'Add a redirect',
    sourceUrl: 'Source URL',
    sourceUrlPlaceholder: '/old-page',
    destinationUrl: 'Destination URL',
    destinationUrlPlaceholder: '/new-page',
    type: 'Type',
    adding: 'Adding...',
    searchPlaceholder: 'Search (source or destination URL)...',
    urlToTestPlaceholder: '/url-to-test',
    test: 'Test',
    noMatch: 'No match',
    sourceFrom: 'Source (from)',
    destinationTo: 'Destination (to)',
    date: 'Date',
    actions: 'Actions',
    noMatchingRedirects: 'No matching redirects.',
    noRedirects: 'No redirects. Add one above.',
    redirectCreated: 'Redirect created',
    redirectDeleted: 'Redirect deleted',
    redirectsDeleted: 'redirect(s) deleted',
    redirectModified: 'Redirect modified',
    noValidCsvRedirects: 'No valid redirects found in CSV',
    redirectsExported: 'redirect(s) exported',
    exportError: 'Export error',
    createdCount: 'created',
    duplicatesCount: 'duplicate(s)',
    errorsCount: 'error(s)',
  },
  performance: {
    days7: '7 days',
    days30: '30 days',
    days90: '90 days',
    loading: 'Loading performance...',
    title: 'Search Console Performance',
    subtitle: 'Clicks, impressions, CTR and positions from Google Search Console',
    closeImport: 'Close import',
    import: 'Import',
    importGscData: 'Import GSC data',
    fileType: 'XLSX or CSV file',
    pasteJsonHint: 'Or paste JSON (array of entries)',
    importing: 'Importing...',
    importedCount: 'imported',
    updatedCount: 'updated',
    noData: 'No performance data',
    noDataDesc: 'Import your data from Google Search Console to view your clicks, impressions, CTR and positions.',
    truncatedNotice:
      'There is too much data to total here: the figures below cover only the newest rows of the period. Configure the SQL data store (the dataStore option) for exact totals.',
    importData: 'Import data',
    totalClicks: 'Total clicks',
    totalImpressions: 'Total impressions',
    averageCtr: 'Average CTR',
    averagePosition: 'Average position',
    topPages: 'Top pages',
    clicks: 'Clicks',
    impressions: 'Impressions',
    ctrPercent: 'CTR (%)',
    position: 'Position',
    topQueries: 'Top queries',
    query: 'Query',
    xlsxEntriesLoaded: 'entries loaded from XLSX file',
    pages: 'pages',
    queries: 'queries',
  },
  schemaBuilder: {
    localBusiness: 'Local Business',
    article: 'Article',
    product: 'Product',
    faq: 'FAQ',
    howTo: 'How-To Guide',
    organization: 'Organization',
    event: 'Event',
    choose: '-- Choose --',
    jsonLdPreview: 'JSON-LD Preview',
    liveUpdate: 'Live update',
    copyJsonLd: 'Copy JSON-LD',
    copyScriptTag: 'Copy script tag',
    copied: 'copied!',
    copyError: 'Copy error',
    tip: 'Tip:',
    beforeDeploying: 'before deploying to production.',
    faqNeedsAnswer: 'Add at least one question with an answer: Google rejects a FAQPage without any.',
    visualGeneratorDesc: 'Visual generator of structured JSON-LD data for SEO',
    addButton: '+ Add',
    name: 'Name',
    description: 'Description',
    address: 'Address',
    city: 'City',
    postalCode: 'Postal code',
    country: 'Country',
    phone: 'Phone',
    email: 'Email',
    openingHours: 'Opening hours',
    latitude: 'Latitude',
    longitude: 'Longitude',
    website: 'Website',
    contactEmail: 'Contact email',
    socialMediaUrls: 'Social media (URLs)',
    knowsAbout: 'Areas of expertise (topical authority, comma-separated)',
    startDate: 'Start date',
    endDate: 'End date',
    location: 'Location',
    locationAddress: 'Location address',
    ticketUrl: 'Ticket URL',
    title: 'Title',
    author: 'Author',
    authorSameAs: 'Author profiles (sameAs: Wikidata/LinkedIn/ORCID, comma-separated)',
    publisher: 'Publisher',
    imageUrl: 'Image URL',
    publicationDate: 'Publication date',
    sku: 'SKU',
    brand: 'Brand',
    price: 'Price',
    currency: 'Currency',
    availability: 'Availability',
    inStock: 'In stock',
    outOfStock: 'Out of stock',
    preOrder: 'Pre-order',
    madeToOrder: 'Made to order',
    questionsAnswers: 'Questions / Answers',
    question: 'Question',
    answer: 'Answer',
    steps: 'Steps',
    stepTitle: 'Step title',
    stepDescription: 'Step description',
    priceRange: 'Price range',
    modificationDate: 'Modification date',
    publisherName: 'Publisher name',
    publisherLogo: 'Publisher logo (URL)',
    productName: 'Product name',
    reviewCount: 'Review count',
    ratingValue: 'Average rating',
    guideTitle: 'Guide title',
    logoUrl: 'Logo (URL)',
    imageLabel: 'Image (URL)',
    urlLabel: 'URL',
    validateOnRichResults: 'Validate your JSON-LD on',
  },
  keywordResearch: {
    loading: 'Keyword analysis in progress...',
    title: 'Keyword Research',
    subtitle: 'Suggestions based on existing content analysis',
    activeKeywords: 'active keywords',
    uniqueTerms: 'unique terms',
    suggestions: 'suggestions',
    searchPlaceholder: 'Search keyword, page title...',
    noSuggestions: 'No suggestions available',
    noSuggestionsDesc: 'Add content to your pages for analysis to generate suggestions.',
    noMatchingSuggestions: 'No suggestions match your search.',
    unused: 'Unused',
    associated: 'Associated',
    trending: 'Trending',
    longTail: 'Long-tail',
    all: 'All',
    unusedPlural: 'Unused',
    associatedPlural: 'Associated',
    trendingPlural: 'Trending',
    keyword: 'Keyword',
    freq: 'Freq.',
    seeLess: 'See less',
    type: 'Type',
    score: 'Score',
    frequency: 'Frequency',
    usedBy: 'Used by',
    suggestedFor: 'Suggested for',
  },
  cannibalization: {
    loading: 'Cannibalization analysis...',
    title: 'Keyword Cannibalization',
    subtitle: 'Detection of keywords used by multiple pages',
    conflicts: 'conflict(s)',
    affectedPages: 'affected page(s)',
    searchPlaceholder: 'Search keyword, title or slug...',
    noCannibalization: 'No cannibalization detected',
    noCannibalizationDesc: 'Each keyword is used by a single page. Best practice!',
    noMatchingConflicts: 'No conflicts match your search.',
    highRisk: 'High risk',
    warning: 'Warning',
    pages: 'pages',
  },
  seoAnalyzer: {
    groupTitle: 'Title',
    groupDescription: 'Description',
    groupUrlSlug: 'URL / Slug',
    groupHeadings: 'Headings H1-H6',
    groupContent: 'Content',
    groupImages: 'Images',
    groupLinks: 'Links',
    groupSocial: 'Social media',
    groupStructuredData: 'Structured data',
    groupReadability: 'Readability',
    groupQuality: 'Quality',
    groupSecondaryKeywords: 'Secondary keywords',
    groupCornerstone: 'Cornerstone content',
    groupFreshness: 'Content freshness',
    groupTechnical: 'Technical',
    groupAccessibility: 'Accessibility',
    groupEcommerce: 'E-commerce',
    groupEeat: 'E-E-A-T',
    groupGeo: 'GEO (AI)',
    groupHreflang: 'Hreflang',
    levelExcellent: 'Excellent',
    levelGood: 'Good',
    levelFair: 'Fair',
    levelNeedsImprovement: 'Needs improvement',
    categoryCritical: 'Critical',
    categoryImportant: 'Important',
    categoryBonus: 'Bonus',
    seoScore: 'SEO Score',
    aiReadiness: 'AI',
    aiReadinessTooltip: 'AI-readiness — how well the page is structured to be cited by generative engines (AI Overviews, ChatGPT, Perplexity). Separate from the SEO score.',
    outOf100: '/ 100',
    cornerstoneLabel: 'Cornerstone',
    checksPassed: 'checks passed',
    errorsCount: 'error(s)',
    warningsCount: 'warning(s)',
    improvementSuggestions: 'Improvement suggestions',
    adjustTitle: 'Adjust your SEO title',
    currently: 'currently',
    titleCharactersIdeal: 'characters, ideal: 50-60',
    writeMetaDesc: 'Write a meta description of 120-160 characters',
    enrichContent: 'Enrich your content (minimum 300 words recommended)',
    includeKeywordInTitle: 'Include your main keyword in the title',
    includeKeywordInDesc: 'Include your keyword in the meta description',
    addAltText: 'Add alt text to your images',
    addInternalLinks: 'Add internal links to other pages',
    seoCannibalization: 'SEO Cannibalization',
    highRisk: 'High risk',
    duplicationHarmsRanking: 'This level of duplication harms ranking significantly.',
    diluteRanking: 'This can dilute your ranking on this keyword.',
    viewPages: 'View pages',
    uniqueKeywordAdvice: 'Use a unique keyword per page to avoid SEO cannibalization.',
    suggestedInternalLinks: 'Suggested internal links',
    analyzingContent: 'Analyzing content...',
    readingTime: 'Reading time: ~{n} min',
    wordsLabel: 'words',
    secondaryKeywords: 'secondary keyword(s)',
    generateMeta: 'Generate meta',
    metaTitle: 'Meta Title',
    metaDescription: 'Meta Description',
    emptyValue: '(empty)',
    optimizeWithAi: 'Optimize with AI',
    optimizeIntro: 'AI analyzes the page and proposes optimized meta tags (title, description, keyword). Review, then apply.',
    optimizeRunning: 'Analyzing…',
    applyAll: 'Apply',
    applied: 'Applied',
    whyChanges: 'Why these changes',
    labelCurrent: 'Current',
    labelSuggested: 'Suggested',
    labelFocusKeyword: 'Focus keyword',
    heuristicNote: 'Heuristic suggestions (no OpenRouter API key, or no usable AI answer).',
    applySaveHint: 'Fields filled — remember to save the document.',
    optimizeSaveFirst: 'Save the document first: the AI analyzes the saved version.',
    noMetaChange: 'No changes proposed.',
  },
  scoreHistory: {
    loading: 'Loading history...',
    loadingError: 'Error loading history',
    noHistory: 'No history yet.',
    noHistoryDesc: 'Scores will be recorded with each save.',
    improving: 'Improving',
    declining: 'Declining',
    stable: 'Stable',
    scoreEvolution: 'Score Evolution',
    measures: 'measure(s)',
    latestScore: 'Latest score:',
  },
  contentDecay: {
    title: 'Stale Content',
    lessThan3Months: '< 3 months',
    months3to6: '3-6 months',
    months6to12: '6-12 months',
    moreThan12Months: '> 12 months',
    description: 'Detects pages with aging content. Non-updated content loses SEO relevance over time.',
    lastUpdate: 'Last Update',
    lastReview: 'Last Review',
    ageDays: 'Age (days)',
    action: 'Action',
    reviewed: 'Reviewed!',
    markReviewed: 'Mark Reviewed',
    noData: 'No update data available.',
  },
  socialPreview: {
    title: 'Social Networks Preview',
    facebook: 'Facebook',
    twitter: 'X (Twitter)',
    ogImage: 'OG Image 1200x630',
    cardImage: 'Card Image 1200x628',
    previewTitle: 'Title',
    previewDescription: 'Description',
    characters: 'characters',
    pageTitlePlaceholder: 'Page Title',
    pageDescriptionPlaceholder: 'Page description...',
  },
  serpPreview: {
    title: 'Google Preview',
    desktop: 'Desktop',
    mobile: 'Mobile',
    noMetaTitle: 'No meta title',
    noMetaDescription: 'No meta description',
    previewTitle: 'Title',
    previewDescription: 'Description',
    url: 'URL',
    characters: 'characters',
  },
  metaTitle: {
    label: 'Meta Title',
    placeholder: 'SEO title of the page...',
    characters: 'characters',
    optimal: 'Optimal:',
    charactersMissing: 'characters missing',
    charactersTooMany: 'characters too many',
    idealLength: 'Ideal length',
  },
  metaDescription: {
    label: 'Meta Description',
    placeholder: 'SEO description of the page...',
    characters: 'characters',
    optimal: 'Optimal:',
    charactersMissing: 'characters missing',
    charactersTooMany: 'characters too many',
    idealLength: 'Ideal length',
  },
  metaImage: {
    label: 'Meta Image',
    imageSet: 'Image set for social sharing',
    noImage: 'No meta image (recommended for social networks)',
    set: 'Set',
  },
  overview: {
    metaCompleteness: 'Meta Completeness',
    incomplete: 'Incomplete',
    partial: 'Partial',
    almostComplete: 'Almost complete',
    complete: 'Complete',
    titleLabel: 'Title',
    descriptionLabel: 'Description',
    imageLabel: 'Image',
    set: 'Set',
    missing: 'Missing',
  },
}

// ---------------------------------------------------------------------------
// Accessor
// ---------------------------------------------------------------------------

/** The dashboard's string dictionary (English). */
export function getDashboardT(): DashboardTranslations {
  return en
}
