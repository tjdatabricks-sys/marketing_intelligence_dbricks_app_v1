import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture } from "./fixture";
import {
  SCHEMA,
  SUMMARY,
  TABLES,
  compatibleType,
} from "../src/lib/server/schema";
import { queryTransport } from "../src/lib/server/warehouse";
import { loadCatalog, resolveContext } from "../src/lib/server/catalog";
import { loadReport } from "../src/lib/server/reports";
import { explore, exportPage, explorerQuery } from "../src/lib/server/explorer";
import { validateColumns, assertReady } from "../src/lib/server/readiness";
import { REPORTS } from "../src/lib/contracts";
import { parseFilters } from "../src/lib/server/request";
import { number } from "../src/lib/server/sql";
import { GET as health } from "../src/app/api/health/route";
let f: Awaited<ReturnType<typeof fixture>>;
const original = queryTransport.execute;
before(async () => {
  process.env.DATABRICKS_CATALOG = "fixture";
  process.env.DATABRICKS_SCHEMA = "gold";
  f = await fixture();
  queryTransport.execute = f.execute;
});
after(() => {
  queryTransport.execute = original;
  f.db.close();
});
test("exactly matches the attached 47-table / 735-column CSV contract", () => {
  assert.deepEqual(SUMMARY, { tables: 47, columns: 735 });
  const lines = readFileSync("data/gold-schema.csv", "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\uFEFF/, "")
        .split(",")
        .map((v) => v.replace(/^"|"$/g, "")),
    );
  const header = lines.shift()!;
  const ti = header.indexOf("table_name"),
    ci = header.indexOf("column_name"),
    di = header.indexOf("data_type");
  for (const row of lines)
    assert.equal(
      SCHEMA[row[ti]].find((col) => col.column_name === row[ci])?.data_type,
      row[di],
    );
  assert.equal(
    SCHEMA.fact_funded_account.find((col) => col.column_name === "funded_flag")
      ?.data_type,
    "STRING",
  );
});
test("readiness validates every type, not just table count", async () => {
  assert.deepEqual(validateColumns(f.metadata), []);
  assert.equal(compatibleType("LONG", "BIGINT"), true);
  assert.equal(compatibleType("DECIMAL", "DECIMAL(28,8)"), true);
  assert.equal(compatibleType("STRING", "BOOLEAN"), false);
  assert.equal(validateColumns(f.metadata.slice(1)).length, 1);
  assert.equal(
    validateColumns(
      f.metadata.map((row) =>
        row.column_name === "funded_flag"
          ? { ...row, data_type: "BOOLEAN" }
          : row,
      ),
    ).length,
    1,
  );
  const result = await assertReady();
  assert.equal(result.status, "ready");
  assert.equal(result.columns, 735);
});
test("liveness stays healthy without warehouse configuration", async () => {
  const before = f.calls.length;
  assert.equal(health().status, 200);
  assert.equal(f.calls.length, before);
});
test("paid-only platform options do not duplicate account-grain platforms", async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(
    catalog.platforms.map((p) => p.id),
    ["p2", "p1"],
  );
  assert.equal(catalog.attribution.length, 1);
  assert.equal(catalog.budgetVersions.length, 1);
  assert.equal(catalog.dateRange.min, "2026-01-01");
});
for (const definition of REPORTS.filter((d) => d.id !== "schema")) {
  test(`${definition.id}: all SQL columns and joins execute against exact contract`, async () => {
    const result = await loadReport(definition.id, {});
    assert.equal(result.id, definition.id);
    assert.ok(result.panels.length);
    assert.ok(!result.metrics.some((metric) => /CAC|ROI/i.test(metric.label)));
  });
  if (definition.filters.length)
    test(`${definition.id}: combined filters bind safely and integrate`, async () => {
      const filters = {
        from: "2026-01-01",
        to: "2026-01-31",
        campaign: "c1",
        platform: "p1",
        market: "East",
        product: "pr1",
        segment: "Retail",
      };
      const accepted = Object.fromEntries(
        Object.entries(filters).filter(([key]) =>
          definition.filters.includes(key as never),
        ),
      );
      const result = await loadReport(definition.id, accepted);
      assert.ok(result.panels.length);
    });
}
test("paid totals avoid dimension fanout and do not add other rollups", async () => {
  const report = await loadReport("paid-media", {});
  assert.equal(
    report.metrics.find((m) => m.label === "Paid spend")?.value,
    300,
  );
  assert.equal(
    report.metrics.find((m) => m.label === "Paid impressions")?.value,
    3000,
  );
  assert.equal(
    report.metrics.find((m) => m.label === "Click-through rate")?.value,
    0.01,
  );
  assert.equal(report.panels[0].rows.length, 2);
});
test("each paid filter narrows delivery independently", async () => {
  for (const filters of [
    { campaign: "c1" },
    { platform: "p1" },
    { market: "East" },
    { product: "pr1" },
    { from: "2026-01-01", to: "2026-01-31" },
  ]) {
    const report = await loadReport("paid-media", filters);
    assert.equal(
      report.metrics.find((m) => m.label === "Paid spend")?.value,
      100,
      JSON.stringify(filters),
    );
  }
});
test("empty filter intersection returns zero totals, no invented conversion rate", async () => {
  const report = await loadReport("paid-media", {
    campaign: "c1",
    platform: "p2",
  });
  assert.equal(report.metrics.find((m) => m.label === "Paid spend")?.value, 0);
  assert.equal(
    report.metrics.find((m) => m.label === "Click-through rate")?.value,
    null,
  );
  assert.equal(report.panels[0].rows.length, 0);
});
test("invoice and GL are aggregated independently before joining", async () => {
  const report = await loadReport("finance", {});
  assert.equal(
    report.metrics.find((m) => m.label === "Invoice totals")?.value,
    350,
  );
  assert.equal(
    report.metrics.find((m) => m.label === "GL net debits")?.value,
    330,
  );
  assert.equal(
    report.metrics.find((m) => m.label === "Invoice minus GL")?.value,
    20,
  );
  const scoped = await loadReport("finance", { campaign: "c1" });
  assert.equal(
    scoped.metrics.find((m) => m.label === "Invoice totals")?.value,
    150,
  );
  assert.equal(
    scoped.metrics.find((m) => m.label === "Invoice minus GL")?.value,
    0,
  );
});
test("reach windows use max, never a sum of unique people", async () => {
  f.db.run(
    "UPDATE fact_paid_reach_window SET unique_reach=100 WHERE reach_id=?",
    ["reach_id-1"],
  );
  f.db.run(
    "UPDATE fact_paid_reach_window SET unique_reach=200 WHERE reach_id=?",
    ["reach_id-2"],
  );
  const report = await loadReport("reach", {});
  assert.equal(
    report.metrics.find((m) => m.label === "Largest single-window reach")
      ?.value,
    200,
  );
});
test("ambiguous versions require selection rather than mixing alternatives", async () => {
  const catalog = await loadCatalog();
  const ambiguous = {
    ...catalog,
    attribution: [
      ...catalog.attribution,
      { id: '["linear","v2"]', label: "linear v2" },
    ],
    budgetVersions: [
      ...catalog.budgetVersions,
      { id: "draft", label: "draft" },
    ],
  };
  const ctx = resolveContext({}, ambiguous);
  assert.equal(ctx.attribution, null);
  assert.equal(ctx.budgetVersion, null);
  assert.equal(ctx.notes.length, 2);
  assert.deepEqual(
    resolveContext(
      { attribution: catalog.attribution[0].id, budgetVersion: "draft" },
      ambiguous,
    ).attribution,
    ["linear", "v1"],
  );
  assert.throws(() => resolveContext({ attribution: "untrusted" }, ambiguous));
});
for (const table of TABLES)
  test(`source explorer: ${table} includes every original column`, async () => {
    const page = await explore(table, 0, 1);
    assert.equal(page.columns.length, SCHEMA[table].length);
    assert.equal(
      Object.keys((page.rows as object[])[0]).length,
      SCHEMA[table].length,
    );
    assert.ok(
      (await exportPage(table, 0, 1)).startsWith(
        '"' + SCHEMA[table][0].column_name + '"',
      ),
    );
  });
test("explorer keeps large numeric strings and raw string flags", async () => {
  f.db.run("UPDATE fact_funded_account SET funded_flag='YES'");
  const page = await explore("fact_funded_account", 0, 1);
  assert.equal((page.rows as Record<string, unknown>[])[0].funded_flag, "YES");
  f.db.run(
    "UPDATE fact_funding_event SET funding_amount_usd='12345678901234567890.12345678'",
  );
  assert.match(
    explorerQuery("fact_funding_event", 0, 1),
    /CAST\(`funding_amount_usd` AS STRING\)/,
  );
  assert.throws(() => number("9007199254740993"));
});
test("rejects table injection, unsafe pagination and invalid dates", () => {
  assert.throws(() => explorerQuery("dim_customer;DROP TABLE dim_ad", 0, 50));
  assert.throws(() => explorerQuery("dim_ad", -1, 50));
  assert.throws(() => explorerQuery("dim_ad", 0, 1001));
  assert.throws(() =>
    parseFilters(new Request("http://local/api?from=2026-02-31"), "overview"),
  );
  assert.throws(() =>
    parseFilters(
      new Request("http://local/api?from=2026-03-01&to=2026-01-01"),
      "overview",
    ),
  );
  assert.deepEqual(
    parseFilters(
      new Request("http://local/api?platform=p1&segment=Retail"),
      "experiments",
    ),
    {},
  );
});
