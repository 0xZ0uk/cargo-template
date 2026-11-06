import { beforeEach, describe, expect, it, vi } from "vitest";
import { recomputeManifestForParent } from "../../src/utils/recomputeManifest";
import type { AbTestingPluginConfig, CollectionABConfig } from "../../src/types/config";

const abConfig: CollectionABConfig = {
  generatePath: ({ doc }) => {
    const slug = doc.slug as string | undefined;
    return slug ? `/${slug}` : null;
  },
};

const STARTED_AT = "2026-11-01T10:00:00.000Z";

function makeReq(
  draftsEnabled: boolean,
  parentStatus = "published",
  { variants = [{ id: "v1", slug: "about--x" }], run = null as { startedAt: string } | null } = {}
) {
  // Variant reads, and the ab-experiments lookup (the run).
  const find = vi.fn().mockImplementation(async ({ collection }: { collection: string }) =>
    collection === "ab-experiments" ? { docs: run ? [run] : [] } : { docs: variants }
  );
  const create = vi.fn().mockImplementation(async ({ data }: { data: unknown }) => data);
  const del = vi.fn().mockResolvedValue({ docs: [], errors: [] });
  const payload = {
    config: { localization: false },
    collections: {
      pages: { config: draftsEnabled ? { versions: { drafts: true } } : { versions: false } },
    },
    findByID: vi.fn().mockResolvedValue({ id: "p1", slug: "about", _status: parentStatus }),
    find,
    create,
    delete: del,
  };
  return { req: { payload } as never, find, create, del };
}

const storage = {
  write: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  read: vi.fn().mockResolvedValue(null),
};
const pluginConfig = {
  collections: { pages: abConfig },
  storage,
} as unknown as AbTestingPluginConfig;

const entry = [
  { bucket: "about--x", rewritePath: "/about--x", passPercentage: 0, startedAt: STARTED_AT },
];

describe("recomputeManifestForParent", () => {
  beforeEach(() => {
    storage.write.mockClear();
    storage.clear.mockClear();
    storage.read.mockReset().mockResolvedValue(null);
  });

  it("only reads published variants when the collection has drafts", async () => {
    const { req, find } = makeReq(true);
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req);
    expect(find.mock.calls[0][0].where).toEqual({
      and: [{ _abVariantOf: { equals: "p1" } }, { _status: { equals: "published" } }],
    });
  });

  it("does not filter by status when the collection has no drafts", async () => {
    const { req, find } = makeReq(false);
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req);
    expect(find.mock.calls[0][0].where).toEqual({ _abVariantOf: { equals: "p1" } });
  });

  it("still honours excludeId alongside the status filter", async () => {
    const { req, find } = makeReq(true);
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req, {
      excludeId: "v9",
    });
    expect(find.mock.calls[0][0].where).toEqual({
      and: [
        { _abVariantOf: { equals: "p1" } },
        { id: { not_equals: "v9" } },
        { _status: { equals: "published" } },
      ],
    });
  });

  it("writes the published variants to the original's key, with the run's start", async () => {
    const { req, create } = makeReq(true, "published", { run: { startedAt: STARTED_AT } });
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req);
    expect(storage.write).toHaveBeenCalledWith("/about", entry, req.payload);
    expect(create).not.toHaveBeenCalled();
  });

  it("starts a run (an ab-experiments row) when the key has none", async () => {
    const { req, create } = makeReq(true);
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req);
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ manifestKey: "/about", parentDocId: "p1", parentCollection: "pages" });
    const written = storage.write.mock.calls[0][1];
    expect(written[0].startedAt).toBe(data.startedAt);
  });

  it("hands the run's start to a custom generateVariantData", async () => {
    const generateVariantData = vi.fn(({ startedAt }: { startedAt: string }) => ({ startedAt }));
    const custom = { ...abConfig, generateVariantData } as CollectionABConfig;
    const { req } = makeReq(true, "published", { run: { startedAt: STARTED_AT } });
    await recomputeManifestForParent("p1", "pages", custom, pluginConfig, req);
    expect(generateVariantData.mock.calls[0][0].startedAt).toBe(STARTED_AT);
  });

  it("ends the run when the last published variant is gone", async () => {
    const { req, del, create } = makeReq(true, "published", { variants: [] });
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req);
    expect(storage.clear).toHaveBeenCalledWith("/about", req.payload);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0][0]).toMatchObject({
      collection: "ab-experiments",
      where: { and: [{ manifestKey: { equals: "/about" } }, { parentCollection: { equals: "pages" } }] },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("clears the key, ends the run and reads no variants, when the original is unpublished", async () => {
    const { req, find, del } = makeReq(true, "draft");
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req);
    expect(storage.clear).toHaveBeenCalledWith("/about", req.payload);
    expect(storage.write).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("leaves the unchanged-entry check to the adapter, never a possibly cached read", async () => {
    storage.read.mockResolvedValue(entry);
    const { req } = makeReq(true, "published", { run: { startedAt: STARTED_AT } });
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req);
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.write).toHaveBeenCalledWith("/about", entry, req.payload);
  });
});
