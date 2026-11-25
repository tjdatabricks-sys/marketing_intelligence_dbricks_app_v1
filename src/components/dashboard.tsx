"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  REPORTS,
  type Report,
  type Filters,
  type Catalog,
  type DataPanel,
  type Choice,
} from "@/lib/contracts";

type Failure = {
  error: string;
  code?: string;
  requestId?: string;
  runtimeMessage?: string;
  stage?: string;
};
async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw data;
  return data;
}
// Compact notation keeps large values readable: 12,300 -> 12.3K, 1.2M, $45.6K.
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const format = (value: unknown, kind?: string) => {
  if (value === null || value === undefined) return "—";
  if (kind === "money")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(Number(value));
  if (kind === "percent")
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(Number(value));
  if (kind === "number") return compact.format(Number(value));
  return String(value);
};
function ErrorBox({ failure, retry }: { failure: Failure; retry: () => void }) {
  return (
    <div role="alert" className="failure">
      <strong>Report data could not be loaded</strong>
      <p>{failure.error ?? "The request failed. Retry to reconnect."}</p>
      {failure.runtimeMessage && (
        <p>
          {failure.stage}: {failure.runtimeMessage}
        </p>
      )}
      <small>
        {failure.code} {failure.requestId && `· Request ${failure.requestId}`}
      </small>
      <div>
        <button onClick={retry}>Retry</button>
      </div>
    </div>
  );
}
function Grid({ panel }: { panel: DataPanel }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{panel.title}</h2>
        <span className="source-name">{panel.source}</span>
      </div>
      {panel.note && <p className="muted panel-note">{panel.note}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {panel.columns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {panel.rows.map((row, i) => (
              <tr key={i}>
                {panel.columns.map((col) => (
                  <td key={col.key} title={String(row[col.key] ?? "")}>
                    {format(row[col.key], col.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {panel.rows.length === 0 && (
          <p className="empty">No matching source rows for these filters.</p>
        )}
      </div>
    </section>
  );
}
function SelectFilter({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value?: string;
  options: Choice[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter">
      <span>{label}</span>
      <select
        aria-label={label}
        name={name}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {name === "attribution" || name === "budgetVersion"
            ? "Choose one (auto if only one)"
            : `All ${label.toLowerCase()}`}
        </option>
        {options.map((option) => (
          <option value={option.id} key={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface SourceSchema {
  tables: {
    name: string;
    columns: { column_name: string; data_type: string }[];
  }[];
  columns: number;
}
interface SourcePage {
  table: string;
  rows: Record<string, unknown>[];
  columns: { column_name: string; data_type: string }[];
  total: string;
  offset: number;
  limit: number;
  nextOffset: number | null;
}
function Explorer() {
  const [schema, setSchema] = useState<SourceSchema>(),
    [table, setTable] = useState("fact_paid_ad_daily"),
    [search, setSearch] = useState(""),
    [columnSearch, setColumnSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<SourcePage>(),
    [error, setError] = useState<Failure>(),
    [retry, setRetry] = useState(0),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    get<SourceSchema>("/api/schema", controller.signal)
      .then(setSchema)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e);
      });
    return () => controller.abort();
  }, [retry]);
  /* eslint-disable react-hooks/set-state-in-effect -- Synchronize abortable warehouse requests and their loading/error state. */
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(undefined);
    setError(undefined);
    get<SourcePage>(
      `/api/source?table=${encodeURIComponent(table)}&offset=${offset}&limit=50`,
      controller.signal,
    )
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [table, offset, retry]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const columns =
    schema?.tables.find((item) => item.name === table)?.columns ?? [];
  const visible = columns.filter(
    (col) =>
      col.column_name.includes(columnSearch) ||
      col.data_type.toLowerCase().includes(columnSearch.toLowerCase()),
  );
  return (
    <>
      <div className="source-tools">
        <label className="filter">
          <span>Find table</span>
          <input
            aria-label="Find table"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search 47 tables"
          />
        </label>
        <label className="filter wide">
          <span>Source table</span>
          <select
            aria-label="Source table"
            value={table}
            onChange={(e) => {
              setTable(e.target.value);
              setOffset(0);
            }}
          >
            {schema?.tables
              .filter(
                (item) => item.name.includes(search) || item.name === table,
              )
              .map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
          </select>
        </label>
        <label className="filter">
          <span>Find column or type</span>
          <input
            aria-label="Find column or type"
            value={columnSearch}
            onChange={(e) => setColumnSearch(e.target.value)}
            placeholder="e.g. funded_flag / STRING"
          />
        </label>
      </div>
      <section className="panel">
        <h2>Declared schema · {columns.length} columns</h2>
        <p className="muted">
          Exact contract from the attached CSV. Nullability, primary keys and
          foreign keys were not provided. Flags declared STRING remain strings.
        </p>
        <div className="column-chips">
          {visible.map((col) => (
            <span key={col.column_name}>
              <b>{col.column_name}</b>
              <code>{col.data_type}</code>
            </span>
          ))}
        </div>
      </section>
      {error && <ErrorBox failure={error} retry={() => setRetry(retry + 1)} />}{" "}
      {loading && (
        <div role="status" className="loading">
          Reading source data…
        </div>
      )}
      {data && (
        <>
          <div className="pagination">
            <span>
              {data.total} source rows · offset {offset} · read-only sample
            </span>
            <div>
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous
              </button>
              <button
                disabled={
                  data.nextOffset === null || offset + 50 >= Number(data.total)
                }
                onClick={() => setOffset(offset + 50)}
              >
                Next
              </button>
              <a
                className="button"
                href={`/api/source?table=${encodeURIComponent(table)}&offset=${offset}&limit=50&format=csv`}
              >
                Export this page
              </a>
            </div>
          </div>
          <Grid
            panel={{
              title: table,
              source: "Live warehouse sample",
              columns: visible.map((col) => ({
                key: col.column_name,
                label: col.column_name,
              })),
              rows: data.rows,
              note: "LONG, DECIMAL, DATE and TIMESTAMP are projected as strings for exact export. No report filters apply here. Exports contain this page only, up to 50 rows.",
            }}
          />
        </>
      )}
    </>
  );
}

interface GenieQueryResultData {
  attachmentId: string;
  sql: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}
interface GenieReplyData {
  conversationId: string;
  messageId: string;
  status: string;
  answer: string;
  queries: GenieQueryResultData[];
}
// The Genie agent answers in markdown-lite (**bold**, `code`, bullet and
// numbered lists, ### headings). Render it as styled elements so no raw
// markup characters such as ** show up in the chat.
function renderGenieInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**"))
      parts.push(<b key={`${keyPrefix}-b${index}`}>{token.slice(2, -2)}</b>);
    else
      parts.push(<code key={`${keyPrefix}-c${index}`}>{token.slice(1, -1)}</code>);
    last = match.index + token.length;
    index++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
function GenieAnswer({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let ordered = false;
  const flush = (key: string) => {
    if (list.length === 0) return;
    const items = list.map((item, i) => (
      <li key={`${key}-li${i}`}>{renderGenieInline(item, `${key}-li${i}`)}</li>
    ));
    blocks.push(
      ordered ? <ol key={`ol-${key}`}>{items}</ol> : <ul key={`ul-${key}`}>{items}</ul>,
    );
    list = [];
  };
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      if (ordered) flush(`b${i}`);
      ordered = false;
      list.push(bullet[1]);
    } else if (numbered) {
      if (!ordered) flush(`b${i}`);
      ordered = true;
      list.push(numbered[2]);
    } else {
      flush(`b${i}`);
      if (!trimmed) return;
      const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
      const inline = renderGenieInline(
        heading ? heading[1] : trimmed,
        `p${i}`,
      );
      blocks.push(
        heading ? <p key={`p${i}`}><b>{inline}</b></p> : <p key={`p${i}`}>{inline}</p>,
      );
    }
  });
  flush("end");
  return <div className="genie-answer">{blocks}</div>;
}
// Draws a compact bar chart for a Genie query result when one column looks
// numeric and another looks like a label. Falls back to the table alone.
function GenieChart({ query }: { query: GenieQueryResultData }) {
  const rows = query.rows;
  if (rows.length < 2 || query.columns.length < 2) return null;
  const numeric = (value: unknown) =>
    value !== null &&
    value !== undefined &&
    value !== "" &&
    !Number.isNaN(Number(value));
  let valueIndex = -1;
  let labelIndex = -1;
  for (let c = 0; c < query.columns.length; c++) {
    const ratio = rows.filter((row) => numeric(row[c])).length / rows.length;
    if (ratio >= 0.8) {
      if (valueIndex < 0) valueIndex = c;
    } else if (labelIndex < 0) labelIndex = c;
  }
  if (valueIndex < 0 || labelIndex < 0) return null;
  const data = rows.slice(0, 12).map((row, i) => ({
    name: String(row[labelIndex] ?? "").slice(0, 18) || `#${i + 1}`,
    value: Number(row[valueIndex]),
  }));
  if (data.every((item) => Number.isNaN(item.value))) return null;
  return (
    <div
      className="genie-chart"
      role="img"
      aria-label={`${query.columns[valueIndex]} by ${query.columns[labelIndex]} chart`}
    >
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10 }}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={56}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickFormatter={(value) => compact.format(Number(value))}
          />
          <Tooltip formatter={(value) => format(value, "number")} />
          <Bar
            dataKey="value"
            name={query.columns[valueIndex]}
            fill="#0d9488"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function GenieChat() {
  const [turns, setTurns] = useState<
    { role: "user" | "genie"; text: string; reply?: GenieReplyData }[]
  >([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure>();
  async function ask(question: string) {
    if (!question || busy) return;
    setDraft("");
    setTurns((prev) => [...prev, { role: "user", text: question }]);
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/genie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, conversationId }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw data;
      const reply = data as GenieReplyData;
      setConversationId(reply.conversationId);
      setTurns((prev) => [...prev, { role: "genie", text: reply.answer, reply }]);
    } catch (e) {
      setTurns((prev) => prev.slice(0, -1));
      setDraft(question);
      setError((e as Failure) ?? { error: "The request failed." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Ask Genie</h2>
        <span className="source-name">Marketing Data Warehouse agent</span>
      </div>
      <p className="muted panel-note">
        Ask natural-language questions about the marketing data warehouse.
        Answers come from the Marketing Data Warehouse Overview and Insights
        agent over the same 47-table gold schema. Follow-ups stay in one
        conversation; each answer is charted and shown with its SQL and
        results.
      </p>
      {turns.length > 0 && (
        <div className="chat-turns">
          {turns.map((turn, i) => (
            <article
              className={turn.role === "user" ? "chat-user" : "chat-genie"}
              key={i}
            >
              <b>{turn.role === "user" ? "You" : "Genie"}</b>
              {turn.role === "user" ? (
                <p>{turn.text}</p>
              ) : (
                <GenieAnswer text={turn.text} />
              )}
              {turn.reply?.queries.map((query) => (
                <div className="genie-query" key={query.attachmentId}>
                  <GenieChart query={query} />
                  {query.columns.length > 0 && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {query.columns.map((column) => (
                              <th key={column}>{column}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {query.rows.map((row, r) => (
                            <tr key={r}>
                              {query.columns.map((column, c) => (
                                <td key={column} title={String(row[c] ?? "")}>
                                  {row[c] === null || row[c] === undefined
                                    ? "—"
                                    : String(row[c])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <details>
                    <summary>
                      SQL
                      {query.rowCount > 0 &&
                        ` · ${query.rowCount.toLocaleString()} rows`}
                      {query.truncated && " · first 50 rows shown"}
                    </summary>
                    <pre>{query.sql}</pre>
                  </details>
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
      {error && <ErrorBox failure={error} retry={() => setError(undefined)} />}
      {busy && (
        <div role="status" className="loading">
          <span className="spinner" />
          Asking the Genie agent… this can take up to two minutes.
        </div>
      )}
      <form
        className="filter-row"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft.trim());
        }}
      >
        <label className="filter wide">
          <span>Question</span>
          <textarea
            aria-label="Question for the Genie agent"
            value={draft}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. What was the total paid spend by campaign last quarter?"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(draft.trim());
              }
            }}
          />
        </label>
        <button type="submit" disabled={busy || !draft.trim()}>
          Ask
        </button>
        {(conversationId || turns.length > 0) && (
          <button
            type="button"
            onClick={() => {
              setTurns([]);
              setConversationId(undefined);
              setError(undefined);
            }}
          >
            New conversation
          </button>
        )}
      </form>
    </section>
  );
}

export function Dashboard() {
  const [active, setActive] = useState("overview"),
    [filters, setFilters] = useState<Filters>({}),
    [catalog, setCatalog] = useState<Catalog>(),
    [report, setReport] = useState<Report>(),
    [error, setError] = useState<Failure>(),
    [catalogError, setCatalogError] = useState<Failure>(),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search),
        id = params.get("report");
      if (id && REPORTS.some((r) => r.id === id)) setActive(id);
      const restored: Filters = {};
      for (const key of [
        "from",
        "to",
        "campaign",
        "platform",
        "market",
        "product",
        "segment",
        "attribution",
        "budgetVersion",
      ] as (keyof Filters)[]) {
        const value = params.get(key);
        if (value) restored[key] = value;
      }
      setFilters(restored);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  /* eslint-disable react-hooks/set-state-in-effect -- Synchronize abortable warehouse requests and their loading/error state. */
  useEffect(() => {
    const controller = new AbortController();
    setCatalogError(undefined);
    get<Catalog>("/api/catalog", controller.signal)
      .then(setCatalog)
      .catch((e) => {
        if (e.name !== "AbortError") setCatalogError(e);
      });
    return () => controller.abort();
  }, [retry]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const definition = REPORTS.find((r) => r.id === active)!;
  const query = new URLSearchParams({ report: active });
  for (const key of definition.filters)
    if (filters[key]) query.set(key, filters[key]!);
  const queryString = query.toString();
  /* eslint-disable react-hooks/set-state-in-effect -- Synchronize abortable warehouse requests and their loading/error state. */
  useEffect(() => {
    if (active === "schema" || active === "genie") {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setReport(undefined);
    setError(undefined);
    get<Report>(`/api/reports?${queryString}`, controller.signal)
      .then(setReport)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [queryString, retry, active]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const change = (id: string, next: Filters) => {
    const params = new URLSearchParams({ report: id });
    for (const [key, value] of Object.entries(next))
      if (value) params.set(key, value);
    window.history.pushState(null, "", `?${params}`);
    setActive(id);
    setFilters(next);
    setMenu(false);
  };
  const update = (key: keyof Filters, value: string) =>
    change(active, { ...filters, [key]: value || undefined });
  const filterOptions: {
    key: keyof Filters;
    label: string;
    options: Choice[];
  }[] = [
    { key: "campaign", label: "Campaigns", options: catalog?.campaigns ?? [] },
    { key: "platform", label: "Platforms", options: catalog?.platforms ?? [] },
    { key: "market", label: "Markets", options: catalog?.markets ?? [] },
    { key: "product", label: "Products", options: catalog?.products ?? [] },
    { key: "segment", label: "Segments", options: catalog?.segments ?? [] },
    {
      key: "attribution",
      label: "Attribution model / version",
      options: catalog?.attribution ?? [],
    },
    {
      key: "budgetVersion",
      label: "Budget version",
      options: catalog?.budgetVersions ?? [],
    },
  ];
  return (
    <div className="app-shell">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <a className="brand" href="/">
          <span className="brand-icon">M</span>
          <span>
            Marketing
            <br />
            <b>Intelligence</b>
          </span>
        </a>
        <div className="workspace-label">DATABRICKS · GOLD ANALYTICS</div>
        <nav aria-label="Reports">
          {[...new Set(REPORTS.map((r) => r.group))].map((group) => (
            <div key={group}>
              <p className="nav-group">{group}</p>
              {REPORTS.filter((r) => r.group === group).map((r, i) => (
                <button
                  key={r.id}
                  aria-current={active === r.id ? "page" : undefined}
                  onClick={() => change(r.id, filters)}
                >
                  <span className="nav-icon" aria-hidden="true">
                    {["◈", "▥", "◷", "◎"][i % 4]}
                  </span>
                  {r.title}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          47 gold tables · 735 columns
          <br />
          Source-aligned analytics
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="menu-toggle"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            ☰
          </button>
          <span>
            Marketing Intelligence{" "}
            <span className="muted">/ {definition.group}</span>
          </span>
          <span className="live-badge">
            {catalogError
              ? "Warehouse needs attention"
              : catalog
                ? "Live warehouse"
                : "Connecting…"}
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{definition.group}</p>
              <h1>{definition.title}</h1>
              <p className="muted">{definition.description}</p>
            </div>
            <span className="gold-badge">47 gold tables</span>
          </div>
          {definition.filters.length > 0 && (
            <section className="filters" aria-label="Report filters">
              <div className="filter-row">
                {definition.filters.includes("from") && (
                  <>
                    <label className="filter">
                      <span>From</span>
                      <input
                        aria-label="From date"
                        type="date"
                        value={filters.from ?? ""}
                        onChange={(e) => update("from", e.target.value)}
                      />
                    </label>
                    <label className="filter">
                      <span>To</span>
                      <input
                        aria-label="To date"
                        type="date"
                        value={filters.to ?? ""}
                        onChange={(e) => update("to", e.target.value)}
                      />
                    </label>
                  </>
                )}
                {filterOptions
                  .filter((f) => definition.filters.includes(f.key))
                  .map((f) => (
                    <SelectFilter
                      key={f.key}
                      name={f.key}
                      label={f.label}
                      options={f.options}
                      value={filters[f.key]}
                      onChange={(value) => update(f.key, value)}
                    />
                  ))}
                <button onClick={() => change(active, {})}>
                  Reset filters
                </button>
              </div>
              <p className="muted filter-help">
                Filters apply to this report. Campaign-level sources use
                campaign cohorts for platform selections.{" "}
                {filters.from || filters.to ? "" : "Showing all dates."}{" "}
                {catalog &&
                  `Available source dates: ${catalog.dateRange.min} – ${catalog.dateRange.max}.`}
              </p>
            </section>
          )}
          {catalogError && !error && active !== "schema" && (
            <ErrorBox
              failure={catalogError}
              retry={() => setRetry(retry + 1)}
            />
          )}{" "}
          {active === "schema" ? (
            <Explorer />
          ) : active === "genie" ? (
            <GenieChat />
          ) : (
            <>
              {error && (
                <ErrorBox failure={error} retry={() => setRetry(retry + 1)} />
              )}{" "}
              {loading && (
                <div role="status" className="loading">
                  <span className="spinner" />
                  Loading warehouse report…
                </div>
              )}
              {report && (
                <>
                  <div className="metric-grid">
                    {report.metrics.map((metric, i) => (
                      <article className="metric-card" key={i}>
                        <p>{metric.label}</p>
                        <strong>{format(metric.value, metric.format)}</strong>
                        {metric.note && <small>{metric.note}</small>}
                      </article>
                    ))}
                  </div>
                  <section className="notes" aria-label="Metric definitions">
                    {report.notes.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </section>
                  <div className="chart-grid">
                    {report.charts.map((chart, i) => (
                      <section className="panel" key={i}>
                        <h2>{chart.title}</h2>
                        <p className="muted panel-note">{chart.note}</p>
                        <div
                          className="chart-box"
                          role="img"
                          aria-label={`${chart.title} chart`}
                        >
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={chart.rows}
                              margin={{
                                top: 12,
                                right: 12,
                                left: 8,
                                bottom: 40,
                              }}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                vertical={false}
                              />
                              <XAxis
                                dataKey={chart.x}
                                tick={{ fontSize: 11 }}
                                interval={0}
                                angle={-20}
                                textAnchor="end"
                              />
                              <YAxis
                                tick={{ fontSize: 11 }}
                                tickFormatter={(value) =>
                                  compact.format(Number(value))
                                }
                              />
                              <Tooltip
                                formatter={(value) =>
                                  format(value, chart.format)
                                }
                              />
                              {chart.series.map((series) => (
                                <Bar
                                  key={series.key}
                                  dataKey={series.key}
                                  name={series.label}
                                  fill={series.color}
                                  radius={[4, 4, 0, 0]}
                                />
                              ))}
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </section>
                    ))}
                  </div>
                  {report.panels.map((panel, i) => (
                    <Grid panel={panel} key={i} />
                  ))}
                  <footer className="report-footer">
                    Read at {new Date(report.filteredAt).toLocaleString()} ·{" "}
                    {report.sources.length} source tables · Read-only warehouse
                    access
                  </footer>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
