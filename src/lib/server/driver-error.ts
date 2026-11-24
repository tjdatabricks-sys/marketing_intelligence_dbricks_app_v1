// Read only known driver error fields. Never serialize the complete response.
export function driverRecords(error: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [],
    seen = new Set<object>();
  function walk(value: unknown, depth: number) {
    if (
      !value ||
      typeof value !== "object" ||
      seen.has(value) ||
      depth > 6 ||
      records.length >= 50
    )
      return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20)) walk(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    records.push(record);
    for (const key of [
      "response",
      "cause",
      "status",
      "payload",
      "error",
      "innerError",
    ])
      walk(record[key], depth + 1);
  }
  walk(error, 0);
  return records;
}
export function operationFailure(error: unknown) {
  return driverRecords(error).some(
    (record) =>
      typeof record.operationState === "number" ||
      (["ERROR", "CANCELED", "CLOSED", "TIMEOUT", "UNKNOWN"].includes(
        String(record.errorCode),
      ) &&
        record.response &&
        typeof record.response === "object"),
  );
}
export function warehouseFields(error: unknown) {
  const records = driverRecords(error),
    messages = records.flatMap((record) =>
      ["errorMessage", "displayMessage", "message"].flatMap((key) =>
        typeof record[key] === "string" ? [record[key] as string] : [],
      ),
    );
  const sqlState = records
    .flatMap((record) => [record.sqlState, record.sql_state])
    .find((value) => typeof value === "string" && /^[A-Z0-9]{5}$/i.test(value));
  const errorClass =
    records
      .flatMap((record) => [record.errorClass, record.error_class])
      .find(
        (value) =>
          typeof value === "string" && /^[A-Z][A-Z0-9_.]{1,119}$/.test(value),
      ) ??
    messages.flatMap((message) => {
      // A server error class precedes SQL, rather than being a bracketed SQL identifier/literal.
      const prefix = message
        .split(/\b(?:SELECT|INSERT|UPDATE|DELETE|MERGE|WITH)\s/i)[0]
        .slice(0, 1000);
      const match = prefix.match(/\[([A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)*)\]/);
      return match && match[1].length <= 120 ? [match[1]] : [];
    })[0];
  const queryId = records
    .flatMap((record) => [
      record.queryId,
      record.query_id,
      record.statementId,
      record.statement_id,
    ])
    .find(
      (value) => typeof value === "string" && /^[a-f0-9-]{32,36}$/i.test(value),
    );
  return {
    ...(sqlState ? { sqlState: String(sqlState).toUpperCase() } : {}),
    ...(errorClass ? { warehouseErrorClass: String(errorClass) } : {}),
    ...(queryId ? { queryId: String(queryId) } : {}),
  };
}
export function operationMessage(error: unknown): string | undefined {
  if (!operationFailure(error)) return undefined;
  // Server-side only, passed through the central redactor before logging.
  return driverRecords(error)
    .flatMap((record) => [record.errorMessage, record.displayMessage])
    .find((value) => typeof value === "string" && value.length > 0) as
    string | undefined;
}
