/**
 * Performance data endpoint.
 * GET — Fetch performance data with aggregation by period.
 * POST — Import performance data from CSV string or JSON entries array.
 *
 * NOTE: Rate limiting is not handled by this plugin. The consuming application
 * should implement rate limiting via its own middleware (e.g., express-rate-limit,
 * Next.js middleware, or a reverse proxy like Nginx/Caddy).
 */

import type { PayloadHandler } from 'payload'
import { parseJsonBody } from '../helpers/parseBody.js'
import {
  addPosition,
  createPositionAccumulator,
  resolvePosition,
  type PositionAccumulator,
} from '../helpers/weightedPosition.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PerformanceEntry {
  url: string
  query?: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  date: string
}

interface AggregatedRow {
  key: string
  clicks: number
  impressions: number
  ctr: number
  positions: PositionAccumulator
}

// ---------------------------------------------------------------------------
// CSV parser (simple, handles quoted fields)
// ---------------------------------------------------------------------------

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    if (values.length === 0) continue
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j]?.trim() ?? ''
    }
    rows.push(row)
  }

  return rows
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',' || ch === ';' || ch === '\t') {
        result.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  result.push(current)
  return result
}

// ---------------------------------------------------------------------------
// Period filter helper
// ---------------------------------------------------------------------------

function getDateThreshold(period: string): Date {
  const now = new Date()
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    case '30d':
    default:
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

import { isSeoAdminRequest as isAdmin, isSeoPanelUser } from '../helpers/isAdmin.js'
import { payloadStoreResolver, type PerformanceRow, type SeoDataStoreResolver } from '../store/index.js'

export function createPerformanceHandler(resolveStore: SeoDataStoreResolver = payloadStoreResolver): PayloadHandler {
  return async (req) => {
    try {
      if (!isSeoPanelUser(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const method = req.method?.toUpperCase()

      // =======================================================================
      // GET — Fetch and aggregate performance data
      // =======================================================================
      if (method === 'GET') {
        const url = new URL(req.url as string)
        const period = url.searchParams.get('period') || '30d'
        const filterUrl = url.searchParams.get('url') || ''
        const filterQuery = url.searchParams.get('query') || ''
        const threshold = getDateThreshold(period)

        // Fetch all performance entries within the period
        const docs = await resolveStore(req.payload).performance.list({
          since: threshold.toISOString(),
          urlContains: filterUrl || undefined,
          queryContains: filterQuery || undefined,
          limit: 10000,
        })

        // Summary
        let totalClicks = 0
        let totalImpressions = 0
        const summaryPositions = createPositionAccumulator()

        for (const doc of docs) {
          totalClicks += doc.clicks || 0
          totalImpressions += doc.impressions || 0
          addPosition(summaryPositions, doc.position, doc.impressions || 0)
        }

        const avgCtr = totalImpressions > 0
          ? Math.round((totalClicks / totalImpressions) * 10000) / 100
          : 0
        const avgPosition = resolvePosition(summaryPositions)

        // Aggregate by URL (top pages)
        const pageMap = new Map<string, AggregatedRow>()
        for (const doc of docs) {
          const key = doc.url || ''
          if (!pageMap.has(key)) {
            pageMap.set(key, { key, clicks: 0, impressions: 0, ctr: 0, positions: createPositionAccumulator() })
          }
          const entry = pageMap.get(key)!
          entry.clicks += doc.clicks || 0
          entry.impressions += doc.impressions || 0
          addPosition(entry.positions, doc.position, doc.impressions || 0)
        }

        const topPages = Array.from(pageMap.values())
          .map((e) => ({
            url: e.key,
            clicks: e.clicks,
            impressions: e.impressions,
            ctr: e.impressions > 0
              ? Math.round((e.clicks / e.impressions) * 10000) / 100
              : 0,
            position: resolvePosition(e.positions),
          }))
          .sort((a, b) => b.clicks - a.clicks)
          .slice(0, 20)

        // Aggregate by query (top queries)
        const queryMap = new Map<string, AggregatedRow>()
        for (const doc of docs) {
          const key = doc.query || '(no query)'
          if (!queryMap.has(key)) {
            queryMap.set(key, { key, clicks: 0, impressions: 0, ctr: 0, positions: createPositionAccumulator() })
          }
          const entry = queryMap.get(key)!
          entry.clicks += doc.clicks || 0
          entry.impressions += doc.impressions || 0
          addPosition(entry.positions, doc.position, doc.impressions || 0)
        }

        const topQueries = Array.from(queryMap.values())
          .map((e) => ({
            query: e.key,
            clicks: e.clicks,
            impressions: e.impressions,
            ctr: e.impressions > 0
              ? Math.round((e.clicks / e.impressions) * 10000) / 100
              : 0,
            position: resolvePosition(e.positions),
          }))
          .sort((a, b) => b.clicks - a.clicks)
          .slice(0, 20)

        // Raw data for charts (limit 200)
        const data = docs.slice(0, 200).map((doc) => ({
          url: doc.url || '',
          query: doc.query || '',
          clicks: doc.clicks || 0,
          impressions: doc.impressions || 0,
          ctr: doc.ctr || 0,
          position: doc.position || 0,
          date: doc.date || '',
        }))

        return Response.json({
          data,
          summary: { totalClicks, totalImpressions, avgCtr, avgPosition },
          topPages,
          topQueries,
        })
      }

      // =======================================================================
      // POST — Import performance data (admin only)
      // =======================================================================
      if (method === 'POST') {
        if (!isAdmin(req)) {
          return Response.json({ error: 'Admin access required' }, { status: 403 })
        }
        const body = await parseJsonBody(req)

        let entries: PerformanceEntry[] = []

        // Parse CSV if provided
        if (typeof body.csv === 'string' && body.csv.trim()) {
          const rows = parseCSV(body.csv as string)

          // Default date when GSC export doesn't include a date column (Pages/Queries reports)
          const todayISO = new Date().toISOString().split('T')[0]

          for (const row of rows) {
            // Support multiple header variants of GSC exports
            const urlVal = row.url || row.page || row.pages || ''
            const queryVal = row.query || row.queries || row['top queries'] || ''
            const dateVal = row.date || ''

            // GSC exports different report types:
            // - Pages report: has url but no date → default to today
            // - Queries report: has query but no url/date → use query as key, default date
            // - Dates report: has date but no url → skip (no page-level data)
            // Need at least a url OR a query to create an entry
            if (!urlVal && !queryVal) continue

            entries.push({
              url: urlVal || '/',
              query: queryVal || undefined,
              clicks: parseFloat(row.clicks || '0') || 0,
              impressions: parseFloat(row.impressions || '0') || 0,
              ctr: parseFloat((row.ctr || '0').replace('%', '').replace(',', '.')) || 0,
              position: parseFloat((row.position || '0').replace(',', '.')) || 0,
              date: dateVal || todayISO,
            })
          }
        }

        // Parse JSON entries if provided
        if (Array.isArray(body.entries)) {
          for (const entry of body.entries) {
            if (!entry || typeof entry !== 'object') continue
            const e = entry as Record<string, unknown>
            if (!e.url || !e.date) continue
            entries.push({
              url: String(e.url),
              query: e.query ? String(e.query) : undefined,
              clicks: Number(e.clicks) || 0,
              impressions: Number(e.impressions) || 0,
              ctr: Number(e.ctr) || 0,
              position: Number(e.position) || 0,
              date: String(e.date),
            })
          }
        }

        if (entries.length === 0) {
          return Response.json(
            {
              error: 'No valid entry found. The CSV needs at least a "Page" (or "URL") or "Top queries" column. Accepted formats: Google Search Console exports (Pages, Queries or Dates).',
            },
            { status: 400 },
          )
        }

        // Limit entries to prevent excessive processing
        const MAX_ENTRIES = 5000
        let truncatedWarning: string | undefined
        if (entries.length > MAX_ENTRIES) {
          truncatedWarning = `Truncated from ${entries.length} to ${MAX_ENTRIES} entries (max limit)`
          entries = entries.slice(0, MAX_ENTRIES)
        }

        // Normalise dates (one row per url + query + day) and drop invalid entries
        let errors = 0
        const rows: PerformanceRow[] = []
        for (const entry of entries) {
          const d = new Date(entry.date)
          if (isNaN(d.getTime())) {
            errors++
            continue
          }
          rows.push({
            url: entry.url,
            query: entry.query || '',
            clicks: entry.clicks,
            impressions: entry.impressions,
            ctr: entry.ctr,
            position: entry.position,
            date: d.toISOString().split('T')[0] + 'T00:00:00.000Z',
            source: 'csv',
          })
        }

        const result = await resolveStore(req.payload).performance.upsert(rows)
        const { imported, updated } = result
        errors += result.errors

        return Response.json({
          imported,
          updated,
          errors,
          ...(truncatedWarning && { warning: truncatedWarning }),
        })
      }

      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] performance error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
