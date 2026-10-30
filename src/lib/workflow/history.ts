import "server-only";

// This projection is also safe for the reporter of the related complaint.
// Actor IDs, request hashes/keys and internal version bookkeeping stay private.
export const historySelect = {
  id: true, action: true, note: true, fromStatus: true, toStatus: true,
  fromCategory: true, toCategory: true, fromPriority: true, toPriority: true,
  fromAssigneeName: true, toAssigneeName: true,
  actorName: true, actorRole: true, createdAt: true,
} as const;

export const historyQuery = {
  select: historySelect,
  orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
  take: 100,
};
