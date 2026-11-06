// Client-side exports — React components for Payload admin UI
// "use client" is prepended by tsup onSuccess (see tsup.config.ts)

// Admin styles (Payload 4 tokens only). esbuild extracts this into dist/client.css;
// tsup's onSuccess re-adds the import so host bundlers load it with the components.
import './ui/styles.css'
// Error boundary — exported so the server `views` entry can mount it across the
// RSC boundary (see views/ErrorBoundaryClient.tsx)
export { SeoErrorBoundary } from './components/ErrorBoundary.js'
export type { SeoErrorBoundaryProps, SeoErrorBoundaryLabels } from './components/ErrorBoundary.js'
export { LocalizedSeoErrorBoundary, withSeoErrorBoundary } from './components/withSeoErrorBoundary.js'
export { default as SeoAnalyzerField } from './components/SeoAnalyzer.js'
export { SeoView } from './components/SeoView.js'
export { default as SeoNavLink } from './components/SeoNavLink.js'
export { ContentDecaySection } from './components/ContentDecaySection.js'
export { default as ScoreHistoryChart } from './components/ScoreHistoryChart.js'
export { SitemapAuditView } from './components/SitemapAuditView.js'
export { SeoConfigView } from './components/SeoConfigView.js'
export { SeoSocialPreview } from './components/SeoSocialPreview.js'
export { RedirectManagerView } from './components/RedirectManagerView.js'
export { CannibalizationView } from './components/CannibalizationView.js'
export { SchemaBuilderView } from './components/SchemaBuilderView.js'
export { PerformanceView } from './components/PerformanceView.js'
export { KeywordResearchView } from './components/KeywordResearchView.js'
export { LinkGraphView } from './components/LinkGraphView.js'
// Meta field components
export { MetaTitleField } from './components/MetaTitleField.js'
export { MetaDescriptionField } from './components/MetaDescriptionField.js'
export { MetaImageField } from './components/MetaImageField.js'
export { OverviewField } from './components/OverviewField.js'
// SERP Preview
export { SerpPreview } from './components/SerpPreview.js'
