'use client'

/**
 * LinkGraphView — Interactive SVG-based internal link graph visualization.
 * Uses a force-directed layout (spring simulation) computed on mount.
 * No external dependencies (no D3.js, no vis.js).
 */

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { Banner, Button } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { getTranslations } from '../i18n.js'
import { useSeoLocale } from '../hooks/useSeoLocale.js'
import {
  CHART_COLORS,
  Card,
  DataTable,
  EmptyState,
  Field,
  Grid,
  LoadingState,
  StatTile,
  TONE_MARK,
  TonePill,
  ViewBody,
  ViewHeader,
} from '../ui/index.js'
import { useAdminRoute, useSeoApi } from '../hooks/useSeoApi.js'
import './LinkGraphView.css'

// ---------------------------------------------------------------------------
// Collection colors — chart series tokens, assigned by collection order.
// The danger color is left out: it marks orphan nodes.
// ---------------------------------------------------------------------------

const COLLECTION_SERIES = [
  CHART_COLORS[0],
  CHART_COLORS[1],
  CHART_COLORS[2],
  CHART_COLORS[4],
  CHART_COLORS[5],
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string
  docId: number | string
  title: string
  collection: string
  slug: string
  inDegree: number
  outDegree: number
  isOrphan: boolean
  isHub: boolean
}

interface GraphEdge {
  source: string
  target: string
  anchorText?: string
}

interface GraphStats {
  totalNodes: number
  totalEdges: number
  orphanCount: number
  hubCount: number
  avgDegree: number
}

interface UnderLinkedItem {
  slug: string
  title: string
  collection: string
  docId: number | string
  inDegree: number
  underLinkedScore: number
  suggestedInboundLinks: number
  isOrphan: boolean
  depthFromHome: number | null
}

interface CrawlBudget {
  targetInDegree: number
  orphanCount: number
  underLinkedCount: number
  suggestedLinkCount: number
  maxDepth: number | null
  avgDepth: number | null
  unreachableCount: number
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: GraphStats
  // SEO-2026 crawl-budget additions (optional — older API responses omit them).
  crawlBudget?: CrawlBudget
  underLinked?: UnderLinkedItem[]
}

/** Local bilingual labels for the crawl-budget section (kept self-contained). */
const CB_LABELS = {
  fr: {
    title: 'Budget de crawl / maillage interne',
    subtitle: 'Pages à fort potentiel mais peu de liens internes entrants. Renforcer le maillage améliore la couverture de crawl.',
    underLinked: 'Pages sous-maillées',
    suggested: 'Liens internes à ajouter',
    maxDepth: 'Profondeur max',
    unreachable: 'Inaccessibles depuis l’accueil',
    page: 'Page',
    inbound: 'Liens entrants',
    add: 'À ajouter',
    depth: 'Profondeur',
    orphan: 'Orpheline',
    none: 'Maillage interne sain — aucune page sous-maillée détectée.',
  },
  en: {
    title: 'Crawl budget / internal linking',
    subtitle: 'High-value pages with few inbound internal links. A stronger internal mesh improves crawl coverage.',
    underLinked: 'Under-linked pages',
    suggested: 'Internal links to add',
    maxDepth: 'Max depth',
    unreachable: 'Unreachable from home',
    page: 'Page',
    inbound: 'Inbound links',
    add: 'To add',
    depth: 'Depth',
    orphan: 'Orphan',
    none: 'Healthy internal mesh — no under-linked pages found.',
  },
} as const

// Internal positioned node for simulation
interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
}

// ---------------------------------------------------------------------------
// Force simulation parameters
// ---------------------------------------------------------------------------

const SIM_ITERATIONS = 120
const REPULSION_STRENGTH = 5000
const ATTRACTION_STRENGTH = 0.008
const CENTER_GRAVITY = 0.01
const DAMPING = 0.92
const MIN_DISTANCE = 40

// Node sizing
const NODE_MIN_RADIUS = 5
const NODE_MAX_RADIUS = 20

// ---------------------------------------------------------------------------
// Force simulation — runs once on mount, positions nodes, then stops
// ---------------------------------------------------------------------------

function runForceSimulation(
  rawNodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
): SimNode[] {
  const cx = width / 2
  const cy = height / 2

  // Initialize node positions in a circle
  const nodes: SimNode[] = rawNodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / rawNodes.length
    const radius = Math.min(width, height) * 0.35
    return {
      ...n,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
    }
  })

  if (nodes.length === 0) return nodes

  // Build adjacency index for quick lookup
  const nodeIndex = new Map<string, number>()
  for (let i = 0; i < nodes.length; i++) {
    nodeIndex.set(nodes[i].id, i)
  }

  // Bound total work (~n² × iters) so a large graph doesn't freeze the admin tab.
  // Repulsion is O(n²) per iteration, so scale the iteration count down as nodes grow.
  const iterations = Math.max(15, Math.min(SIM_ITERATIONS, Math.floor(1_500_000 / (nodes.length * nodes.length))))

  // Run simulation iterations
  for (let iter = 0; iter < iterations; iter++) {
    // Reduce temperature over time
    const alpha = 1 - iter / iterations

    // 1. Repulsion between all nodes (Coulomb's law)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x
        let dy = nodes[j].y - nodes[i].y
        let dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < MIN_DISTANCE) dist = MIN_DISTANCE

        const force = (REPULSION_STRENGTH * alpha) / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force

        nodes[i].vx -= fx
        nodes[i].vy -= fy
        nodes[j].vx += fx
        nodes[j].vy += fy
      }
    }

    // 2. Attraction along edges (Hooke's law)
    for (const edge of edges) {
      const si = nodeIndex.get(edge.source)
      const ti = nodeIndex.get(edge.target)
      if (si === undefined || ti === undefined) continue

      const dx = nodes[ti].x - nodes[si].x
      const dy = nodes[ti].y - nodes[si].y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1

      const force = ATTRACTION_STRENGTH * dist * alpha
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force

      nodes[si].vx += fx
      nodes[si].vy += fy
      nodes[ti].vx -= fx
      nodes[ti].vy -= fy
    }

    // 3. Center gravity
    for (const node of nodes) {
      node.vx += (cx - node.x) * CENTER_GRAVITY * alpha
      node.vy += (cy - node.y) * CENTER_GRAVITY * alpha
    }

    // 4. Apply velocities with damping
    for (const node of nodes) {
      node.vx *= DAMPING
      node.vy *= DAMPING
      node.x += node.vx
      node.y += node.vy

      // Keep within bounds (with padding)
      const padding = 30
      node.x = Math.max(padding, Math.min(width - padding, node.x))
      node.y = Math.max(padding, Math.min(height - padding, node.y))
    }
  }

  return nodes
}

// ---------------------------------------------------------------------------
// Compute node radius based on degree
// ---------------------------------------------------------------------------

function getNodeRadius(node: GraphNode, maxDegree: number): number {
  if (maxDegree === 0) return NODE_MIN_RADIUS
  const totalDegree = node.inDegree + node.outDegree
  const ratio = totalDegree / maxDegree
  return NODE_MIN_RADIUS + (NODE_MAX_RADIUS - NODE_MIN_RADIUS) * ratio
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LinkGraphView() {
  const seoApi = useSeoApi()
  const adminRoute = useAdminRoute()
  const locale = useSeoLocale()
  const T = getTranslations(locale)
  const cb = CB_LABELS[locale === 'en' ? 'en' : 'fr']

  const [data, setData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(false)
  const [filterCollection, setFilterCollection] = useState<string>('all')
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [tooltipNode, setTooltipNode] = useState<SimNode | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  // Pan & zoom state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Simulation results
  const [simNodes, setSimNodes] = useState<SimNode[]>([])

  // ---------------------------------------------------------------------------
  // Fetch graph data
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(seoApi('/link-graph'), { credentials: 'include', cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: GraphData = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : T.common.error)
    } finally {
      setLoading(false)
    }
  }, [T.common.error])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ---------------------------------------------------------------------------
  // Run simulation when data changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setSimNodes([])
      return
    }

    const width = 1200
    const height = 800
    const positioned = runForceSimulation(data.nodes, data.edges, width, height)
    setSimNodes(positioned)
  }, [data])

  // ---------------------------------------------------------------------------
  // Derived data: filtered nodes, edges, collections
  // ---------------------------------------------------------------------------

  const collections = useMemo(() => {
    if (!data) return []
    const set = new Set(data.nodes.map((n) => n.collection))
    return Array.from(set).sort()
  }, [data])

  const collectionColors = useMemo(() => {
    const map = new Map<string, string>()
    collections.forEach((c, i) => map.set(c, COLLECTION_SERIES[i % COLLECTION_SERIES.length]))
    return map
  }, [collections])
  const getCollectionColor = (collection: string) => collectionColors.get(collection) ?? COLLECTION_SERIES[0]

  const filteredNodeIds = useMemo(() => {
    if (filterCollection === 'all') return new Set(simNodes.map((n) => n.id))
    return new Set(simNodes.filter((n) => n.collection === filterCollection).map((n) => n.id))
  }, [simNodes, filterCollection])

  const visibleNodes = useMemo(() => {
    return simNodes.filter((n) => filteredNodeIds.has(n.id))
  }, [simNodes, filteredNodeIds])

  const visibleEdges = useMemo(() => {
    if (!data) return []
    return data.edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
    )
  }, [data, filteredNodeIds])

  const maxDegree = useMemo(() => {
    return simNodes.reduce((max, n) => Math.max(max, n.inDegree + n.outDegree), 0)
  }, [simNodes])

  // Node index for edge rendering
  const nodeMap = useMemo(() => {
    const map = new Map<string, SimNode>()
    for (const n of simNodes) {
      map.set(n.id, n)
    }
    return map
  }, [simNodes])

  const connectedNodes = useMemo(() => {
    if (!hoveredNode || !data) return new Set<string>()
    const set = new Set<string>()
    set.add(hoveredNode)
    for (const e of data.edges) {
      if (e.source === hoveredNode) set.add(e.target)
      if (e.target === hoveredNode) set.add(e.source)
    }
    return set
  }, [hoveredNode, data])

  // ---------------------------------------------------------------------------
  // Zoom & pan handlers
  // ---------------------------------------------------------------------------

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newScale = Math.max(0.1, Math.min(5, transform.scale * delta))

      // Zoom toward mouse position
      const rect = svgRef.current?.getBoundingClientRect()
      if (rect) {
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const newX = mx - ((mx - transform.x) / transform.scale) * newScale
        const newY = my - ((my - transform.y) / transform.scale) * newScale
        setTransform({ x: newX, y: newY, scale: newScale })
      } else {
        setTransform((prev) => ({ ...prev, scale: newScale }))
      }
    },
    [transform],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only pan with left click on SVG background
      if (e.button !== 0) return
      if ((e.target as Element).tagName !== 'svg' && (e.target as Element).tagName !== 'rect') return
      setIsPanning(true)
      setPanStart({ x: e.clientX - transform.x, y: e.clientY - transform.y })
    },
    [transform],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return
      setTransform((prev) => ({
        ...prev,
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      }))
    },
    [isPanning, panStart],
  )

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  // ---------------------------------------------------------------------------
  // Control actions
  // ---------------------------------------------------------------------------

  const zoomIn = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.min(5, prev.scale * 1.2) }))
  }, [])

  const zoomOut = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.max(0.1, prev.scale * 0.8) }))
  }, [])

  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 })
  }, [])

  // ---------------------------------------------------------------------------
  // Node interaction
  // ---------------------------------------------------------------------------

  const handleNodeHover = useCallback(
    (node: SimNode, e: React.MouseEvent) => {
      setHoveredNode(node.id)
      setTooltipNode(node)
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        setTooltipPos({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 8 })
      }
    },
    [],
  )

  const handleNodeLeave = useCallback(() => {
    setHoveredNode(null)
    setTooltipNode(null)
  }, [])

  const handleNodeClick = useCallback(
    (node: SimNode) => {
      // Open the edit page using the Payload document ID
      window.open(formatAdminURL({ adminRoute, path: `/collections/${node.collection}/${node.docId}` }), '_blank')
    },
    [adminRoute],
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // SVG canvas dimensions
  const SVG_WIDTH = 1200
  const SVG_HEIGHT = 800

  const header = <ViewHeader description={T.linkGraph.subtitle} title={T.linkGraph.title} />

  // Loading state
  if (loading) {
    return (
      <>
        {header}
        <ViewBody>
          <LoadingState label={T.common.loading} />
        </ViewBody>
      </>
    )
  }

  // Error state
  if (error) {
    return (
      <>
        {header}
        <ViewBody>
          <Banner type="danger">
            {T.common.error}: {error}
          </Banner>
          <div className="seo-row">
            <Button buttonStyle="secondary" onClick={fetchData} type="button">
              {T.common.refresh}
            </Button>
          </div>
        </ViewBody>
      </>
    )
  }

  // No data
  if (!data || data.nodes.length === 0) {
    return (
      <>
        {header}
        <ViewBody>
          <EmptyState title={T.common.noResults} />
        </ViewBody>
      </>
    )
  }

  return (
    <>
      {header}
      <ViewBody>
        {/* Stats bar */}
        <Grid>
          <StatTile label={T.linkGraph.nodes} value={data.stats.totalNodes} />
          <StatTile label={T.linkGraph.edges} value={data.stats.totalEdges} />
          <StatTile
            label={T.linkGraph.orphanNodes}
            tone={data.stats.orphanCount > 0 ? 'danger' : 'neutral'}
            value={data.stats.orphanCount}
          />
          <StatTile label={T.linkGraph.hubNodes} tone="brand" value={data.stats.hubCount} />
        </Grid>

        {/* Crawl budget / internal linking (SEO 2026) */}
        {data.crawlBudget && (
          <Card title={cb.title}>
            <p className="seo-text seo-text--small seo-text--secondary">{cb.subtitle}</p>
            <Grid>
              <StatTile
                label={cb.underLinked}
                tone={data.crawlBudget.underLinkedCount > 0 ? 'warning' : 'neutral'}
                value={data.crawlBudget.underLinkedCount}
              />
              <StatTile label={cb.suggested} tone="brand" value={data.crawlBudget.suggestedLinkCount} />
              <StatTile label={cb.maxDepth} value={data.crawlBudget.maxDepth ?? '—'} />
              <StatTile
                label={cb.unreachable}
                tone={data.crawlBudget.unreachableCount > 0 ? 'danger' : 'neutral'}
                value={data.crawlBudget.unreachableCount}
              />
            </Grid>
            {data.underLinked && data.underLinked.length > 0 ? (
              <DataTable aria-label={cb.underLinked}>
                <thead>
                  <tr>
                    <th>{cb.page}</th>
                    <th className="seo-table__num">{cb.inbound}</th>
                    <th className="seo-table__num">{cb.add}</th>
                    <th className="seo-table__num">{cb.depth}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.underLinked.slice(0, 15).map((u) => (
                    <tr key={u.slug}>
                      <td>
                        <span className="seo-row seo-row--nowrap">
                          <span className="seo-link-graph__page">{u.title || u.slug}</span>
                          {u.isOrphan && <TonePill tone="danger">{cb.orphan}</TonePill>}
                        </span>
                      </td>
                      <td className="seo-table__num">{u.inDegree}</td>
                      <td className="seo-table__num">+{u.suggestedInboundLinks}</td>
                      <td className="seo-table__num">{u.depthFromHome ?? '∞'}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <Banner type="success">{cb.none}</Banner>
            )}
          </Card>
        )}

        {/* Controls bar */}
        <div className="seo-row seo-link-graph__controls">
          <Button
            aria-label={T.linkGraph.zoomIn}
            buttonStyle="secondary"
            onClick={zoomIn}
            tooltip={T.linkGraph.zoomIn}
            type="button"
          >
            +
          </Button>
          <Button
            aria-label={T.linkGraph.zoomOut}
            buttonStyle="secondary"
            onClick={zoomOut}
            tooltip={T.linkGraph.zoomOut}
            type="button"
          >
            -
          </Button>
          <Button buttonStyle="secondary" onClick={resetView} type="button">
            {T.linkGraph.resetView}
          </Button>

          <label className="seo-checkbox">
            <input checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} type="checkbox" />
            {showLabels ? T.linkGraph.hideLabels : T.linkGraph.showLabels}
          </label>

          <Field label={T.linkGraph.filterByCollection}>
            <select
              aria-label={T.linkGraph.filterByCollection}
              className="seo-select seo-select--inline"
              onChange={(e) => setFilterCollection(e.target.value)}
              value={filterCollection}
            >
              <option value="all">{T.linkGraph.all}</option>
              {collections.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          {/* Legend */}
          <ul aria-label={T.linkGraph.filterByCollection} className="seo-link-graph__legend">
            {collections.map((c) => (
              <li className="seo-row seo-row--nowrap seo-text seo-text--small seo-text--secondary" key={c}>
                <span aria-hidden="true" className="seo-dot" style={{ background: getCollectionColor(c) }} />
                {c}
              </li>
            ))}
          </ul>
        </div>

        {/* Graph container */}
        <div className="seo-link-graph__canvas" ref={containerRef}>
          <svg
            className={`seo-link-graph__svg${isPanning ? ' seo-link-graph__svg--panning' : ''}`}
            height={SVG_HEIGHT}
            onMouseDown={handleMouseDown}
            onMouseLeave={handleMouseUp}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            ref={svgRef}
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            width="100%"
          >
            {/* Background rect for pan detection */}
            <rect fill="none" height={SVG_HEIGHT} pointerEvents="all" width={SVG_WIDTH} x={0} y={0} />

            {/* Transform group (pan + zoom) */}
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
              {/* Edges */}
              {visibleEdges.map((edge, i) => {
                const sourceNode = nodeMap.get(edge.source)
                const targetNode = nodeMap.get(edge.target)
                if (!sourceNode || !targetNode) return null

                // Test the edge directly instead of looking its index up in
                // `data.edges`: the indexOf ran per edge on every hover render,
                // i.e. O(edges²) — about 9 million comparisons at 3 000 edges,
                // which froze the tab on the slightest pan.
                const isHighlighted =
                  hoveredNode !== null &&
                  (edge.source === hoveredNode || edge.target === hoveredNode)
                const isDimmed = hoveredNode !== null && !isHighlighted

                return (
                  <line
                    className={`seo-link-graph__edge${isHighlighted ? ' seo-link-graph__edge--active' : ''}${isDimmed ? ' seo-link-graph__edge--dimmed' : ''}`}
                    key={`e-${i}`}
                    x1={sourceNode.x}
                    x2={targetNode.x}
                    y1={sourceNode.y}
                    y2={targetNode.y}
                  />
                )
              })}

              {/* Nodes */}
              {visibleNodes.map((node) => {
                const radius = getNodeRadius(node, maxDegree)
                const isHovered = hoveredNode === node.id
                const isConnected = connectedNodes.has(node.id)
                const isDimmed = hoveredNode !== null && !isConnected

                return (
                  <g key={`n-${node.id}`}>
                    {/* Node circle.
                        This one CANNOT become a <button>: HTML interactive
                        elements are not valid inside <svg> (only through a
                        <foreignObject>, which would break the graph layout). It
                        is therefore the one place where role + tabIndex +
                        onKeyDown is the correct answer rather than a shortcut —
                        with an accessible name, which it did not have. */}
                    <circle
                      aria-label={node.title}
                      className={`seo-link-graph__node${isHovered ? ' seo-link-graph__node--hovered' : node.isHub ? ' seo-link-graph__node--hub' : ''}`}
                      cx={node.x}
                      cy={node.y}
                      fillOpacity={isDimmed ? 0.15 : isHovered ? 1 : 0.75}
                      onClick={() => handleNodeClick(node)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleNodeClick(node)
                        }
                      }}
                      onMouseEnter={(e) => handleNodeHover(node, e)}
                      onMouseLeave={handleNodeLeave}
                      r={isHovered ? radius + 3 : radius}
                      role="button"
                      style={{ fill: node.isOrphan ? TONE_MARK.danger : getCollectionColor(node.collection) }}
                      tabIndex={0}
                    />

                    {/* Label */}
                    {showLabels && !isDimmed && (
                      <text
                        className="seo-chart__axis-label"
                        pointerEvents="none"
                        textAnchor="middle"
                        x={node.x}
                        y={node.y + radius + 12}
                      >
                        {node.title.length > 20 ? node.title.slice(0, 18) + '...' : node.title}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>

          {/* Tooltip */}
          {tooltipNode && (
            <div className="seo-link-graph__tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
              <div className="seo-link-graph__tooltip-title">{tooltipNode.title}</div>
              <div className="seo-link-graph__tooltip-muted">
                /{tooltipNode.slug || 'home'} ({tooltipNode.collection})
              </div>
              <div className="seo-row">
                <span>
                  {T.linkGraph.incomingLinks}: {tooltipNode.inDegree}
                </span>
                <span>
                  {T.linkGraph.outgoingLinks}: {tooltipNode.outDegree}
                </span>
              </div>
              {(tooltipNode.isOrphan || tooltipNode.isHub) && (
                <div className="seo-row">
                  {tooltipNode.isOrphan && <TonePill tone="danger">{T.linkGraph.orphanNodes}</TonePill>}
                  {tooltipNode.isHub && <TonePill tone="brand">{T.linkGraph.hubNodes}</TonePill>}
                </div>
              )}
              <div className="seo-link-graph__tooltip-muted">{T.linkGraph.clickToOpen}</div>
            </div>
          )}
        </div>
      </ViewBody>
    </>
  )
}
