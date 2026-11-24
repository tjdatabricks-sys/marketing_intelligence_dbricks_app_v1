import { execute, t, Bind } from "./sql";
import {
  SCHEMA,
  TABLES,
  SUMMARY,
  compatibleType,
  type GoldType,
} from "./schema";
import { namespace, quoteIdentifier } from "./config";
import { WarehouseError } from "./warehouse";

export interface LiveColumn {
  table_name: string;
  column_name: string;
  data_type: string;
}
export function validateColumns(columns: LiveColumn[]) {
  const lookup = new Map(
    columns.map((row) => [
      `${row.table_name}.${row.column_name}`.toLowerCase(),
      row.data_type,
    ]),
  );
  return Object.entries(SCHEMA).flatMap(([table, cols]) =>
    cols.flatMap((column) => {
      const actual = lookup.get(`${table}.${column.column_name}`.toLowerCase());
      if (!actual)
        return [`Missing or inaccessible ${table}.${column.column_name}`];
      return compatibleType(column.data_type, actual)
        ? []
        : [
            `${table}.${column.column_name}: expected ${column.data_type}, found ${actual}`,
          ];
    }),
  );
}
let ready:
  | {
      at: number;
      promise: Promise<{
        status: string;
        tables: number;
        columns: number;
        checkedAt: string;
      }>;
    }
  | undefined;
export async function assertReady() {
  if (ready && Date.now() - ready.at < 60000) return ready.promise;
  const promise = (async () => {
    const ns = namespace(),
      b = new Bind();
    const rows = await execute(
      `SELECT table_name,column_name,data_type FROM ${quoteIdentifier(ns.catalog)}.information_schema.columns WHERE table_schema=${b.add(ns.schema)}`,
      b,
    );
    const issues = validateColumns(
      rows.map((row) => ({
        table_name: String(row.table_name),
        column_name: String(row.column_name),
        data_type: String(row.data_type),
      })),
    );
    if (issues.length)
      throw new WarehouseError(
        `Schema validation failed (${issues.length} issues): ${issues.slice(0, 8).join("; ")}. The supplied contract requires ${SUMMARY.tables} tables and ${SUMMARY.columns} columns.`,
        "SCHEMA_MISMATCH",
      );
    await Promise.all(
      TABLES.map((table) => execute(`SELECT * FROM ${t(table)} LIMIT 0`)),
    );
    return { status: "ready", ...SUMMARY, checkedAt: new Date().toISOString() };
  })();
  const entry = { at: Date.now(), promise };
  ready = entry;
  try {
    return await promise;
  } catch (error) {
    if (ready === entry) ready = undefined;
    throw error;
  }
}
