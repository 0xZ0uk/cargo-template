import type { CollectionSlug, Payload } from "payload";

export interface ManifestEntry<TVariantData extends object = object> {
  id: number | string;
  key: string;
  variants?: TVariantData[] | null;
}

/** One indexed row lookup. `pagination: false` skips Payload's count query. */
export async function findEntry<TVariantData extends object>(
  payload: Payload,
  slug: string,
  key: string
): Promise<ManifestEntry<TVariantData> | null> {
  const { docs } = await payload.find({
    collection: slug as CollectionSlug,
    where: { key: { equals: key } },
    limit: 1,
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });

  return (docs[0] as unknown as ManifestEntry<TVariantData> | undefined) ?? null;
}

/** Reads one key over REST, for a resolver running outside Payload's process. */
export async function fetchEntry<TVariantData extends object>(
  url: string,
  authorization: string,
  key: string
): Promise<TVariantData[] | null> {
  const query = new URLSearchParams({
    "where[key][equals]": key,
    limit: "1",
    pagination: "false",
    depth: "0",
  });
  const res = await fetch(`${url}?${query}`, {
    cache: "no-store",
    headers: { Authorization: authorization },
  });

  // Throw rather than return null, so a failed read isn't cached as "no experiment".
  if (!res.ok) throw new Error(`Manifest read failed: ${res.status}`);

  const data = (await res.json()) as { docs?: { variants?: TVariantData[] | null }[] };

  return data.docs?.[0]?.variants ?? null;
}
