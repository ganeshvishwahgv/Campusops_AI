import { connection } from "next/server";
import { authorizeTransport, privateJson } from "@/lib/auth/http";
import { complaintErrorResponse } from "@/lib/complaints/service";
import { listRepairs } from "@/lib/transport/breakdowns";

// Live repair progress for every broken bus, shared by all transport viewers.
export async function GET() {
  await connection();
  try {
    const { response } = await authorizeTransport();
    if (response) return response;
    return privateJson(await listRepairs());
  } catch (error) { return complaintErrorResponse(error); }
}
