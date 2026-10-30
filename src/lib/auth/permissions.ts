import type { Role } from "@/generated/prisma/enums";

export const roleLabels: Record<Role, string> = {
  STUDENT: "Student",
  FACULTY: "Faculty",
  TECHNICIAN: "Technician",
  DEPARTMENT_MANAGER: "Department manager",
  FACILITIES_ADMIN: "Facilities admin",
  PROCUREMENT_APPROVER: "Procurement approver",
  SYSTEM_ADMIN: "System admin",
  TRANSPORT_ADMIN: "Transport admin",
};

// Deny by default until scoped modules and their backend policies exist.
export function canViewDashboard(role: string): boolean {
  return role === "FACILITIES_ADMIN" || role === "SYSTEM_ADMIN";
}

export const complaintRoles: Role[] = ["STUDENT", "FACULTY", "FACILITIES_ADMIN", "SYSTEM_ADMIN"];

export function canAccessComplaints(role: string): boolean {
  return complaintRoles.some((allowed) => allowed === role);
}

export function canAccessWorkOrders(role: string): boolean {
  return canViewDashboard(role) || role === "TECHNICIAN";
}

export function canAccessBookings(role: string): boolean {
  return canViewDashboard(role) || role === "FACULTY" || role === "DEPARTMENT_MANAGER";
}

// Transport admins run the fleet map, breakdown reports and rescue dispatch.
export function canManageTransport(role: string): boolean {
  return canViewDashboard(role) || role === "TRANSPORT_ADMIN";
}
