import { connection } from "next/server";
import { privateJson } from "@/lib/auth/http";
import { authorizeWorkflow, listWorkOrders, workflowErrorResponse } from "@/lib/workflow/service";

export async function GET(request: Request) {
  await connection();
  try {
    const { user, response } = await authorizeWorkflow();
    if (response) return response;
    return privateJson(await listWorkOrders(user, new URL(request.url).searchParams));
  } catch (error) { return workflowErrorResponse(error); }
}
