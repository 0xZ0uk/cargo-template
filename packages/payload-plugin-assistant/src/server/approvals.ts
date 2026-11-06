import type { CollectionSlug, GlobalSlug, PayloadRequest } from "payload";
import { diffDocument, labelText, type BlockLike, type DiffMode, type FieldLike } from "../approvals/diff";
import type { ApprovalAction, ApprovalProposal, ProposalDocument, ProposalItem } from "../approvals/types";
import { lexicalToText } from "../approvals/lexical";
import { blocksBySlugOf, collectionOf as richTextCollectionOf, markdownLosses, resolveRichText, RichTextPathError, SET_RICH_TEXT_TOOL_NAME, toMarkdown, unsupportedMarkdown } from "../richText/fields";

/**
 * Approval proposals (#65): what a pending write would change, read as the signed-in user.
 *
 * Every read is `overrideAccess: false` with the request's user, `depth: 0`, drafts included: the
 * card shows what the user may see, and the write itself is access-checked again when it runs
 * (plugin-mcp lists one tool per operation for all collections, so an approved call can still be
 * denied). A read that fails (no access, deleted) gives a proposal with a `notice` and the
 * proposed values, never an error for the whole list.
 */

/** A pending interrupt as the stores keep it: `payload` is the AG-UI interrupt descriptor. */
export interface PendingInterruptLike {
  interruptId: string;
  requestedAt: number;
  payload: Record<string, unknown>;
}

/** Most documents listed for a create, or for an update/delete by `where`. */
const MAX_ITEMS = 10;

type Doc = Record<string, unknown>;

interface InterruptCall {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

/** The tool call behind an approval interrupt (`metadata: { kind: "approval", toolName, input }`). */
export function interruptCall(record: PendingInterruptLike): InterruptCall {
  const descriptor = record.payload as { toolCallId?: unknown; metadata?: { toolName?: unknown; input?: unknown } };
  const input = descriptor.metadata?.input;
  return {
    toolName: typeof descriptor.metadata?.toolName === "string" ? descriptor.metadata.toolName : "tool",
    toolCallId: typeof descriptor.toolCallId === "string" ? descriptor.toolCallId : "",
    input: input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {},
  };
}


export function actionOf(toolName: string): ApprovalAction {
  if (toolName === SET_RICH_TEXT_TOOL_NAME) return "update";
  if (/^create/i.test(toolName)) return "create";
  if (/^update/i.test(toolName)) return "update";
  if (/^delete/i.test(toolName)) return "delete";
  if (/^restore/i.test(toolName)) return "restore";
  if (/^duplicate/i.test(toolName)) return "duplicate";
  return "other";
}

const isGlobalTool = (toolName: string) => /global/i.test(toolName);

const idOf = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : typeof value === "number" ? String(value) : undefined;

const isRecord = (value: unknown): value is Doc => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function blocksOf(req: PayloadRequest): Map<string, BlockLike> {
  const blocks = new Map<string, BlockLike>();
  for (const block of (req.payload.config.blocks ?? []) as unknown as BlockLike[]) blocks.set(block.slug, block);
  return blocks;
}

function collectionOf(req: PayloadRequest, slug: string) {
  return req.payload.collections?.[slug as CollectionSlug]?.config;
}

function globalOf(req: PayloadRequest, slug: string) {
  return req.payload.config.globals?.find((g) => g.slug === slug);
}

function titleOf(doc: Doc, useAsTitle: string | undefined, id: string): string {
  for (const key of [useAsTitle, "title", "name", "label", "slug", "email", "filename"]) {
    if (!key || key === "id") continue;
    const value = doc[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return id;
}

function documentOf(doc: Doc, useAsTitle: string | undefined): ProposalDocument {
  const id = idOf(doc.id) ?? "";
  return {
    id,
    title: titleOf(doc, useAsTitle, id),
    ...(typeof doc.updatedAt === "string" ? { updatedAt: doc.updatedAt } : {}),
    ...(typeof doc._status === "string" ? { status: doc._status } : {}),
  };
}

const localeOf = (input: Record<string, unknown>) => (typeof input.locale === "string" && input.locale ? { locale: input.locale } : {});

async function readDoc(req: PayloadRequest, slug: string, id: string, input: Record<string, unknown>): Promise<Doc | null> {
  const config = collectionOf(req, slug);
  if (!config) return null;
  try {
    const doc = await req.payload.findByID({
      collection: slug as CollectionSlug,
      id,
      depth: 0,
      draft: Boolean(config.versions && (config.versions as { drafts?: unknown }).drafts),
      overrideAccess: false,
      req,
      disableErrors: true,
      ...localeOf(input),
    } as Parameters<typeof req.payload.findByID>[0]);
    return isRecord(doc) ? doc : null;
  } catch {
    return null;
  }
}

async function readGlobal(req: PayloadRequest, slug: string, input: Record<string, unknown>): Promise<Doc | null> {
  const config = globalOf(req, slug);
  if (!config) return null;
  try {
    const doc = await req.payload.findGlobal({
      slug: slug as GlobalSlug,
      depth: 0,
      draft: Boolean(config.versions && (config.versions as { drafts?: unknown }).drafts),
      overrideAccess: false,
      req,
      ...localeOf(input),
    } as Parameters<typeof req.payload.findGlobal>[0]);
    return isRecord(doc) ? doc : null;
  } catch {
    return null;
  }
}

async function readVersion(req: PayloadRequest, slug: string, versionId: string, global: boolean): Promise<{ parent?: string; version: Doc } | null> {
  try {
    const found = global
      ? await req.payload.findGlobalVersionByID({ slug: slug as GlobalSlug, id: versionId, depth: 0, overrideAccess: false, req, disableErrors: true } as Parameters<typeof req.payload.findGlobalVersionByID>[0])
      : await req.payload.findVersionByID({ collection: slug as CollectionSlug, id: versionId, depth: 0, overrideAccess: false, req, disableErrors: true } as Parameters<typeof req.payload.findVersionByID>[0]);
    if (!isRecord(found) || !isRecord(found.version)) return null;
    return { ...(idOf(found.parent) ? { parent: idOf(found.parent)! } : {}), version: found.version };
  } catch {
    return null;
  }
}

async function findWhere(req: PayloadRequest, slug: string, where: unknown, input: Record<string, unknown>): Promise<{ docs: Doc[]; total: number } | null> {
  const config = collectionOf(req, slug);
  if (!config || !isRecord(where)) return null;
  try {
    const result = await req.payload.find({
      collection: slug as CollectionSlug,
      where: where as never,
      limit: MAX_ITEMS,
      depth: 0,
      draft: Boolean(config.versions && (config.versions as { drafts?: unknown }).drafts),
      overrideAccess: false,
      req,
      ...localeOf(input),
    } as Parameters<typeof req.payload.find>[0]);
    return { docs: result.docs as Doc[], total: result.totalDocs };
  } catch {
    return null;
  }
}

/**
 * The single document a write targets, read now as the user: `updateDocument`/`deleteDocuments`
 * by id, `restoreVersion` (the version's parent), `duplicateDocument`, and the global tools.
 * `undefined` for writes that don't target one existing document (create, by `where`).
 */
async function currentTarget(req: PayloadRequest, call: InterruptCall): Promise<{ doc: Doc | null; version?: Doc } | undefined> {
  const { toolName, input } = call;
  const slug = typeof input.slug === "string" ? input.slug : undefined;
  if (!slug) return undefined;
  const action = actionOf(toolName);
  if (isGlobalTool(toolName)) {
    if (action === "restore") {
      const versionId = idOf(input.id);
      const version = versionId ? await readVersion(req, slug, versionId, true) : null;
      return { doc: await readGlobal(req, slug, input), ...(version ? { version: version.version } : {}) };
    }
    return action === "update" ? { doc: await readGlobal(req, slug, input) } : undefined;
  }
  if (action === "restore") {
    const versionId = idOf(input.id);
    const version = versionId ? await readVersion(req, slug, versionId, false) : null;
    const doc = version?.parent ? await readDoc(req, slug, version.parent, input) : null;
    return { doc, ...(version ? { version: version.version } : {}) };
  }
  if (action === "update" || action === "delete" || action === "duplicate") {
    const id = idOf(input.id);
    return id ? { doc: await readDoc(req, slug, id, input) } : undefined;
  }
  return undefined;
}

const changedAfter = (doc: Doc | null | undefined, requestedAt: number) => {
  const updated = typeof doc?.updatedAt === "string" ? Date.parse(doc.updatedAt) : NaN;
  return Number.isFinite(updated) && Number.isFinite(requestedAt) && updated > requestedAt;
};

/** Build the proposal of one pending approval. Never throws: problems become a `notice`. */
export async function buildProposal(req: PayloadRequest, record: PendingInterruptLike): Promise<ApprovalProposal> {
  const call = interruptCall(record);
  const { toolName, input } = call;
  const action = actionOf(toolName);
  const slug = typeof input.slug === "string" ? input.slug : undefined;
  const global = isGlobalTool(toolName);
  const collectionConfig = slug && !global ? collectionOf(req, slug) : undefined;
  const globalConfig = slug && global ? globalOf(req, slug) : undefined;
  const entity = collectionConfig ?? globalConfig;
  const fields = (entity?.fields ?? undefined) as FieldLike[] | undefined;
  const blocks = blocksOf(req);
  const useAsTitle = collectionConfig?.admin?.useAsTitle;
  const versioned = Boolean(entity?.versions && (entity.versions as { drafts?: unknown }).drafts);

  const base: ApprovalProposal = {
    interruptId: record.interruptId,
    toolCallId: call.toolCallId,
    toolName,
    action,
    target: slug
      ? {
          kind: global ? "global" : "collection",
          slug,
          label: global
            ? labelText(globalConfig?.label, slug)
            : labelText((collectionConfig?.labels as { singular?: unknown } | undefined)?.singular, slug),
        }
      : null,
    items: [],
    ...(versioned && action !== "delete" ? { draft: input.draft === true } : {}),
  };

  const diff = (mode: DiffMode, before: unknown, after: unknown): Pick<ProposalItem, "changes" | "omittedChanges"> => {
    const result = diffDocument({ before, after, mode, ...(fields ? { fields } : {}), blocks });
    return { changes: result.changes, ...(result.omitted ? { omittedChanges: result.omitted } : {}) };
  };
  const data = isRecord(input.data) ? input.data : {};
  const asDocument = (doc: Doc) => (global ? { ...documentOf(doc, undefined), id: "", title: base.target?.label ?? slug ?? "" } : documentOf(doc, useAsTitle));

  if (slug && !entity) {
    return { ...base, notice: `“${slug}” is not a collection or global of this site.`, items: [diff("create", undefined, input)] };
  }

  if (toolName === SET_RICH_TEXT_TOOL_NAME && slug && collectionConfig) {
    return richTextProposal(req, record, call, { ...base, ...(versioned ? { draft: input.draft !== false } : {}) }, asDocument);
  }

  switch (action) {
    case "create": {
      const documents = Array.isArray(input.documents) ? input.documents : isRecord(input.data) ? [{ data: input.data }] : [];
      const items = documents.slice(0, MAX_ITEMS).map((entry) => diff("create", undefined, isRecord(entry) && isRecord(entry.data) ? entry.data : entry));
      return { ...base, items, ...(documents.length > MAX_ITEMS ? { matchedDocs: documents.length } : {}) };
    }
    case "update":
    case "delete":
    case "duplicate":
    case "restore": {
      const target = await currentTarget(req, call);
      if (target) {
        const { doc } = target;
        if (action === "restore") {
          if (!target.version) return { ...base, notice: "The version to restore could not be read: it doesn't exist, or you can't access it.", items: [] };
          return {
            ...base,
            items: [{ ...(doc ? { document: asDocument(doc) } : {}), ...diff("replace", doc ?? undefined, target.version) }],
            ...(changedAfter(doc, record.requestedAt) ? { changedSinceProposal: true } : {}),
          };
        }
        if (!doc) {
          return {
            ...base,
            notice: "The current document could not be read: it doesn't exist, or you can't access it. Applying this may fail.",
            items: action === "delete" ? [] : [diff("create", undefined, data)],
          };
        }
        if (action === "duplicate") {
          return { ...base, items: [{ document: asDocument(doc), ...diff("create", undefined, { ...doc, ...data }) }] };
        }
        return {
          ...base,
          items: [{ document: asDocument(doc), ...(action === "delete" ? diff("delete", doc, undefined) : diff("update", doc, data)) }],
          ...(changedAfter(doc, record.requestedAt) ? { changedSinceProposal: true } : {}),
        };
      }
      // By `where` (update or delete many).
      if (slug && (action === "update" || action === "delete") && input.where !== undefined) {
        const found = await findWhere(req, slug, input.where, input);
        if (!found) return { ...base, notice: "The matching documents could not be read.", items: action === "update" ? [diff("create", undefined, data)] : [] };
        const items = found.docs.map((doc) => ({ document: asDocument(doc), ...(action === "delete" ? diff("delete", doc, undefined) : diff("update", doc, data)) }));
        return { ...base, items, matchedDocs: found.total };
      }
      return { ...base, items: [diff("create", undefined, action === "update" ? data : input)] };
    }
    default: {
      // A write tool the card doesn't know: its arguments, readable.
      const { slug: _slug, ...rest } = input;
      return { ...base, items: [diff("create", undefined, rest)] };
    }
  }
}

/**
 * The card of `setRichTextFromMarkdown` (#67): the field as text, before (the current value as
 * Markdown, with the field's own converters) and after (the proposed Markdown, as the field's
 * editor will store it). Formatting Markdown can't keep is named in a notice.
 */
async function richTextProposal(
  req: PayloadRequest,
  record: PendingInterruptLike,
  call: InterruptCall,
  base: ApprovalProposal,
  asDocument: (doc: Doc) => ProposalDocument
): Promise<ApprovalProposal> {
  const { input } = call;
  const slug = input.slug as string;
  const path = typeof input.path === "string" ? input.path : "";
  const markdown = typeof input.markdown === "string" ? input.markdown : "";
  const id = idOf(input.id);
  const doc = id ? await readDoc(req, slug, id, input) : null;
  const fallback = (notice: string): ApprovalProposal => ({
    ...base,
    notice,
    items: [{ changes: [{ path: path || "markdown", label: path || "Rich text", kind: "changed", format: "richText", after: markdown }] }],
  });
  if (!doc) return fallback("The current document could not be read: it doesn't exist, or you can't access it. Applying this may fail.");
  const collection = richTextCollectionOf(req, slug);
  if (!collection) return fallback(`“${slug}” is not a collection of this site.`);
  try {
    const location = resolveRichText(collection, doc, path, blocksBySlugOf(req));
    const before = toMarkdown(location.converters, location.value) || lexicalToText(location.value);
    let after = markdown.trim();
    let unsupported: string[] = [];
    try {
      const proposed = location.converters.fromMarkdown({ markdown });
      after = toMarkdown(location.converters, proposed) || after;
      unsupported = unsupportedMarkdown(proposed);
    } catch {
      // Show the proposed Markdown as sent.
    }
    const losses = markdownLosses(location.value);
    const notices = [
      losses.length
        ? `This field contains ${losses.join(", ")}, which Markdown can't keep: ${
            input.allowFormattingLoss === true ? "approving removes it." : "the tool will refuse unless the editor agrees to lose it."
          }`
        : "",
      unsupported.length ? `This field doesn't support ${unsupported.join(", ")}: that Markdown will be saved as plain text.` : "",
    ].filter(Boolean);
    const lossNotice = notices.length ? notices.join(" ") : undefined;
    const change = before === after ? [] : [{
      path: location.path,
      label: location.label,
      kind: before ? (after ? "changed" : "removed") : "added",
      format: "richText",
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    } as ProposalItem["changes"][number]];
    return {
      ...base,
      ...(lossNotice ? { notice: lossNotice } : {}),
      items: [{ document: asDocument(doc), changes: change }],
      ...(changedAfter(doc, record.requestedAt) ? { changedSinceProposal: true } : {}),
    };
  } catch (error) {
    return fallback(error instanceof RichTextPathError ? error.message : "The rich text field could not be read.");
  }
}

/** Proposals for every pending approval of a conversation, oldest first. */
export function buildProposals(req: PayloadRequest, pending: ReadonlyArray<PendingInterruptLike>): Promise<ApprovalProposal[]> {
  return Promise.all(pending.map((record) => buildProposal(req, record)));
}

/**
 * The approvals whose document changed after the card showed it: `seenUpdatedAt` (what the diff
 * was built from) no longer matches the document's `updatedAt`, read now as the user. A document
 * that can't be read isn't "stale": applying will fail on its own and the card shows why.
 */
export async function findStaleApprovals(
  req: PayloadRequest,
  pending: ReadonlyArray<PendingInterruptLike>,
  seen: ReadonlyArray<{ interruptId: string; seenUpdatedAt: string }>
): Promise<string[]> {
  const stale: string[] = [];
  for (const { interruptId, seenUpdatedAt } of seen) {
    const record = pending.find((p) => p.interruptId === interruptId);
    if (!record) continue;
    const target = await currentTarget(req, interruptCall(record));
    const current = target?.doc?.updatedAt;
    if (typeof current === "string" && current !== seenUpdatedAt) stale.push(interruptId);
  }
  return stale;
}
