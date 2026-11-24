export interface Choice {
  id: string;
  label: string;
}
export interface Filters {
  from?: string;
  to?: string;
  campaign?: string;
  platform?: string;
  market?: string;
  product?: string;
  segment?: string;
  attribution?: string;
  budgetVersion?: string;
}
export interface Catalog {
  campaigns: Choice[];
  platforms: Choice[];
  markets: Choice[];
  products: Choice[];
  segments: Choice[];
  attribution: Choice[];
  budgetVersions: Choice[];
  dateRange: { min: string; max: string };
  tables: number;
  columns: number;
}
export interface Metric {
  label: string;
  value: number | null;
  format: "money" | "number" | "percent";
  note?: string;
}
export interface DataColumn {
  key: string;
  label: string;
  format?: "money" | "number" | "percent" | "date";
}
export interface DataPanel {
  title: string;
  columns: DataColumn[];
  rows: Record<string, unknown>[];
  source: string;
  note?: string;
}
export interface Chart {
  title: string;
  rows: Record<string, unknown>[];
  x: string;
  series: { key: string; label: string; color: string }[];
  format: "money" | "number" | "percent";
  note?: string;
}
export interface Report {
  id: string;
  title: string;
  metrics: Metric[];
  charts: Chart[];
  panels: DataPanel[];
  notes: string[];
  sources: string[];
  filteredAt: string;
}
export interface ReportDefinition {
  id: string;
  title: string;
  group: string;
  description: string;
  filters: (keyof Filters)[];
  note: string;
}

const campaignFilters = [
  "from",
  "to",
  "campaign",
  "platform",
  "market",
  "product",
] as const;
export const REPORTS: ReportDefinition[] = [
  {
    id: "overview",
    title: "Control Tower",
    group: "Executive",
    description: "Paid delivery, acquisition and attributed outcomes",
    filters: [...campaignFilters, "attribution"],
    note: "Paid delivery uses ad-level facts. Attributed outcomes use one selected model/version; shared campaign totals are not allocated to platforms.",
  },
  {
    id: "campaigns",
    title: "Campaign Performance",
    group: "Marketing",
    description: "Campaign delivery, budgets and outcomes",
    filters: [...campaignFilters, "attribution", "budgetVersion"],
    note: "Product and geography follow campaign ownership where facts have no finer grain. Budget comparisons use one budget version.",
  },
  {
    id: "paid-media",
    title: "Paid Media",
    group: "Marketing",
    description: "Ad delivery, engagement and independent rollups",
    filters: [...campaignFilters],
    note: "Ad-level delivery is the primary total. Campaign daily/monthly rollups are compared separately and never added to it.",
  },
  {
    id: "organic",
    title: "Organic Social",
    group: "Marketing",
    description: "Post delivery and platform-month rollups",
    filters: [...campaignFilters],
    note: "Post daily facts provide delivery totals. Monthly platform facts are a separate rollup, not additional delivery.",
  },
  {
    id: "reach",
    title: "Reach & Frequency",
    group: "Marketing",
    description: "Reported audience windows, scopes and deduplication",
    filters: [...campaignFilters],
    note: "Reach is reported per window and scope. Overlapping windows and ad audiences are not summed into a deduplicated total.",
  },
  {
    id: "funnel",
    title: "Acquisition Funnel",
    group: "Acquisition",
    description: "Submissions, leads, applications and funded accounts",
    filters: [...campaignFilters, "segment", "attribution"],
    note: "Stages are counted from their own facts and dates, not summed with snapshots. Weighted funded credits are distinct from unique accounts.",
  },
  {
    id: "customers",
    title: "Customers & Products",
    group: "Acquisition",
    description: "Customer cohorts, funding and product mix",
    filters: [...campaignFilters, "segment", "attribution"],
    note: "Customer creation and account funding use their own dates. Campaign/platform selections are linked customer or account cohorts, not acquisition attribution.",
  },
  {
    id: "contribution",
    title: "Revenue & Attribution",
    group: "Finance",
    description: "Relationship value and selected-model contribution",
    filters: [...campaignFilters, "segment", "attribution"],
    note: "Raw relationship value and attributed contribution are separate measures. Do not add them. Allocation totals use one model and version.",
  },
  {
    id: "finance",
    title: "Invoice & GL",
    group: "Finance",
    description: "Whole-invoice reconciliation without join fanout",
    filters: [...campaignFilters],
    note: "Billing month selects invoices. Campaign/platform/product/market select invoice cohorts; comparison retains all their invoice lines and GL postings.",
  },
  {
    id: "targets",
    title: "Budgets & Targets",
    group: "Finance",
    description: "Versioned budgets and source sales targets",
    filters: [...campaignFilters, "budgetVersion"],
    note: "Targets are source campaign/product/geography totals. Budget versions are alternatives and are never summed together.",
  },
  {
    id: "omnichannel",
    title: "Mail, OOH & TV",
    group: "Engagement",
    description: "Mail delivery, offline responses and broadcast activity",
    filters: ["from", "to", "campaign", "market", "product", "segment"],
    note: "Mail responses are independent events. OOH impressions and TV estimated audiences are not deduplicated people or paid-digital impressions.",
  },
  {
    id: "digital",
    title: "Web & Email",
    group: "Engagement",
    description: "Session engagement and send cohorts",
    filters: [...campaignFilters, "segment"],
    note: "Web daily and raw session facts are separate grains. Email outcomes retain send-cohort meaning; parent-campaign links are used for campaign filters.",
  },
  {
    id: "experiments",
    title: "Experiments",
    group: "Engagement",
    description: "Observed assignment-cohort outcomes",
    filters: ["from", "to"],
    note: "The supplied schema has no control/treatment definitions or hypotheses. Observed cohort rates are shown; uplift and statistical significance are not inferred.",
  },
  {
    id: "schema",
    title: "Schema & Source Data",
    group: "Data Platform",
    description: "All 47 tables and 735 declared columns",
    filters: [],
    note: "The explorer preserves the supplied names and types, including string-valued flags. Sample rows are read-only and unfiltered.",
  },
  {
    id: "governance",
    title: "Data Quality & Lineage",
    group: "Data Platform",
    description: "Source counts, load metadata and join ambiguity",
    filters: [],
    note: "Checks describe observable source conditions. A ready connection does not certify business data quality or pipeline freshness.",
  },
];
