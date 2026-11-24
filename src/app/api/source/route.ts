import { withApiErrors } from "@/lib/server/api-errors";
import { explore, exportPage } from "@/lib/server/explorer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiErrors(async (request) => {
  const params = new URL(request.url).searchParams,
    table = params.get("table") ?? "",
    offset = Number(params.get("offset") ?? 0),
    limit = Number(params.get("limit") ?? 50);
  if (params.get("format") === "csv")
    return new Response(await exportPage(table, offset, limit), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${table}-${offset}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  return Response.json(await explore(table, offset, limit), {
    headers: { "Cache-Control": "no-store" },
  });
});
