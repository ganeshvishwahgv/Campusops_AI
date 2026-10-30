import { connection } from "next/server";
import { db } from "@/lib/db";
import { privateJson } from "@/lib/auth/http";
import { authorizeComplaints, complaintErrorResponse, complaintSelect } from "@/lib/complaints/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { user, response } = await authorizeComplaints();
    if (response) return response;
    const { id } = await context.params;
    if (id.length > 100) return privateJson({ error: "Complaint not found." }, 404);
    // Identical response for an absent record and a record owned by someone else.
    const complaint = await db.incident.findFirst({ where: { id, reporterId: user.id }, select: complaintSelect });
    return complaint ? privateJson({ complaint }) : privateJson({ error: "Complaint not found." }, 404);
  } catch (error) { return complaintErrorResponse(error); }
}
