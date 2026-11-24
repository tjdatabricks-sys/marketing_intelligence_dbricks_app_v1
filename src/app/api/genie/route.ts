import { withApiErrors } from "@/lib/server/api-errors";
import { askGenie } from "@/lib/server/genie";
import { WarehouseError } from "@/lib/server/warehouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrors(async (request) => {
  let body: { message?: unknown; conversationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    throw new WarehouseError(
      "Send a JSON body with a message field.",
      "GENIE_REQUEST",
      400,
    );
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message)
    throw new WarehouseError("Ask a question first.", "GENIE_EMPTY", 400);
  if (message.length > 8000)
    throw new WarehouseError(
      "The question is too long. Keep it under 8,000 characters.",
      "GENIE_TOO_LONG",
      400,
    );
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId
      ? body.conversationId
      : undefined;
  return Response.json(await askGenie(message, conversationId), {
    headers: { "Cache-Control": "no-store" },
  });
});
