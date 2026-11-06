import { withAuthRedactions, type RedactionMap, type RedactionPolicy, type RelationField, type RelationMap } from "./redaction";

/**
 * Where documents of other collections can appear inside a collection's or global's documents
 * (#68): its relationship, upload and join fields, read from Payload's sanitized config. Pure
 * (structural types only), so it runs on the Worker and the result travels to the conversation's
 * Durable Object in the turn settings.
 */

interface FieldLike {
  type?: string;
  name?: string;
  fields?: FieldLike[];
  tabs?: Array<{ name?: string; fields?: FieldLike[] }>;
  blocks?: Array<{ slug?: string; fields?: FieldLike[] } | string>;
  blockReferences?: Array<{ slug?: string; fields?: FieldLike[] } | string>;
  relationTo?: string | string[];
  collection?: string | string[];
}

interface EntityLike {
  slug: string;
  fields?: unknown;
  auth?: unknown;
}

export interface ConfigLike {
  collections?: ReadonlyArray<EntityLike>;
  globals?: ReadonlyArray<EntityLike>;
  blocks?: ReadonlyArray<{ slug: string; fields?: unknown }>;
}

const MAX_SCHEMA_DEPTH = 12;

/** Every relationship, upload and join field of `fields`, by dotted data path (groups, named tabs, arrays and blocks by name). */
function relationFieldsOf(fields: unknown, blocks: ReadonlyMap<string, { fields?: unknown }>, prefix = "", depth = 0): RelationField[] {
  if (!Array.isArray(fields) || depth > MAX_SCHEMA_DEPTH) return [];
  const out: RelationField[] = [];
  const at = (name: string | undefined) => (name ? (prefix ? `${prefix}.${name}` : name) : prefix);
  for (const field of fields as FieldLike[]) {
    if (!field || typeof field !== "object") continue;
    switch (field.type) {
      case "relationship":
      case "upload":
        if (field.name && field.relationTo) out.push({ path: at(field.name), relationTo: field.relationTo });
        break;
      case "join":
        if (field.name && field.collection) out.push({ path: at(field.name), relationTo: field.collection, join: true });
        break;
      case "tabs":
        for (const tab of field.tabs ?? []) out.push(...relationFieldsOf(tab.fields, blocks, at(tab.name), depth + 1));
        break;
      case "blocks":
        for (const block of [...(field.blocks ?? []), ...(field.blockReferences ?? [])]) {
          const fieldsOfBlock = typeof block === "string" ? blocks.get(block)?.fields : block?.fields;
          out.push(...relationFieldsOf(fieldsOfBlock, blocks, at(field.name), depth + 1));
        }
        break;
      default:
        // group (named or not), array, row, collapsible: walk their fields.
        if (Array.isArray(field.fields)) {
          const named = field.type === "group" || field.type === "array" ? field.name : undefined;
          out.push(...relationFieldsOf(field.fields, blocks, at(named), depth + 1));
        }
    }
  }
  return out;
}

const targets = (field: RelationField) => (Array.isArray(field.relationTo) ? field.relationTo : [field.relationTo]);

/**
 * The relation fields that can lead to a redacted field: for each collection and global, its
 * relationship, upload and join fields whose target has redacted paths, directly or through its
 * own relations. Everything else is left out, so the map stays small (in practice `createdBy` /
 * `updatedBy` on every collection, plus the app's relationships to users).
 */
export function relationMapOf(config: ConfigLike, paths: RedactionMap): RelationMap {
  const blocks = new Map((config.blocks ?? []).map((block) => [block.slug, block]));
  const all = new Map<string, RelationField[]>();
  for (const entity of [...(config.collections ?? []), ...(config.globals ?? [])]) {
    all.set(entity.slug, relationFieldsOf(entity.fields, blocks));
  }
  const sensitive = new Set(Object.keys(paths).filter((slug) => paths[slug]?.length));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [slug, fields] of all) {
      if (sensitive.has(slug)) continue;
      if (fields.some((field) => targets(field).some((target) => sensitive.has(target)))) {
        sensitive.add(slug);
        grew = true;
      }
    }
  }
  const map: RelationMap = {};
  for (const [slug, fields] of all) {
    const kept = fields.filter((field) => targets(field).some((target) => sensitive.has(target)));
    if (kept.length) map[slug] = kept;
  }
  return map;
}

const policies = new WeakMap<object, WeakMap<object, RedactionPolicy>>();

/**
 * The redaction policy of a running Payload: the app's paths plus the auth defaults for every auth
 * collection of the sanitized config (collections added by later plugins included), and the
 * relations that lead to them (`createdBy` / `updatedBy` only exist after sanitizing). Cached per
 * config and options.
 */
export function redactionPolicyOf(config: ConfigLike, redact: RedactionMap): RedactionPolicy {
  let byOptions = policies.get(config);
  if (!byOptions) policies.set(config, (byOptions = new WeakMap()));
  let policy = byOptions.get(redact);
  if (!policy) {
    const paths = withAuthRedactions(redact, config.collections);
    const relations = relationMapOf(config, paths);
    policy = Object.keys(relations).length ? { paths, relations } : { paths };
    byOptions.set(redact, policy);
  }
  return policy;
}
