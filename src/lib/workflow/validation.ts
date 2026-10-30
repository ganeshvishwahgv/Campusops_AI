import { categoryOptions, urgencyOptions } from "@/lib/complaints/types";
import { ComplaintError } from "@/lib/complaints/validation";
import { workflowActions, type WorkflowAction } from "./types";

export class WorkflowError extends ComplaintError {}
export function expectedVersion(input: unknown): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0 || input >= 2147483647) {
    throw new WorkflowError(400, "A valid current version is required. Refresh and try again.");
  }
  return input;
}

export function validateAction(body: Record<string, unknown>) {
  if (!workflowActions.some((action) => action === body.action)) throw new WorkflowError(400, "Choose a supported workflow action.");
  const action = body.action as WorkflowAction;
  const allowed = new Set(["action", "expectedVersion", "note", ...(action === "TRIAGE" ? ["category", "priority"] : action === "ASSIGN" ? ["assigneeId"] : [])]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new WorkflowError(400, "Unsupported fields in this workflow action.");
  if (typeof body.note !== "string" || body.note.trim().length < 5 || body.note.trim().length > 2000) throw new WorkflowError(400, "Write an update of 5–2,000 characters. It will be visible to the reporter.");
  const version = expectedVersion(body.expectedVersion);
  if (action === "TRIAGE" && (!categoryOptions.some((item) => item.value === body.category) || !urgencyOptions.some((item) => item.value === body.priority))) throw new WorkflowError(400, "Select a valid issue category and operations priority.");
  if (action === "ASSIGN" && (typeof body.assigneeId !== "string" || !body.assigneeId.trim() || body.assigneeId.length > 100)) throw new WorkflowError(400, "Select a technician.");
  return {
    action, expectedVersion: version, note: body.note.trim(),
    ...(action === "TRIAGE" ? {
      category: body.category as typeof categoryOptions[number]["value"],
      priority: body.priority as typeof urgencyOptions[number]["value"],
    } : {}),
    ...(action === "ASSIGN" ? { assigneeId: (body.assigneeId as string).trim() } : {}),
  };
}

export function validateProfile(body: Record<string, unknown>) {
  const allowed = new Set(["expectedVersion", "skills", "onDuty", "maxActiveJobs", "availableFrom", "availableUntil"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new WorkflowError(400, "Unsupported workforce fields.");
  const version = expectedVersion(body.expectedVersion);
  if (!Array.isArray(body.skills) || !body.skills.length || body.skills.length > categoryOptions.length ||
    body.skills.some((skill) => !categoryOptions.some((item) => item.value === skill)) || new Set(body.skills).size !== body.skills.length) {
    throw new WorkflowError(400, "Choose one or more distinct skill categories.");
  }
  if (typeof body.onDuty !== "boolean" || typeof body.maxActiveJobs !== "number" || !Number.isInteger(body.maxActiveJobs) || body.maxActiveJobs < 1 || body.maxActiveJobs > 20) throw new WorkflowError(400, "Choose duty status and a workload limit from 1 to 20.");
  function date(input: unknown) {
    if (input === null || input === undefined || input === "") return null;
    if (typeof input !== "string" || input.length > 40 || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input) || !Number.isFinite(new Date(input).getTime())) throw new WorkflowError(400, "Availability dates must include a timezone.");
    return new Date(input);
  }
  const availableFrom = date(body.availableFrom);
  const availableUntil = date(body.availableUntil);
  if (availableFrom && availableUntil && availableUntil <= availableFrom) throw new WorkflowError(400, "Availability must end after it starts.");
  return { expectedVersion: version, skills: (body.skills as string[]).slice().sort(), onDuty: body.onDuty, maxActiveJobs: body.maxActiveJobs, availableFrom, availableUntil };
}
