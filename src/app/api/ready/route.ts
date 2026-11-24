import { withApiErrors } from "@/lib/server/api-errors";
import { assertReady } from "@/lib/server/readiness";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiErrors(async () =>
  Response.json(await assertReady(), {
    headers: { "Cache-Control": "no-store" },
  }),
);
