/**
 * Documents a message is about (#69): the document a conversation started from ("Ask the
 * assistant" in an edit view) and the documents the editor mentioned with `@`. Shared by the
 * server and the client bundle: plain data and pure helpers, no Payload or `@tanstack/ai` imports.
 *
 * A reference is only an address and a title. It is resolved and access-checked on the server
 * (title included), stored in the user message's `metadata.assistant`, and shown to the model as a
 * short note naming the documents; their content never goes into the prompt; the model reads them
 * with its tools, as the user.
 */

/** A collection document or a global. `title` is the server's (`useAsTitle`, the global's label). */
export interface DocumentReference {
  kind: "collection" | "global";
  slug: string;
  /** Collections only. */
  id?: string;
  title: string;
}

/** What the client sends: an address; the server finds the title and checks access. */
export interface DocumentReferenceInput {
  kind: "collection" | "global";
  slug: string;
  id?: string;
}

/** The user message's `metadata.assistant`: what the message is about, as the server resolved it. */
export interface MessageReferences {
  /** The document the conversation started from (sent with the first message from an edit view). */
  context?: DocumentReference;
  /** Documents mentioned with `@`. */
  references?: DocumentReference[];
}

/** The key under the message's `metadata` (TanStack keeps `tanstack` for itself). */
export const MESSAGE_METADATA_KEY = "assistant";
/** Most `@` mentions in one message. */
export const MAX_REFERENCES = 10;
/** Collection and global slugs, as Payload allows them (and nothing that could break a note). */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Document ids: D1's integers, UUIDs, ObjectIds. */
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const isSlug = (value: unknown): value is string => typeof value === "string" && SLUG.test(value);
export const isDocumentId = (value: unknown): value is string => typeof value === "string" && DOC_ID.test(value);

/** One reference input from untrusted JSON, or `undefined` when it isn't one. Numbers ids become strings. */
export function parseReferenceInput(value: unknown): DocumentReferenceInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { kind, slug, id } = value as Record<string, unknown>;
  if (!isSlug(slug)) return undefined;
  if (kind === "global") return { kind, slug };
  if (kind !== "collection") return undefined;
  const text = typeof id === "number" && Number.isSafeInteger(id) ? String(id) : id;
  return isDocumentId(text) ? { kind, slug, id: text } : undefined;
}

/** A stable key for de-duplicating references (`pages:12`, `global:header`). */
export const referenceKey = (ref: DocumentReferenceInput): string =>
  ref.kind === "global" ? `global:${ref.slug}` : `${ref.slug}:${ref.id ?? ""}`;

/** The references stored on a message (`metadata.assistant`), tolerating anything else there. */
export function messageReferences(metadata: unknown): MessageReferences {
  const bag = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>)[MESSAGE_METADATA_KEY] : undefined;
  if (!bag || typeof bag !== "object") return {};
  const { context, references } = bag as Record<string, unknown>;
  const asRef = (value: unknown): DocumentReference | undefined => {
    const input = parseReferenceInput(value);
    const title = (value as { title?: unknown } | undefined)?.title;
    return input ? { ...input, title: typeof title === "string" && title ? title : input.id ?? input.slug } : undefined;
  };
  const out: MessageReferences = {};
  const ctx = asRef(context);
  if (ctx) out.context = ctx;
  if (Array.isArray(references)) {
    const refs = references.map(asRef).filter((ref): ref is DocumentReference => Boolean(ref));
    if (refs.length) out.references = refs;
  }
  return out;
}

/** How a document is named to the model: `pages 12 "Home"`, `global header "Header"`. */
export function describeReference(ref: DocumentReference): string {
  const title = JSON.stringify(ref.title.slice(0, 200));
  return ref.kind === "global" ? `global \`${ref.slug}\` ${title}` : `\`${ref.slug}\` id ${ref.id} ${title}`;
}

export const REFERENCE_NOTE_OPEN = "<document-references>";
export const REFERENCE_NOTE_CLOSE = "</document-references>";

/**
 * The note added after the user's text in what the model receives (never in the stored message):
 * which documents the message is about and how to read them. Titles and addresses only.
 */
export function referenceNote(refs: MessageReferences): string | undefined {
  const lines: string[] = [];
  if (refs.context) {
    const ref = refs.context;
    lines.push(
      `The editor opened this conversation from the edit view of ${describeReference(ref)}: "this document", "this page" and the like mean it. ` +
        (ref.kind === "global"
          ? `Read it with findGlobal (slug \`${ref.slug}\`) before you answer about it or change it.`
          : `Read it with findDocuments (slug \`${ref.slug}\`, id ${ref.id}, draft: true) before you answer about it or change it.`) +
        " The editor's unsaved changes in the form are not included: you see the saved version."
    );
  }
  if (refs.references?.length) {
    lines.push(
      `The editor mentioned: ${refs.references.map(describeReference).join("; ")}. ` +
        "Read the ones you need with findDocuments (by id, draft: true) or findGlobal before you answer about them."
    );
  }
  return lines.length ? `${REFERENCE_NOTE_OPEN}\n${lines.join("\n")}\n${REFERENCE_NOTE_CLOSE}` : undefined;
}

/** The user's own text, without a {@link referenceNote} after it (for the test model). */
export function withoutReferenceNote(text: string): string {
  const at = text.lastIndexOf(`\n\n${REFERENCE_NOTE_OPEN}`);
  return at >= 0 && text.trimEnd().endsWith(REFERENCE_NOTE_CLOSE) ? text.slice(0, at) : text;
}
