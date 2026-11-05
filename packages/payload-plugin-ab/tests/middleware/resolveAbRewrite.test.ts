import { describe, expect, it, vi } from "vitest";
import { createResolveAbRewrite } from "../../src/middleware/resolveAbRewrite";
import type { AbRewrite, ResolveAbRewriteCookieConfig } from "../../src/middleware/types";
import { parseCookieHeader, serializeAbCookie } from "../../src/middleware/utils/cookies";

interface Variant {
  bucket: string;
  passPercentage: number;
  rewritePath: string;
}

const PAGE = "/every-view";
const BUCKET_COOKIE = "payload_ab_bucket_every-view";
const EXP_COOKIE = "exp_every-view";
const NINETY_DAYS = 60 * 60 * 24 * 90;

const variantB: Variant = {
  bucket: "every-view--b",
  passPercentage: 100,
  rewritePath: "/every-view--b",
};

function makeResolver(variants: Variant[], cookies: ResolveAbRewriteCookieConfig = {}) {
  const read = vi.fn(async () => variants);
  const resolveAbRewrite = createResolveAbRewrite<Variant>({
    cookies: { getExpCookieName: (key) => `exp_${key.replace(/^\//u, "")}`, ...cookies },
    getBucket: (v) => v.bucket,
    getPassPercentage: (v) => v.passPercentage,
    getRewritePath: (v) => v.rewritePath,
    storage: {
      clear: async () => {},
      read,
      write: async () => {},
    },
  });
  return { read, resolveAbRewrite };
}

function resolve(variants: Variant[], cookie: string, cookies: ResolveAbRewriteCookieConfig = {}) {
  const request = new Request(`https://example.com${PAGE}`, { headers: { cookie } });

  return makeResolver(variants, cookies).resolveAbRewrite(request, PAGE, PAGE, PAGE);
}

const cookie = (res: AbRewrite | null, name: string) => res?.cookies.find((c) => c.name === name);

describe("resolveAbRewrite", () => {
  it("returns null when the page runs no experiment", async () => {
    expect(await resolve([], "")).toBeNull();
  });

  it("keeps the bucket cookie across browser sessions", async () => {
    const res = await resolve([variantB], "");

    expect(res).toMatchObject({ bucket: "every-view--b", pathname: "/every-view--b", variant: variantB });
    expect(cookie(res, BUCKET_COOKIE)).toMatchObject({
      options: { maxAge: NINETY_DAYS },
      value: "every-view--b",
    });
  });

  it("uses bucketCookieMaxAge for the bucket cookie lifetime", async () => {
    const res = await resolve([variantB], "", { bucketCookieMaxAge: 3600 });

    expect(cookie(res, BUCKET_COOKIE)?.options.maxAge).toBe(3600);
  });

  it("restores the variant from the exp cookie when the bucket cookie is gone", async () => {
    const res = await resolve([variantB], `ab_visitor_id=v1; ${EXP_COOKIE}=original`);

    expect(res?.pathname).toBe(PAGE);
    expect(res?.variant).toBeNull();
    expect(cookie(res, BUCKET_COOKIE)).toMatchObject({
      options: { maxAge: NINETY_DAYS },
      value: "original",
    });
    expect(cookie(res, EXP_COOKIE)).toBeUndefined();
  });

  it("draws a new variant when the saved bucket no longer exists", async () => {
    const res = await resolve(
      [variantB],
      `ab_visitor_id=v1; ${BUCKET_COOKIE}=every-view--gone; ${EXP_COOKIE}=every-view--gone`
    );

    expect(res?.pathname).toBe("/every-view--b");
    expect(cookie(res, BUCKET_COOKIE)?.value).toBe("every-view--b");
    expect(cookie(res, EXP_COOKIE)?.value).toBe("every-view--b");
  });

  it("sets no cookies for a returning visitor whose bucket is still live", async () => {
    const res = await resolve([variantB], `ab_visitor_id=v1; ${BUCKET_COOKIE}=every-view--b`);

    expect(res?.pathname).toBe("/every-view--b");
    expect(res?.cookies).toEqual([]);
    expect(res?.setCookieHeaders).toEqual([]);
  });

  it("returns null for a visitor already assigned to the original", async () => {
    expect(await resolve([variantB], `ab_visitor_id=v1; ${BUCKET_COOKIE}=original`)).toBeNull();
  });

  it("issues a visitor id and serializes Set-Cookie headers for a new visitor", async () => {
    const res = await resolve([variantB], "");
    const visitor = cookie(res, "ab_visitor_id");

    expect(visitor?.value).toMatch(/^[0-9a-f-]{36}$/u);
    expect(res?.setCookieHeaders).toHaveLength(3);
    expect(res?.setCookieHeaders[0]).toMatch(
      /^payload_ab_bucket_every-view=every-view--b; Path=\/; Max-Age=7776000; Expires=.+; SameSite=Lax$/u
    );
  });

  it("accepts the Cookie header as a string, and passes payload to storage.read", async () => {
    const { read, resolveAbRewrite } = makeResolver([variantB]);
    const payload = { marker: true } as never;
    const res = await resolveAbRewrite(`${BUCKET_COOKIE}=every-view--b`, PAGE, PAGE, PAGE, {
      payload,
    });

    expect(read).toHaveBeenCalledWith(PAGE, payload);
    expect(res?.bucket).toBe("every-view--b");
  });

  it("builds valid cookie names from a non-ASCII key, and reads them back", async () => {
    const key = "/fr/à-propos(1)";
    const resolveAbRewrite = createResolveAbRewrite<Variant>({
      getBucket: (v) => v.bucket,
      getPassPercentage: (v) => v.passPercentage,
      getRewritePath: (v) => v.rewritePath,
      storage: { clear: async () => {}, read: async () => [variantB], write: async () => {} },
    });
    const bucketName = "payload_ab_bucket_fr_%C3%A0-propos%281%29";
    const expName = "exp_%2Ffr%2F%C3%A0-propos%281%29";

    const first = await resolveAbRewrite(null, key, key, key);
    const names = first?.cookies.map((c) => c.name) ?? [];
    expect(names).toEqual(expect.arrayContaining([bucketName, expName]));
    // RFC 6265 token: visible ASCII, no separators.
    for (const name of names) expect(name).toMatch(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u);

    const back = await resolveAbRewrite(
      first!.setCookieHeaders.map((h) => h.split(";")[0]).join("; "),
      key,
      key,
      key
    );
    expect(back?.bucket).toBe("every-view--b");
    expect(back?.cookies).toEqual([]);
  });

  it("returns null when the storage read throws", async () => {
    const resolveAbRewrite = createResolveAbRewrite<Variant>({
      getBucket: (v) => v.bucket,
      getRewritePath: (v) => v.rewritePath,
      storage: {
        clear: async () => {},
        read: async () => {
          throw new Error("down");
        },
        write: async () => {},
      },
    });

    expect(await resolveAbRewrite(null, PAGE, PAGE, PAGE)).toBeNull();
  });
});

describe("cookie helpers", () => {
  it("parses a Cookie header: first value wins, values are decoded, quotes stripped", () => {
    const cookies = parseCookieHeader('a=1; b="x y"; exp_%2Fen%2Fabout=v%2D1; a=2; junk');

    expect(cookies.get("a")).toBe("1");
    expect(cookies.get("b")).toBe("x y");
    expect(cookies.get("exp_%2Fen%2Fabout")).toBe("v-1");
    expect(cookies.has("junk")).toBe(false);
  });

  it("round-trips a value through serialize and parse", () => {
    const header = serializeAbCookie({
      name: "exp_%2Fen%2Fabout",
      value: "about--a b",
      options: { maxAge: 60, path: "/", sameSite: "lax" },
    });
    const pair = header.split(";")[0]!;

    expect(parseCookieHeader(pair).get("exp_%2Fen%2Fabout")).toBe("about--a b");
  });
});
