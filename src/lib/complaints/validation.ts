import { categoryOptions, urgencyOptions } from "./types";

export class ComplaintError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

const allowedFields = new Set(["title", "description", "category", "reportedUrgency", "buildingId", "roomId", "assetId", "busId", "locationDetails"]);

export function validateComplaint(body: Record<string, unknown>) {
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    throw new ComplaintError(400, "The submission contains unsupported fields.");
  }
  const fields: Record<string, string> = {};
  function text(key: string, min: number, max: number) {
    const input = body[key];
    if (typeof input !== "string") {
      fields[key] = `Enter ${key === "locationDetails" ? "location details" : key}.`;
      return "";
    }
    const value = input.trim();
    if (value.length < min || value.length > max) fields[key] = `Use ${min}–${max} characters.`;
    return value;
  }
  function optionalId(key: string) {
    if (body[key] === undefined || body[key] === null || body[key] === "") return null;
    return text(key, 1, 100);
  }
  const title = text("title", 5, 120);
  const description = text("description", 20, 4000);
  const buildingId = text("buildingId", 1, 100);
  const roomId = optionalId("roomId");
  const assetId = optionalId("assetId");
  const busId = optionalId("busId");
  const locationDetails = body.locationDetails === undefined ? "" : text("locationDetails", 0, 200);
  const category = body.category;
  const reportedUrgency = body.reportedUrgency;
  if (!categoryOptions.some((option) => option.value === category)) fields.category = "Choose an issue type.";
  if (!urgencyOptions.some((option) => option.value === reportedUrgency)) fields.reportedUrgency = "Choose the reported urgency.";
  if (assetId && !roomId) fields.assetId = "Select a room before choosing equipment.";
  if (busId && category !== "TRANSPORT") fields.busId = "Choose Transportation to report a bus issue.";
  if (Object.keys(fields).length) throw new ComplaintError(400, "Check the highlighted complaint details.", fields);
  return {
    title, description, category: category as typeof categoryOptions[number]["value"],
    reportedUrgency: reportedUrgency as typeof urgencyOptions[number]["value"],
    buildingId, roomId, assetId, busId, locationDetails,
  };
}

export function validateSubmissionKey(key: string | null): string {
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new ComplaintError(400, "The submission reference is missing or invalid. Refresh the form and try again.");
  }
  return key.toLowerCase();
}
