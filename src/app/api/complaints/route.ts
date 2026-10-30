import { connection } from "next/server";
import { checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { authorizeComplaints, complaintErrorResponse, listComplaints, submitComplaint } from "@/lib/complaints/service";
import { validateSubmissionKey } from "@/lib/complaints/validation";

export async function GET(request: Request) {
  await connection();
  try {
    const { user, response } = await authorizeComplaints();
    if (response) return response;
    return privateJson(await listComplaints(user.id, new URL(request.url).searchParams));
  } catch (error) { return complaintErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { user, response } = await authorizeComplaints();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const key = validateSubmissionKey(request.headers.get("Idempotency-Key"));
    const body = await readJsonBody(request, 24 * 1024);
    const result = await submitComplaint(user.id, key, body);
    return privateJson(result, result.replayed ? 200 : 201);
  } catch (error) { return complaintErrorResponse(error); }
}
