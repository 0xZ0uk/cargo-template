import type { CollectionConfig, Field, FieldAccess, Where } from "payload";
import type { CollectionABConfig } from "../types/config";
import {
  AB_PASS_PERCENTAGE_FIELD,
  AB_VARIANT_OF_FIELD,
  AB_PENDING_PERCENTAGES_FIELD,
  AB_WRITE_CONTEXT_KEY,
  DEFAULT_SLUG_FIELD,
} from "../constants";

const VARIANTS_FIELD_PATH = "@shipment/payload-plugin-ab/admin/VariantsField#VariantsField";

/**
 * Only the plugin's own writes may set `_abVariantOf` / `_abPassPercentage`: the duplicate
 * endpoint marks `req.context`, and the hooks write with `overrideAccess: true`. A REST,
 * GraphQL or MCP write can't make a page a variant (skipping the endpoint's checks: no
 * variant of a variant, created as a draft) or change a pass percentage directly. Payload
 * drops a denied field from the incoming data and keeps the stored value.
 */
const pluginWritesOnly: FieldAccess = ({ req }) => req.context?.[AB_WRITE_CONTEXT_KEY] === true;
const pluginWriteAccess = { create: pluginWritesOnly, update: pluginWritesOnly };

function isVariant(data: Record<string, unknown>): boolean {
  return Boolean(data[AB_VARIANT_OF_FIELD]);
}

/** Patch a top-level field to be hidden on variant documents, keeping its own condition. */
function hideOnVariant(field: Field): Field {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = (field as any).admin as { condition?: (...args: any[]) => boolean } | undefined;
  const ownCondition = admin?.condition;

  return {
    ...field,
    admin: {
      ...admin,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      condition: (data: Record<string, unknown>, ...rest: any[]) =>
        !isVariant(data) && (ownCondition ? ownCondition(data, ...rest) : true),
    },
  } as Field;
}

/** Find a top-level field by name and patch it. Returns the new fields array. */
function patchField(fields: Field[], name: string, patcher: (f: Field) => Field): Field[] {
  return fields.map((f) => {
    if ("name" in f && f.name === name) return patcher(f);
    return f;
  });
}

export function injectAdminFields<TVariantData extends object>(
  collection: CollectionConfig,
  collectionSlug: string,
  abConfig: CollectionABConfig<TVariantData>,
  options: { showResults?: boolean } = {}
): CollectionConfig {
  const slugField = abConfig.slugField ?? DEFAULT_SLUG_FIELD;

  // 1. _abVariantOf — native relationship field in sidebar, read-only, visible on variant pages only.
  //    Payload renders this natively: shows the parent page title with a link.
  const variantOfField: Field = {
    name: AB_VARIANT_OF_FIELD,
    type: "relationship",
    relationTo: collectionSlug as CollectionConfig["slug"],
    label: "Variant of",
    access: pluginWriteAccess,
    admin: {
      position: "sidebar",
      readOnly: true,
      condition: (data: Record<string, unknown>) => isVariant(data),
      description: "The original page this variant belongs to.",
    },
  };

  // 2. _abPassPercentage — hidden everywhere; managed inline in the Variants panel.
  const passPercentageField: Field = {
    name: AB_PASS_PERCENTAGE_FIELD,
    type: "number",
    min: 1,
    max: 99,
    access: pluginWriteAccess,
    admin: {
      hidden: true,
    },
  };

  // 3. _abVariants — Variants panel UI field in sidebar, visible on original pages only.
  const variantsUiField: Field = {
    name: "_abVariants",
    type: "ui",
    admin: {
      position: "sidebar",
      condition: (data: Record<string, unknown>) => !isVariant(data),
      components: {
        Field: {
          path: VARIANTS_FIELD_PATH,
          clientProps: {
            slugField,
            titleField: abConfig.nameField ?? collection.admin?.useAsTitle ?? "title",
            // Only with `measurement` configured: the panel then shows results per bucket from
            // `GET {api}/_ab/results`.
            ...(options.showResults ? { resultsPath: "/_ab/results" } : {}),
          },
        },
      },
    },
  };

  const pendingPercentagesField: Field = {
    name: AB_PENDING_PERCENTAGES_FIELD,
    type: "json",
    virtual: true,
    admin: {
      hidden: true,
      readOnly: false,
      condition: (data: Record<string, unknown>) => !isVariant(data),
    },
  };

  // 4. Hide slug on variant pages (auto-generated slug must not be changed manually).
  let patchedFields = patchField(collection.fields ?? [], slugField, hideOnVariant);

  // 5. Hide tenantField on variant pages (must match parent — not editable on variants).
  if (abConfig.tenantField) {
    const topLevelTenantFieldName = abConfig.tenantField.split(".")[0]!;
    patchedFields = patchField(patchedFields, topLevelTenantFieldName, hideOnVariant);
  }

  // 6. Assemble: pass percentage first (hidden), then user fields, then sidebar UI last.
  const newFields: Field[] = [
    passPercentageField,
    ...patchedFields,
    variantOfField,
    pendingPercentagesField,
    variantsUiField,
  ];

  // 7. Exclude variant docs from the list view and from Lexical's internal-link pickers.
  //    Payload 4 renamed `baseListFilter` to `baseFilter` (the old name is a deprecated
  //    alias; `baseFilter` wins when both are set), so wrap whichever the host defined.
  const existingBaseFilter = collection.admin?.baseFilter ?? collection.admin?.baseListFilter;
  const excludeVariants: Where = { [AB_VARIANT_OF_FIELD]: { exists: false } };
  const newBaseFilter = existingBaseFilter
    ? async (...args: Parameters<NonNullable<typeof existingBaseFilter>>): Promise<Where> => {
        const existing = await existingBaseFilter(...args);
        return existing ? { and: [existing, excludeVariants] } : excludeVariants;
      }
    : (): Where => excludeVariants;

  return {
    ...collection,
    fields: newFields,
    admin: {
      ...collection.admin,
      baseFilter: newBaseFilter,
      baseListFilter: undefined,
    },
  };
}
