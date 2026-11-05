import type { GlobalConfig } from "payload";

export function createGlobal(slug: string, debug: boolean): GlobalConfig {
  return {
    slug,
    access: {
      read: () => true,
    },
    admin: {
      hidden: !debug,
      group: "System",
    },
    // Payload 4 versions globals by default. The manifest is rewritten on every variant
    // publish and derived from the variant documents, so its history is only D1 rows.
    versions: false,
    fields: [
      {
        name: "manifest",
        type: "json",
        admin: {
          description: "A/B testing manifest. Managed automatically — do not edit manually.",
        },
      },
    ],
  };
}
