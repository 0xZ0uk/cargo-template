import { describe, expect, it } from "vitest";
import { buildResultRows, conversionRate } from "../../src/admin/resultRows";

describe("buildResultRows", () => {
  it("lists the original, the current variants, then deleted variants with data", () => {
    const rows = buildResultRows(
      [
        { bucket: "about--b", impressions: 40, conversions: 4 },
        { bucket: "original", impressions: 60, conversions: 3 },
        { bucket: "about--gone", impressions: 5, conversions: 1 },
      ],
      [
        { slug: "about--a", title: "Short headline" },
        { slug: "about--b", title: "Long headline" },
      ]
    );
    expect(rows).toEqual([
      { bucket: "original", impressions: 60, conversions: 3, label: "Original" },
      { bucket: "about--a", impressions: 0, conversions: 0, label: "Short headline" },
      { bucket: "about--b", impressions: 40, conversions: 4, label: "Long headline" },
      {
        bucket: "about--gone",
        impressions: 5,
        conversions: 1,
        label: "Deleted variant (about--gone)",
        deleted: true,
      },
    ]);
  });

  it("formats the rate, with a dash before any impression", () => {
    expect(conversionRate(0, 0)).toBe("–");
    expect(conversionRate(60, 3)).toBe("5.0%");
  });
});
