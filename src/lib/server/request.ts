import { REPORTS, type Filters } from "../contracts";
import { WarehouseError } from "./warehouse";

export function parseFilters(request: Request, id: string): Filters {
  const supported = REPORTS.find((report) => report.id === id)?.filters ?? [];
  const filters: Filters = {};
  for (const key of supported) {
    const value = new URL(request.url).searchParams.get(key)?.trim();
    if (value) filters[key] = value;
  }
  for (const key of ["from", "to"] as const) {
    const value = filters[key];
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(new Date(value).getTime()) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw new WarehouseError(`Invalid ${key} date.`, "INVALID_FILTER", 400);
  }
  if (filters.from && filters.to && filters.from > filters.to)
    throw new WarehouseError(
      "The start date must not follow the end date.",
      "INVALID_FILTER",
      400,
    );
  return filters;
}
