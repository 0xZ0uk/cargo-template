import type { CollectionSlug, PayloadRequest, Where } from "payload";
import { diffDocument, labelText, type BlockLike, type DiffMode, type FieldLike } from "../approvals/diff";
import type { ApprovalAction, ApprovalProposal, ProposalDocument, ProposalItem } from "../approvals/types";
import { lexicalToText } from "../approvals/lexical";
import { blocksBySlugOf, collectionOf as richTextCollectionOf, markdownLosses, resolveRichText, RichTextPathError, SET_RICH_TEXT_TOOL_NAME, toMarkdown, unsupportedMarkdown } from "../richText/fields";
import { describeCall, type ToolCall } from "../toolCalls";
import { reviewOf, type ApprovalAnswer } from "../approvals/decision";
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
  /** What the call means ({@link describeCall}). An interrupt is only raised for a tool that needs approval. */
  call: ToolCall;
}

/** The tool call behind an approval interrupt (`metadata: { kind: "approval", toolName, input }`). */
export function interruptCall(record: PendingInterruptLike): InterruptCall {
  const descriptor = record.payload as { toolCallId?: unknown; metadata?: { toolName?: unknown; input?: unknown } };
  const toolName = typeof descriptor.metadata?.toolName === "string" ? descriptor.metadata.toolName : "tool";
  const call = describeCall(toolName, descriptor.metadata?.input, { needsApproval: true });
  return {
    toolName,
    toolCallId: typeof descriptor.toolCallId === "string" ? descriptor.toolCallId : "",
    input: call.args,
    call,
  };
}

/** The card's action: a read never waits for approval, so it (like an unknown tool) is `other`. */
const actionOf = (call: ToolCall): ApprovalAction => (call.operation === "read" ? "other" : call.operation);

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

const localeOf = (call: ToolCall) => (call.locale ? { locale: call.locale } : {});

/** The documents a write by `where` matches (the first {@link MAX_ITEMS}), or `null` when they can't be read. */
async function findWhere(reader: UserReader, call: ToolCall, options: { limit?: number; sort?: string } = {}) {
  const { target, args } = call;
  if (!target || !isRecord(args.where)) return null;
  try {
    return await reader.find(target.slug, args.where as Where, { limit: MAX_ITEMS, ...options, ...localeOf(call) });
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
async function currentTarget(reader: UserReader, call: ToolCall): Promise<{ doc: Doc | null; version?: Doc } | undefined> {
  const { target, id } = call;
  if (!target) return undefined;
  const { slug } = target;
  const action = actionOf(call);
  if (target.kind === "global") {
    if (action === "restore") {
      const version = id ? await reader.findVersion(slug, id, { global: true }) : null;
      return { doc: await reader.findGlobal(slug, localeOf(call)), ...(version ? { version: version.version } : {}) };
    }
    return action === "update" ? { doc: await reader.findGlobal(slug, localeOf(call)) } : undefined;
  }
  if (action === "restore") {
    const version = id ? await reader.findVersion(slug, id) : null;
    const doc = version?.parent ? await reader.findByID(slug, version.parent, localeOf(call)) : null;
    return { doc, ...(version ? { version: version.version } : {}) };
  }
  if (action === "update" || action === "delete" || action === "duplicate") {
    return id ? { doc: await reader.findByID(slug, id, localeOf(call)) } : undefined;
  }
  return undefined;
}

const changedAfter = (doc: Doc | null | undefined, requestedAt: number) => {
  const updated = typeof doc?.updatedAt === "string" ? Date.parse(doc.updatedAt) : NaN;
  return Number.isFinite(updated) && Number.isFinite(requestedAt) && updated > requestedAt;
};

/*
 * Review tokens (#138): what a proposal's diff was built from, so an approval of an old diff is
 * refused. Opaque to the client, which echoes it back (`approvals/decision.ts`). Recomputed at
 * resume by {@link reviewTokenOf} with the same functions, never parsed.
 *
 * - One document (by id, a restore's parent, a duplicate's source, a global): its `updatedAt`.
 * - A write by `where`: how many documents match and the newest `updatedAt` among them. Any edit
 *   of a match makes it the newest; a new match (created, or edited into the set) is the newest
 *   too; a match deleted or edited out of the set lowers the count. So the pair changes whenever
 *   the set of documents the write would touch, or one of them, does — with one read of one
 *   document, however many match.
 */
const tokenOf = (token: string | undefined) => (token ? { reviewToken: token } : {});

const docToken = (doc: Doc | null | undefined) => (typeof doc?.updatedAt === "string" ? `doc:${doc.updatedAt}` : undefined);

/** How many documents a write by `where` matches and the newest of them, or `null` when they can't be read. */
async function whereStamp(reader: UserReader, call: ToolCall): Promise<{ total: number; newest: Doc | undefined } | null> {
  const found = await findWhere(reader, call, { limit: 1, sort: "-updatedAt" });
  return found ? { total: found.total, newest: found.docs[0] } : null;
}

const whereToken = (stamp: { total: number; newest: Doc | undefined }) =>
  `where:${stamp.total}:${typeof stamp.newest?.updatedAt === "string" ? stamp.newest.updatedAt : ""}`;

const isWhereWrite = (call: ToolCall) =>
  Boolean(call.target) && call.id === undefined && (call.operation === "update" || call.operation === "delete") && call.args.where !== undefined;

/** The review token of a pending write, read now as the user; `undefined` when nothing can go stale or nothing can be read. */
async function reviewTokenOf(reader: UserReader, call: ToolCall): Promise<string | undefined> {
  if (reader.hiddenField(call)) return undefined;
  const target = await currentTarget(reader, call);
  if (target) return docToken(target.doc);
  if (!isWhereWrite(call)) return undefined;
  const stamp = await whereStamp(reader, call);
  return stamp ? whereToken(stamp) : undefined;
}

/** Build the proposal of one pending approval. Never throws: problems become a `notice`. */
export async function buildProposal(reader: UserReader, record: PendingInterruptLike): Promise<ApprovalProposal> {
  const { req } = reader;
  const interrupt = interruptCall(record);
  const { toolName, input, call } = interrupt;
  const action = actionOf(call);
  const slug = call.target?.slug;
  // Current values of redacted fields (#68) never reach the card: the reader returns documents
  // without them, populated relations (`createdBy`…) redacted by their own collection. What the
  // model proposes to write is shown as is (it authored it).
  const global = call.target?.kind === "global";
  const collectionConfig = slug && !global ? collectionOf(req, slug) : undefined;
  const globalConfig = slug && global ? globalOf(req, slug) : undefined;
  const entity = collectionConfig ?? globalConfig;
  const fields = (entity?.fields ?? undefined) as FieldLike[] | undefined;
  const blocks = blocksOf(req);
  const versioned = Boolean(entity?.versions && (entity.versions as { drafts?: unknown }).drafts);

  const base: ApprovalProposal = {
    interruptId: record.interruptId,
    toolCallId: interrupt.toolCallId,
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
  const hiddenField = reader.hiddenField(call);
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
            ...tokenOf(docToken(doc)),
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
          return { ...base, items: [{ document: asDocument(doc), ...diff("create", undefined, { ...doc, ...data }) }], ...tokenOf(docToken(doc)) };
        }
        return {
          ...base,
          items: [{ document: asDocument(doc), ...(action === "delete" ? diff("delete", doc, undefined) : diff("update", doc, data)) }],
          ...(changedAfter(doc, record.requestedAt) ? { changedSinceProposal: true } : {}),
          ...tokenOf(docToken(doc)),
        };
      }
      // By `where` (update or delete many).
      if (isWhereWrite(call)) {
        // The stamp is read before the documents: a change in between makes the token older
        // than the diff (a needless 409), never newer (an approval of a diff that is out of date).
        const stamp = await whereStamp(reader, call);
        const found = stamp && (await findWhere(reader, call));
        if (!found) return { ...base, notice: "The matching documents could not be read.", items: action === "update" ? [diff("create", undefined, data)] : [] };
        const items = found.docs.map((doc) => ({ document: asDocument(doc), ...(action === "delete" ? diff("delete", doc, undefined) : diff("update", doc, data)) }));
        return {
          ...base,
          items,
          matchedDocs: found.total,
          ...(changedAfter(stamp.newest, record.requestedAt) ? { changedSinceProposal: true } : {}),
          reviewToken: whereToken(stamp),
        };
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
  call: ToolCall,
  base: ApprovalProposal,
  asDocument: (doc: Doc) => ProposalDocument
): Promise<ApprovalProposal> {
  const { req } = reader;
  const { args: input } = call;
  const slug = call.target?.slug ?? "";
  const path = typeof input.path === "string" ? input.path : "";
  const markdown = typeof input.markdown === "string" ? input.markdown : "";
  const doc = call.id ? await reader.findByID(slug, call.id, localeOf(call)) : null;
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
      ...tokenOf(docToken(doc)),
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
 * The approvals whose targets changed after the card showed them: the answer's review token
 * ({@link reviewTokenOf}) no longer matches, read now as the user. Targets that can't be read
 * aren't "stale": applying will fail on its own and the card shows why.
 *
 * Legacy answers (`seenUpdatedAt`, before #138) are checked as they were: the single document's
 * `updatedAt`, nothing for a write by `where`.
 */
export async function findStaleApprovals(
  reader: UserReader,
  pending: ReadonlyArray<PendingInterruptLike>,
  answers: ReadonlyArray<{ interruptId: string; answer: ApprovalAnswer }>
): Promise<string[]> {
  const stale: string[] = [];
  for (const { interruptId, answer } of answers) {
    const review = reviewOf(answer);
    const record = review && pending.find((p) => p.interruptId === interruptId);
    if (!review || !record) continue;
    const { call } = interruptCall(record);
    if ("reviewToken" in review) {
      const current = await reviewTokenOf(reader, call);
      if (current !== undefined && current !== review.reviewToken) stale.push(interruptId);
    } else {
      const current = (await currentTarget(reader, call))?.doc?.updatedAt;
      if (typeof current === "string" && current !== review.seenUpdatedAt) stale.push(interruptId);
    }
  }
  return stale;
}
