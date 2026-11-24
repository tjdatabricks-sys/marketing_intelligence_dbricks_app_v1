import { tableColumns, TABLES, SCHEMA, SUMMARY } from "./schema";
import { execute, t, Bind, jsonValue } from "./sql";
import { quoteIdentifier } from "./config";
import { WarehouseError } from "./warehouse";

export const schemaContract = () => ({
  ...SUMMARY,
  tables: TABLES.map((name) => ({ name, columns: SCHEMA[name] })),
});
export function explorerQuery(table: string, offset: number, limit: number) {
  if (!TABLES.includes(table))
    throw new WarehouseError("Unknown gold table.", "INVALID_TABLE", 400);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 1000000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new WarehouseError(
      "Use an offset from 0 to 1000000 and a limit from 1 to 1000.",
      "INVALID_PAGE",
      400,
    );
  const columns = tableColumns(table);
  // Explicit STRING projections preserve decimal precision, LONGs and timestamp microseconds.
  const project = columns
    .map(
      ({ column_name, data_type }) =>
        `${["DECIMAL", "LONG", "TIMESTAMP", "DATE"].includes(data_type) ? `CAST(${quoteIdentifier(column_name)} AS STRING)` : quoteIdentifier(column_name)} AS ${quoteIdentifier(column_name)}`,
    )
    .join(",");
  // No key constraints were provided: all supplied columns form a stable value order.
  const order = columns
    .map(({ column_name }) => quoteIdentifier(column_name))
    .join(",");
  return `SELECT ${project} FROM ${t(table)} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
}
export async function explore(table: string, offset = 0, limit = 50) {
  const sql = explorerQuery(table, offset, limit),
    b = new Bind();
  const [rows, counts] = await Promise.all([
    execute(sql, b),
    execute(`SELECT CAST(COUNT(*) AS STRING) AS total FROM ${t(table)}`),
  ]);
  return {
    table,
    columns: tableColumns(table),
    rows: jsonValue(rows),
    total: String(counts[0]?.total ?? "0"),
    offset,
    limit,
    nextOffset: rows.length === limit ? offset + limit : null,
  };
}
export function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}
export async function exportPage(table: string, offset = 0, limit = 1000) {
  const rows = await execute(explorerQuery(table, offset, limit)),
    columns = tableColumns(table).map((col) => col.column_name);
  return [columns, ...rows.map((row) => columns.map((key) => row[key]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
