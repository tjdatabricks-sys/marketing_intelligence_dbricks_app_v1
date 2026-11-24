import definitions from "../../../data/gold-schema.json";

export type GoldType =
  "STRING" | "DATE" | "TIMESTAMP" | "INT" | "LONG" | "DECIMAL" | "DOUBLE";
export interface Column {
  column_name: string;
  data_type: GoldType;
}
export const SCHEMA: Record<string, Column[]> = {};
for (const row of definitions)
  (SCHEMA[row.table_name] ??= []).push({
    column_name: row.column_name,
    data_type: row.data_type as GoldType,
  });
export const TABLES = Object.keys(SCHEMA).sort();
export const SUMMARY = { tables: TABLES.length, columns: definitions.length };

export function tableColumns(table: string): Column[] {
  if (!Object.hasOwn(SCHEMA, table)) throw new Error("Unknown gold table.");
  return SCHEMA[table];
}
export function hasColumn(table: string, column: string) {
  return tableColumns(table).some((item) => item.column_name === column);
}
export function compatibleType(expected: GoldType, actual: string) {
  const type = actual.toUpperCase().split("(")[0];
  if (expected === "LONG") return ["LONG", "BIGINT"].includes(type);
  if (expected === "INT") return ["INT", "INTEGER"].includes(type);
  if (expected === "DECIMAL") return ["DECIMAL", "NUMERIC"].includes(type);
  if (expected === "STRING")
    return ["STRING", "VARCHAR", "CHAR"].includes(type);
  return expected === type;
}
