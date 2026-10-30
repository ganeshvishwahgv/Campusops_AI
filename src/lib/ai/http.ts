import "server-only";
import { privateJson } from "@/lib/auth/http";
import { complaintErrorResponse } from "@/lib/complaints/service";
import { aiRateLimited } from "./client";

export function aiThrottle(userId: string) {
  return aiRateLimited(userId)
    ? privateJson({ error: "Too many AI requests in the last minute. Please wait a moment." }, 429)
    : null;
}

export function aiErrorResponse(error: unknown) {
  return complaintErrorResponse(error);
}
