import { connectionSettings, positiveInteger } from "./config";
import { managedAuthentication } from "./databricks-auth";
import { WarehouseError } from "./warehouse";

// The Marketing Data Warehouse Overview and Insights agent, which answers
// natural-language questions over the same 05gold schema the app reports on.
export const GENIE_SPACE_ID =
  process.env.DATABRICKS_GENIE_SPACE_ID ??
  "01f1e80b883c1c23a0512159f0343f4f";

type GenieStatus =
  | "SUBMITTED"
  | "FETCHING_METADATA"
  | "FILTERING_CONTEXT"
  | "ASKING_AI"
  | "PENDING_WAREHOUSE"
  | "EXECUTING_QUERY"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "QUERY_RESULT_EXPIRED";

const TERMINAL: readonly GenieStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "QUERY_RESULT_EXPIRED",
];

interface GenieAttachment {
  attachment_id?: string;
  query?: { sql?: string };
  text?: Record<string, unknown>;
  viz?: Record<string, unknown>;
}

interface GenieMessage {
  message_id: string;
  conversation_id: string;
  status?: GenieStatus;
  content: string;
  attachments?: GenieAttachment[];
  query_result?: { row_count?: number };
  error?: { error?: string; type?: string };
}

export interface GenieQueryResult {
  attachmentId: string;
  sql: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

export interface GenieReply {
  conversationId: string;
  messageId: string;
  status: GenieStatus;
  answer: string;
  queries: GenieQueryResult[];
}

// Keep chat payloads small; the agent can return more rows than we display.
const MAX_ROWS = 50;

let authenticator: ReturnType<typeof managedAuthentication> | undefined;
function authHeaders() {
  const { host } = connectionSettings();
  authenticator ??= managedAuthentication(host);
  return authenticator.authenticate();
}

async function genieFetch(path: string, init?: RequestInit): Promise<unknown> {
  const { host } = connectionSettings();
  const response = await fetch(`https://${host}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
  });
  if (response.status === 401 || response.status === 403)
    throw new WarehouseError(
      "The app service principal lacks access to the Genie agent. Share the agent with the app's service principal (and enable its API access if disabled), then try again.",
      "GENIE_PERMISSION",
      503,
    );
  if (response.status === 404)
    throw new WarehouseError(
      "The configured Genie agent was not found. Check DATABRICKS_GENIE_SPACE_ID in app.yaml.",
      "GENIE_NOT_FOUND",
      503,
    );
  if (response.status === 429)
    throw new WarehouseError(
      "The Genie agent is rate limited. Wait a moment and ask again.",
      "GENIE_RATE_LIMIT",
      429,
    );
  if (!response.ok)
    throw new WarehouseError(
      "The Genie agent request failed. Try again shortly.",
      "GENIE_ERROR",
      502,
    );
  return response.json();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollMessage(
  conversationId: string,
  messageId: string,
): Promise<GenieMessage> {
  const path =
    `/api/2.0/genie/spaces/${GENIE_SPACE_ID}/conversations/${encodeURIComponent(conversationId)}` +
    `/messages/${encodeURIComponent(messageId)}`;
  const deadline =
    Date.now() +
    positiveInteger("DATABRICKS_GENIE_TIMEOUT_SECONDS", 110, 600) * 1000;
  let delay = 1500;
  for (;;) {
    const message = (await genieFetch(path)) as GenieMessage;
    if (message.status && TERMINAL.includes(message.status)) return message;
    if (Date.now() + delay > deadline)
      throw new WarehouseError(
        "The Genie agent did not finish within the app's time budget. Ask again; the question may need rephrasing or the data volume is large.",
        "GENIE_TIMEOUT",
        504,
      );
    await sleep(delay);
    delay = Math.min(delay * 2, 5000);
  }
}

async function collectQueries(
  conversationId: string,
  message: GenieMessage,
): Promise<GenieQueryResult[]> {
  const queries: GenieQueryResult[] = [];
  for (const attachment of message.attachments ?? []) {
    const sql =
      typeof attachment.query?.sql === "string" ? attachment.query.sql : "";
    const id = attachment.attachment_id;
    if (!sql || !id) continue;
    let columns: string[] = [];
    let rows: unknown[][] = [];
    let truncated = false;
    try {
      const response = (await genieFetch(
        `/api/2.0/genie/spaces/${GENIE_SPACE_ID}/conversations/${encodeURIComponent(conversationId)}` +
          `/messages/${encodeURIComponent(message.message_id)}/attachments/${encodeURIComponent(id)}/query-result`,
      )) as {
        statement_response?: {
          manifest?: { schema?: { column_names?: string[] } };
          result?: { data_array?: unknown[][]; is_truncated?: boolean };
        };
      };
      columns = response.statement_response?.manifest?.schema?.column_names ?? [];
      rows = Array.isArray(response.statement_response?.result?.data_array)
        ? response.statement_response.result.data_array
        : [];
      truncated =
        Boolean(response.statement_response?.result?.is_truncated) ||
        rows.length > MAX_ROWS;
    } catch {
      // Query results can expire or be restricted; the SQL is still shown.
    }
    queries.push({
      attachmentId: id,
      sql,
      columns,
      rows: rows.slice(0, MAX_ROWS),
      rowCount: message.query_result?.row_count ?? rows.length,
      truncated,
    });
  }
  return queries;
}

export async function askGenie(
  message: string,
  conversationId?: string,
): Promise<GenieReply> {
  let conversation = conversationId;
  let reply: GenieMessage;
  if (conversation) {
    reply = (await genieFetch(
      `/api/2.0/genie/spaces/${GENIE_SPACE_ID}/conversations/${encodeURIComponent(conversation)}/messages`,
      { method: "POST", body: JSON.stringify({ content: message }) },
    )) as GenieMessage;
  } else {
    const started = (await genieFetch(
      `/api/2.0/genie/spaces/${GENIE_SPACE_ID}/start-conversation`,
      { method: "POST", body: JSON.stringify({ content: message }) },
    )) as { conversation_id: string; message_id: string; message?: GenieMessage };
    conversation = started.conversation_id;
    reply =
      started.message ??
      ({
        message_id: started.message_id,
        conversation_id: started.conversation_id,
        content: "",
      } as GenieMessage);
  }
  const final = await pollMessage(conversation!, reply.message_id);
  if (final.status === "FAILED" || final.error)
    throw new WarehouseError(
      `The Genie agent could not answer this question. ${
        final.error?.error ?? final.error?.type ?? "Try rephrasing it."
      }`,
      "GENIE_FAILED",
      502,
    );
  if (final.status !== "COMPLETED")
    throw new WarehouseError(
      "The Genie agent response was cancelled or expired. Ask again.",
      `GENIE_${final.status}`,
      502,
    );
  return {
    conversationId: conversation!,
    messageId: final.message_id,
    status: final.status,
    answer: final.content || "The Genie agent returned no answer text.",
    queries: await collectQueries(conversation!, final),
  };
}
