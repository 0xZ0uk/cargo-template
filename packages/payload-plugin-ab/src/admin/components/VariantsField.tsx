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

export function VariantsField({
  slugField = "slug",
  titleField = "title",
  collectionSlug: collectionSlugProp,
  resultsPath,
}: VariantsFieldProps) {
  const { id, collectionSlug: docCollectionSlug } = useDocumentInfo();
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

            {resultsPath && (
              <VariantResults
                url={`${apiURL}${resultsPath}`}
                collectionSlug={slug!}
                docId={id}
                variants={variants}
              />
            )}
          </>
        )}
      </div>

      <ConfirmationModal
        modalSlug={CLEAR_ALL_MODAL_SLUG}
        heading="Delete all variants?"
        body={`This deletes ${variants.length} variant(s) of this page. Their traffic goes back to the original.`}
        confirmLabel="Delete all"
        onConfirm={handleClearAll}
      />
    </div>
  );
}

export default VariantsField;
