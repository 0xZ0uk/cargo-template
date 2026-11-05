import type { GlobalSlug } from "payload";
import type { StorageAdapter } from "../../types/config";
import type { PayloadGlobalAdapterConfig } from "./config";
import { fetchManifest } from "./api/fetchManifest";
import { readManifest } from "./api/readManifest";
import { createGlobal } from "./utils/createGlobal";

export type { PayloadGlobalAdapterConfig } from "./config";

export function payloadGlobalAdapter<TVariantData extends object>(
  config?: PayloadGlobalAdapterConfig
): StorageAdapter<TVariantData> {
  const slug = config?.globalSlug ?? "_abManifest";

  return {
    async write(path, variants, payload) {
      const currentManifest = await readManifest(payload, slug);

      await payload.updateGlobal({
        slug: slug as GlobalSlug,
        data: { manifest: { ...currentManifest, [path]: variants } },
        overrideAccess: true,
      });
    },

    async read(path, payload) {
      // Same process as Payload (e.g. a loader on the Worker): read through the Local API. A
      // Worker fetching its own REST API is a needless subrequest, and a loop on some routes.
      if (payload) {
        const manifest = await readManifest(payload, slug);

        return (manifest[path] as TVariantData[] | undefined) ?? null;
      }

      const serverURL = config?.serverURL ?? "";
      const apiRoute = config?.apiRoute ?? "/api";

      return fetchManifest<TVariantData>(serverURL, apiRoute, slug, path);
    },

    async clear(path, payload) {
      const currentManifest = await readManifest(payload, slug);

      if (!(path in currentManifest)) return;

      delete currentManifest[path];

      await payload.updateGlobal({
        slug: slug as GlobalSlug,
        data: { manifest: currentManifest },
        overrideAccess: true,
      });
    },

    createGlobal(debug = false) {
      return createGlobal(slug, debug);
    },
  };
}
