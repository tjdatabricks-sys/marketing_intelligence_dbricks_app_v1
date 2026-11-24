# Marketing Intelligence for Databricks Apps

Rebuilt around **Market_POC_Schema_Exploration (5).csv**: **47 gold tables, 735 columns**, preserving the supplied table names, column names and declared types. The source CSV and machine-readable contract are in `data/`. Authentication is resolved automatically by the official `@databricks/sdk-auth` credential provider, using the identity supplied by Databricks Apps. The app does not ask users to create or enter client IDs, client secrets or PATs. This is a read-only Next.js application using the Databricks SQL driver and the app's OAuth service principal. No Z.ai runtime, API, generated data or credentials are required.

The dashboard provides 15 views: Control Tower, Campaign Performance, Paid Media, Organic Social, Reach & Frequency, Acquisition Funnel, Customers & Products, Revenue & Attribution, Invoice & GL, Budgets & Targets, Mail/OOH/TV, Web & Email, Experiments, Schema & Source Data, and Data Quality & Lineage.

The prior preferences remain: the platform selector is sourced only from paid-ad delivery (one option per platform ID), and aggregate CAC/ROI cards are absent. Organic-only platforms remain available in the unfiltered organic report and source explorer. Unsupported legacy brand-survey and ecommerce reports are replaced with source-supported views.

## Deploy

1. In Databricks Apps, create or configure the app. Select this repository and branch `codex/rebuild-gold-schema`, with the repository root as the source directory. A private repository requires a Git credential for the **app service principal**. Alternatively upload the source ZIP contents into a workspace folder.
2. Add a SQL warehouse resource with key **`sql-warehouse`** and **Can use** permission.
3. In `app.yaml`, replace `<your-catalog>` and `<your-schema>` with the location containing all 47 supplied tables. The app binds the warehouse resource to `DATABRICKS_WAREHOUSE_ID` automatically. Databricks supplies workspace host and app identity automatically; no authentication entries need to be added to `app.yaml`.
4. Grant the app service principal `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the 47 tables. Granting your developer account access does not grant the app access. `information_schema.columns` must expose the tables to that principal. An authorized administrator can replace the three placeholders in **`scripts/grants.sql`** and run it; the file already includes grants for every required table. For example:

   ```sql
   GRANT USE CATALOG ON CATALOG `your_catalog` TO `app-service-principal-application-id`;
   GRANT USE SCHEMA ON SCHEMA `your_catalog`.`your_schema` TO `app-service-principal-application-id`;
   -- Repeat for each required table listed in DATA_MODEL.md:
   GRANT SELECT ON TABLE `your_catalog`.`your_schema`.`dim_ad` TO `app-service-principal-application-id`;
   ```

5. Deploy. Databricks installs Node dependencies, runs the package build script, and executes `npm run start`. The server binds to `0.0.0.0` and the injected `DATABRICKS_APP_PORT` (or `PORT`, default 8000). The source requires Node.js 22 or newer.
6. Open `/api/health` for process liveness, then `/api/ready` for warehouse/schema readiness. A successful readiness response includes `status: "ready"`, `tables: 47`, `columns: 735`, and `checkedAt`. Open each report and compare a known campaign/date cohort with warehouse SQL before accepting production figures.

Official deployment and resource references: [Databricks app deployment](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy), [SQL warehouse resources](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/sql-warehouse), [environment variables](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/environment-variables).

## Data behavior

- Filters are applied in SQL using bound values. Dates, campaign, platform, market, product, segment, attribution pair and budget version are exposed where supported. Shared selections persist between reports; unsupported filters are hidden and omitted from that report's request. Reset clears all selections; the URL records the current selection.
- Sources with a direct key use that key. Sources without platform keys use campaign membership; shared campaign outcomes and budgets are **not** fractionally allocated between platforms. See `DATA_MODEL.md` for cohort paths and exceptions.
- Attribution model/version and budget version are alternatives. One available choice is selected automatically; multiple choices require an explicit selection. Associated measures show unavailable until a selection is made. Source scorecards retain separate model-version rows.
- Ad daily, campaign daily, campaign monthly and scorecard facts are separate grains. Their totals are never added together. Organic post and platform-month facts are also kept separate.
- Reach windows and TV audiences are not summed into deduplicated people. Experiment cohorts show observed outcomes; no control assignment, statistical significance or uplift is invented.
- Source flags declared `STRING` remain strings. Computed funded/engaged counts recognize trimmed `true`, `1`, `y`, and `yes`, case-insensitively. Other values are not silently converted to true.
- LONG/DECIMAL/DATE/TIMESTAMP source samples and CSV exports use SQL string projections to preserve exact values. Charts format numeric values for display; unsafe integer chart values are rejected. CSV export is **one page**, not a whole-table export. Browser pages contain 50 rows; the API accepts up to 1,000 rows per page and offset up to 1,000,000. Samples use a value order across all contract columns; concurrent source changes can affect pagination.
- No business data is bundled or simulated in production. Synthetic data is confined to automated tests. The attachment supplies no nullability, key constraints, currency conversion, business definitions, timezone policy, freshness SLA or actual business rows. Names ending `_usd` are displayed as USD.
- There are no write, campaign-management or data-ingestion operations. Dashboard users read through the app service principal. The app's access policy and that principal's Unity Catalog grants define access to the reports and explorer.

## Local development and verification

```sh
npm ci
# Copy .env.example to .env.local and configure warehouse/catalog/schema.
# Local development uses the Databricks SDK credential chain / CLI profile.
npm run dev
```

Production verification:

```sh
npm run schema:generate
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run package:databricks
```

Backend tests execute all report SQL against synthetic tables created from the exact contract, with a small Databricks-to-SQLite syntax adaptation. Browser tests use that same test query adapter through intercepted API responses against the production UI. They cover navigation, filters, source types/export links, warehouse error retry and mobile layout. These tests do **not** establish live Databricks permission, connector, performance or business-data correctness; `/api/ready` and deployed cohort comparisons cover those separately.

Packaging creates `dist/marketing-intelligence-databricks.zip` containing deployable source, the contract and documentation. It excludes `.env.local`, credentials, `node_modules`, `.next`, tests and local output. Databricks builds from source. Use the repository checkout rather than the deployment ZIP to rerun the full test suite.

## Health and diagnostics

`/api/health` performs no warehouse request, so stopped warehouses do not make the app fail its process health check. `/api/ready` checks every required column/type using Unity Catalog metadata and verifies SELECT access to every table; successful results are cached for 60 seconds. Additional live columns are allowed. BIGINT/LONG, INTEGER/INT, and parameterized DECIMAL types are recognized; BOOLEAN is not accepted for a supplied STRING flag. Decimal precision/scale was absent from the attachment, so it is not guessed.

API errors include a request ID and safe diagnostics. Use that request ID in app logs and the app principal's warehouse Query History. Authentication, permission, schema, SQL and networking errors have separate codes. Client responses and logs do not intentionally include credentials or raw driver SQL. Catalog options are cached for 60 seconds; report results are not cached. Query concurrency defaults to four, with isolated sessions, a bounded queue and a configurable execution deadline.

The warehouse binding, catalog/schema placeholders, principal grants and deployment are environment-owned configuration. This repository does not create, load or alter the source tables.

## Managed authentication implementation

`databricks-auth.ts` adapts the official Databricks SDK credential provider to the SQL driver. The SDK handles OAuth endpoint discovery, token caching and refresh. Inside Databricks Apps, it reads the injected identity, ignores local profile files and forces app OAuth instead of accepting a stray PAT. Local development uses the standard SDK credential chain. This replaces the SQL driver's cloud-domain-based OAuth adapter, which has its own endpoint and hostname detection. This change does not assert the cause of a particular deployed failure or grant Unity Catalog permissions. Runtime access remains managed by the Databricks app resource and permission configuration.

Diagnostics version 4 distinguishes failed warehouse query operations from initial authentication. Logs include the server error class and SQLSTATE when supplied, the operation ID and source-table names, and a redacted warehouse message for operation failures. The raw driver response and SQL are never serialized. The redacted warehouse message is confined to app logs; API responses contain structured fields only. An OAuth mention in a query error is not sufficient to diagnose an app credential failure.
