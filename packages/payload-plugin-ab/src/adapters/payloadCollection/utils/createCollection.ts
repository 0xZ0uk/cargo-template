import type { CollectionConfig } from "payload";

export function createCollection(slug: string, debug: boolean): CollectionConfig {
  return {
    slug,
    // Signed-in users may read (the debug view, an authenticated REST read); nobody writes
    // over the API. The plugin reads and writes through the Local API with overrideAccess.
    access: {
      read: ({ req }) => Boolean(req.user),
      create: () => false,
      update: () => false,
      delete: () => false,
    },
    admin: {
      hidden: !debug,
      group: "System",
      useAsTitle: "key",
      defaultColumns: ["key", "updatedAt"],
    },
    // Payload 4 versions collections by default. Rows are derived from the variant documents,
    // so their history would only add D1 rows.
    versions: false,
    fields: [
      {
        name: "key",
        type: "text",
        required: true,
        unique: true,
        index: true,
        admin: { description: "Manifest key: the path generatePath returned for the original." },
      },
      {
        name: "variants",
        type: "json",
        admin: {
          description: "Variants served on this key. Managed automatically — do not edit manually.",
        },
      },
    ],
  };
}
