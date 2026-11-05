import { beforeEach, describe, expect, it, vi } from "vitest";
import { recomputeManifestForParent } from "../../src/utils/recomputeManifest";
import type { AbTestingPluginConfig, CollectionABConfig } from "../../src/types/config";

const abConfig: CollectionABConfig = {
  generatePath: ({ doc }) => {
    const slug = doc.slug as string | undefined;
    return slug ? `/${slug}` : null;
  },
};

function makeReq(draftsEnabled: boolean, parentStatus = "published") {
  const find = vi.fn().mockResolvedValue({ docs: [{ id: "v1", slug: "about--x" }] });
  const payload = {
    config: { localization: false },
    collections: {
      pages: { config: draftsEnabled ? { versions: { drafts: true } } : { versions: false } },
    },
    findByID: vi.fn().mockResolvedValue({ id: "p1", slug: "about", _status: parentStatus }),
    find,
  };
  return { req: { payload } as never, find };
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

const entry = [{ bucket: "about--x", rewritePath: "/about--x", passPercentage: 0 }];

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

  it("writes the published variants to the original's key", async () => {
    const { req } = makeReq(true);
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req);
    expect(storage.write).toHaveBeenCalledWith("/about", entry, req.payload);
  });

  it("clears the key, and reads no variants, when the original is unpublished", async () => {
    const { req, find } = makeReq(true, "draft");
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req);
    expect(storage.clear).toHaveBeenCalledWith("/about", req.payload);
    expect(storage.write).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it("doesn't rewrite an entry that hasn't changed", async () => {
    storage.read.mockResolvedValue(entry);
    const { req } = makeReq(true);
    await recomputeManifestForParent("p1", "pages", abConfig, pluginConfig, req);
    expect(storage.write).not.toHaveBeenCalled();
  });
});
