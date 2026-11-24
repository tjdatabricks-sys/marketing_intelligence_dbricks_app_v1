import { withApiErrors } from "@/lib/server/api-errors";
import { parseFilters } from "@/lib/server/request";
import { loadReport } from "@/lib/server/reports";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiErrors(async (request) => {
  const id = new URL(request.url).searchParams.get("report") ?? "overview";
  return Response.json(await loadReport(id, parseFilters(request, id)), {
    headers: { "Cache-Control": "no-store" },
  });
});
