import { qualifiedTable, quoteIdentifier } from "./config";
import { hasColumn, tableColumns } from "./schema";
import { WarehouseError, queryTransport } from "./warehouse";
import type { Filters } from "../contracts";

export interface Statement {
  sql: string;
  parameters: Record<string, string | number | boolean>;
}
export const t = (table: string) => {
  tableColumns(table);
  return qualifiedTable(table);
};
export const c = (table: string, alias: string, column: string) => {
  if (!hasColumn(table, column))
    throw new Error(`Unknown column ${table}.${column}`);
  return `${alias}.${quoteIdentifier(column)}`;
};
export class Bind {
  parameters: Statement["parameters"] = {};
  add(value: string | number | boolean) {
    const key = "p" + Object.keys(this.parameters).length;
    this.parameters[key] = value;
    return ":" + key;
  }
}
export interface Context {
  filters: Filters;
  attribution: [string, string] | null;
  budgetVersion: string | null;
  notes: string[];
}
export const DATE_FIELDS: Record<string, string> = {
  fact_application: "submission_date",
  fact_attributed_contribution_monthly: "report_month",
  fact_campaign_budget_monthly: "budget_month",
  fact_campaign_monthly_scorecard: "month",
  fact_direct_mail: "dispatch_date",
  fact_email_send_cohort_daily: "send_date",
  fact_experiment_variant_assignment_cohort: "assignment_date",
  fact_finance_gl_posting: "posting_date",
  fact_funded_account: "funding_date",
  fact_funded_attribution_allocation: "attributed_date",
  fact_funding_event: "funding_date",
  fact_lead: "created_date",
  fact_lead_funnel_snapshot: "created_date",
  fact_marketing_submission: "submission_date",
  fact_offline_response: "response_date",
  fact_ooh_delivery_monthly: "report_month",
  fact_organic_platform_monthly: "report_month",
  fact_organic_post_daily: "report_date",
  fact_paid_ad_daily: "report_date",
  fact_paid_ad_engagement_daily: "report_date",
  fact_paid_campaign_daily: "report_date",
  fact_paid_campaign_monthly: "report_month",
  fact_paid_reach_window: "window_start",
  fact_relationship_value_monthly: "report_month",
  fact_sales_target_monthly: "target_month",
  fact_tv_spot: "air_date",
  fact_vendor_invoice_line: "invoice_billing_month",
  fact_web_session: "session_date",
  fact_web_session_daily: "session_date",
  dim_customer: "created_date",
};

export function dateWhere(
  table: string,
  alias: string,
  ctx: Context,
  b: Bind,
): string[] {
  const column = DATE_FIELDS[table];
  if (!column) return [];
  const from = ctx.filters.from,
    to = ctx.filters.to;
  const month = [
    "report_month",
    "budget_month",
    "month",
    "target_month",
    "invoice_billing_month",
  ].includes(column);
  const parts: string[] = [];
  if (table === "fact_paid_reach_window") {
    if (from)
      parts.push(
        `${c(table, alias, "window_end")} >= CAST(${b.add(from)} AS DATE)`,
      );
    if (to)
      parts.push(
        `${c(table, alias, "window_start")} <= CAST(${b.add(to)} AS DATE)`,
      );
  } else {
    if (from)
      parts.push(
        `${c(table, alias, column)} >= CAST(${b.add(month ? from.slice(0, 7) + "-01" : from)} AS DATE)`,
      );
    if (to)
      parts.push(
        `${c(table, alias, column)} <= CAST(${b.add(month ? to.slice(0, 7) + "-01" : to)} AS DATE)`,
      );
  }
  return parts;
}
export function modelWhere(alias: string, ctx: Context, b: Bind): string {
  if (!ctx.attribution) return "FALSE";
  return `${alias}.attribution_model=${b.add(ctx.attribution[0])} AND ${alias}.attribution_model_version=${b.add(ctx.attribution[1])}`;
}

// Dimension paths use EXISTS, so duplicated dimension rows cannot multiply facts.
// Name lookups in the reports are reduced to one row per ID separately.
export function where(
  table: string,
  alias: string,
  ctx: Context,
  b: Bind,
  dates = true,
): string {
  const f = ctx.filters,
    parts = dates ? dateWhere(table, alias, ctx, b) : [];
  if (table === "fact_paid_ad_engagement_daily") {
    parts.push(
      `EXISTS (SELECT 1 FROM ${t("fact_paid_ad_daily")} pe WHERE pe.ad_performance_id=${alias}.ad_performance_id AND ${where("fact_paid_ad_daily", "pe", ctx, b, false)})`,
    );
    return parts.join(" AND ");
  }
  const has = (column: string) => hasColumn(table, column);
  const field = (column: string) => c(table, alias, column);
  let campaign = has("campaign_id")
    ? field("campaign_id")
    : has("ooh_campaign_id")
      ? field("ooh_campaign_id")
      : has("email_parent_campaign_id")
        ? field("email_parent_campaign_id")
        : has("mailer_campaign_id")
          ? field("mailer_campaign_id")
          : null;
  const viaCampaign = (predicate: (a: string) => string): string => {
    if (campaign)
      return `EXISTS (SELECT 1 FROM ${t("dim_campaign")} dc WHERE dc.campaign_id=${campaign} AND ${predicate("dc")})`;
    if (has("platform_campaign_id"))
      return `EXISTS (SELECT 1 FROM ${t("dim_platform_campaign")} pc JOIN ${t("dim_campaign")} dc ON dc.campaign_id=pc.campaign_id WHERE pc.platform_campaign_id=${field("platform_campaign_id")} AND ${predicate("dc")})`;
    if (has("account_id"))
      return `EXISTS (SELECT 1 FROM ${t("fact_funded_account")} ac JOIN ${t("fact_application")} ap ON ap.application_id=ac.application_id JOIN ${t("fact_lead")} fl ON fl.lead_id=ap.lead_id JOIN ${t("dim_campaign")} dc ON dc.campaign_id=fl.campaign_id WHERE ac.account_id=${field("account_id")} AND ${predicate("dc")})`;
    if (has("customer_id"))
      return `EXISTS (SELECT 1 FROM ${t("fact_lead")} fl JOIN ${t("dim_campaign")} dc ON dc.campaign_id=fl.campaign_id WHERE fl.customer_id=${field("customer_id")} AND ${predicate("dc")})`;
    if (has("invoice_id"))
      return `EXISTS (SELECT 1 FROM ${t("fact_vendor_invoice_line")} il JOIN ${t("dim_campaign")} dc ON dc.campaign_id=il.campaign_id WHERE il.invoice_id=${field("invoice_id")} AND ${predicate("dc")})`;
    return "FALSE";
  };
  if (f.campaign) {
    // Campaign filter values are base campaign names with trailing variant
    // numbers stripped ("Always On Acquisition" covers 05, 24 and 28), so
    // match through dim_campaign instead of exact campaign_id equality.
    const cohort = `SELECT campaign_id FROM ${t("dim_campaign")} WHERE REGEXP_REPLACE(campaign_name,' +[0-9]+$','')=${b.add(f.campaign)}`;
    parts.push(
      campaign
        ? `${campaign} IN (${cohort})`
        : viaCampaign((a) => `${a}.campaign_id IN (${cohort})`),
    );
  }
  if (f.platform) {
    if (has("platform_id"))
      parts.push(`${field("platform_id")}=${b.add(f.platform)}`);
    else if (has("platform_campaign_id"))
      parts.push(
        `EXISTS (SELECT 1 FROM ${t("dim_platform_campaign")} pc WHERE pc.platform_campaign_id=${field("platform_campaign_id")} AND pc.platform_id=${b.add(f.platform)})`,
      );
    else
      parts.push(
        viaCampaign(
          (a) =>
            `EXISTS (SELECT 1 FROM ${t("dim_platform_campaign")} pc WHERE pc.campaign_id=${a}.campaign_id AND pc.platform_id=${b.add(f.platform!)})`,
        ),
      );
  }
  if (f.product) {
    if (has("product_id"))
      parts.push(`${field("product_id")}=${b.add(f.product)}`);
    else if (has("account_id"))
      parts.push(
        `EXISTS (SELECT 1 FROM ${t("fact_funded_account")} ac WHERE ac.account_id=${field("account_id")} AND ac.product_id=${b.add(f.product)})`,
      );
    else if (table === "dim_customer")
      parts.push(
        `EXISTS (SELECT 1 FROM ${t("fact_funded_account")} ac WHERE ac.customer_id=${field("customer_id")} AND ac.product_id=${b.add(f.product)})`,
      );
    else parts.push(viaCampaign((a) => `${a}.product_id=${b.add(f.product!)}`));
  }
  if (f.market) {
    const geo = has("geo_id")
      ? field("geo_id")
      : has("ooh_geo_id")
        ? field("ooh_geo_id")
        : null;
    const match = (value: string) =>
      `EXISTS (SELECT 1 FROM ${t("dim_geography")} dg WHERE dg.geo_id=${value} AND dg.market=${b.add(f.market!)})`;
    if (geo) parts.push(match(geo));
    else if (has("customer_id"))
      parts.push(
        `EXISTS (SELECT 1 FROM ${t("dim_customer")} cu WHERE cu.customer_id=${field("customer_id")} AND ${match("cu.geo_id")})`,
      );
    else if (has("account_id"))
      parts.push(
        `EXISTS (SELECT 1 FROM ${t("fact_funded_account")} ac JOIN ${t("dim_customer")} cu ON cu.customer_id=ac.customer_id WHERE ac.account_id=${field("account_id")} AND ${match("cu.geo_id")})`,
      );
    else parts.push(viaCampaign((a) => match(`${a}.geo_id`)));
  }
  if (f.segment) {
    if (has("customer_segment"))
      parts.push(`${field("customer_segment")}=${b.add(f.segment)}`);
    else if (has("customer_id"))
      parts.push(
        `EXISTS (SELECT 1 FROM ${t("dim_customer")} cu WHERE cu.customer_id=${field("customer_id")} AND cu.customer_segment=${b.add(f.segment)})`,
      );
    else if (has("account_id"))
      parts.push(
        `EXISTS (SELECT 1 FROM ${t("fact_funded_account")} ac JOIN ${t("dim_customer")} cu ON cu.customer_id=ac.customer_id WHERE ac.account_id=${field("account_id")} AND cu.customer_segment=${b.add(f.segment)})`,
      );
    else parts.push("FALSE");
  }
  return parts.join(" AND ") || "TRUE";
}
export function labelLookup(table: string, id: string, label: string) {
  c(table, "d", id);
  c(table, "d", label);
  return `(SELECT ${quoteIdentifier(id)}, CASE WHEN COUNT(DISTINCT ${quoteIdentifier(label)})=1 THEN MAX(${quoteIdentifier(label)}) ELSE NULL END AS label FROM ${t(table)} GROUP BY ${quoteIdentifier(id)})`;
}
export const month = (table: string, alias: string) =>
  `SUBSTRING(CAST(${c(table, alias, DATE_FIELDS[table])} AS STRING),1,7)`;
export const trueFlag = (expression: string) =>
  `LOWER(TRIM(${expression})) IN ('true','1','y','yes')`;
export async function execute(sql: string, b: Bind = new Bind()) {
  return queryTransport.execute({ sql, parameters: b.parameters });
}
export function number(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n))
    throw new WarehouseError(
      "A source value cannot be represented as a chart number. Inspect the source table.",
      "NUMERIC_VALUE",
    );
  if (
    (typeof value === "bigint" ||
      (typeof value === "string" && /^-?\d+$/.test(value))) &&
    !Number.isSafeInteger(n)
  )
    throw new WarehouseError(
      "A source integer exceeds safe chart precision. Use the source export for the exact value.",
      "NUMERIC_PRECISION",
    );
  return n;
}
export function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  return value;
}
