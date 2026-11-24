import { withApiErrors } from "@/lib/server/api-errors";
import { getCatalog } from "@/lib/server/catalog";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiErrors(async () =>
  Response.json(await getCatalog(), {
    headers: { "Cache-Control": "no-store" },
  }),
);
