# Source model and calculation rules

`data/gold-schema.csv` is the original attachment, retained verbatim. `data/gold-schema.json` is the normalized contract. `src/lib/server/gold-rows.ts` is generated from that contract. The explorer exposes all **47 tables / 735 columns** without renaming fields or replacing STRING flags with BOOLEAN. All fields are nullable in the generated transport interfaces because nullability was not supplied.

## Report sources

| Report                 | Primary sources and grain                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control Tower          | Paid ad daily delivery; lead-created events; selected-model funded allocation; selected-model monthly contribution                                      |
| Campaign Performance   | The above, versioned monthly budgets, plus an independent campaign-month scorecard broken out by attribution version                                    |
| Paid Media             | Ad daily primary totals, ad engagement daily, independent campaign daily and monthly rollups                                                            |
| Organic Social         | Post daily primary totals and independent organic platform-month rollup                                                                                 |
| Reach & Frequency      | Per reach ID / ad / reporting window, scope and deduplication method; window count and largest source window                                            |
| Acquisition Funnel     | Submissions, new leads, applications by submission date, funded accounts by funding date, attribution by attributed date; separate lead-cohort snapshot |
| Customers & Products   | Customer-created cohort, funded account product mix, funding event amounts and selected-model allocation                                                |
| Revenue & Attribution  | Raw relationship value grouped by value type, selected-model attributed contribution, selected-model funded credits                                     |
| Invoice & GL           | Eligible invoice cohort, all lines per invoice and all postings per invoice aggregated before the join                                                  |
| Budgets & Targets      | Selected budget version; source sales targets; paid delivery, new leads, funded accounts shown separately                                               |
| Mail, OOH & TV         | Mail pieces/cost, response events, OOH monthly plays/impressions, TV spot count/cost                                                                    |
| Web & Email            | Distinct raw sessions and engaged sessions; independent daily rollup; email parent-campaign send cohorts                                                |
| Experiments            | Experiment + variant assignment cohorts and observed outcome rate                                                                                       |
| Schema & Source Data   | Every supplied table/column/type; read-only paginated rows and page CSV                                                                                 |
| Data Quality & Lineage | Every table's row count, latest gold load, release count; platform dimension grain inspection                                                           |

The explorer is also the source for ad-group, audience, creative, content, placement, vendor, social-account and date dimension details that do not have standalone aggregate cards. All tables retain `_gold_loaded_at` and `_gold_release`.

## Joins and filters

The attachment contains names/types only. The app infers these identifier relationships; it cannot establish referential integrity from metadata alone. Filtering uses `EXISTS` so repeated dimension rows do not multiply facts. Dimension display labels are grouped to one row per ID; conflicting names fall back to the ID.

| Selection   | Source path                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campaign    | Direct `campaign_id`, `ooh_campaign_id`, `email_parent_campaign_id` or mailer campaign where present; otherwise platform campaign, account → application → lead, customer → lead, or invoice → line |
| Platform    | Direct `platform_id`; otherwise `platform_campaign_id` → platform campaign; otherwise associated campaign → platform campaign. The latter is a shared campaign cohort, not platform attribution.    |
| Product     | Direct `product_id`; otherwise account → funded account; customer dimension → funded account product; otherwise campaign ownership                                                                  |
| Market      | Direct geo/OOH geo → geography market; otherwise customer geography, account → customer geography, or campaign geography                                                                            |
| Segment     | Direct customer segment; otherwise customer → dimension, or account → funded account → customer                                                                                                     |
| Attribution | Exact pair of `attribution_model` and `attribution_model_version`, never version alone                                                                                                              |
| Budget      | Exact `budget_version`                                                                                                                                                                              |

Paid engagement inherits filtered paid-ad rows through `ad_performance_id`, including delivery geography. Direct mail and offline responses support customer segment; OOH and TV omit segment and say so in their panel notes. Raw web sessions support segment; daily web rollups and email omit it and explain their coarser grain. Experiments accept only dates because they contain no campaign/customer keys. Schema/governance do not inherit report filters.

Date ranges are inclusive. Daily/event sources use their corresponding report/event date. Monthly sources include complete source months touched by the range, using month-start boundaries. Reach selects windows overlapping the range and retains whole-window measurements. Each report explicitly explains its grain. Different stage dates and cohort membership mean these panels are not a single synchronized conversion funnel.

## Calculations and limitations

- Paid spend/impressions/clicks: sums of `fact_paid_ad_daily` measures; CTR = sum(clicks) / sum(impressions), null for zero denominator. Monthly, campaign daily and source scorecard facts remain separate rollups.
- Funded account count: distinct account IDs whose STRING flag matches true/1/y/yes. Allocation credits: sum of source weights for the selected model/version; account count is distinct account ID. No credits from alternative versions are added.
- Contribution: attributed components use selected-model facts. Raw relationship value stays grouped by `value_type`, without a combined KPI that could mix actual and projected alternatives. No raw + attributed combined value is calculated.
- Budgets: sum the selected version. Targets are source targets, not inferred from conversion assumptions. Versions are never summed. No blended CAC or ROI cards are generated.
- Finance: dimension and billing-month filters identify eligible invoices. All lines and all GL postings for those invoice IDs are aggregated independently before joining. Invoice total minus net GL debits is a comparison; no supplied account-code mapping classifies accounts as spend or payable. GL-only invoices are not part of this invoice cohort. No row-level reconciliation or fraud inference is made.
- Reach: no sum across windows, ads or scopes. Largest single-window reach is the maximum reported source value. Source `avg_frequency` and deduplication method remain per-window fields.
- Experiments: sum assignment/outcome counts within experiment + variant; observed rate = subjects_with_outcome / assigned_subjects. Cross-experiment subjects may overlap, so there is no global subjects card or inferred significance.
- Session engagement: distinct session IDs whose STRING flag matches true/1/y/yes. The daily rollup is not added to raw sessions. Email opened/clicked/etc. are send-cohort source counts. The displayed send click rate uses messages sent as denominator.
- KPI totals aggregate all matching rows. Grouped report tables are capped at 500 groups; charts show the first 20 ordered groups, with limits stated in the UI. The source browser allows paginated inspection of the remaining rows.

## Table inventory

The following inventory is generated from the supplied contract. See the in-app schema browser or `data/gold-schema.csv` for every associated column and type.

| Table                                       | Columns |
| ------------------------------------------- | ------: |
| `dim_ad`                                    |      26 |
| `dim_ad_format`                             |      24 |
| `dim_ad_group`                              |      21 |
| `dim_audience`                              |      19 |
| `dim_campaign`                              |      23 |
| `dim_channel`                               |      18 |
| `dim_content`                               |      14 |
| `dim_creative`                              |      22 |
| `dim_customer`                              |      20 |
| `dim_date`                                  |      12 |
| `dim_device`                                |       6 |
| `dim_geography`                             |      20 |
| `dim_placement`                             |      18 |
| `dim_platform`                              |      26 |
| `dim_platform_campaign`                     |      24 |
| `dim_product`                               |      18 |
| `dim_social_account`                        |       7 |
| `dim_vendor`                                |      18 |
| `fact_application`                          |      10 |
| `fact_attributed_contribution_monthly`      |      18 |
| `fact_campaign_budget_monthly`              |       8 |
| `fact_campaign_monthly_scorecard`           |      15 |
| `fact_direct_mail`                          |       9 |
| `fact_email_send_cohort_daily`              |      13 |
| `fact_experiment_variant_assignment_cohort` |      10 |
| `fact_finance_gl_posting`                   |      11 |
| `fact_funded_account`                       |      11 |
| `fact_funded_attribution_allocation`        |      15 |
| `fact_funding_event`                        |       8 |
| `fact_lead`                                 |      14 |
| `fact_lead_funnel_snapshot`                 |      18 |
| `fact_marketing_submission`                 |      13 |
| `fact_offline_response`                     |      11 |
| `fact_ooh_delivery_monthly`                 |      11 |
| `fact_organic_platform_monthly`             |      16 |
| `fact_organic_post_daily`                   |      24 |
| `fact_paid_ad_daily`                        |      25 |
| `fact_paid_ad_engagement_daily`             |      22 |
| `fact_paid_campaign_daily`                  |      19 |
| `fact_paid_campaign_monthly`                |      18 |
| `fact_paid_reach_window`                    |      14 |
| `fact_relationship_value_monthly`           |      12 |
| `fact_sales_target_monthly`                 |      11 |
| `fact_tv_spot`                              |       9 |
| `fact_vendor_invoice_line`                  |      12 |
| `fact_web_session`                          |      12 |
| `fact_web_session_daily`                    |      10 |
