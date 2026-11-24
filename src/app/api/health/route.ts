export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    { status: "healthy", service: "marketing-intelligence", schemaVersion: 1 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
