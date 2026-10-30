import { connection } from "next/server";
import { db } from "@/lib/db";
import { privateJson } from "@/lib/auth/http";
import { authorizeWorkflow, technicians, workflowErrorResponse } from "@/lib/workflow/service";

export async function GET() {
  await connection();
  try {
    const { response } = await authorizeWorkflow(true);
    if (response) return response;
    return privateJson({ technicians: await db.$transaction((tx) => technicians(tx)) });
  } catch (error) { return workflowErrorResponse(error); }
}
