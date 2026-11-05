"use client";

import type { VariantData } from "./VariantsField";

import { EditIcon, TrashIcon, useDocumentDrawer } from "@payloadcms/ui";

interface VariantRowProps {
  variant: VariantData;
  collectionSlug: string;
  maxPercentage: number;
  onPercentageChange: (value: string) => void;
  onPercentageBlur: () => void;
  onDelete: () => void;
  onSaved: () => void;
}

export function VariantRow({
  variant,
  collectionSlug,
  maxPercentage,
  onPercentageChange,
  onPercentageBlur,
  onDelete,
  onSaved,
}: VariantRowProps) {
  const [DocumentDrawer, , { openDrawer, closeDrawer }] = useDocumentDrawer({
    collectionSlug,
    id: variant.id,
  });

  const handleAfterAction = () => {
    closeDrawer();
    onSaved();
  };

  const title = variant.title ?? variant.slug ?? String(variant.id);

  return (
    <div className="ab-variant-row">
      <span className="ab-variant-row__title" title={title}>
        {title}
      </span>

      <div className="ab-variant-row__percent">
        <input
          type="number"
          min={1}
          max={maxPercentage}
          value={variant.passPercentage ?? ""}
          onChange={(e) => onPercentageChange(e.target.value)}
          onBlur={onPercentageBlur}
          className="ab-variant-row__percent-input"
          aria-label={`Traffic for ${title} (1–${maxPercentage}%)`}
          title={`Traffic percentage (1–${maxPercentage})`}
        />
        <span className="ab-variant-row__percent-suffix" aria-hidden="true">
          %
        </span>
      </div>

      <button
        type="button"
        onClick={openDrawer}
        className="ab-variant-row__icon-btn"
        aria-label={`Edit ${title}`}
        title="Edit variant"
      >
        <EditIcon />
      </button>

      <button
        type="button"
        onClick={onDelete}
        className="ab-variant-row__icon-btn ab-variant-row__icon-btn--danger"
        aria-label={`Remove ${title}`}
        title="Remove variant"
      >
        <TrashIcon />
      </button>

      <DocumentDrawer onSave={handleAfterAction} onDelete={handleAfterAction} />
    </div>
  );
}
