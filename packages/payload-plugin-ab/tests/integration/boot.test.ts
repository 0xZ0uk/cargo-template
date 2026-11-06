import type { CollectionSlug, Payload, SanitizedConfig } from "payload";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig, getPayload, handleEndpoints } from "payload";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { abTestingPlugin, pruneEndedExperimentRuns, type AbResults } from "../../src";
import { payloadCollectionAdapter } from "../../src/adapters/payloadCollection";
import { abRunMarker, createResolveAbRewrite } from "../../src/middleware";

/**
 * Real Payload 4 on in-memory SQLite (D1 is SQLite), with drafts and two locales like a
 * localized host. Requests go through Payload's own REST handler, as the admin panel's do.
 */
interface Variant {
  bucket: string;
  rewritePath: string;
  passPercentage: number;
}

const storage = payloadCollectionAdapter<Variant>();
const recordConversion = vi.fn();
const rateLimit = vi.fn(async (_req: unknown) => true);
const getResults = vi.fn(async (): Promise<AbResults> => ({ configured: false, reason: "No credentials." }));
const PAGES = "pages" as CollectionSlug;
const MANIFEST = "ab-manifest" as CollectionSlug;

let payload: Payload;
let config: SanitizedConfig;
let token: string;
let memberToken: string;
let readonlyToken: string;
const READONLY_EMAIL = "readonly@example.com";

type Doc = Record<string, unknown> & { id: number | string };

async function api(path: string, init: RequestInit & { auth?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (init.auth !== false) headers.set("Authorization", `JWT ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await handleEndpoints({
    config,
    request: new Request(`http://localhost:3000/api${path}`, { ...init, headers }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> };
}

const manifestRows = async () =>
  (await payload.find({ collection: MANIFEST, pagination: false, overrideAccess: true }))
    .docs as unknown as { id: Doc["id"]; key: string; variants: any; updatedAt: string }[];

const manifest = async (): Promise<Record<string, any>> =>
  Object.fromEntries((await manifestRows()).map((row) => [row.key, row.variants]));

const findPage = (id: Doc["id"], opts: { draft?: boolean; locale?: string } = {}) =>
  payload.findByID({
    collection: PAGES,
    id,
    depth: 0,
    draft: opts.draft ?? false,
    locale: (opts.locale ?? "en") as never,
    overrideAccess: true,
  }) as Promise<Doc>;

async function createPublishedPage(slug: string, title: string): Promise<Doc> {
  const doc = (await payload.create({
    collection: PAGES,
    data: { slug, title, _status: "published" } as never,
    locale: "en" as never,
    overrideAccess: true,
  })) as Doc;
  await payload.update({
    collection: PAGES,
    id: doc.id,
    data: { title: `${title} (pt)`, _status: "published" } as never,
    locale: "pt" as never,
    overrideAccess: true,
  });
  return doc;
}

async function addVariant(parent: Doc): Promise<Doc> {
  const res = await api("/_ab/duplicate", {
    method: "POST",
    body: JSON.stringify({ collectionSlug: "pages", docId: parent.id }),
  });
  expect(res.status).toBe(201);
  return findPage(res.body.id, { draft: true });
}

beforeAll(async () => {
  config = await buildConfig({
    secret: "test-secret",
    db: sqliteAdapter({ client: { url: ":memory:" }, push: true }),
    localization: { locales: ["en", "pt"], defaultLocale: "en", fallback: true },
    admin: { user: "users" },
    collections: [
      { slug: "users", auth: true, fields: [] },
      // Another auth collection (site members): signed in, but not an admin-panel user.
      { slug: "members", auth: true, fields: [] },
      {
        slug: "pages",
        admin: { useAsTitle: "title" },
        access: {
          read: () => true,
          // An admin-panel user who may read pages but not edit them.
          update: ({ req }) => Boolean(req.user) && (req.user as any).email !== READONLY_EMAIL,
        },
        versions: { drafts: true },
        fields: [
          { name: "title", type: "text", localized: true },
          { name: "slug", type: "text", index: true },
          { name: "blocks", type: "array", fields: [{ name: "text", type: "text", localized: true }] },
          {
            name: "meta",
            type: "group",
            fields: [
              { name: "title", type: "text", localized: true },
              { name: "related", type: "relationship", relationTo: "posts" },
            ],
          },
          // A host system field, kept out of promotions with `promoteSkipFields`.
          { name: "internalNote", type: "text" },
        ],
      },
      { slug: "posts", fields: [{ name: "title", type: "text" }] },
    ],
    plugins: [
      abTestingPlugin<Variant>({
        storage,
        collections: {
          pages: {
            generatePath: ({ doc, locale }) =>
              typeof doc.slug === "string" && doc.slug ? `/${locale}/${doc.slug}` : null,
            promoteSkipFields: ["internalNote"],
          },
        },
        measurement: { recordConversion, getResults, rateLimit },
      }),
    ],
  });
  payload = await getPayload({ config });
  await payload.create({
    collection: "users" as CollectionSlug,
    data: { email: "editor@example.com", password: "test-password" } as never,
    overrideAccess: true,
  });
  const login = await payload.login({
    collection: "users" as never,
    data: { email: "editor@example.com", password: "test-password" },
  });
  token = login.token!;
  await payload.create({
    collection: "members" as CollectionSlug,
    data: { email: "member@example.com", password: "test-password" } as never,
    overrideAccess: true,
  });
  memberToken = (
    await payload.login({
      collection: "members" as never,
      data: { email: "member@example.com", password: "test-password" },
    })
  ).token!;
  await payload.create({
    collection: "users" as CollectionSlug,
    data: { email: READONLY_EMAIL, password: "test-password" } as never,
    overrideAccess: true,
  });
  readonlyToken = (
    await payload.login({
      collection: "users" as never,
      data: { email: READONLY_EMAIL, password: "test-password" },
    })
  ).token!;
}, 60_000);

afterAll(async () => {
  await (payload as unknown as { destroy?: () => Promise<void> }).destroy?.();
});

describe("Payload 4 boot", () => {
  it("adds the manifest and experiments collections without version history", () => {
    expect(payload.config.globals).toHaveLength(0);
    expect(payload.collections[MANIFEST]?.config.versions).toBeFalsy();
    expect(payload.collections["ab-experiments" as CollectionSlug]?.config.versions).toBeFalsy();
  });

  it("hides variants through admin.baseFilter, the Payload 4 name", async () => {
    const pages = payload.collections[PAGES]!.config;
    expect(pages.admin.baseListFilter).toBeUndefined();
    expect(await (pages.admin.baseFilter as any)({})).toEqual({ _abVariantOf: { exists: false } });
  });

  it("points the Variants panel at the package's import-map path, with the slug and title fields", () => {
    const field = payload.collections[PAGES]!.config.fields.find(
      (f) => "name" in f && f.name === "_abVariants"
    ) as any;
    expect(field.admin.components.Field).toEqual({
      path: "@cargo/payload-plugin-ab/admin/VariantsField#VariantsField",
      clientProps: { slugField: "slug", titleField: "title", resultsPath: "/_ab/results" },
    });
  });
});

describe("POST /api/_ab/duplicate", () => {
  it("refuses a visitor who isn't signed in", async () => {
    const page = await createPublishedPage("guarded", "Guarded");
    const res = await api("/_ab/duplicate", {
      auth: false,
      method: "POST",
      body: JSON.stringify({ collectionSlug: "pages", docId: page.id }),
    });
    expect(res.status).toBe(401);
  });

  it("refuses a collection the plugin isn't configured on", async () => {
    const post = (await payload.create({
      collection: "posts" as CollectionSlug,
      data: { title: "x" } as never,
      overrideAccess: true,
    })) as Doc;
    const res = await api("/_ab/duplicate", {
      method: "POST",
      body: JSON.stringify({ collectionSlug: "posts", docId: post.id }),
    });
    expect(res.status).toBe(400);
  });

  it("clones the original into an unpublished variant that takes no traffic yet", async () => {
    const page = await createPublishedPage("clone-me", "Clone me");
    const variant = await addVariant(page);

    expect(variant.slug).toMatch(/^clone-me--[0-9a-z]{6}$/u);
    expect(variant._abVariantOf).toBe(page.id);
    expect(variant._abPassPercentage).toBe(1);
    expect(variant.title).toBe("Clone me");
    expect(variant._status).toBe("draft");
    expect(await manifest()).not.toHaveProperty("/en/clone-me");
  });

  it("refuses to make a variant of a variant", async () => {
    const page = await createPublishedPage("nested", "Nested");
    const variant = await addVariant(page);
    const res = await api("/_ab/duplicate", {
      method: "POST",
      body: JSON.stringify({ collectionSlug: "pages", docId: variant.id }),
    });
    expect(res.status).toBe(400);
  });
});

describe("the variant fields", () => {
  let page: Doc;
  let other: Doc;
  let variant: Doc;
  let user: Record<string, unknown>;

  beforeAll(async () => {
    page = await createPublishedPage("locked", "Locked");
    other = await createPublishedPage("locked-other", "Locked other");
    variant = await addVariant(page);
    user = (
      await payload.find({
        collection: "users" as CollectionSlug,
        where: { email: { equals: "editor@example.com" } },
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0]!;
  });

  it("can't be set by a REST create: the page is created as an original", async () => {
    const res = await api("/pages", {
      method: "POST",
      body: JSON.stringify({ title: "Sneaky", slug: "sneaky", _status: "published", _abVariantOf: page.id, _abPassPercentage: 50 }),
    });
    expect(res.status).toBe(201);
    const created = await findPage(res.body.doc.id, { draft: true });
    expect(created._abVariantOf).toBeFalsy();
    expect(created._abPassPercentage).toBeFalsy();
    expect(await manifest()).not.toHaveProperty("/en/locked");
  });

  it("can't make a variant of a variant, or turn an original into a variant, over REST", async () => {
    const res = await api(`/pages/${other.id}`, {
      method: "PATCH",
      body: JSON.stringify({ _abVariantOf: variant.id, _abPassPercentage: 10 }),
    });
    expect(res.status).toBe(200);
    const after = await findPage(other.id, { draft: true });
    expect(after._abVariantOf).toBeFalsy();
    expect(after._abPassPercentage).toBeFalsy();
  });

  it("a REST save of the variant keeps its parent and percentage, as the Variants drawer sends them", async () => {
    const res = await api(`/pages/${variant.id}?draft=true`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Locked B", _abVariantOf: other.id, _abPassPercentage: 60 }),
    });
    expect(res.status).toBe(200);
    const after = await findPage(variant.id, { draft: true });
    expect(after.title).toBe("Locked B");
    expect(after._abVariantOf).toBe(page.id);
    expect(after._abPassPercentage).toBe(1);

    const detach = await api(`/pages/${variant.id}?draft=true`, {
      method: "PATCH",
      body: JSON.stringify({ _abVariantOf: null }),
    });
    expect(detach.status).toBe(200);
    expect((await findPage(variant.id, { draft: true }))._abVariantOf).toBe(page.id);
  });

  it("can't be set by a Local API write that enforces access, as the MCP tools make", async () => {
    const created = (await payload.create({
      collection: PAGES,
      data: { title: "Via MCP", slug: "via-mcp", _abVariantOf: page.id, _abPassPercentage: 20 } as never,
      draft: true,
      overrideAccess: false,
      user: user as never,
    })) as Doc;
    expect((await findPage(created.id, { draft: true }))._abVariantOf).toBeFalsy();

    await payload.update({
      collection: PAGES,
      id: variant.id,
      data: { _abPassPercentage: 40 } as never,
      draft: true,
      overrideAccess: false,
      user: user as never,
    });
    expect((await findPage(variant.id, { draft: true }))._abPassPercentage).toBe(1);
  });

  it("the Variants panel still stages percentages through a REST save of the original", async () => {
    const res = await api(`/pages/${page.id}?draft=true`, {
      method: "PATCH",
      body: JSON.stringify({ _status: "draft", _abPendingPercentages: { [String(variant.id)]: 25 } }),
    });
    expect(res.status).toBe(200);
    expect((await findPage(variant.id, { draft: true }))._abPassPercentage).toBe(25);
  });
});

describe("variant lifecycle", () => {
  let page: Doc;
  let variant: Doc;

  beforeAll(async () => {
    page = await createPublishedPage("about", "About");
    variant = await addVariant(page);
  });

  it("publishing the variant in one locale routes only that locale", async () => {
    await payload.update({
      collection: PAGES,
      id: variant.id,
      data: { title: "About B", _status: "published" } as never,
      locale: "en" as never,
      overrideAccess: true,
    });

    const m = await manifest();
    expect(m["/en/about"]).toHaveLength(1);
    expect(m).not.toHaveProperty("/pt/about");
  });

  it("publishing it in all locales writes a manifest entry per locale and records the experiment", async () => {
    await payload.update({
      collection: PAGES,
      id: variant.id,
      data: { _status: "published" } as never,
      locale: "en" as never,
      publishAllLocales: true,
      overrideAccess: true,
    });

    const m = await manifest();
    const experiments = await payload.find({
      collection: "ab-experiments" as CollectionSlug,
      where: { parentDocId: { equals: String(page.id) } },
      overrideAccess: true,
    });
    expect(experiments.docs.map((d: any) => d.manifestKey).sort()).toEqual(["/en/about", "/pt/about"]);
    // Each entry carries its run's start, so a resolver knows the run from the manifest alone.
    const startOf = (key: string) =>
      (experiments.docs as any[]).find((d) => d.manifestKey === key).startedAt;

    expect(m["/en/about"]).toEqual([
      {
        bucket: variant.slug,
        rewritePath: `/en/${variant.slug}`,
        passPercentage: 1,
        startedAt: startOf("/en/about"),
      },
    ]);
    expect(m["/pt/about"]).toEqual([
      {
        bucket: variant.slug,
        rewritePath: `/pt/${variant.slug}`,
        passPercentage: 1,
        startedAt: startOf("/pt/about"),
      },
    ]);
  });

  it("lists the variant drafts over REST, as the Variants panel does", async () => {
    const query = new URLSearchParams({
      "where[_abVariantOf][equals]": String(page.id),
      depth: "0",
      draft: "true",
    });
    const res = await api(`/pages?${query}`);
    expect(res.status).toBe(200);
    expect(res.body.docs.map((d: Doc) => d.id)).toEqual([variant.id]);
  });

  it("a draft save of the original stages percentages on the variant's draft only", async () => {
    // An unpublished content change on the variant must survive the percentage publish below.
    await payload.update({
      collection: PAGES,
      id: variant.id,
      data: { title: "About B (unpublished edit)", blocks: [{ text: "draft block" }] } as never,
      draft: true,
      locale: "en" as never,
      overrideAccess: true,
    });

    await payload.update({
      collection: PAGES,
      id: page.id,
      data: { _status: "draft", _abPendingPercentages: { [String(variant.id)]: 30 } } as never,
      draft: true,
      locale: "en" as never,
      overrideAccess: true,
    });

    expect((await findPage(variant.id, { draft: true }))._abPassPercentage).toBe(30);
    expect((await findPage(variant.id))._abPassPercentage).toBe(1);
    expect((await manifest())["/en/about"][0].passPercentage).toBe(1);
  });

  it("publishing the original publishes only the percentages", async () => {
    await payload.update({
      collection: PAGES,
      id: page.id,
      data: { _status: "published" } as never,
      locale: "en" as never,
      overrideAccess: true,
    });

    const published = await findPage(variant.id);
    expect(published._abPassPercentage).toBe(30);
    // The variant's unpublished edit stays unpublished, in both locales.
    expect(published.title).toBe("About B");
    expect(published.blocks).toEqual([]);
    expect((await findPage(variant.id, { locale: "pt" })).title).toBe("About (pt)");
    expect((await findPage(variant.id, { draft: true })).title).toBe("About B (unpublished edit)");

    const m = await manifest();
    expect(m["/en/about"][0].passPercentage).toBe(30);
    expect(m["/pt/about"][0].passPercentage).toBe(30);
  });

  it("rejects staged percentages that leave the original under 1%", async () => {
    await expect(
      payload.update({
        collection: PAGES,
        id: page.id,
        data: { _abPendingPercentages: { [String(variant.id)]: 100 } } as never,
        draft: true,
        overrideAccess: true,
      })
    ).rejects.toMatchObject({
      data: { errors: [{ path: "_abPendingPercentages", message: expect.stringMatching(/cannot exceed 99%/u) }] },
    });
  });

  it("the resolver reads the manifest through the Local API and routes to the variant", async () => {
    const resolveAbRewrite = createResolveAbRewrite<Variant>({
      storage,
      getBucket: (v) => v.bucket,
      getRewritePath: (v) => v.rewritePath,
      getPassPercentage: (v) => v.passPercentage,
    });
    const cookie = `payload_ab_bucket_en_about=${variant.slug}`;
    const res = await resolveAbRewrite(cookie, "/about", "/en/about", "/en/about", { payload });
    expect(res?.pathname).toBe(`/en/${variant.slug}`);
  });

  it("deleting the variant over REST clears the manifest entries", async () => {
    const res = await api(`/pages/${variant.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const m = await manifest();
    expect(m).not.toHaveProperty("/en/about");
    expect(m).not.toHaveProperty("/pt/about");
  });
});

describe("a draft-only variant", () => {
  it("takes no traffic and doesn't start the experiment when the original is published", async () => {
    const page = await createPublishedPage("draft-only", "Draft only");
    const variant = await addVariant(page);
    // Payload 4 localizes `_status`: the copy must be a draft in every locale, not only the request's.
    expect((await findPage(variant.id, { locale: "pt" }))._status).toBe("draft");
    await payload.update({
      collection: PAGES,
      id: page.id,
      data: { title: "Draft only, edited", _status: "published" } as never,
      overrideAccess: true,
    });

    expect(await manifest()).not.toHaveProperty("/en/draft-only");
    expect(await manifest()).not.toHaveProperty("/pt/draft-only");
    const experiments = await payload.find({
      collection: "ab-experiments" as CollectionSlug,
      where: { parentDocId: { equals: String(page.id) } },
      overrideAccess: true,
    });
    expect(experiments.docs).toHaveLength(0);
  });
});

describe("unpublishing", () => {
  let page: Doc;
  let variant: Doc;

  const publish = (id: Doc["id"]) =>
    payload.update({
      collection: PAGES,
      id,
      data: { _status: "published" } as never,
      publishAllLocales: true,
      overrideAccess: true,
    });
  const unpublish = (id: Doc["id"], locale?: string) =>
    payload.update({
      collection: PAGES,
      id,
      data: { _status: "draft" } as never,
      ...(locale ? { locale: locale as never } : { unpublishAllLocales: true }),
      overrideAccess: true,
    });

  beforeAll(async () => {
    page = await createPublishedPage("pricing", "Pricing");
    variant = await addVariant(page);
    await publish(variant.id);
    expect(Object.keys(await manifest())).toEqual(expect.arrayContaining(["/en/pricing", "/pt/pricing"]));
  });

  it("a draft save of the published variant keeps it in the manifest", async () => {
    await payload.update({
      collection: PAGES,
      id: variant.id,
      data: { title: "Pricing B, in progress" } as never,
      draft: true,
      overrideAccess: true,
    });
    const m = await manifest();
    expect(m["/en/pricing"]).toHaveLength(1);
    expect(m["/pt/pricing"]).toHaveLength(1);
  });

  it("unpublishing the variant in one locale drops it from that locale only", async () => {
    // Republish first: unpublishing pt while an en draft is pending copies that draft into
    // the main row, which Payload 4 then serves as unpublished in en too.
    await publish(variant.id);
    await unpublish(variant.id, "pt");
    const m = await manifest();
    expect(m["/en/pricing"]).toHaveLength(1);
    expect(m).not.toHaveProperty("/pt/pricing");
  });

  it("unpublishing the variant everywhere, after a draft edit, drops it from the manifest", async () => {
    await publish(variant.id);
    await payload.update({
      collection: PAGES,
      id: variant.id,
      data: { title: "Pricing B, edited again" } as never,
      draft: true,
      overrideAccess: true,
    });
    await unpublish(variant.id);
    const m = await manifest();
    expect(m).not.toHaveProperty("/en/pricing");
    expect(m).not.toHaveProperty("/pt/pricing");
  });

  it("unpublishing the original stops its experiment until it's published again", async () => {
    await publish(variant.id);
    expect(await manifest()).toHaveProperty("/en/pricing");

    await unpublish(page.id);
    expect(await manifest()).not.toHaveProperty("/en/pricing");
    expect(await manifest()).not.toHaveProperty("/pt/pricing");

    await publish(page.id);
    const m = await manifest();
    expect(m["/en/pricing"]).toHaveLength(1);
    expect(m["/pt/pricing"]).toHaveLength(1);
  });
});

describe("experiment rows of another collection", () => {
  // Ids are per collection, and two A/B collections can generate the same path.
  const otherRow = (data: Record<string, unknown>) =>
    payload.create({
      collection: "ab-experiments" as CollectionSlug,
      data: { parentCollection: "landings", locale: "en", startedAt: new Date().toISOString(), ...data } as never,
      overrideAccess: true,
    });
  const rowsOf = async (collection: string, where: Record<string, unknown>) =>
    (
      await payload.find({
        collection: "ab-experiments" as CollectionSlug,
        where: { and: [{ parentCollection: { equals: collection } }, where] } as never,
        overrideAccess: true,
      })
    ).docs;

  it("don't stop this collection's experiment from being recorded, and survive its delete", async () => {
    const page = await createPublishedPage("shared", "Shared");
    await otherRow({ manifestKey: "/en/shared", parentDocId: "999" });
    await otherRow({ manifestKey: "/en/elsewhere", parentDocId: String(page.id) });

    const variant = await addVariant(page);
    await payload.update({
      collection: PAGES,
      id: variant.id,
      data: { _status: "published" } as never,
      overrideAccess: true,
    });
    expect(await rowsOf("pages", { manifestKey: { equals: "/en/shared" } })).toHaveLength(1);

    await payload.delete({ collection: PAGES, id: page.id, overrideAccess: true });
    expect(await rowsOf("pages", { parentDocId: { equals: String(page.id) } })).toHaveLength(0);
    expect(await rowsOf("landings", { parentDocId: { equals: String(page.id) } })).toHaveLength(1);
  });
});

describe("deleting an original", () => {
  it("detaches its variants, clears the manifest and the experiment rows, ended runs too", async () => {
    const page = await createPublishedPage("gone", "Gone");
    const variant = await addVariant(page);
    const setStatus = (status: "published" | "draft") =>
      payload.update({
        collection: PAGES,
        id: variant.id,
        data: { _status: status } as never,
        overrideAccess: true,
      });
    // A run that ended, then a current one.
    await setStatus("published");
    await setStatus("draft");
    await setStatus("published");
    expect(await manifest()).toHaveProperty("/en/gone");
    const before = await payload.find({
      collection: "ab-experiments" as CollectionSlug,
      where: { parentDocId: { equals: String(page.id) } },
      overrideAccess: true,
    });
    expect(before.docs.map((d: any) => Boolean(d.endedAt)).sort()).toEqual([false, true]);

    await payload.delete({ collection: PAGES, id: page.id, overrideAccess: true });

    expect(await manifest()).not.toHaveProperty("/en/gone");
    expect((await findPage(variant.id, { draft: true }))._abVariantOf).toBeFalsy();
    const experiments = await payload.find({
      collection: "ab-experiments" as CollectionSlug,
      where: { parentDocId: { equals: String(page.id) } },
      overrideAccess: true,
    });
    expect(experiments.docs).toHaveLength(0);
  });
});

describe("pruneEndedExperimentRuns", () => {
  it("deletes only runs that ended more than 90 days ago", async () => {
    const day = 24 * 60 * 60 * 1000;
    // Runs other tests ended just now aren't due.
    const now = new Date();
    const row = (label: string, startedDaysAgo: number, endedDaysAgo: number | null) =>
      payload.create({
        collection: "ab-experiments" as CollectionSlug,
        data: {
          manifestKey: `/en/prune-${label}`,
          parentDocId: "prune",
          parentCollection: "pages",
          locale: "en",
          startedAt: new Date(now.getTime() - startedDaysAgo * day).toISOString(),
          endedAt: endedDaysAgo === null ? null : new Date(now.getTime() - endedDaysAgo * day).toISOString(),
        } as never,
        overrideAccess: true,
      });
    await row("expired", 120, 91);
    await row("recent", 120, 89);
    // Open for months: still running, never pruned.
    await row("open", 400, null);

    expect(await pruneEndedExperimentRuns(payload, { now })).toBe(1);
    const left = await payload.find({
      collection: "ab-experiments" as CollectionSlug,
      where: { parentDocId: { equals: "prune" } },
      overrideAccess: true,
    });
    expect(left.docs.map((d: any) => d.manifestKey).sort()).toEqual(["/en/prune-open", "/en/prune-recent"]);
    expect(await pruneEndedExperimentRuns(payload, { now })).toBe(0);
  });
});

describe("manifest storage", () => {
  const v = (bucket: string): Variant[] => [{ bucket, rewritePath: `/${bucket}`, passPercentage: 10 }];
  const rowsFor = async (key: string) => (await manifestRows()).filter((row) => row.key === key);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps concurrent writes for different keys", async () => {
    await Promise.all([
      storage.write("/store/a", v("a"), payload),
      storage.write("/store/b", v("b"), payload),
    ]);
    expect(await storage.read("/store/a", payload)).toEqual(v("a"));
    expect(await storage.read("/store/b", payload)).toEqual(v("b"));

    await Promise.all([
      storage.write("/store/a", v("a2"), payload),
      storage.write("/store/b", v("b2"), payload),
    ]);
    expect(await storage.read("/store/a", payload)).toEqual(v("a2"));
    expect(await storage.read("/store/b", payload)).toEqual(v("b2"));
  });

  it("clearing one key leaves the others", async () => {
    await storage.write("/store/c", v("c"), payload);
    await storage.write("/store/d", v("d"), payload);
    await storage.clear("/store/c", payload);
    expect(await storage.read("/store/c", payload)).toBeNull();
    expect(await storage.read("/store/d", payload)).toEqual(v("d"));
    await expect(storage.clear("/store/never-written", payload)).resolves.toBeUndefined();
  });

  it("a create race on a new key ends with one row", async () => {
    // Hold both writers' lookups until both have run, so both see no row and both create.
    const find = payload.find.bind(payload);
    const create = vi.spyOn(payload, "create");
    let arrived = 0;
    let open!: () => void;
    const barrier = new Promise<void>((resolve) => (open = resolve));
    vi.spyOn(payload, "find").mockImplementation((async (args: any) => {
      const result = await find(args);
      if (args.collection === MANIFEST && arrived < 2) {
        if (++arrived === 2) open();
        await barrier;
      }
      return result;
    }) as never);

    await Promise.all([
      storage.write("/store/race", v("first"), payload),
      storage.write("/store/race", v("second"), payload),
    ]);
    const rows = await rowsFor("/store/race");
    expect(rows).toHaveLength(1);
    expect([v("first"), v("second")]).toContainEqual(rows[0]!.variants);
    // Both creates ran; the loser re-found the row and updated it.
    expect(create.mock.calls.filter(([args]) => args.collection === MANIFEST)).toHaveLength(2);
    expect(create.mock.settledResults.map((r) => r.type).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("doesn't rewrite a row that hasn't changed", async () => {
    await storage.write("/store/same", v("same"), payload);
    const [before] = await rowsFor("/store/same");
    await new Promise((r) => setTimeout(r, 5));
    await storage.write("/store/same", v("same"), payload);
    const [after] = await rowsFor("/store/same");
    expect(after!.updatedAt).toBe(before!.updatedAt);
  });

  it("isn't readable over REST without a session, nor are the experiments", async () => {
    await storage.write("/store/private", v("p"), payload);

    expect((await api("/ab-manifest", { auth: false })).status).toBe(403);
    expect((await api("/ab-experiments", { auth: false })).status).toBe(403);
    expect((await api("/ab-manifest", { auth: false, method: "POST", body: "{}" })).status).toBe(403);

    // Signed in, it can be read (debug view), but still not written over the API.
    expect((await api("/ab-manifest")).status).toBe(200);
    const create = await api("/ab-manifest", {
      method: "POST",
      body: JSON.stringify({ key: "/store/forged", variants: [] }),
    });
    expect(create.status).toBe(403);

    // The Local API, as the plugin and the resolver use it, still reads.
    expect(await storage.read("/store/private", payload)).toEqual(v("p"));
  });

  it("the REST fallback reads only with credentials", async () => {
    await storage.write("/store/rest", v("r"), payload);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      handleEndpoints({ config, request: new Request(input, init) })
    );
    vi.stubGlobal("fetch", fetchMock);

    const anonymous = payloadCollectionAdapter<Variant>({ serverURL: "http://localhost:3000" });
    expect(await anonymous.read("/store/rest")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const authed = payloadCollectionAdapter<Variant>({
      serverURL: "http://localhost:3000",
      authorization: `JWT ${token}`,
    });
    expect(await authed.read("/store/rest")).toEqual(v("r"));
    expect(await authed.read("/store/missing")).toBeNull();

    const wrong = payloadCollectionAdapter<Variant>({
      serverURL: "http://localhost:3000",
      authorization: "JWT not-a-token",
    });
    await expect(wrong.read("/store/rest")).rejects.toThrow();
  });
});

describe("measurement", () => {
  let page: Doc;
  let variant: Doc;
  const KEY = "/en/measured";

  const convert = (body: unknown, cookie = "", init: { contentType?: string } = {}) =>
    handleEndpoints({
      config,
      request: new Request("http://localhost:3000/api/_ab/convert", {
        method: "POST",
        headers: { "Content-Type": init.contentType ?? "application/json", cookie },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    }).then(async (res) => ({
      status: res.status,
      setCookie: res.headers.get("set-cookie"),
      body: (await res.json().catch(() => null)) as Record<string, any>,
    }));

  beforeAll(async () => {
    page = await createPublishedPage("measured", "Measured");
    variant = await addVariant(page);
    await payload.update({
      collection: PAGES,
      id: variant.id,
      data: { _status: "published" } as never,
      locale: "en" as never,
      publishAllLocales: true,
      overrideAccess: true,
    });
  });

  afterEach(() => {
    recordConversion.mockReset();
    getResults.mockClear();
    rateLimit.mockClear();
  });

  /** The `ab-experiments` rows of one key, oldest first. */
  const runRows = async (key: string) =>
    (
      await payload.find({
        collection: "ab-experiments" as CollectionSlug,
        where: { manifestKey: { equals: key } },
        sort: "startedAt",
        overrideAccess: true,
      })
    ).docs as unknown as { startedAt: string; endedAt?: string | null }[];

  /** The marker value for this run: `<bucket>:<run>`. */
  const runMarker = async (bucket: string) => {
    const { docs } = await payload.find({
      collection: "ab-experiments" as CollectionSlug,
      where: { manifestKey: { equals: KEY } },
      overrideAccess: true,
    });
    return abRunMarker(bucket, (docs[0] as any).startedAt);
  };

  describe("POST /api/_ab/convert", () => {
    const assigned = (bucket: string) =>
      `ab_visitor_id=visitor-1; payload_ab_bucket_en_measured=${encodeURIComponent(bucket)}`;

    it("records a conversion with the bucket and visitor from the cookies, not the body", async () => {
      const res = await convert(
        { experiment: KEY, goal: "cta", bucket: "original", visitorId: "forged" },
        assigned(variant.slug as string)
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ recorded: true });
      expect(recordConversion).toHaveBeenCalledTimes(1);
      expect(recordConversion.mock.calls[0]![0]).toEqual({
        experiment: KEY,
        bucket: variant.slug,
        goal: "cta",
        visitorId: "visitor-1",
      });
      const marker = encodeURIComponent(await runMarker(variant.slug as string));
      expect(res.setCookie).toMatch(
        new RegExp(`^payload_ab_cv_en_measured=${marker}; Path=/; .*SameSite=Lax; HttpOnly$`, "u")
      );
      expect(rateLimit).toHaveBeenCalledTimes(1);
    });

    it("counts a visitor once per run and bucket", async () => {
      const original = encodeURIComponent(await runMarker("original"));
      const cookie = `${assigned("original")}; payload_ab_cv_en_measured=${original}`;
      const res = await convert({ experiment: KEY, goal: "cta" }, cookie);
      expect(res.body).toEqual({ recorded: false, reason: "duplicate" });
      expect(recordConversion).not.toHaveBeenCalled();

      // A visitor moved to another bucket (their variant was deleted) converts there again.
      const moved = `${assigned(variant.slug as string)}; payload_ab_cv_en_measured=${original}`;
      expect((await convert({ experiment: KEY, goal: "cta" }, moved)).body).toEqual({ recorded: true });

      // A marker from an earlier experiment on this page (bare bucket, or another run) doesn't count.
      for (const stale of ["original", encodeURIComponent(abRunMarker("original", "2020-01-01T00:00:00.000Z"))]) {
        const returning = `${assigned("original")}; payload_ab_cv_en_measured=${stale}`;
        expect((await convert({ experiment: KEY, goal: "cta" }, returning)).body).toEqual({ recorded: true });
      }
    });

    it("answers 429 and records nothing when rateLimit refuses", async () => {
      rateLimit.mockResolvedValueOnce(false);
      const res = await convert({ experiment: KEY, goal: "cta" }, assigned("original"));
      expect(res.status).toBe(429);
      expect(res.setCookie).toBeNull();
      expect(recordConversion).not.toHaveBeenCalled();
    });

    it("lets the request through when rateLimit throws", async () => {
      rateLimit.mockRejectedValueOnce(new Error("binding down"));
      const res = await convert({ experiment: KEY, goal: "cta" }, assigned("original"));
      expect(res.status).toBe(200);
      expect(recordConversion).toHaveBeenCalledTimes(1);
    });

    it("accepts sendBeacon's text/plain body", async () => {
      const res = await convert(JSON.stringify({ experiment: KEY, goal: "cta" }), assigned("original"), {
        contentType: "text/plain;charset=UTF-8",
      });
      expect(res.status).toBe(200);
      expect(recordConversion).toHaveBeenCalledTimes(1);
    });

    it("refuses a visitor without an assignment, or with a bucket that isn't live", async () => {
      expect((await convert({ experiment: KEY, goal: "cta" })).status).toBe(409);
      // No visitor id: the cookies weren't set by the resolver.
      const noVisitor = `payload_ab_bucket_en_measured=original`;
      expect((await convert({ experiment: KEY, goal: "cta" }, noVisitor)).status).toBe(409);
      expect((await convert({ experiment: KEY, goal: "cta" }, assigned("measured--gone00"))).status).toBe(409);
      expect(recordConversion).not.toHaveBeenCalled();
    });

    it("validates the body", async () => {
      const cookie = assigned("original");
      expect((await convert("not json", cookie)).status).toBe(400);
      expect((await convert({ experiment: KEY, goal: "signup" }, cookie)).status).toBe(400);
      expect((await convert({ experiment: "measured", goal: "cta" }, cookie)).status).toBe(400);
      expect((await convert({ experiment: KEY }, cookie)).status).toBe(400);
      expect((await convert(JSON.stringify({ experiment: KEY, goal: "cta", pad: "x".repeat(4096) }), cookie)).status).toBe(413);
      expect(recordConversion).not.toHaveBeenCalled();
    });

    it("answers 404 for a page without an experiment", async () => {
      const res = await convert({ experiment: "/en/no-experiment", goal: "cta" }, assigned("original"));
      expect(res.status).toBe(404);
    });

    it("answers 500 when the host's recordConversion throws, and sets no marker", async () => {
      recordConversion.mockRejectedValueOnce(new Error("boom"));
      const res = await convert({ experiment: KEY, goal: "cta" }, assigned("original"));
      expect(res.status).toBe(500);
      expect(res.setCookie).toBeNull();
    });
  });

  describe("GET /api/_ab/results", () => {
    const results = (query: string, auth: string | null = `JWT ${token}`) =>
      handleEndpoints({
        config,
        request: new Request(`http://localhost:3000/api/_ab/results?${query}`, {
          headers: auth ? { Authorization: auth } : {},
        }),
      }).then(async (res) => ({ status: res.status, body: (await res.json()) as Record<string, any> }));

    it("is for admin-panel users only", async () => {
      expect((await results(`collection=pages&id=${page.id}`, null)).status).toBe(401);
      expect((await results(`collection=pages&id=${page.id}`, `JWT ${memberToken}`)).status).toBe(403);
      expect(getResults).not.toHaveBeenCalled();
    });

    it("computes the key from the document and passes the experiment's start", async () => {
      const res = await results(`collection=pages&id=${page.id}&locale=pt`);
      expect(res.status).toBe(200);
      expect(res.body.experiment).toEqual({ key: "/pt/measured", startedAt: expect.any(String) });
      expect(res.body.results).toEqual({ configured: false, reason: "No credentials." });
      expect(getResults).toHaveBeenCalledWith(
        expect.objectContaining({ experiment: "/pt/measured", startedAt: res.body.experiment.startedAt })
      );
    });

    it("returns no experiment before a variant is published", async () => {
      const draftOnly = await createPublishedPage("not-started", "Not started");
      await addVariant(draftOnly);
      const res = await results(`collection=pages&id=${draftOnly.id}`);
      expect(res.body).toEqual({ experiment: null, results: null, pastRuns: [] });
      expect(getResults).not.toHaveBeenCalled();
    });

    it("validates the collection and refuses a variant", async () => {
      expect((await results(`collection=posts&id=1`)).status).toBe(400);
      expect((await results(`collection=pages`)).status).toBe(400);
      expect((await results(`collection=pages&id=${variant.id}`)).status).toBe(400);
    });

    it("starts a new run, with a later start, after the experiment ended", async () => {
      const restarted = await createPublishedPage("restarted", "Restarted");
      const publish = (id: Doc["id"]) =>
        payload.update({
          collection: PAGES,
          id,
          data: { _status: "published" } as never,
          locale: "en" as never,
          publishAllLocales: true,
          overrideAccess: true,
        });
      const first = await addVariant(restarted);
      await publish(first.id);
      const before = await results(`collection=pages&id=${restarted.id}`);
      expect(before.body.experiment?.startedAt).toEqual(expect.any(String));

      // Ending it: the last variant goes, and the run ends but stays, with its own results.
      expect((await api(`/pages/${first.id}`, { method: "DELETE" })).status).toBe(200);
      getResults.mockClear();
      const ended = await results(`collection=pages&id=${restarted.id}`);
      expect(ended.body).toEqual({
        experiment: null,
        results: null,
        pastRuns: [
          {
            key: "/en/restarted",
            startedAt: before.body.experiment.startedAt,
            endedAt: expect.any(String),
            results: { configured: false, reason: "No credentials." },
          },
        ],
      });
      const endedAt = ended.body.pastRuns[0].endedAt;
      expect(Date.parse(endedAt)).toBeGreaterThanOrEqual(Date.parse(before.body.experiment.startedAt));
      expect(getResults).toHaveBeenCalledWith(
        expect.objectContaining({
          experiment: "/en/restarted",
          startedAt: before.body.experiment.startedAt,
          endedAt,
        })
      );
      const rows = await runRows("/en/restarted");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.endedAt).toBe(endedAt);

      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await addVariant(restarted);
      await publish(second.id);
      const after = await results(`collection=pages&id=${restarted.id}`);
      expect(Date.parse(after.body.experiment.startedAt)).toBeGreaterThan(
        Date.parse(before.body.experiment.startedAt)
      );
      // A new row for the new run; the ended one is listed as past.
      expect(await runRows("/en/restarted")).toHaveLength(2);
      expect(after.body.pastRuns).toEqual([expect.objectContaining({ startedAt: before.body.experiment.startedAt, endedAt })]);
      // The manifest entry carries the new run.
      expect((await manifest())["/en/restarted"][0].startedAt).toBe(after.body.experiment.startedAt);
      // The current run is read without an end.
      const current = getResults.mock.calls.find(
        ([args]: any[]) => args.startedAt === after.body.experiment.startedAt
      ) as any[] | undefined;
      expect(current?.[0].endedAt).toBeUndefined();
    });

    it("reads each past run's results on its own, and one failing doesn't hide the rest", async () => {
      const multi = await createPublishedPage("multi", "Multi");
      for (let i = 0; i < 2; i++) {
        const v = await addVariant(multi);
        await payload.update({
          collection: PAGES,
          id: v.id,
          data: { _status: "published" } as never,
          locale: "en" as never,
          overrideAccess: true,
        });
        await payload.delete({ collection: PAGES, id: v.id, overrideAccess: true });
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const [older, newer] = await runRows("/en/multi");
      getResults.mockImplementation(async (args: any) => {
        if (args.startedAt === older!.startedAt) throw new Error("SQL API down");
        return { configured: true, buckets: [{ bucket: "original", impressions: 3, conversions: 1 }] };
      });
      try {
        const res = await results(`collection=pages&id=${multi.id}`);
        expect(res.status).toBe(200);
        // Most recent first; only this locale's runs.
        expect(res.body.pastRuns).toEqual([
          expect.objectContaining({
            startedAt: newer!.startedAt,
            results: { configured: true, buckets: [{ bucket: "original", impressions: 3, conversions: 1 }] },
          }),
          expect.objectContaining({ startedAt: older!.startedAt, results: null, error: "SQL API down" }),
        ]);
      } finally {
        getResults.mockImplementation(async () => ({ configured: false, reason: "No credentials." }));
      }
    });

    it("doesn't list runs that ended more than 90 days ago, even before they're pruned", async () => {
      const old = await createPublishedPage("long-ago", "Long ago");
      const day = 24 * 60 * 60 * 1000;
      for (const daysAgo of [91, 30]) {
        await payload.create({
          collection: "ab-experiments" as CollectionSlug,
          data: {
            manifestKey: "/en/long-ago",
            parentDocId: String(old.id),
            parentCollection: "pages",
            locale: "en",
            startedAt: new Date(Date.now() - (daysAgo + 7) * day).toISOString(),
            endedAt: new Date(Date.now() - daysAgo * day).toISOString(),
          } as never,
          overrideAccess: true,
        });
      }
      const res = await results(`collection=pages&id=${old.id}`);
      expect(res.body.pastRuns).toHaveLength(1);
      expect(Date.parse(res.body.pastRuns[0].endedAt)).toBeGreaterThan(Date.now() - 31 * day);
      // Another locale's runs aren't this one's.
      expect((await results(`collection=pages&id=${old.id}&locale=pt`)).body.pastRuns).toEqual([]);
    });

    it("ends the run when the variant is unpublished, too", async () => {
      const paused = await createPublishedPage("paused", "Paused");
      const v = await addVariant(paused);
      const setStatus = (status: "published" | "draft") =>
        payload.update({
          collection: PAGES,
          id: v.id,
          data: { _status: status } as never,
          ...(status === "published" ? { publishAllLocales: true } : { unpublishAllLocales: true }),
          overrideAccess: true,
        });
      await setStatus("published");
      expect((await results(`collection=pages&id=${paused.id}`)).body.experiment).not.toBeNull();
      await setStatus("draft");
      const res = await results(`collection=pages&id=${paused.id}`);
      expect(res.body.experiment).toBeNull();
      expect(res.body.pastRuns).toHaveLength(1);
    });

    it("answers 502 when the host's getResults fails", async () => {
      getResults.mockRejectedValueOnce(new Error("SQL API down"));
      const res = await results(`collection=pages&id=${page.id}`);
      expect(res.status).toBe(502);
      expect(res.body.error).toBe("SQL API down");
    });
  });
});

describe("POST /api/_ab/promote", () => {
  let post: Doc;
  let otherPost: Doc;

  const promote = (body: Record<string, unknown>, auth: string | null = `JWT ${token}`) =>
    handleEndpoints({
      config,
      request: new Request("http://localhost:3000/api/_ab/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify(body),
      }),
    }).then(async (res) => ({ status: res.status, body: (await res.json()) as Record<string, any> }));

  const publishAll = (id: Doc["id"]) =>
    payload.update({
      collection: PAGES,
      id,
      data: { _status: "published" } as never,
      locale: "en" as never,
      publishAllLocales: true,
      overrideAccess: true,
    });

  /** A published original with content in both locales, and a published variant that differs. */
  async function experiment(slug: string) {
    // Rows of an array with localized fields keep their ids across locales.
    const rows = (texts: string[], locale: string) =>
      texts.map((text, i) => ({ id: `${slug}-${i}`.padEnd(24, "0").slice(0, 24), text: `${text} (${locale})` }));
    const original = await createPublishedPage(slug, "Original");
    for (const locale of ["en", "pt"]) {
      await payload.update({
        collection: PAGES,
        id: original.id,
        data: {
          blocks: rows(["Old block"], locale),
          meta: { title: `Old meta (${locale})`, related: post.id },
          internalNote: "original note",
          _status: "published",
        } as never,
        locale: locale as never,
        overrideAccess: true,
      });
    }
    const variant = await addVariant(original);
    const loser = await addVariant(original);
    for (const locale of ["en", "pt"]) {
      await payload.update({
        collection: PAGES,
        id: variant.id,
        data: {
          title: `Winner (${locale})`,
          blocks: rows(["New block", "Second"], locale).map((row) => ({ ...row, id: `v${row.id}`.slice(0, 24) })),
          meta: { title: `New meta (${locale})`, related: otherPost.id },
          internalNote: "variant note",
        } as never,
        locale: locale as never,
        overrideAccess: true,
      });
    }
    await publishAll(variant.id);
    await publishAll(loser.id);
    return { original, variant, loser, slug };
  }

  beforeAll(async () => {
    post = (await payload.create({
      collection: "posts" as CollectionSlug,
      data: { title: "related" } as never,
      overrideAccess: true,
    })) as Doc;
    otherPost = (await payload.create({
      collection: "posts" as CollectionSlug,
      data: { title: "other related" } as never,
      overrideAccess: true,
    })) as Doc;
  });

  it("copies the variant onto the original's draft in every locale, skipping system and custom fields", async () => {
    const { original, variant, slug } = await experiment("promoted");
    const variantBlocks = (await findPage(variant.id, { draft: true })).blocks as { id: string }[];

    const res = await promote({ collectionSlug: "pages", docId: original.id, variantId: variant.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ originalId: original.id, promotedId: variant.id, locales: ["en", "pt"] });

    for (const locale of ["en", "pt"]) {
      const draft = await findPage(original.id, { draft: true, locale });
      // Copied: content, localized fields per locale, and relationships by id.
      expect(draft.title).toBe(`Winner (${locale})`);
      expect((draft.blocks as any[]).map((b) => b.text)).toEqual([`New block (${locale})`, `Second (${locale})`]);
      expect(draft.meta).toEqual({ title: `New meta (${locale})`, related: otherPost.id });
      // Skipped: the slug, the A/B fields, ids and timestamps, and the custom skip field.
      expect(draft.slug).toBe(slug);
      expect(draft._abVariantOf ?? null).toBeNull();
      expect(draft._abPassPercentage ?? null).toBeNull();
      expect(draft.internalNote).toBe("original note");
      expect(draft.id).toBe(original.id);
      expect(draft.createdAt).toBe(original.createdAt);
      // Array rows get new ids: the variant's rows aren't the original's.
      for (const block of draft.blocks as { id: string }[]) {
        expect(variantBlocks.map((b) => b.id)).not.toContain(block.id);
      }
      expect(draft._status).toBe("draft");

      // The live page is untouched until an editor publishes the draft.
      const live = await findPage(original.id, { locale });
      expect(live._status).toBe("published");
      expect(live.title).toBe(`Original${locale === "pt" ? " (pt)" : ""}`);
      expect((live.blocks as any[]).map((b) => b.text)).toEqual([`Old block (${locale})`]);
    }

    // The promoted content is the newest version, a draft; the published one is still there.
    const { docs: versions } = await payload.findVersions({
      collection: PAGES,
      where: { parent: { equals: original.id } },
      sort: "-updatedAt",
      locale: "en" as never,
      depth: 0,
      overrideAccess: true,
    });
    expect((versions[0] as any).version).toMatchObject({ title: "Winner (en)", _status: "draft" });
    expect(versions.some((v: any) => v.version._status === "published" && v.version.title === "Original")).toBe(
      true
    );
  });

  it("deletes the variants and ends the run, which stays listed as a past experiment", async () => {
    const { original, variant, loser, slug } = await experiment("promoted-ends");
    expect((await manifest())[`/en/${slug}`]).toHaveLength(2);

    const res = await promote({ collectionSlug: "pages", docId: original.id, variantId: variant.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([...res.body.deleted].sort()).toEqual([variant.id, loser.id].sort());
    // The promoted variant goes last.
    expect(res.body.deleted.at(-1)).toBe(variant.id);

    const { totalDocs } = await payload.find({
      collection: PAGES,
      where: { _abVariantOf: { equals: original.id } },
      draft: true,
      overrideAccess: true,
    });
    expect(totalDocs).toBe(0);
    const m = await manifest();
    expect(m).not.toHaveProperty(`/en/${slug}`);
    expect(m).not.toHaveProperty(`/pt/${slug}`);

    const results = await handleEndpoints({
      config,
      request: new Request(`http://localhost:3000/api/_ab/results?collection=pages&id=${original.id}`, {
        headers: { Authorization: `JWT ${token}` },
      }),
    });
    const body = (await results.json()) as Record<string, any>;
    expect(body.experiment).toBeNull();
    expect(body.pastRuns).toEqual([
      expect.objectContaining({ key: `/en/${slug}`, startedAt: expect.any(String), endedAt: expect.any(String) }),
    ]);
  });

  it("is for admin-panel users with update access on the original", async () => {
    const { original, variant } = await experiment("promote-guarded");
    const body = { collectionSlug: "pages", docId: original.id, variantId: variant.id };
    expect((await promote(body, null)).status).toBe(401);
    expect((await promote(body, `JWT ${memberToken}`)).status).toBe(403);
    expect((await promote(body, `JWT ${readonlyToken}`)).status).toBe(403);

    // Nothing changed.
    expect((await findPage(original.id, { draft: true })).title).toBe("Original");
    expect((await findPage(variant.id, { draft: true })).id).toBe(variant.id);
  });

  it("refuses a variant of another page, an original as the variant, and bad bodies", async () => {
    const { original, variant } = await experiment("promote-mismatch");
    const { original: other } = await experiment("promote-other");

    const mismatch = await promote({ collectionSlug: "pages", docId: other.id, variantId: variant.id });
    expect(mismatch.status).toBe(400);
    expect((await promote({ collectionSlug: "pages", docId: original.id, variantId: other.id })).status).toBe(400);
    expect((await promote({ collectionSlug: "pages", docId: variant.id, variantId: variant.id })).status).toBe(400);
    expect((await promote({ collectionSlug: "posts", docId: original.id, variantId: variant.id })).status).toBe(400);
    expect((await promote({ collectionSlug: "pages", docId: original.id })).status).toBe(400);
    expect((await promote({ collectionSlug: "pages", docId: original.id, variantId: 999_999 })).status).toBe(404);

    // Neither original changed, and the variant still exists.
    expect((await findPage(other.id, { draft: true })).title).toBe("Original");
    expect((await findPage(original.id, { draft: true })).title).toBe("Original");
    expect((await findPage(variant.id, { draft: true })).title).toBe("Winner (en)");
  });

  it("promotes the variant's published version, not edits saved after it", async () => {
    const { original, variant } = await experiment("promote-published");
    // An edit the editor saved but never published: visitors were never tested on it.
    await payload.update({
      collection: PAGES,
      id: variant.id,
      data: { title: "Unpublished edit" } as never,
      draft: true,
      locale: "en" as never,
      overrideAccess: true,
    });
    expect((await findPage(variant.id, { draft: true, locale: "en" })).title).toBe("Unpublished edit");

    const res = await promote({ collectionSlug: "pages", docId: original.id, variantId: variant.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await findPage(original.id, { draft: true, locale: "en" })).title).toBe("Winner (en)");
  });

  it("refuses a variant that was never published", async () => {
    const original = await createPublishedPage("promote-unpublished", "Original");
    const variant = await addVariant(original);

    const res = await promote({ collectionSlug: "pages", docId: original.id, variantId: variant.id });
    expect(res.status).toBe(400);
    expect((await findPage(original.id, { draft: true })).title).toBe("Original");
    expect((await findPage(variant.id, { draft: true })).id).toBe(variant.id);
  });
});
