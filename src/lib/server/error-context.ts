import {
  operationFailure,
  operationMessage,
  warehouseFields,
} from "./driver-error";
const contexts = new WeakMap<
  object,
  {
    stage: string;
    parameters: string[];
    operationId?: string;
    sourceTables?: string[];
  }
>();

export function recordFailure(
  error: unknown,
  stage: string,
  parameters: Record<string, unknown>,
  query: { operationId?: string; sourceTables?: string[] } = {},
) {
  if (error && typeof error === "object")
    contexts.set(error, {
      stage,
      ...query,
      parameters: Object.values(parameters).filter(
        (value): value is string =>
          typeof value === "string" && value.length > 3,
      ),
    });
}

export function failureDetails(error: unknown) {
  const context =
    error && typeof error === "object" ? contexts.get(error) : undefined;
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  function redact(value: string): string {
    let text = value;
    const secrets = Object.entries(process.env)
      .filter(
        ([name, value]) =>
          /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY/.test(name) &&
          value &&
          value.length > 3,
      )
      .map(([, value]) => value!);
    for (const value of [...secrets, ...(context?.parameters ?? [])].sort(
      (a, b) => b.length - a.length,
    ))
      text = text.split(value).join("[REDACTED]");
    return text
      .replace(/(?:Bearer|Basic)\s+\S+/gi, "[AUTHORIZATION REDACTED]")
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        "[TOKEN REDACTED]",
      )
      .replace(
        /(?:access_token|refresh_token|client_secret|password)\s*[=:]\s*[^\s,;]+/gi,
        "[SECRET REDACTED]",
      )
      .replace(/https?:\/\/[^\s)]+/gi, "[URL]")
      .replace(
        /\b(?:SELECT|INSERT|UPDATE|DELETE|MERGE|WITH)\s[\s\S]*/gi,
        "[SQL omitted]",
      )
      .slice(0, 600);
  }
  return {
    stage: context?.stage ?? "api_handler",
    ...warehouseFields(error),
    ...(operationFailure(error) ? { failurePhase: "warehouse_query" } : {}),
    ...(context?.operationId && /^[a-f0-9-]{32,36}$/i.test(context.operationId)
      ? { operationId: context.operationId }
      : {}),
    ...(context?.sourceTables?.length
      ? { sourceTables: context.sourceTables }
      : {}),
    // The full driver response and SQL are never logged. Strip quoted literals too.
    warehouseMessage: operationMessage(error)
      ? redact(operationMessage(error)!).replace(
          /'(?:''|[^'])*'|"(?:""|[^"])*"/g,
          "[QUOTED VALUE]",
        )
      : undefined,
    errorType:
      error instanceof Error
        ? error.name
        : typeof record.name === "string"
          ? redact(record.name)
          : "Unknown",
    // Only TypeErrors expose their short, redacted runtime message to the API.
    // Other driver messages may include SQL and remain classified diagnostics.
    runtimeMessage:
      error instanceof TypeError ? redact(error.message) : undefined,
    stackFrames:
      error instanceof Error
        ? error.stack
            ?.split("\n")
            .filter((line) => /^\s+at /.test(line))
            .slice(0, 6)
            .map(redact)
        : undefined,
  };
}
