import { test, expect } from "@playwright/test";
import { fixture } from "../fixture";
import { queryTransport } from "../../src/lib/server/warehouse";
import { loadCatalog } from "../../src/lib/server/catalog";
import { loadReport } from "../../src/lib/server/reports";
import { parseFilters } from "../../src/lib/server/request";
import {
  schemaContract,
  explore,
  exportPage,
} from "../../src/lib/server/explorer";
import { REPORTS } from "../../src/lib/contracts";
let f: Awaited<ReturnType<typeof fixture>>;
test.beforeAll(async () => {
  process.env.DATABRICKS_CATALOG = "fixture";
  process.env.DATABRICKS_SCHEMA = "gold";
  f = await fixture();
  queryTransport.execute = f.execute;
});
test.afterAll(() => f.db.close());
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      p = url.searchParams;
    try {
      let data: unknown;
      if (url.pathname === "/api/catalog") data = await loadCatalog();
      else if (url.pathname === "/api/reports") {
        const id = p.get("report") ?? "overview";
        data = await loadReport(id, parseFilters(new Request(url), id));
      } else if (url.pathname === "/api/schema") data = schemaContract();
      else if (url.pathname === "/api/source") {
        if (p.get("format") === "csv") {
          await route.fulfill({
            contentType: "text/csv",
            body: await exportPage(
              p.get("table")!,
              Number(p.get("offset") ?? 0),
              Number(p.get("limit") ?? 50),
            ),
          });
          return;
        }
        data = await explore(
          p.get("table")!,
          Number(p.get("offset") ?? 0),
          Number(p.get("limit") ?? 50),
        );
      } else {
        await route.continue();
        return;
      }
      await route.fulfill({ json: data });
    } catch (error) {
      await route.fulfill({
        status: 503,
        json: { error: String(error), code: "TEST_QUERY_FAILURE" },
      });
    }
  });
});
for (const report of REPORTS)
  test(`opens ${report.title} with source-aligned content`, async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(`/?report=${report.id}`);
    await expect(
      page.getByRole("heading", { name: report.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    if (report.id === "schema")
      await expect(
        page.getByText("Declared schema · 25 columns"),
      ).toBeVisible();
    else await expect(page.locator(".report-footer")).toBeVisible();
    await expect(
      page
        .locator(".metric-card")
        .filter({ hasText: /Blended CAC|Blended ROI|Avg CAC/ }),
    ).toHaveCount(0);
    expect(failures).toEqual([]);
  });
test("filters update totals, persist across reports and reset", async ({
  page,
}) => {
  await page.goto("/?report=paid-media");
  await expect(
    page.locator(".metric-card").filter({ hasText: "Paid spend" }),
  ).toContainText("$300.00");
  await expect(page.getByLabel("Platforms").locator("option")).toHaveCount(3);
  await page.getByLabel("Campaigns", { exact: true }).selectOption("c1");
  await expect(
    page.locator(".metric-card").filter({ hasText: "Paid spend" }),
  ).toContainText("$100.00");
  await page.getByLabel("Platforms", { exact: true }).selectOption("p2");
  await expect(
    page.locator(".metric-card").filter({ hasText: "Paid spend" }),
  ).toContainText("$0.00");
  await page
    .getByRole("button", { name: "Campaign Performance", exact: true })
    .click();
  await expect(page.getByLabel("Campaigns", { exact: true })).toHaveValue("c1");
  await expect(page.getByLabel("Platforms", { exact: true })).toHaveValue("p2");
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(
    page.locator(".metric-card").filter({ hasText: "Paid spend" }),
  ).toContainText("$300.00");
});
test("date, market, product, segment, model and budget choices are wired", async ({
  page,
}) => {
  await page.goto("/?report=paid-media");
  await page.getByLabel("From date").fill("2026-01-01");
  await page.getByLabel("To date").fill("2026-01-31");
  await page.getByLabel("Markets", { exact: true }).selectOption("East");
  await page.getByLabel("Products", { exact: true }).selectOption("pr1");
  await expect(
    page.locator(".metric-card").filter({ hasText: "Paid spend" }),
  ).toContainText("$100.00");
  await page
    .getByRole("button", { name: "Acquisition Funnel", exact: true })
    .click();
  await page.getByLabel("Segments", { exact: true }).selectOption("Retail");
  await page
    .getByLabel("Attribution model / version")
    .selectOption('["linear","v1"]');
  await expect(page.locator(".report-footer")).toBeVisible();
  await page
    .getByRole("button", { name: "Budgets & Targets", exact: true })
    .click();
  await page.getByLabel("Budget version").selectOption("approved");
  await expect(page.locator(".report-footer")).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});
test("source browser shows string flag types and exports current page", async ({
  page,
}) => {
  await page.goto("/?report=schema");
  await page
    .getByLabel("Source table", { exact: true })
    .selectOption("fact_funded_account");
  await page.getByLabel("Find column or type").fill("funded_flag");
  await expect(page.locator(".column-chips")).toContainText(
    "funded_flagSTRING",
  );
  await expect(
    page.getByRole("columnheader", { name: "funded_flag", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Export this page" }),
  ).toHaveAttribute("href", /table=fact_funded_account.*format=csv/);
});
test("warehouse errors can retry without losing filter selection", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/reports?*", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: {
            error: "Warehouse temporarily unavailable",
            code: "WAREHOUSE_CONNECTION",
            requestId: "test-id",
          },
        })
      : route.fallback(),
  );
  await page.goto("/?report=paid-media&campaign=c1");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Warehouse temporarily unavailable",
  );
  fail = false;
  await page
    .locator("main")
    .getByRole("alert")
    .getByRole("button", { name: "Retry" })
    .click();
  await expect(
    page.locator(".metric-card").filter({ hasText: "Paid spend" }),
  ).toContainText("$100.00");
  await expect(page.getByLabel("Campaigns", { exact: true })).toHaveValue("c1");
});
test("mobile navigation and filter layout remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("button", { name: "Reach & Frequency", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reach & Frequency", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".report-footer")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});
