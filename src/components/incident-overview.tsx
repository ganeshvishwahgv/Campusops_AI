"use client";

import { useState } from "react";
import { AiBriefing } from "./ai-briefing";

export type OverviewIncident = {
  id: string; title: string; category: string; priority: string; status: string;
  locationText: string | null; buildingId: string | null; createdAt?: string;
  resolutionDueAt: string | null; assignee: { name: string } | null;
};
type OverviewRoom = { id: string; name: string; capacity: number; availability: string };
type OverviewBuilding = { id: string; name: string; rooms: OverviewRoom[] };

const label = "font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500";
const priorities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const priorityStyle: Record<string, { bar: string; text: string; icon: string }> = {
  CRITICAL: { bar: "bg-red-600", text: "text-red-700", icon: "▲" },
  HIGH: { bar: "bg-amber-500", text: "text-amber-800", icon: "◆" },
  MEDIUM: { bar: "bg-slate-500", text: "text-slate-600", icon: "●" },
  LOW: { bar: "bg-slate-300", text: "text-slate-500", icon: "○" },
};
const pipeline = ["REPORTED", "NEEDS_CLARIFICATION", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "RESOLVED", "CLOSED"];
const filters = ["Open", "Critical", "Blocked", "Unassigned", "Overdue", "Done", "All"] as const;
type Filter = (typeof filters)[number];

function readable(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function isOpenIncident(incident: { status: string }) {
  return !["RESOLVED", "CLOSED"].includes(incident.status);
}
function isOverdue(incident: OverviewIncident, now: number) {
  return isOpenIncident(incident) && Boolean(incident.resolutionDueAt && Date.parse(incident.resolutionDueAt) < now);
}
function age(value: string | undefined, now: number) {
  if (!value) return "";
  const hours = Math.max(0, (now - Date.parse(value)) / 3_600_000);
  return hours < 1 ? "just now" : hours < 48 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`;
}

function BarList({ title, rows, total }: { title: string; rows: { key: string; label: string; value: number; bar?: string; icon?: string }[]; total: number }) {
  return <section className="rounded-lg border border-slate-200 bg-white p-4">
    <h3 className="text-xs font-bold">{title}</h3>
    <ul className="mt-4 space-y-3">
      {rows.map((row) => <li key={row.key} title={`${row.label}: ${row.value}`} className="grid grid-cols-[minmax(90px,140px)_1fr_28px] items-center gap-3 text-[11px]">
        <span className="truncate text-slate-600">{row.icon && <span aria-hidden="true" className="mr-1">{row.icon}</span>}{row.label}</span>
        <span className="h-2 rounded-full bg-slate-100"><span className={`block h-2 rounded-full ${row.bar ?? "bg-[#142943]"}`} style={{ width: `${total ? Math.max(row.value ? 4 : 0, (row.value / total) * 100) : 0}%` }} /></span>
        <span className="text-right font-semibold text-[#172b46]">{row.value}</span>
      </li>)}
      {!rows.length && <li className="text-xs text-slate-500">No data yet.</li>}
    </ul>
  </section>;
}

export function IncidentOverview({ incidents, buildings, selectedId, onSelect, onRecoverRoom, onAskLens }: {
  incidents: OverviewIncident[]; buildings: OverviewBuilding[]; selectedId: string | null;
  onSelect: (id: string) => void; onRecoverRoom: (roomId: string) => void; onAskLens: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("Open");
  const [query, setQuery] = useState("");
  const [now] = useState(() => Date.now());
  const open = incidents.filter(isOpenIncident);
  const count = (predicate: (incident: OverviewIncident) => boolean) => incidents.filter(predicate).length;
  const tiles = [
    { name: "Open", value: open.length, tone: "" },
    { name: "Critical", value: count((item) => isOpenIncident(item) && item.priority === "CRITICAL"), tone: "text-red-700" },
    { name: "Blocked", value: count((item) => item.status === "BLOCKED"), tone: "text-red-700" },
    { name: "Unassigned", value: count((item) => isOpenIncident(item) && !item.assignee), tone: "text-amber-800" },
    { name: "Overdue", value: count((item) => isOverdue(item, now)), tone: "text-amber-800" },
    { name: "Resolved / closed", value: incidents.length - open.length, tone: "text-emerald-700" },
  ];

  const byCategory = Object.entries(open.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.category]: (acc[item.category] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, label: readable(key), value }));
  const byLocation = buildings.map((building) => ({ key: building.id, label: building.name, value: open.filter((item) => item.buildingId === building.id).length }))
    .filter((row) => row.value).sort((a, b) => b.value - a.value);
  const unlocated = open.filter((item) => !item.buildingId).length;
  if (unlocated) byLocation.push({ key: "none", label: "No location", value: unlocated });
  const downRooms = buildings.flatMap((building) => building.rooms.filter((room) => room.availability !== "AVAILABLE").map((room) => ({ ...room, building: building.name })));

  const matches = (item: OverviewIncident) => {
    switch (filter) {
      case "Open": return isOpenIncident(item);
      case "Critical": return isOpenIncident(item) && item.priority === "CRITICAL";
      case "Blocked": return item.status === "BLOCKED";
      case "Unassigned": return isOpenIncident(item) && !item.assignee;
      case "Overdue": return isOverdue(item, now);
      case "Done": return !isOpenIncident(item);
      default: return true;
    }
  };
  const shown = incidents
    .filter((item) => matches(item) && `${item.id} ${item.title} ${item.locationText ?? ""} ${item.category} ${item.assignee?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => priorities.indexOf(a.priority) - priorities.indexOf(b.priority) || Number(isOpenIncident(b)) - Number(isOpenIncident(a)));

  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      {tiles.map((tile) => <button key={tile.name} type="button"
        onClick={() => setFilter(tile.name === "Resolved / closed" ? "Done" : tile.name as Filter)}
        className={`rounded-lg border bg-white p-4 text-left transition hover:border-amber-400 ${filter === (tile.name === "Resolved / closed" ? "Done" : tile.name) ? "border-amber-400 ring-2 ring-amber-100" : "border-slate-200"}`}>
        <p className={label}>{tile.name}</p>
        <p className={`mt-2 text-3xl font-bold tracking-tight ${tile.value ? tile.tone : ""}`}>{tile.value}</p>
      </button>)}
    </div>

    <div className="grid gap-4 xl:grid-cols-2">
      <BarList title="Open incidents by priority" total={open.length}
        rows={priorities.map((priority) => ({ key: priority, label: readable(priority), value: open.filter((item) => item.priority === priority).length, bar: priorityStyle[priority].bar, icon: priorityStyle[priority].icon }))} />
      <BarList title="Workflow pipeline (all incidents)" total={incidents.length}
        rows={pipeline.map((status) => ({ key: status, label: readable(status), value: incidents.filter((item) => item.status === status).length })).filter((row) => row.value)} />
      <BarList title="Open incidents by issue type" total={open.length} rows={byCategory} />
      <BarList title="Hotspots by campus location" total={open.length} rows={byLocation} />
    </div>

    <AiBriefing onSelectIncident={onSelect} onAskLens={onAskLens} />

    {downRooms.length > 0 && <section className="rounded-lg border border-red-200 bg-red-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-xs font-bold text-red-800">Rooms out of service</h3><p className="mt-1 text-[11px] text-slate-600">Classes and events scheduled here need a new venue.</p></div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {downRooms.map((room) => <li key={room.id}><button type="button" onClick={() => onRecoverRoom(room.id)} className="rounded border border-red-200 bg-white px-3 py-2 text-left text-[11px] hover:border-violet-400">
          <span className="font-semibold">{room.name}</span><span className="text-slate-500"> · {readable(room.availability)} · {room.capacity} seats</span>
          <span className="ml-2 font-semibold text-violet-800">✦ Find replacement</span>
        </button></li>)}
      </ul>
    </section>}

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 className="text-sm font-bold">Incident board</h2>
          <p className="mt-1 text-[11px] text-slate-500">{shown.length} shown · sorted by priority</p>
        </div>
        <input aria-label="Search incidents" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, title, place, technician..."
          className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-amber-500 sm:w-64" />
      </div>
      <div role="tablist" aria-label="Incident filters" className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
        {filters.map((name) => <button key={name} role="tab" aria-selected={filter === name} type="button" onClick={() => setFilter(name)}
          className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${filter === name ? "border-[#142943] bg-[#142943] text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{name}</button>)}
      </div>
      <ul className="divide-y divide-slate-100">
        {shown.map((incident) => {
          const style = priorityStyle[incident.priority] ?? priorityStyle.MEDIUM;
          const overdue = isOverdue(incident, now);
          return <li key={incident.id}>
            <button type="button" onClick={() => onSelect(incident.id)} aria-pressed={selectedId === incident.id}
              className={`grid w-full gap-3 border-l-[3px] p-4 text-left sm:grid-cols-[minmax(0,1fr)_auto] ${selectedId === incident.id ? "border-amber-400 bg-amber-50/40" : "border-transparent hover:bg-slate-50"}`}>
              <div className="min-w-0">
                <p className="font-mono text-[9px] text-slate-400">{incident.id} · {readable(incident.category)}{incident.createdAt ? ` · ${age(incident.createdAt, now)}` : ""}</p>
                <p className="mt-1 truncate text-xs font-semibold">{incident.title}</p>
                <p className="mt-1 text-[10px] text-slate-500">{incident.locationText ?? "Location not specified"} · {incident.assignee?.name ?? <span className="text-amber-800">Unassigned</span>}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {overdue && <span className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700">⏱ Overdue</span>}
                <span className={`rounded border border-slate-200 px-2 py-1 text-[10px] font-semibold ${style.text}`}><span aria-hidden="true">{style.icon}</span> {readable(incident.priority)}</span>
                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600">{readable(incident.status)}</span>
              </div>
            </button>
          </li>;
        })}
        {!shown.length && <li className="p-6 text-sm text-slate-500">No incidents match this filter.</li>}
      </ul>
    </section>
  </div>;
}
