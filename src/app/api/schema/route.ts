import { schemaContract } from "@/lib/server/explorer";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(schemaContract());
}
