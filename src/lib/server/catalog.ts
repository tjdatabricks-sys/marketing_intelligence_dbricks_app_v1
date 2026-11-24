import { execute, t, Bind, DATE_FIELDS } from "./sql";
import { SUMMARY } from "./schema";
import type { Catalog, Choice, Filters } from "../contracts";
import type { Context } from "./sql";
import { WarehouseError } from "./warehouse";

function choices(rows: Record<string, unknown>[]): Choice[] {
  return rows
    .filter(
      (row) => row.id !== null && row.id !== undefined && String(row.id).trim(),
    )
    .map((row) => ({ id: String(row.id), label: String(row.label ?? row.id) }));
}
export async function loadCatalog(): Promise<Catalog> {
  const [
    campaigns,
    platforms,
    markets,
    products,
    segments,
    models,
    budgets,
    dates,
  ] = await Promise.all([
    execute(
      `SELECT campaign_id AS id, CASE WHEN COUNT(DISTINCT campaign_name)=1 THEN MAX(campaign_name) ELSE campaign_id END AS label FROM ${t("dim_campaign")} GROUP BY campaign_id ORDER BY label`,
    ),
    execute(
      `SELECT f.platform_id AS id, COALESCE(p.label,f.platform_id) AS label FROM (SELECT DISTINCT platform_id FROM ${t("fact_paid_ad_daily")} WHERE platform_id IS NOT NULL) f LEFT JOIN (SELECT platform_id, CASE WHEN COUNT(DISTINCT platform_name)=1 THEN MAX(platform_name) ELSE platform_id END AS label FROM ${t("dim_platform")} GROUP BY platform_id) p ON p.platform_id=f.platform_id ORDER BY label`,
    ),
    // DISTINCT queries resolve ORDER BY against output aliases only, so order by `label`, not the source column.
    execute(
      `SELECT DISTINCT market AS id,market AS label FROM ${t("dim_geography")} WHERE market IS NOT NULL AND TRIM(market)<>'' ORDER BY label`,
    ),
    execute(
      `SELECT product_id AS id,CASE WHEN COUNT(DISTINCT product_name)=1 THEN MAX(product_name) ELSE product_id END AS label FROM ${t("dim_product")} GROUP BY product_id ORDER BY label`,
    ),
    execute(
      `SELECT DISTINCT customer_segment AS id,customer_segment AS label FROM ${t("dim_customer")} WHERE customer_segment IS NOT NULL AND TRIM(customer_segment)<>'' ORDER BY label`,
    ),
    execute(
      `SELECT DISTINCT attribution_model AS model,attribution_model_version AS version FROM (SELECT attribution_model,attribution_model_version FROM ${t("fact_funded_attribution_allocation")} UNION ALL SELECT attribution_model,attribution_model_version FROM ${t("fact_attributed_contribution_monthly")}) a WHERE attribution_model IS NOT NULL AND attribution_model_version IS NOT NULL ORDER BY model,version`,
    ),
    execute(
      `SELECT DISTINCT budget_version AS id,budget_version AS label FROM ${t("fact_campaign_budget_monthly")} WHERE budget_version IS NOT NULL ORDER BY label`,
    ),
    execute(
      `SELECT MIN(first_date) AS first_date,MAX(last_date) AS last_date FROM (${Object.entries(
        DATE_FIELDS,
      )
        .filter(([table]) => table.startsWith("fact_"))
        .map(
          ([table, column]) =>
            `SELECT MIN(${column}) AS first_date,MAX(${table === "fact_paid_reach_window" ? "window_end" : column}) AS last_date FROM ${t(table)}`,
        )
        .join(" UNION ALL ")}) dates`,
    ),
  ]);
  const asDate = (value: unknown) =>
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value
        ? String(value).slice(0, 10)
        : new Date().toISOString().slice(0, 10);
  return {
    ...SUMMARY,
    campaigns: choices(campaigns),
    platforms: choices(platforms),
    markets: choices(markets),
    products: choices(products),
    segments: choices(segments),
    attribution: models.map((row) => ({
      id: JSON.stringify([String(row.model), String(row.version)]),
      label: `${row.model} · ${row.version}`,
    })),
    budgetVersions: choices(budgets),
    dateRange: {
      min: asDate(dates[0]?.first_date),
      max: asDate(dates[0]?.last_date),
    },
  };
}
let cached: { at: number; promise: Promise<Catalog> } | undefined;
export async function getCatalog() {
  if (cached && Date.now() - cached.at < 60000) return cached.promise;
  const entry = { at: Date.now(), promise: loadCatalog() };
  cached = entry;
  try {
    return await entry.promise;
  } catch (error) {
    if (cached === entry) cached = undefined;
    throw error;
  }
}
export function resolveContext(filters: Filters, catalog: Catalog): Context {
  const notes: string[] = [];
  const select = (
    value: string | undefined,
    options: Choice[],
    label: string,
  ) => {
    if (value && value !== "auto") {
      if (!options.some((option) => option.id === value))
        throw new WarehouseError(
          `Unknown ${label} selection. Refresh the filter options.`,
          "INVALID_FILTER",
          400,
        );
      return value;
    }
    if (options.length === 1) return options[0].id;
    if (options.length > 1)
      notes.push(
        `Select one ${label}; measures using it are unavailable until a selection is made. Versions are never summed together.`,
      );
    return null;
  };
  const attribution = select(
    filters.attribution,
    catalog.attribution,
    "attribution model/version",
  );
  const budgetVersion = select(
    filters.budgetVersion,
    catalog.budgetVersions,
    "budget version",
  );
  return {
    filters,
    attribution: attribution
      ? (JSON.parse(attribution) as [string, string])
      : null,
    budgetVersion,
    notes,
  };
}
