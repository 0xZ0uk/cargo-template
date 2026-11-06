import { describe, expect, it, vi } from "vitest";
import type { Payload } from "payload";
import type { StorageAdapter } from "../../src/types/config";
import { createMemoryManifestCache } from "../../src/cache/memoryManifestCache";
import { withManifestCache } from "../../src/cache/withManifestCache";

type V = { bucket: string };

const payload = {} as Payload;
const a = [{ bucket: "a" }];
const b = [{ bucket: "b" }];

function setup(initial: Record<string, V[]> = {}) {
  const rows = new Map(Object.entries(initial));
  const storage = {
    read: vi.fn(async (path: string) => rows.get(path) ?? null),
    write: vi.fn(async (path: string, variants: V[]) => void rows.set(path, variants)),
    clear: vi.fn(async (path: string) => void rows.delete(path)),
    createCollection: vi.fn(),
  } satisfies StorageAdapter<V>;
  let clock = 0;
  const cache = createMemoryManifestCache<V>({ now: () => clock });
  const cached = withManifestCache(storage, { cache, ttl: 10 });
  return { rows, storage, cache, cached, tick: (s: number) => (clock += s * 1000) };
}

describe("withManifestCache", () => {
  it("reads storage on a miss, then serves the hit from the cache", async () => {
    const { storage, cached } = setup({ "/a": a });
    expect(await cached.read("/a", payload)).toEqual(a);
    expect(await cached.read("/a", payload)).toEqual(a);
    expect(storage.read).toHaveBeenCalledTimes(1);
  });

  it("caches a key with no experiment as a negative entry", async () => {
    const { storage, cached } = setup();
    expect(await cached.read("/none", payload)).toBeNull();
    expect(await cached.read("/none", payload)).toBeNull();
    expect(storage.read).toHaveBeenCalledTimes(1);
  });

  it("reads storage again once the entry expires", async () => {
    const { storage, cached, rows, tick } = setup({ "/a": a });
    await cached.read("/a", payload);
    rows.set("/a", b); // written elsewhere: this cache doesn't see it until the TTL ends
    tick(9);
    expect(await cached.read("/a", payload)).toEqual(a);
    tick(1);
    expect(await cached.read("/a", payload)).toEqual(b);
    expect(storage.read).toHaveBeenCalledTimes(2);
  });

  it("writes through: a write replaces the cached value, negative entries included", async () => {
    const { storage, cached } = setup();
    await cached.read("/a", payload);
    await cached.write("/a", b, payload);
    expect(await cached.read("/a", payload)).toEqual(b);
    expect(storage.read).toHaveBeenCalledTimes(1);
  });

  it("a clear caches the key as having no experiment", async () => {
    const { storage, cached } = setup({ "/a": a });
    await cached.read("/a", payload);
    await cached.clear("/a", payload);
    expect(await cached.read("/a", payload)).toBeNull();
    expect(storage.read).toHaveBeenCalledTimes(1);
    expect(storage.clear).toHaveBeenCalledWith("/a", payload);
  });

  it("drops the entry when the storage write fails", async () => {
    const { storage, cached } = setup({ "/a": a });
    await cached.read("/a", payload);
    storage.write.mockRejectedValueOnce(new Error("D1 down"));
    await expect(cached.write("/a", b, payload)).rejects.toThrow("D1 down");
    expect(await cached.read("/a", payload)).toEqual(a);
    expect(storage.read).toHaveBeenCalledTimes(2);
  });

  it("doesn't cache a read that a write overtook", async () => {
    const { storage, cached } = setup({ "/a": a });
    let release!: () => void;
    storage.read.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r));
      return a;
    });
    const slowRead = cached.read("/a", payload);
    await cached.write("/a", b, payload);
    release();
    expect(await slowRead).toEqual(a);
    expect(await cached.read("/a", payload)).toEqual(b);
  });

  it.each(["write", "clear"] as const)(
    "doesn't cache a read that began during a %s and returned the old value",
    async (op) => {
      const { storage, cached, rows } = setup({ "/a": a });
      let releaseStorage!: () => void;
      const held = new Promise<void>((r) => (releaseStorage = r));
      storage.write.mockImplementationOnce(async (path: string, variants: V[]) => {
        await held;
        rows.set(path, variants);
      });
      storage.clear.mockImplementationOnce(async (path: string) => {
        await held;
        rows.delete(path);
      });
      let releaseRead!: () => void;
      storage.read.mockImplementationOnce(async () => {
        await new Promise<void>((r) => (releaseRead = r));
        return a; // queried before the write committed, answered after it
      });

      const pending = op === "write" ? cached.write("/a", b, payload) : cached.clear("/a", payload);
      const slowRead = cached.read("/a", payload);
      releaseStorage();
      await pending;
      releaseRead();
      expect(await slowRead).toEqual(a);
      expect(await cached.read("/a", payload)).toEqual(op === "write" ? b : null);
      expect(storage.read).toHaveBeenCalledTimes(1);
    }
  );

  it("doesn't cache a failed read, and falls back to storage when the cache throws", async () => {
    const { storage, cached } = setup({ "/a": a });
    storage.read.mockRejectedValueOnce(new Error("timeout"));
    await expect(cached.read("/a", payload)).rejects.toThrow("timeout");
    expect(await cached.read("/a", payload)).toEqual(a);

    const broken = withManifestCache(storage, {
      cache: {
        get: () => Promise.reject(new Error("cache down")),
        set: () => Promise.reject(new Error("cache down")),
        delete: () => Promise.reject(new Error("cache down")),
      },
    });
    expect(await broken.read("/a", payload)).toEqual(a);
    await expect(broken.write("/a", b, payload)).resolves.toBeUndefined();
  });

  it("keeps the adapter's other members", () => {
    const { storage, cached } = setup();
    expect(cached.createCollection).toBe(storage.createCollection);
  });
});

describe("createMemoryManifestCache", () => {
  it("drops the oldest entries past maxEntries", () => {
    const cache = createMemoryManifestCache<V>({ maxEntries: 2 });
    cache.set("/1", a, 60);
    cache.set("/2", a, 60);
    cache.set("/1", b, 60); // refreshed: now the newest
    cache.set("/3", a, 60);
    expect(cache.get("/2")).toBeUndefined();
    expect(cache.get("/1")).toEqual(b);
    expect(cache.get("/3")).toEqual(a);
  });

  it("deletes entries", () => {
    const cache = createMemoryManifestCache<V>();
    cache.set("/1", null, 60);
    expect(cache.get("/1")).toBeNull();
    cache.delete("/1");
    expect(cache.get("/1")).toBeUndefined();
  });
});
