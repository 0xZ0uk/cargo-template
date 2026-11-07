import type { CollectionSlug, PayloadRequest, Where } from "payload";
import { diffDocument, labelText, type BlockLike, type DiffMode, type FieldLike } from "../approvals/diff";
import type { ApprovalAction, ApprovalProposal, ProposalDocument, ProposalItem } from "../approvals/types";
import { lexicalToText } from "../approvals/lexical";
import { blocksBySlugOf, collectionOf as richTextCollectionOf, markdownLosses, resolveRichText, RichTextPathError, SET_RICH_TEXT_TOOL_NAME, toMarkdown, unsupportedMarkdown } from "../richText/fields";
import { HiddenFieldError, type UserReader } from "./reader";

/**
 * Approval proposals (#65): what a pending write would change, read as the signed-in user.
 *
 * Every read goes through the request's {@link UserReader} (`overrideAccess: false`, `depth: 0`,
 * drafts included, redacted fields removed, titles that never use a hidden field): the card shows
 * what the user may see, and the write itself is access-checked again when it runs
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

function documentOf(reader: UserReader, slug: string, doc: Doc): ProposalDocument {
  const id = idOf(doc.id) ?? "";
  return {
    id,
    title: reader.title(slug, doc, id),
    ...(typeof doc.updatedAt === "string" ? { updatedAt: doc.updatedAt } : {}),
    ...(typeof doc._status === "string" ? { status: doc._status } : {}),
  };
}

const localeOf = (input: Record<string, unknown>) => (typeof input.locale === "string" && input.locale ? { locale: input.locale } : {});

/** The documents a write by `where` matches (the first {@link MAX_ITEMS}), or `null` when they can't be read. */
async function findWhere(reader: UserReader, slug: string, where: unknown, input: Record<string, unknown>) {
  if (!isRecord(where)) return null;
  try {
    return await reader.find(slug, where as Where, { limit: MAX_ITEMS, ...localeOf(input) });
  } catch (error) {
    if (error instanceof HiddenFieldError) return null;
    throw error;
  }
}

/**
 * The single document a write targets, read now as the user: `updateDocument`/`deleteDocuments`
 * by id, `restoreVersion` (the version's parent), `duplicateDocument`, and the global tools.
 * `undefined` for writes that don't target one existing document (create, by `where`).
 */
async function currentTarget(reader: UserReader, call: InterruptCall): Promise<{ doc: Doc | null; version?: Doc } | undefined> {
  const { toolName, input } = call;
  const slug = typeof input.slug === "string" ? input.slug : undefined;
  if (!slug) return undefined;
  const action = actionOf(toolName);
  if (isGlobalTool(toolName)) {
    if (action === "restore") {
      const versionId = idOf(input.id);
      const version = versionId ? await reader.findVersion(slug, versionId, { global: true }) : null;
      return { doc: await reader.findGlobal(slug, localeOf(input)), ...(version ? { version: version.version } : {}) };
    }
    return action === "update" ? { doc: await reader.findGlobal(slug, localeOf(input)) } : undefined;
  }
  if (action === "restore") {
    const versionId = idOf(input.id);
    const version = versionId ? await reader.findVersion(slug, versionId) : null;
    const doc = version?.parent ? await reader.findByID(slug, version.parent, localeOf(input)) : null;
    return { doc, ...(version ? { version: version.version } : {}) };
  }
  if (action === "update" || action === "delete" || action === "duplicate") {
    const id = idOf(input.id);
    return id ? { doc: await reader.findByID(slug, id, localeOf(input)) } : undefined;
  }
  return undefined;
}

const changedAfter = (doc: Doc | null | undefined, requestedAt: number) => {
  const updated = typeof doc?.updatedAt === "string" ? Date.parse(doc.updatedAt) : NaN;
  return Number.isFinite(updated) && Number.isFinite(requestedAt) && updated > requestedAt;
};

/** Build the proposal of one pending approval. Never throws: problems become a `notice`. */
export async function buildProposal(reader: UserReader, record: PendingInterruptLike): Promise<ApprovalProposal> {
  const { req } = reader;
  const call = interruptCall(record);
  const { toolName, input } = call;
  const action = actionOf(toolName);
  const slug = typeof input.slug === "string" ? input.slug : undefined;
  // Current values of redacted fields (#68) never reach the card: the reader returns documents
  // without them, populated relations (`createdBy`…) redacted by their own collection. What the
  // model proposes to write is shown as is (it authored it).
  const global = isGlobalTool(toolName);
  const collectionConfig = slug && !global ? collectionOf(req, slug) : undefined;
  const globalConfig = slug && global ? globalOf(req, slug) : undefined;
  const entity = collectionConfig ?? globalConfig;
  const fields = (entity?.fields ?? undefined) as FieldLike[] | undefined;
  const blocks = blocksOf(req);
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
  // The card's title comes from the reader, which never names a document by a hidden field.
  const asDocument = (doc: Doc) =>
    global ? { ...documentOf(reader, "", doc), id: "", title: base.target?.label ?? slug ?? "" } : documentOf(reader, slug ?? "", doc);

  if (slug && !entity) {
    return { ...base, notice: `“${slug}” is not a collection or global of this site.`, items: [diff("create", undefined, input)] };
  }

  // The policy refuses calls that query a hidden field (#68) when they are applied: say so now.
  const hiddenField = reader.hiddenField(input, toolName);
  if (hiddenField) {
    return {
      ...base,
      notice: `This change uses the hidden field “${hiddenField}” in its where, sort or select, so it will be refused if you approve it. Reject it.`,
      items: [],
    };
  }

  if (toolName === SET_RICH_TEXT_TOOL_NAME && slug && collectionConfig) {
    return richTextProposal(reader, record, call, { ...base, ...(versioned ? { draft: input.draft !== false } : {}) }, asDocument);
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
      const target = await currentTarget(reader, call);
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
        const found = await findWhere(reader, slug, input.where, input);
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
  reader: UserReader,
  record: PendingInterruptLike,
  call: InterruptCall,
  base: ApprovalProposal,
  asDocument: (doc: Doc) => ProposalDocument
): Promise<ApprovalProposal> {
  const { req } = reader;
  const { input } = call;
  const slug = input.slug as string;
  const path = typeof input.path === "string" ? input.path : "";
  const markdown = typeof input.markdown === "string" ? input.markdown : "";
  const id = idOf(input.id);
  const doc = id ? await reader.findByID(slug, id, localeOf(input)) : null;
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
export function buildProposals(reader: UserReader, pending: ReadonlyArray<PendingInterruptLike>): Promise<ApprovalProposal[]> {
  return Promise.all(pending.map((record) => buildProposal(reader, record)));
}

/**
 * The approvals whose document changed after the card showed it: `seenUpdatedAt` (what the diff
 * was built from) no longer matches the document's `updatedAt`, read now as the user. A document
 * that can't be read isn't "stale": applying will fail on its own and the card shows why.
 */
export async function findStaleApprovals(
  reader: UserReader,
  pending: ReadonlyArray<PendingInterruptLike>,
  seen: ReadonlyArray<{ interruptId: string; seenUpdatedAt: string }>
): Promise<string[]> {
  const stale: string[] = [];
  for (const { interruptId, seenUpdatedAt } of seen) {
    const record = pending.find((p) => p.interruptId === interruptId);
    if (!record) continue;
    const target = await currentTarget(reader, interruptCall(record));
    const current = target?.doc?.updatedAt;
    if (typeof current === "string" && current !== seenUpdatedAt) stale.push(interruptId);
  }
  return stale;
}
