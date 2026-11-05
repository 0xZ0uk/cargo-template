import type { CollectionSlug, GlobalSlug, Payload, SanitizedConfig } from "payload";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig, getPayload, handleEndpoints } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { abTestingPlugin } from "../../src";
import { payloadGlobalAdapter } from "../../src/adapters/payloadGlobal";
import { createResolveAbRewrite } from "../../src/middleware";

/**
 * Real Payload 4 on in-memory SQLite (D1 is SQLite), with drafts and two locales like a
 * localized host. Requests go through Payload's own REST handler, as the admin panel's do.
 */
interface Variant {
  bucket: string;
  rewritePath: string;
  passPercentage: number;
}

const storage = payloadGlobalAdapter<Variant>();
const PAGES = "pages" as CollectionSlug;
const MANIFEST = "_abManifest" as GlobalSlug;

let payload: Payload;
let config: SanitizedConfig;
let token: string;

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

const manifest = async () =>
  ((await payload.findGlobal({ slug: MANIFEST, overrideAccess: true })) as { manifest?: any })
    .manifest ?? {};

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
      {
        slug: "pages",
        admin: { useAsTitle: "title" },
        access: { read: () => true },
        versions: { drafts: true },
        fields: [
          { name: "title", type: "text", localized: true },
          { name: "slug", type: "text", index: true },
          { name: "blocks", type: "array", fields: [{ name: "text", type: "text", localized: true }] },
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
          },
        },
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
}, 60_000);

afterAll(async () => {
  await (payload as unknown as { destroy?: () => Promise<void> }).destroy?.();
});

describe("Payload 4 boot", () => {
  it("adds the manifest global and the experiments collection without version history", () => {
    const global = payload.config.globals.find((g) => g.slug === "_abManifest");
    expect(global).toBeDefined();
    expect(global?.versions).toBeFalsy();
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
      clientProps: { slugField: "slug", titleField: "title" },
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
    expect(m["/en/about"]).toEqual([
      { bucket: variant.slug, rewritePath: `/en/${variant.slug}`, passPercentage: 1 },
    ]);
    expect(m["/pt/about"]).toEqual([
      { bucket: variant.slug, rewritePath: `/pt/${variant.slug}`, passPercentage: 1 },
    ]);

    const experiments = await payload.find({
      collection: "ab-experiments" as CollectionSlug,
      where: { parentDocId: { equals: String(page.id) } },
      overrideAccess: true,
    });
    expect(experiments.docs.map((d: any) => d.manifestKey).sort()).toEqual(["/en/about", "/pt/about"]);
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

describe("deleting an original", () => {
  it("detaches its variants, clears the manifest and the experiment rows", async () => {
    const page = await createPublishedPage("gone", "Gone");
    const variant = await addVariant(page);
    await payload.update({
      collection: PAGES,
      id: variant.id,
      data: { _status: "published" } as never,
      overrideAccess: true,
    });
    expect(await manifest()).toHaveProperty("/en/gone");

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
