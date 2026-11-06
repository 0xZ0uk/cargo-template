"use client";

import "./VariantsField.css";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ConfirmationModal,
  FieldLabel,
  Spinner,
  toast,
  useConfig,
  useDocumentInfo,
  useField,
  useFormModified,
  useModal,
} from "@payloadcms/ui";
import {
  AB_MAX_VARIANT_TOTAL,
  AB_PASS_PERCENTAGE_FIELD,
  AB_PENDING_PERCENTAGES_FIELD,
  AB_VARIANT_OF_FIELD,
} from "../../constants";
import { VariantRow } from "./VariantRow";
import { VariantResults } from "./VariantResults";

export interface VariantData {
  id: string;
  title?: string;
  slug?: string;
  passPercentage: number | null;
}

interface VariantsFieldProps {
  slugField?: string;
  titleField?: string;
  collectionSlug?: string; // injected via customComponents clientProps
  /**
   * Set by the plugin when `measurement` is configured: the results endpoint, relative to the
   * API route. Without it the panel shows no results.
   */
  resultsPath?: string;
}

const CLEAR_ALL_MODAL_SLUG = "ab-variants-clear-all";
const PROMOTE_MODAL_SLUG = "ab-variants-promote";

export function VariantsField({
  slugField = "slug",
  titleField = "title",
  collectionSlug: collectionSlugProp,
  resultsPath,
}: VariantsFieldProps) {
  const { id, collectionSlug: docCollectionSlug, unpublishedVersionCount } = useDocumentInfo();
  const formModified = useFormModified();
  const slug = collectionSlugProp ?? docCollectionSlug;
  const {
    config: {
      serverURL,
      routes: { api: apiRoute },
    },
  } = useConfig();
  const apiURL = `${serverURL ?? ""}${apiRoute}`;
  const { openModal } = useModal();

  const [variants, setVariants] = useState<VariantData[]>([]);

  const { value: pendingPercentages, setValue: setPendingPercentages } = useField<
    Record<string, number> | null
  >({
    path: AB_PENDING_PERCENTAGES_FIELD,
  });

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState<VariantData | null>(null);

  const fetchVariants = useCallback(async () => {
    if (!id || !slug) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        [`where[${AB_VARIANT_OF_FIELD}][equals]`]: String(id),
        limit: "100",
        depth: "0",
        draft: "true",
      });
      const draftRes = await fetch(`${apiURL}/${slug}?${query}`, { credentials: "include" });
      if (!draftRes.ok) throw new Error("Failed to fetch variants");

      const draftData = await draftRes.json();

      setVariants(
        (draftData.docs ?? []).map((doc: Record<string, unknown>) => ({
          id: String(doc.id),
          title: (doc[titleField] as string | undefined) || (doc[slugField] as string | undefined),
          slug: doc[slugField] as string | undefined,
          passPercentage: (doc[AB_PASS_PERCENTAGE_FIELD] as number | undefined) ?? 1,
        }))
      );
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [apiURL, id, slug, slugField, titleField]);

  useEffect(() => {
    void fetchVariants();
  }, [fetchVariants]);

  const dropPending = (ids: Iterable<string>) => {
    if (!pendingPercentages) return;
    const next = { ...pendingPercentages };
    let changed = false;
    for (const variantId of ids) {
      if (next[variantId] !== undefined) {
        delete next[variantId];
        changed = true;
      }
    }
    if (changed) setPendingPercentages(Object.keys(next).length > 0 ? next : null);
  };

  const handleAddVariant = async () => {
    if (!id || !slug) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${apiURL}/_ab/duplicate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionSlug: slug, docId: id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Error: ${body.error ?? "Unknown error"}`);
        return;
      }

      // The list is refetched from the variants' drafts below; staged values for the
      // existing variants would be stale against it.
      dropPending(variants.map((v) => v.id));

      await fetchVariants();
      toast.success("Variant created");
    } catch {
      toast.error("Failed to create variant");
    } finally {
      setActionLoading(false);
    }
  };

  const deleteVariant = async (variantId: string) => {
    const res = await fetch(`${apiURL}/${slug}/${encodeURIComponent(variantId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return res.ok;
  };

  const handleDeleteVariant = async (variantId: string) => {
    if (!slug) return;
    setActionLoading(true);
    try {
      if (!(await deleteVariant(variantId))) {
        toast.error("Failed to delete variant");
        return;
      }
      setVariants((prev) => prev.filter((v) => v.id !== variantId));
      dropPending([variantId]);
    } catch {
      toast.error("Failed to delete variant");
    } finally {
      setActionLoading(false);
    }
  };

  const handleClearAll = async () => {
    if (!variants.length || !slug) return;
    setActionLoading(true);
    try {
      // One at a time: each delete recomputes the page's manifest entry (read, modify, write
      // one JSON value), and parallel deletes would race and leave deleted variants in it.
      const deleted = new Set<string>();
      for (const v of variants) {
        try {
          if (await deleteVariant(v.id)) deleted.add(v.id);
        } catch {
          // counted as failed below
        }
      }
      const failed = variants.length - deleted.size;
      setVariants((prev) => prev.filter((v) => !deleted.has(v.id)));
      dropPending(deleted);
      if (failed > 0) toast.error(`${failed} variant(s) failed to delete`);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePromote = async () => {
    const target = promoteTarget;
    if (!target || !id || !slug) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${apiURL}/_ab/promote`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionSlug: slug, docId: id, variantId: target.id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; deleted?: unknown[] };
      if (!res.ok) {
        toast.error(body.error ?? "Failed to promote the variant");
        // Part of it may have happened (the draft written, some variants deleted).
        await fetchVariants();
        return;
      }
      toast.success("Variant promoted. Review this page's draft, then publish it.");
      // The form holds the content from before the promotion: reload it so the editor sees,
      // and later saves, the promoted draft rather than overwriting it.
      window.location.reload();
    } catch {
      toast.error("Failed to promote the variant");
    } finally {
      setActionLoading(false);
      setPromoteTarget(null);
    }
  };

  const openPromote = (variant: VariantData) => {
    setPromoteTarget(variant);
    openModal(PROMOTE_MODAL_SLUG);
  };

  const sumOthers = (excludeId: string) =>
    variants.filter((v) => v.id !== excludeId).reduce((s, v) => s + (v.passPercentage ?? 0), 0);

  const handlePercentageChange = (variantId: string, rawStr: string) => {
    if (rawStr === "") {
      setVariants((prev) =>
        prev.map((v) => (v.id === variantId ? { ...v, passPercentage: null } : v))
      );
      return;
    }
    const raw = Number(rawStr);
    if (isNaN(raw)) return;
    const maxAllowed = Math.max(1, AB_MAX_VARIANT_TOTAL - sumOthers(variantId));
    const clamped = Math.min(raw, maxAllowed);
    setVariants((prev) =>
      prev.map((v) => (v.id === variantId ? { ...v, passPercentage: clamped } : v))
    );
    setPendingPercentages({ ...(pendingPercentages ?? {}), [variantId]: clamped });
  };

  const handlePercentageBlur = (variantId: string) => {
    const variant = variants.find((v) => v.id === variantId);
    if (!variant) return;
    const maxAllowed = Math.max(1, AB_MAX_VARIANT_TOTAL - sumOthers(variantId));
    const lastValid = pendingPercentages?.[variantId] ?? 1;
    const enforced = Math.max(1, Math.min(variant.passPercentage ?? lastValid, maxAllowed));
    if (enforced === variant.passPercentage) return;
    setVariants((prev) =>
      prev.map((v) => (v.id === variantId ? { ...v, passPercentage: enforced } : v))
    );
    setPendingPercentages({ ...(pendingPercentages ?? {}), [variantId]: enforced });
  };

  if (!id) return null;

  const totalVariantPercent = variants.reduce((sum, v) => sum + (v.passPercentage ?? 0), 0);
  const originalPercent = 100 - totalVariantPercent;

  return (
    <div className="ab-variants">
      <div
        className={`ab-variants__body${actionLoading ? " ab-variants__body--busy" : ""}`}
        aria-busy={actionLoading || loading}
      >
        <div className="ab-variants__header">
          <FieldLabel label="Variants" />
          {variants.length > 0 && (
            <span className="ab-variants__original-share">
              Original: {Math.max(0, originalPercent)}% of traffic
            </span>
          )}
        </div>
        {loading ? (
          <div className="ab-variants__placeholder">
            <Spinner size="sm" loadingText={null} />
          </div>
        ) : variants.length === 0 ? (
          <div className="ab-variants__placeholder">
            <Button onClick={handleAddVariant} buttonStyle="primary" size="medium" margin={false}>
              Add variant
            </Button>
          </div>
        ) : (
          <>
            {variants.map((variant) => (
              <VariantRow
                key={variant.id}
                variant={variant}
                collectionSlug={slug!}
                maxPercentage={Math.max(1, AB_MAX_VARIANT_TOTAL - sumOthers(variant.id))}
                onPercentageChange={(value) => handlePercentageChange(variant.id, value)}
                onPercentageBlur={() => handlePercentageBlur(variant.id)}
                onDelete={() => handleDeleteVariant(variant.id)}
                onPromote={() => openPromote(variant)}
                onSaved={fetchVariants}
              />
            ))}

            <div className="ab-variants__actions">
              <div>
                <Button onClick={handleAddVariant} buttonStyle="primary" size="medium" margin={false}>
                  Add variant
                </Button>
              </div>
              <div>
                <Button
                  onClick={() => openModal(CLEAR_ALL_MODAL_SLUG)}
                  buttonStyle="secondary"
                  size="medium"
                  margin={false}
                >
                  Clear all
                </Button>
              </div>
            </div>
          </>
        )}

        {/* With no variants left it still lists past experiments (and hides itself without). */}
        {resultsPath && !loading && slug && id && (
          <VariantResults
            url={`${apiURL}${resultsPath}`}
            collectionSlug={slug}
            docId={id}
            variants={variants}
          />
        )}
      </div>

      <ConfirmationModal
        modalSlug={CLEAR_ALL_MODAL_SLUG}
        heading="Delete all variants?"
        body={`This deletes ${variants.length} variant(s) of this page. Their traffic goes back to the original.`}
        confirmLabel="Delete all"
        onConfirm={handleClearAll}
      />

      <ConfirmationModal
        modalSlug={PROMOTE_MODAL_SLUG}
        heading={`Promote ${promoteTarget?.title ?? "this variant"}?`}
        body={
          <div className="ab-promote" data-testid="ab-promote-confirm">
            <p>
              Its content, including SEO, is copied onto this page as a <strong>draft</strong>, in
              every locale. The slug and URL stay. Nothing changes on the live site until you
              publish this page.
            </p>
            <p>
              The experiment then ends: {variants.length === 1 ? "the variant is" : `all ${variants.length} variants are`}{" "}
              deleted, which can&apos;t be undone. The results stay under Past experiments, and
              this page&apos;s current content stays in its version history.
            </p>
            {unpublishedVersionCount > 0 && (
              <p className="ab-promote__warning" data-testid="ab-promote-draft-warning">
                This page has unpublished changes: the promoted content replaces them (they stay
                in the version history).
              </p>
            )}
            {formModified && (
              <p className="ab-promote__warning">
                Unsaved changes in this form are lost: the page reloads after the promotion.
              </p>
            )}
          </div>
        }
        confirmLabel="Promote"
        confirmingLabel="Promoting…"
        onCancel={() => setPromoteTarget(null)}
        onConfirm={handlePromote}
      />
    </div>
  );
}

export default VariantsField;
