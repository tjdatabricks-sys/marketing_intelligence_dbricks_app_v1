import {
  REPORTS,
  type Report,
  type Metric,
  type DataColumn,
  type Filters,
} from "../contracts";
import {
  Bind,
  c,
  t,
  where,
  modelWhere,
  month,
  trueFlag,
  execute,
  number,
  jsonValue,
  labelLookup,
  type Context,
} from "./sql";
import { getCatalog, resolveContext } from "./catalog";
import { WarehouseError } from "./warehouse";
import { TABLES } from "./schema";

type Measure = {
  key: string;
  label: string;
  sql: string;
  format: Metric["format"];
};
type Dataset = {
  table: string;
  title: string;
  group?: string;
  measures: Measure[];
  model?: boolean;
  budget?: boolean;
  cards?: boolean;
  omit?: (keyof Filters)[];
  note?: string;
};
const sum = (
  column: string,
  label: string,
  format: Metric["format"] = "number",
): Measure => ({ key: column, label, sql: `SUM(f.${column})`, format });
const count = (column: string, label: string): Measure => ({
  key: column,
  label,
  sql: `COUNT(DISTINCT f.${column})`,
  format: "number",
});
const ratio = (
  key: string,
  label: string,
  numerator: string,
  denominator: string,
): Measure => ({
  key,
  label,
  sql: `SUM(f.${numerator}) * 1.0 / NULLIF(SUM(f.${denominator}),0)`,
  format: "percent",
});
const paid = (): Dataset => ({
  table: "fact_paid_ad_daily",
  title: "Paid delivery",
  group: "campaign_id",
  measures: [
    sum("spend_usd", "Paid spend", "money"),
    sum("impressions", "Paid impressions"),
    sum("clicks", "Paid clicks"),
    ratio("ctr", "Click-through rate", "clicks", "impressions"),
  ],
});
const leads = (): Dataset => ({
  table: "fact_lead",
  title: "New leads",
  group: "campaign_id",
  measures: [count("lead_id", "New leads")],
});
const funded = (): Dataset => ({
  table: "fact_funded_account",
  title: "Funded accounts",
  group: "product_id",
  measures: [
    {
      key: "funded_accounts",
      label: "Funded accounts",
      sql: `COUNT(DISTINCT CASE WHEN ${trueFlag("f.funded_flag")} THEN f.account_id END)`,
      format: "number",
    },
  ],
  note: "Funded flag accepts trimmed true/1/y/yes. Unrecognized source flag values remain visible in the explorer.",
});
const attributed = (): Dataset => ({
  table: "fact_attributed_contribution_monthly",
  title: "Attributed contribution",
  group: "campaign_id",
  model: true,
  measures: [
    sum("attributed_contribution_usd", "Attributed contribution", "money"),
    sum("attributed_interest_usd", "Attributed interest", "money"),
    sum("attributed_fee_usd", "Attributed fees", "money"),
  ],
});
const allocations = (): Dataset => ({
  table: "fact_funded_attribution_allocation",
  title: "Funded attribution",
  group: "campaign_id",
  model: true,
  measures: [
    sum("attribution_weight", "Funded credits"),
    count("account_id", "Accounts with attribution"),
  ],
  note: "Credits are source weights, not a distinct account count. The allocation date controls this panel.",
});
const budget = (): Dataset => ({
  table: "fact_campaign_budget_monthly",
  title: "Campaign budget",
  group: "campaign_id",
  budget: true,
  measures: [sum("allocated_budget_usd", "Allocated budget", "money")],
});
const target = (): Dataset => ({
  table: "fact_sales_target_monthly",
  title: "Sales targets",
  group: "campaign_id",
  measures: [
    sum("lead_target", "Lead target"),
    sum("funded_account_target", "Funded account target"),
    sum("revenue_target_usd", "Revenue target", "money"),
  ],
});
const relationships = (): Dataset => ({
  table: "fact_relationship_value_monthly",
  title: "Relationship value",
  group: "value_type",
  measures: [
    sum("net_contribution_usd", "Net relationship contribution", "money"),
    sum("interest_income_usd", "Interest income", "money"),
    sum("fee_income_usd", "Fee income", "money"),
    sum("servicing_cost_usd", "Servicing cost", "money"),
  ],
  note: "Value types are shown separately. Confirm whether value types represent additive ledger components before combining them.",
});

export function datasets(id: string): Dataset[] {
  switch (id) {
    case "overview":
      return [paid(), leads(), allocations(), attributed()];
    case "campaigns":
      return [
        paid(),
        leads(),
        budget(),
        allocations(),
        attributed(),
        {
          table: "fact_campaign_monthly_scorecard",
          title: "Source monthly scorecard (independent rollup)",
          group: "campaign_id",
          cards: false,
          measures: [
            sum("paid_spend_usd", "Paid spend", "money"),
            sum("new_leads", "New leads"),
            sum("attributed_funded_account_credits", "Funded credits"),
            sum(
              "attributed_contribution_earned_usd",
              "Earned contribution",
              "money",
            ),
          ],
          note: "Shown by attribution model version below; this rollup is not added to the primary totals.",
        },
      ];
    case "paid-media":
      return [
        paid(),
        {
          table: "fact_paid_ad_engagement_daily",
          title: "Paid engagement",
          group: "format_id",
          measures: [
            sum("total_engagements", "Total engagements"),
            sum("video_starts", "Video starts"),
            sum("video_completions", "Video completions"),
            ratio(
              "completion_rate",
              "Video completion rate",
              "video_completions",
              "video_starts",
            ),
          ],
        },
        ...["fact_paid_campaign_daily", "fact_paid_campaign_monthly"].map(
          (table) => ({
            table,
            title:
              table === "fact_paid_campaign_daily"
                ? "Campaign daily rollup"
                : "Campaign monthly rollup",
            group: "platform_id",
            cards: false,
            measures: [
              sum("spend_usd", "Spend", "money"),
              sum("impressions", "Impressions"),
              sum("clicks", "Clicks"),
              sum("platform_conversions", "Platform conversions"),
            ],
            note: "Independent source rollup. Platform conversions are platform-reported events, not funded accounts.",
          }),
        ),
      ];
    case "organic":
      return [
        {
          table: "fact_organic_post_daily",
          title: "Organic post delivery",
          group: "platform_id",
          measures: [
            sum("impressions", "Organic impressions"),
            sum("engagements", "Organic engagements"),
            sum("link_clicks", "Organic link clicks"),
            ratio(
              "engagement_rate",
              "Engagement rate",
              "engagements",
              "impressions",
            ),
          ],
          note: "Post-level unique reach estimates are not summed across posts.",
        },
        {
          table: "fact_organic_platform_monthly",
          title: "Organic monthly rollup",
          group: "platform_id",
          cards: false,
          measures: [
            sum("impressions", "Impressions"),
            sum("engagements", "Engagements"),
            sum("video_views", "Video views"),
          ],
        },
      ];
    case "reach":
      return [];
    case "funnel":
      return [
        {
          table: "fact_marketing_submission",
          title: "Marketing submissions",
          group: "form_type",
          measures: [count("submission_id", "Submissions")],
        },
        leads(),
        {
          table: "fact_application",
          title: "Applications",
          group: "application_status",
          measures: [count("application_id", "Applications")],
        },
        funded(),
        allocations(),
        {
          table: "fact_lead_funnel_snapshot",
          title: "Lead cohort snapshot",
          group: "campaign_id",
          cards: false,
          measures: [
            count("lead_id", "Cohort leads"),
            sum("application_count", "Applications"),
            sum("approved_application_count", "Approved applications"),
            sum("funded_account_count", "Funded accounts"),
          ],
          note: "Snapshot is a lead-created-date cohort. It is not added to event-date stage totals.",
        },
      ];
    case "customers":
      return [
        {
          table: "dim_customer",
          title: "Customer creation cohort",
          group: "customer_segment",
          measures: [count("customer_id", "Customers")],
        },
        funded(),
        {
          table: "fact_funding_event",
          title: "Funding events",
          group: "funding_type",
          measures: [
            count("funding_id", "Funding events"),
            sum("funding_amount_usd", "Funding amount", "money"),
          ],
        },
        allocations(),
      ];
    case "contribution":
      return [relationships(), attributed(), allocations()];
    case "targets":
      return [budget(), target(), paid(), leads(), funded()];
    case "omnichannel":
      return [
        {
          table: "fact_direct_mail",
          title: "Direct mail",
          group: "delivery_status",
          measures: [
            count("mailer_id", "Mail pieces"),
            sum("unit_cost_usd", "Mail cost", "money"),
          ],
        },
        {
          table: "fact_offline_response",
          title: "Offline responses",
          group: "response_type",
          measures: [count("offline_response_id", "Responses")],
        },
        {
          table: "fact_ooh_delivery_monthly",
          title: "Out of home",
          group: "measurement_type",
          omit: ["segment"],
          measures: [
            sum("play_count", "OOH plays"),
            sum("estimated_impressions", "OOH estimated impressions"),
          ],
          note: "Segment does not apply to OOH delivery; that filter is omitted for this panel.",
        },
        {
          table: "fact_tv_spot",
          title: "Television",
          group: "station",
          omit: ["segment"],
          measures: [
            count("tv_spot_id", "TV spots"),
            sum("spot_cost_usd", "TV cost", "money"),
          ],
          note: "Segment does not apply to TV delivery. Audience estimates remain per spot in source data.",
        },
      ];
    case "digital":
      return [
        {
          table: "fact_web_session",
          title: "Web sessions",
          group: "source_medium",
          measures: [
            count("session_id", "Web sessions"),
            {
              key: "engaged",
              label: "Engaged sessions",
              sql: `COUNT(DISTINCT CASE WHEN ${trueFlag("f.engaged_flag")} THEN f.session_id END)`,
              format: "number",
            },
          ],
        },
        {
          table: "fact_web_session_daily",
          title: "Web daily rollup",
          group: "device_key",
          omit: ["segment"],
          cards: false,
          measures: [
            sum("sessions", "Sessions"),
            sum("engaged_sessions", "Engaged sessions"),
            ratio(
              "engagement_rate",
              "Engagement rate",
              "engaged_sessions",
              "sessions",
            ),
          ],
          note: "The daily rollup has no customer key. Segment does not apply to this panel.",
        },
        {
          table: "fact_email_send_cohort_daily",
          title: "Email send cohorts",
          group: "email_campaign_id",
          omit: ["segment"],
          measures: [
            sum("messages_sent", "Email messages sent"),
            sum("is_delivered", "Delivered"),
            sum("opened", "Opened"),
            sum("clicked", "Clicked"),
            sum("bounced", "Bounced"),
            sum("unsubscribed", "Unsubscribed"),
            ratio("click_rate", "Send click rate", "clicked", "messages_sent"),
          ],
          note: "Segment does not apply to email send cohorts. Opened/clicked are source send-cohort counts, not cross-campaign deduplicated people.",
        },
      ];
    case "experiments":
      return [
        {
          table: "fact_experiment_variant_assignment_cohort",
          title: "Experiment variant cohorts",
          group: "variant_id",
          measures: [
            sum("assigned_subjects", "Assigned subjects"),
            sum("subjects_with_outcome", "Subjects with outcome"),
            sum("outcome_events", "Outcome events"),
            ratio(
              "outcome_rate",
              "Observed outcome rate",
              "subjects_with_outcome",
              "assigned_subjects",
            ),
          ],
          note: "Grouped by experiment and variant. Assignments across experiments may overlap; subjects are not globally deduplicated.",
        },
      ];
    default:
      return [];
  }
}

const labels: Record<string, [string, string, string]> = {
  campaign_id: ["dim_campaign", "campaign_id", "campaign_name"],
  platform_id: ["dim_platform", "platform_id", "platform_name"],
  product_id: ["dim_product", "product_id", "product_name"],
  format_id: ["dim_ad_format", "format_id", "format_name"],
  device_key: ["dim_device", "device_key", "device_name"],
};
export function datasetQuery(d: Dataset, ctx: Context, grouped: boolean) {
  const b = new Bind(),
    filters = { ...ctx.filters };
  for (const key of d.omit ?? []) delete filters[key];
  const scoped = { ...ctx, filters };
  const conditions = [where(d.table, "f", scoped, b)];
  if (d.model) conditions.push(modelWhere("f", ctx, b));
  if (d.budget)
    conditions.push(
      ctx.budgetVersion
        ? `f.budget_version=${b.add(ctx.budgetVersion)}`
        : "FALSE",
    );
  const groups: string[] = [],
    select: string[] = [];
  let join = "";
  if (grouped && d.group) {
    const field = c(d.table, "f", d.group);
    groups.push(field);
    select.push(`${field} AS id`);
    if (labels[d.group]) {
      const [table, id, label] = labels[d.group];
      join = ` LEFT JOIN ${labelLookup(table, id, label)} names ON names.${id}=${field}`;
      select.push(`COALESCE(MAX(names.label),${field}) AS label`);
    } else select.push(`${field} AS label`);
    if (d.table === "fact_experiment_variant_assignment_cohort") {
      groups.push("f.experiment_id");
      select.push("f.experiment_id AS experiment_id");
    }
    if (d.table === "fact_campaign_monthly_scorecard") {
      groups.push("f.attribution_model_version");
      select.push("f.attribution_model_version AS attribution_model_version");
    }
    if (d.table === "fact_relationship_value_monthly") {
      /* Keep value types independent in the table. */
    }
  }
  select.push(...d.measures.map((m) => `${m.sql} AS ${m.key}`));
  return {
    sql: `SELECT ${select.join(",")} FROM ${t(d.table)} f${join} WHERE ${conditions.join(" AND ")}${groups.length ? ` GROUP BY ${groups.join(",")} ORDER BY ${groups.join(",")} LIMIT 500` : ""}`,
    parameters: b.parameters,
  };
}

async function datasetReport(d: Dataset, ctx: Context, report: Report) {
  const unavailable =
    (d.model && !ctx.attribution) || (d.budget && !ctx.budgetVersion);
  // Relationship value types may be alternatives, so do not publish a combined card.
  const cards =
    d.cards !== false &&
    d.table !== "fact_relationship_value_monthly" &&
    d.table !== "fact_experiment_variant_assignment_cohort";
  const [totals, rows] = await Promise.all([
    cards ? executeStatement(datasetQuery(d, ctx, false)) : Promise.resolve([]),
    executeStatement(datasetQuery(d, ctx, true)),
  ]);
  if (cards)
    for (const m of d.measures)
      report.metrics.push({
        label: m.label,
        value: unavailable
          ? null
          : totals[0]?.[m.key] == null && m.sql.includes("NULLIF")
            ? null
            : number(totals[0]?.[m.key]),
        format: m.format,
        note: unavailable ? "Select one version in Filters." : d.note,
      });
  const columns: DataColumn[] = [
    { key: "id", label: d.group ?? "ID" },
    { key: "label", label: "Name" },
    ...(d.table === "fact_experiment_variant_assignment_cohort"
      ? [{ key: "experiment_id", label: "Experiment" }]
      : []),
    ...(d.table === "fact_campaign_monthly_scorecard"
      ? [{ key: "attribution_model_version", label: "Attribution version" }]
      : []),
    ...d.measures.map((m) => ({
      key: m.key,
      label: m.label,
      format: m.format,
    })),
  ];
  report.panels.push({
    title: d.title,
    columns,
    rows: jsonValue(rows) as Record<string, unknown>[],
    source: d.table,
    note: [
      d.note,
      "Grouped results are limited to 500 groups. KPI totals include all matching rows.",
    ]
      .filter(Boolean)
      .join(" "),
  });
  if (
    d.measures.length &&
    rows.length &&
    d.table !== "fact_campaign_monthly_scorecard"
  ) {
    const first = d.measures[0];
    report.charts.push({
      title: d.title,
      x: "label",
      rows: rows.slice(0, 20).map((row) => ({
        label:
          d.table === "fact_experiment_variant_assignment_cohort"
            ? `${row.experiment_id} / ${row.label}`
            : String(row.label ?? row.id ?? "Unknown"),
        [first.key]: row[first.key] == null ? null : number(row[first.key]),
      })),
      series: [{ key: first.key, label: first.label, color: "#0d9488" }],
      format: first.format,
      note: "First 20 source groups; the table contains up to 500.",
    });
  }
  report.sources.push(d.table);
}
const executeStatement = (statement: ReturnType<typeof datasetQuery>) =>
  execute(
    statement.sql,
    Object.assign(new Bind(), { parameters: statement.parameters }),
  );

async function reach(ctx: Context, report: Report) {
  const b = new Bind(),
    table = "fact_paid_reach_window";
  const rows = await execute(
    `SELECT f.reach_id,f.ad_id,f.platform_campaign_id,CAST(f.window_start AS STRING) AS window_start,CAST(f.window_end AS STRING) AS window_end,CAST(f.window_impressions AS STRING) AS window_impressions,CAST(f.unique_reach AS STRING) AS unique_reach,CAST(f.avg_frequency AS STRING) AS avg_frequency,f.reach_scope,f.deduplication_method FROM ${t(table)} f WHERE ${where(table, "f", ctx, b)} ORDER BY f.window_end DESC,f.reach_id LIMIT 500`,
    b,
  );
  const totalBind = new Bind();
  const stats = await execute(
    `SELECT COUNT(*) AS windows,MAX(f.unique_reach) AS max_window_reach FROM ${t(table)} f WHERE ${where(table, "f", ctx, totalBind)}`,
    totalBind,
  );
  report.metrics.push(
    {
      label: "Reported reach windows",
      value: number(stats[0]?.windows),
      format: "number",
    },
    {
      label: "Largest single-window reach",
      value:
        stats[0]?.max_window_reach == null
          ? null
          : number(stats[0].max_window_reach),
      format: "number",
      note: "Maximum source window; not deduplicated total reach.",
    },
  );
  report.panels.push({
    title: "Reach windows",
    rows,
    columns: [
      "reach_id",
      "ad_id",
      "platform_campaign_id",
      "window_start",
      "window_end",
      "window_impressions",
      "unique_reach",
      "avg_frequency",
      "reach_scope",
      "deduplication_method",
    ].map((key) => ({ key, label: key })),
    source: table,
    note: "Up to 500 windows overlapping the date range. Metrics retain whole-window values; partial windows are not prorated.",
  });
  report.sources.push(table);
}

export function financeQuery(ctx: Context) {
  const b = new Bind();
  return {
    sql: `WITH eligible AS (SELECT DISTINCT f.invoice_id FROM ${t("fact_vendor_invoice_line")} f WHERE ${where("fact_vendor_invoice_line", "f", ctx, b)}), lines AS (SELECT f.invoice_id,COUNT(*) AS line_count,SUM(f.media_spend_usd) AS media_spend_usd,SUM(f.agency_fee_usd) AS agency_fee_usd,SUM(f.line_total_usd) AS invoice_total_usd FROM ${t("fact_vendor_invoice_line")} f WHERE EXISTS (SELECT 1 FROM eligible e WHERE e.invoice_id=f.invoice_id) GROUP BY f.invoice_id), ledger AS (SELECT f.invoice_id,COUNT(*) AS posting_count,SUM(f.debit_amount_usd) AS debit_usd,SUM(f.credit_amount_usd) AS credit_usd FROM ${t("fact_finance_gl_posting")} f WHERE EXISTS (SELECT 1 FROM eligible e WHERE e.invoice_id=f.invoice_id) GROUP BY f.invoice_id) SELECT l.*,COALESCE(g.posting_count,0) AS posting_count,COALESCE(g.debit_usd,0) AS debit_usd,COALESCE(g.credit_usd,0) AS credit_usd,l.invoice_total_usd-(COALESCE(g.debit_usd,0)-COALESCE(g.credit_usd,0)) AS reconciliation_delta_usd FROM lines l LEFT JOIN ledger g ON g.invoice_id=l.invoice_id`,
    parameters: b.parameters,
  };
}
async function finance(ctx: Context, report: Report) {
  const q = financeQuery(ctx),
    b = Object.assign(new Bind(), { parameters: q.parameters });
  const [rows, totals] = await Promise.all([
    execute(`${q.sql} ORDER BY invoice_id LIMIT 500`, b),
    execute(
      `SELECT COUNT(*) AS invoices,SUM(invoice_total_usd) AS invoice_total_usd,SUM(debit_usd-credit_usd) AS gl_net_usd,SUM(reconciliation_delta_usd) AS reconciliation_delta_usd FROM (${q.sql}) reconciled`,
      b,
    ),
  ]);
  for (const [key, label, format] of [
    ["invoices", "Invoices", "number"],
    ["invoice_total_usd", "Invoice totals", "money"],
    ["gl_net_usd", "GL net debits", "money"],
    ["reconciliation_delta_usd", "Invoice minus GL", "money"],
  ] as const)
    report.metrics.push({ label, value: number(totals[0]?.[key]), format });
  report.panels.push({
    title: "Invoice reconciliation",
    rows: jsonValue(rows) as Record<string, unknown>[],
    columns: [
      "invoice_id",
      "line_count",
      "posting_count",
      "media_spend_usd",
      "agency_fee_usd",
      "invoice_total_usd",
      "debit_usd",
      "credit_usd",
      "reconciliation_delta_usd",
    ].map((key) => ({
      key,
      label: key,
      format: key.endsWith("_usd") ? "money" : undefined,
    })),
    source: "fact_vendor_invoice_line + fact_finance_gl_posting",
    note: "Up to 500 whole invoices. GL is net debits, without account-code classification supplied by this schema. A delta is a comparison, not an assertion of an accounting error. GL-only invoices are excluded from this invoice cohort.",
  });
  report.sources.push("fact_vendor_invoice_line", "fact_finance_gl_posting");
}

async function governance(report: Report) {
  const rows = await Promise.all(
    TABLES.map(async (table) => {
      const result = await execute(
        `SELECT COUNT(*) AS row_count,CAST(MAX(_gold_loaded_at) AS STRING) AS latest_load,COUNT(DISTINCT _gold_release) AS releases FROM ${t(table)}`,
      );
      return { table, ...(jsonValue(result[0]) as object) };
    }),
  );
  report.metrics.push({
    label: "Declared tables",
    value: TABLES.length,
    format: "number",
  });
  report.panels.push({
    title: "Source inventory",
    rows,
    columns: [
      { key: "table", label: "Table" },
      { key: "row_count", label: "Rows" },
      { key: "latest_load", label: "Latest gold load" },
      { key: "releases", label: "Distinct releases" },
    ],
    source: "All supplied gold tables",
    note: "No freshness SLA was supplied; load timestamps are displayed without invented pass/fail thresholds.",
  });
  const duplicates = await execute(
    `SELECT platform_id,COUNT(*) AS dimension_rows,COUNT(DISTINCT platform_name) AS distinct_names,COUNT(DISTINCT social_account_id) AS social_accounts FROM ${t("dim_platform")} GROUP BY platform_id HAVING COUNT(*)>1 ORDER BY platform_id LIMIT 500`,
  );
  report.panels.push({
    title: "Platform dimension grain",
    rows: duplicates,
    columns: [
      "platform_id",
      "dimension_rows",
      "distinct_names",
      "social_accounts",
    ].map((key) => ({ key, label: key })),
    source: "dim_platform",
    note: "Multiple social accounts may legitimately share a platform ID. Reports use EXISTS filters and one label per ID to avoid multiplying facts.",
  });
  report.sources.push(...TABLES);
}

export async function loadReport(
  id: string,
  filters: Filters,
): Promise<Report> {
  const definition = REPORTS.find((item) => item.id === id);
  if (!definition || id === "schema")
    throw new WarehouseError("Unknown report.", "NOT_FOUND", 404);
  const catalog = await getCatalog(),
    ctx = resolveContext(filters, catalog);
  const report: Report = {
    id,
    title: definition.title,
    metrics: [],
    charts: [],
    panels: [],
    notes: [
      definition.note,
      ...ctx.notes.filter((note) =>
        note.includes("budget")
          ? definition.filters.includes("budgetVersion")
          : definition.filters.includes("attribution"),
      ),
    ],
    sources: [],
    filteredAt: new Date().toISOString(),
  };
  // Preserve panel order despite concurrent warehouse requests.
  const parts = await Promise.all(
    datasets(id).map(async (d) => {
      const part: Report = {
        ...report,
        metrics: [],
        charts: [],
        panels: [],
        sources: [],
      };
      await datasetReport(d, ctx, part);
      return part;
    }),
  );
  for (const part of parts) {
    report.metrics.push(...part.metrics);
    report.charts.push(...part.charts);
    report.panels.push(...part.panels);
    report.sources.push(...part.sources);
  }
  if (id === "reach") await reach(ctx, report);
  if (id === "finance") await finance(ctx, report);
  if (id === "governance") await governance(report);
  if (definition.filters.includes("platform") && filters.platform)
    report.notes.push(
      "For sources without a platform key, the platform filter selects campaigns associated with that platform. Shared campaign outcomes and budgets are not allocated between platforms.",
    );
  report.notes.push(
    "Monthly sources include complete calendar months touched by the selected dates. Event sources use inclusive event dates. Relationships between source IDs are inferred from the supplied names; the CSV provides no foreign-key constraints.",
  );
  report.sources = [...new Set(report.sources)];
  return report;
}
