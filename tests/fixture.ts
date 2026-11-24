import initSqlJs from "sql.js";
import { SCHEMA } from "../src/lib/server/schema";
import type { Statement } from "../src/lib/server/sql";

// Synthetic rows exist only in tests. Production has no fallback/sample-data path.
export async function fixture() {
  const SQL = await initSqlJs(),
    db = new SQL.Database();
  const metadata = Object.entries(SCHEMA).flatMap(([table, columns]) =>
    columns.map((col) => ({
      table_name: table,
      column_name: col.column_name,
      data_type:
        col.data_type === "LONG"
          ? "BIGINT"
          : col.data_type === "DECIMAL"
            ? "DECIMAL(28,8)"
            : col.data_type,
    })),
  );
  function insert(
    table: string,
    overrides: Record<string, unknown>,
    cohort = 1,
  ) {
    const id = String(cohort),
      date = cohort === 1 ? "2026-01-12" : "2026-02-12",
      monthly = date.slice(0, 7) + "-01";
    const common: Record<string, unknown> = {
      campaign_id: "c" + id,
      campaign_name: "Campaign " + id,
      platform_id: "p" + id,
      platform_name: cohort === 1 ? "Meta" : "LinkedIn",
      platform_campaign_id: "pc" + id,
      product_id: "pr" + id,
      product_name: "Product " + id,
      geo_id: "g" + id,
      market: cohort === 1 ? "East" : "West",
      customer_id: "u" + id,
      customer_segment: cohort === 1 ? "Retail" : "Business",
      account_id: "ac" + id,
      application_id: "app" + id,
      lead_id: "lead" + id,
      submission_id: "sub" + id,
      ad_id: "ad" + id,
      ad_performance_id: "perf" + id,
      ad_group_id: "ag" + id,
      format_id: "fmt" + id,
      format_name: "Format " + id,
      device_key: "dev" + id,
      device_name: "Device " + id,
      social_account_id: "soc" + id,
      content_key: "content" + id,
      invoice_id: "inv" + id,
      invoice_line_id: "line" + id,
      gl_posting_id: "gl" + id,
      attribution_model: "linear",
      attribution_model_version: "v1",
      budget_version: "approved",
      funded_flag: "true",
      engaged_flag: "yes",
      value_type: "actual",
      distribution_type: "paid",
      acquisition_distribution_type: "paid",
      email_parent_campaign_id: "c" + id,
      ooh_campaign_id: "c" + id,
      ooh_geo_id: "g" + id,
      mailer_campaign_id: "c" + id,
      experiment_id: "exp" + id,
      variant_id: "variant" + id,
      window_start: monthly,
      window_end: date,
      attribution_weight: "1.0",
      spend_usd: cohort * 100,
      paid_spend_usd: 999999,
      impressions: cohort * 1000,
      clicks: cohort * 10,
      line_total_usd: cohort === 1 ? 120 : 200,
      debit_amount_usd: cohort === 1 ? 100 : 180,
      credit_amount_usd: 0,
      _gold_release: "r1",
    };
    const row = SCHEMA[table].map(
      (col) =>
        overrides[col.column_name] ??
        (Object.hasOwn(common, col.column_name)
          ? common[col.column_name]
          : col.data_type === "DATE"
            ? [
                "report_month",
                "budget_month",
                "target_month",
                "month",
                "invoice_billing_month",
              ].includes(col.column_name)
              ? monthly
              : date
            : col.data_type === "TIMESTAMP"
              ? "2026-03-01 10:00:00.123456"
              : ["INT", "LONG", "DOUBLE", "DECIMAL"].includes(col.data_type)
                ? 1
                : `${col.column_name}-${id}`),
    );
    db.run(
      `INSERT INTO ${table} VALUES (${row.map(() => "?").join(",")})`,
      row as (string | number | null)[],
    );
  }
  for (const [table, cols] of Object.entries(SCHEMA)) {
    db.run(
      `CREATE TABLE ${table} (${cols.map((col) => `"${col.column_name}" ${["INT", "LONG"].includes(col.data_type) ? "INTEGER" : ["DECIMAL", "DOUBLE"].includes(col.data_type) ? "REAL" : "TEXT"}`).join(",")})`,
    );
    insert(table, {}, 1);
    insert(table, {}, 2);
  }
  insert("dim_platform", { social_account_id: "second-account" }, 1);
  insert(
    "fact_vendor_invoice_line",
    { invoice_line_id: "line1b", line_total_usd: 30 },
    1,
  );
  insert(
    "fact_finance_gl_posting",
    { gl_posting_id: "gl1b", debit_amount_usd: 50 },
    1,
  );
  const calls: Statement[] = [];
  async function execute(
    statement: Statement,
  ): Promise<Record<string, unknown>[]> {
    calls.push(statement);
    if (statement.sql.includes(".information_schema.columns")) return metadata;
    let sql = statement.sql
      .replace(/`fixture`\.`gold`\.`(\w+)`/g, '"$1"')
      .replace(/CAST\((:[a-z0-9]+) AS DATE\)/gi, "$1")
      .replace(/ AS STRING\)/gi, " AS TEXT)");
    const query = db.prepare(sql);
    try {
      query.bind(
        Object.fromEntries(
          Object.entries(statement.parameters).map(([key, value]) => [
            ":" + key,
            typeof value === "boolean" ? Number(value) : value,
          ]),
        ),
      );
      const rows: Record<string, unknown>[] = [];
      while (query.step()) rows.push(query.getAsObject());
      return rows;
    } catch (error) {
      throw new Error(`SQL fixture rejected: ${sql}`, { cause: error });
    } finally {
      query.free();
    }
  }
  return { db, insert, execute, calls, metadata };
}
