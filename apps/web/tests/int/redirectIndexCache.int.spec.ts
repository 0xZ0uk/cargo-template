import { describe, expect, it, vi } from 'vitest'

import { createRedirectIndexCache } from '@/app/_frontend/redirectIndexCache'
import { buildRedirectIndex, matchRedirect } from '@/utilities/redirects'

const index = (...from: string[]) =>
  buildRedirectIndex(from.map((f) => ({ from: f, to: '/target', type: '301' })))

function setup() {
  const state = { gen: '1', table: [index('/a')], clock: 0, genFails: false, loadOk: true }
  const readGeneration = vi.fn(async () => {
    if (state.genFails) throw new Error('R2 down')
    return state.gen
  })
  const load = vi.fn(async () => ({ index: state.table[0]!, ok: state.loadOk }))
  const onGenerationError = vi.fn()
  const getIndex = createRedirectIndexCache({
    readGeneration,
    load,
    ttlMs: 60_000,
    failureTtlMs: 10_000,
    onGenerationError,
    now: () => state.clock,
  })

  return { state, readGeneration, load, onGenerationError, getIndex }
}

describe('createRedirectIndexCache', () => {
  it('serves the cached index while the generation is unchanged', async () => {
    const { getIndex, load, readGeneration } = setup()

    await getIndex()
    await getIndex()
    await getIndex()

    expect(load).toHaveBeenCalledTimes(1)
    expect(readGeneration).toHaveBeenCalledTimes(3)
  })

  it('reloads on the next lookup after the generation changes, within the TTL', async () => {
    const { getIndex, load, state } = setup()

    expect(matchRedirect(await getIndex(), '/b')).toBeNull()

    state.table = [index('/a', '/b')]
    state.gen = '2'
    state.clock = 1_000

    expect(matchRedirect(await getIndex(), '/b')).not.toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('drops a deleted redirect on the next lookup', async () => {
    const { getIndex, state } = setup()

    expect(matchRedirect(await getIndex(), '/a')).not.toBeNull()

    state.table = [index()]
    state.gen = '2'

    expect(matchRedirect(await getIndex(), '/a')).toBeNull()
  })

  it('reloads after the TTL even when the generation is unchanged', async () => {
    const { getIndex, load, state } = setup()

    await getIndex()
    state.clock = 60_001
    await getIndex()

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not share an in-flight load between lookups (Workers ties a promise to its request)', async () => {
    const { getIndex, load } = setup()

    await Promise.all([getIndex(), getIndex()])
    // Both missed before either finished, so each loaded on its own...
    expect(load).toHaveBeenCalledTimes(2)
    // ...and the next lookup is served from the cache.
    await getIndex()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('stores the generation read before the load, so a save during the load is not masked', async () => {
    const { getIndex, load, state } = setup()
    load.mockImplementationOnce(async () => {
      // A save lands while D1 is being read.
      state.gen = '2'
      return { index: index('/a'), ok: true }
    })

    await getIndex()
    await getIndex()

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('caches a failed load for the failure TTL, under the generation read', async () => {
    const { getIndex, load, state } = setup()
    state.loadOk = false

    await getIndex()
    state.clock = 5_000
    await getIndex()
    expect(load).toHaveBeenCalledTimes(1)

    state.clock = 10_001
    await getIndex()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('retries a failed load right away when the generation moved', async () => {
    const { getIndex, load, state } = setup()
    state.loadOk = false
    await getIndex()

    state.loadOk = true
    state.gen = '2'
    await getIndex()

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('falls back to the cached index, with a warning, when the generation read fails', async () => {
    const { getIndex, load, onGenerationError, state } = setup()
    await getIndex()

    state.genFails = true
    state.gen = '2'
    state.table = [index()]

    expect(matchRedirect(await getIndex(), '/a')).not.toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
    expect(onGenerationError).toHaveBeenCalledTimes(1)
  })

  it('loads from D1 when the generation read fails and nothing is cached or the entry expired', async () => {
    const { getIndex, load, state } = setup()
    state.genFails = true

    await getIndex()
    expect(load).toHaveBeenCalledTimes(1)

    state.clock = 60_001
    await getIndex()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
