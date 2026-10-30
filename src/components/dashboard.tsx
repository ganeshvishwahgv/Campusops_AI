"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { roleLabels } from "@/lib/auth/permissions";
import { LogoutButton } from "@/components/logout-button";
import { NotificationBell } from "@/components/notification-bell";
import TransportPanel from "@/components/transport-panel";
import { IncidentOverview } from "@/components/incident-overview";
import { RoomRecovery } from "@/components/room-recovery";
import { OpsLens } from "@/components/ops-lens";
import { AiTriage } from "@/components/ai-triage";

type Room = {
  id: string;
  name: string;
  capacity: number;
  roomType: string;
  availability: string;
};

type Building = {
  id: string;
  code: string;
  name: string;
  mapX: number;
  mapY: number;
  rooms: Room[];
};

type Incident = {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  reportedUrgency?: string | null;
  status: string;
  locationText: string | null;
  summary: string | null;
  blockedReason: string | null;
  buildingId: string | null;
  roomId: string | null;
  busId: string | null;
  createdAt: string;
  resolutionDueAt: string | null;
  assignee: {
    name: string;
    department: string | null;
  } | null;
};

type Bus = {
  id: string;
  fleetCode: string;
  capacity: number;
  availability: string;
};

type DashboardData = {
  source: string;
  dataset: string;
  stats: {
    openIncidents: number;
    criticalIncidents: number;
    buildings: number;
    buses: number;
  };
  buildings: Building[];
  incidents: Incident[];
  buses: Bus[];
};

const views = ["Overview", "Campus map", "Room recovery", "Transportation", "OpsLens"] as const;
const fullWidthViews: View[] = ["Room recovery", "Transportation"];
type View = (typeof views)[number];

const label =
  "font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500";

function readable(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isOpen(incident: Incident) {
  return !["RESOLVED", "CLOSED"].includes(incident.status);
}

function priorityRank(priority: string) {
  const ranks: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };

  return ranks[priority] ?? 4;
}

function Badge({ value }: { value: string }) {
  const color = ["CRITICAL", "BLOCKED", "UNAVAILABLE"].includes(value)
    ? "border-red-200 bg-red-50 text-red-700"
    : ["HIGH", "REPORTED", "MAINTENANCE"].includes(value)
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : ["AVAILABLE", "RESOLVED", "CLOSED"].includes(value)
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span
      className={`inline-flex rounded border px-2 py-1 text-[10px] font-semibold ${color}`}
    >
      {readable(value)}
    </span>
  );
}

export default function Dashboard({ user }: { user: CurrentUser }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<View>("Overview");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>("INC-001");
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [recoveryRoom, setRecoveryRoom] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/dashboard", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          setData(null);
          window.location.replace(response.status === 401 ? "/login?expired=1" : "/");
          return;
        }

        if (!response.ok) {
          throw new Error(`Database request failed (${response.status}).`);
        }

        const result: DashboardData = await response.json();

        if (
          result.source !== "database" ||
          !result.stats ||
          !Array.isArray(result.buildings) ||
          !Array.isArray(result.incidents) ||
          !Array.isArray(result.buses)
        ) {
          throw new Error("Unexpected dashboard response.");
        }

        if (!controller.signal.aborted) setData(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load campus records."
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const revalidate = () => setRevision((value) => value + 1);
    const onVisibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    document.addEventListener("visibilitychange", onVisibility);
    // Recheck even while an untouched dashboard remains open.
    const timer = window.setInterval(revalidate, 60_000);
    return () => {
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, []);

  const buildings = data?.buildings ?? [];
  const incidents = data?.incidents ?? [];
  const buses = data?.buses ?? [];

  const selected = incidents.find((item) => item.id === selectedId);
  const selectedLocation = buildings.find(
    (item) => item.id === selectedBlock
  );

  const displayedIncidents = incidents
    .filter((item) => {
      const searchable =
        `${item.id} ${item.title} ${item.locationText ?? ""} ${item.category}`;

      return (
        (!selectedBlock || item.buildingId === selectedBlock) &&
        searchable.toLowerCase().includes(query.toLowerCase())
      );
    })
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));

  function changeView(next: View) {
    setView(next);
    setSelectedBlock(null);
    setQuery("");
  }

  function chooseLocation(id: string) {
    setSelectedBlock(id);
    setQuery("");

    const related = incidents
      .filter((item) => item.buildingId === id)
      .sort((a, b) => {
        if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
        return priorityRank(a.priority) - priorityRank(b.priority);
      });

    setSelectedId(related[0]?.id ?? null);
  }

  function chooseIncident(incident: Incident) {
    setSelectedId(incident.id);
  }

  function recoverRoom(roomId: string) {
    setRecoveryRoom(roomId);
    setView("Room recovery");
  }

  const stats = [
    ["OPEN INCIDENTS", data?.stats.openIncidents],
    ["CRITICAL", data?.stats.criticalIncidents],
    ["CAMPUS LOCATIONS", data?.stats.buildings],
    ["FLEET VEHICLES", data?.stats.buses],
  ];

  return (
    <main className="min-h-screen bg-white font-sans text-[#172b46]">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 bg-[#142943] px-5 py-3 text-white">
        <div className="flex items-center gap-5">
          <span className="text-lg font-black tracking-tight">
            CAMPUS<span className="text-amber-400">/</span>OPS
          </span>
          <div className="hidden border-l border-white/20 pl-5 md:block">
            <p className="text-xs font-semibold">
              Easwari Engineering College
            </p>
            <p className="mt-1 font-mono text-[9px] tracking-[0.15em] text-slate-300">
              OPERATIONS & RECOVERY WORKSPACE
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="hidden rounded bg-amber-400 px-3 py-2 text-[10px] font-bold tracking-wider text-[#142943] sm:block">
            DEMO OPERATIONS
          </span>
          <div className="text-right">
            <p className="text-xs font-semibold">{user.name}</p>
            <p className="mt-1 text-[10px] text-slate-300">{roleLabels[user.role]}</p>
          </div>
          <NotificationBell /><LogoutButton />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-7 gap-y-3 border-b border-slate-200 px-5 py-3">
        {stats.map(([name, value]) => (
          <div key={String(name)} className="flex items-baseline gap-2">
            <span className="text-lg font-bold">{value ?? "—"}</span>
            <span className={label}>{name}</span>
          </div>
        ))}

        <div className="ml-auto flex items-center gap-3">
          <span
            aria-live="polite"
            className={`font-mono text-[10px] ${
              error ? "text-red-600" : "text-emerald-700"
            }`}
          >
            {loading
              ? "LOADING RECORDS"
              : error
                ? "REFRESH FAILED"
                : "DATABASE CONNECTED"}
          </span>
          <button
            onClick={() => setRevision((value) => value + 1)}
            disabled={loading}
            className="rounded border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-40"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border-b border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700"
        >
          {error} Check the server terminal and click Refresh.
          {data && " Previously loaded records remain visible."}
        </div>
      )}

      <div className={`grid min-h-[calc(100vh-118px)] ${fullWidthViews.includes(view) ? "lg:grid-cols-[185px_minmax(0,1fr)]" : "lg:grid-cols-[185px_minmax(0,1fr)_290px]"}`}>
        <aside className="flex flex-col border-b border-slate-200 bg-white lg:border-r lg:border-b-0">
          <p className={`${label} px-5 pt-6 pb-4`}>Workspace</p>

          <nav
            aria-label="Dashboard navigation"
            className="flex flex-wrap lg:block"
          >
            {views.map((item, index) => (
              <button
                key={item}
                onClick={() => changeView(item)}
                aria-current={view === item ? "page" : undefined}
                className={`flex items-center gap-3 border-l-[3px] px-5 py-4 text-left text-xs transition lg:w-full ${
                  view === item
                    ? "border-amber-400 bg-[#f5f4f0] font-bold"
                    : "border-transparent text-slate-500 hover:bg-slate-50"
                }`}
              >
                <span className="font-mono text-[10px] text-slate-400">
                  0{index + 1}
                </span>
                {item}
                {(item === "Room recovery" || item === "OpsLens") && <span aria-hidden="true" className="ml-auto text-violet-700">✦</span>}
              </button>
            ))}
            <Link href="/complaints" prefetch={false} className="flex items-center gap-3 border-l-[3px] border-transparent px-5 py-4 text-left text-xs font-semibold text-amber-800 hover:bg-amber-50 lg:w-full">
              <span className="font-mono text-[10px] text-slate-400">06</span>
              My complaints
            </Link>
            <Link href="/work-orders" prefetch={false} className="flex items-center gap-3 border-l-[3px] border-transparent px-5 py-4 text-left text-xs font-semibold text-amber-800 hover:bg-amber-50 lg:w-full">
              <span className="font-mono text-[10px] text-slate-400">07</span>
              Work orders
            </Link>
            <Link href="/bookings" prefetch={false} className="flex items-center gap-3 border-l-[3px] border-transparent px-5 py-4 text-left text-xs font-semibold text-amber-800 hover:bg-amber-50 lg:w-full">
              <span className="font-mono text-[10px] text-slate-400">08</span>
              Room bookings
            </Link>
          </nav>

          <div className="mt-6 hidden border-t border-slate-100 px-4 pt-5 lg:block">
            <p className={`${label} mb-3`}>Campus locations</p>
            {buildings.map((location) => (
              <button
                key={location.id}
                onClick={() => {
                  setView("Campus map");
                  chooseLocation(location.id);
                }}
                className={`mb-1 block w-full rounded px-2 py-2 text-left text-[11px] ${
                  selectedBlock === location.id
                    ? "bg-amber-50 font-semibold text-amber-800"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {location.name}
              </button>
            ))}
          </div>

          <div className="mt-auto hidden px-5 py-7 lg:block">
            <div className="mb-5 h-px bg-slate-200" />
            <p className="font-mono text-[10px] leading-5 tracking-wider">
              AI ASSISTS.
              <br />
              RULES VALIDATE.
              <br />
              <span className="text-amber-700">PEOPLE APPROVE.</span>
            </p>
          </div>
        </aside>

        <section className="min-w-0 bg-[#fafaf8] p-4 xl:p-6">
          <div className="mb-5">
            <p className={label}>Easwari / Campus operations</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">
              {view === "Overview" ? "Campus command centre" : view}
            </h1>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {view === "Overview" ? "Live incident picture with an AI shift briefing" : view === "Campus map" ? "Real campus names · Illustrative map · Demo records and submitted complaints" : view === "Room recovery" ? "AI-assisted relocation when a classroom or venue is unavailable" : view === "OpsLens" ? "Ask questions about live campus operations" : "Simulated fleet with rule-checked rescue and AI dispatch briefs"}
            </p>
          </div>

          {!data ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
              {loading ? "Loading campus records..." : "Campus data is unavailable."}
            </div>
          ) : view === "Overview" ? (
            <IncidentOverview incidents={incidents} buildings={buildings} selectedId={selectedId}
              onSelect={setSelectedId} onRecoverRoom={recoverRoom} onAskLens={() => changeView("OpsLens")} />
          ) : view === "Room recovery" ? (
            <RoomRecovery key={recoveryRoom ?? "default"} initialRoomId={recoveryRoom}
              rooms={buildings.flatMap((building) => building.rooms.map((room) => ({ ...room, building: building.name })))} />
          ) : view === "OpsLens" ? (
            <OpsLens onSelectIncident={setSelectedId} />
          ) : view === "Campus map" ? (
            <>
              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div>
                    <h2 className="text-xs font-semibold">Campus incident map</h2>
                    <p className="mt-1 text-[10px] text-slate-400">
                      Select a numbered pin to inspect that location
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      aria-label="Zoom out"
                      disabled={zoom <= 1}
                      onClick={() =>
                        setZoom((value) => Math.max(1, value - 0.25))
                      }
                      className="rounded border border-slate-200 px-3 py-1 text-sm disabled:opacity-30"
                    >
                      −
                    </button>
                    <button
                      onClick={() => setZoom(1)}
                      className="rounded border border-slate-200 px-3 py-1 text-[10px]"
                    >
                      {Math.round(zoom * 100)}%
                    </button>
                    <button
                      aria-label="Zoom in"
                      disabled={zoom >= 2}
                      onClick={() =>
                        setZoom((value) => Math.min(2, value + 0.25))
                      }
                      className="rounded border border-slate-200 px-3 py-1 text-sm disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                </div>

                {imageFailed ? (
                  <div role="alert" className="p-8 text-sm leading-7 text-red-700">
                    Map image not found. Check that campus-map.png is inside
                    your project’s public folder, then reload this page.
                  </div>
                ) : (
                  <div className="max-h-[650px] overflow-auto">
                    <div
                      className="relative"
                      style={{ width: `${zoom * 100}%` }}
                    >
                      {/* Standard image keeps overlays aligned to its dimensions. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/campus-map.png"
                        alt="Illustrated Easwari campus with Main, Academic, Civil, Mechanical and Admin blocks, Open Air Theatre, and bus stops"
                        onError={() => setImageFailed(true)}
                        className="block h-auto w-full"
                      />

                      {buildings.map((location) => {
                        const related = incidents.filter(
                          (incident) =>
                            incident.buildingId === location.id &&
                            isOpen(incident)
                        );
                        const critical = related.some(
                          (incident) => incident.priority === "CRITICAL"
                        );
                        const active = selectedBlock === location.id;
                        const color = critical
                          ? "bg-red-600"
                          : related.length
                            ? "bg-amber-500"
                            : "bg-emerald-600";

                        return (
                          <button
                            key={location.id}
                            onClick={() => chooseLocation(location.id)}
                            aria-label={`${location.name}: ${related.length} open incidents`}
                            aria-pressed={active}
                            title={`${location.name} · ${related.length} open incidents`}
                            style={{
                              left: `${location.mapX}%`,
                              top: `${location.mapY}%`,
                            }}
                            className={`absolute z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-white text-xs font-bold text-white shadow-lg transition hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy-900 ${color} ${
                              active ? "ring-4 ring-[#142943]/35" : ""
                            }`}
                          >
                            {related.length}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-4 border-t border-slate-200 px-4 py-3 text-[10px] text-slate-500">
                  <span><span className="text-red-600">●</span> Critical</span>
                  <span><span className="text-amber-500">●</span> Open incident</span>
                  <span><span className="text-emerald-600">●</span> No open incidents</span>
                  <span className="ml-auto">Numbers = open incident counts</span>
                </div>
              </section>

              {selectedLocation && (
                <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={label}>Selected location</p>
                      <h2 className="mt-2 text-sm font-bold">{selectedLocation.name}</h2>
                    </div>
                    <button
                      onClick={() => setSelectedBlock(null)}
                      className="text-xs font-semibold text-amber-700 hover:underline"
                    >
                      Show all locations
                    </button>
                  </div>

                  {selectedLocation.rooms.length ? (
                    <div className="mt-3 divide-y divide-slate-100">
                      {selectedLocation.rooms.map((room) => (
                        <div
                          key={room.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-3"
                        >
                          <div>
                            <p className="text-xs font-semibold">{room.name}</p>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {room.capacity} demo seats · {readable(room.roomType)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {room.availability !== "AVAILABLE" && <button type="button" onClick={() => recoverRoom(room.id)} className="text-[11px] font-semibold text-violet-800 hover:underline">✦ Find replacement</button>}
                            <Badge value={room.availability} />
                          </div>
                        </div>
                      ))}
                      <p className="pt-3 text-[10px] leading-5 text-slate-400">
                        Room condition only. Use Room recovery to check bookings and find a replacement.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500">
                      No indoor rooms registered for this location.
                    </p>
                  )}
                </section>
              )}

              <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
                  <h2 className="text-sm font-bold">
                    {selectedLocation
                      ? `${selectedLocation.name} incidents`
                      : "Incident queue"}
                  </h2>
                  <input
                    aria-label="Search incidents"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search incidents..."
                    className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-amber-500 sm:w-48"
                  />
                </div>

                <div className="divide-y divide-slate-100">
                  {displayedIncidents.map((incident) => (
                    <button
                      key={incident.id}
                      onClick={() => chooseIncident(incident)}
                      aria-pressed={selectedId === incident.id}
                      className={`flex w-full flex-wrap items-center justify-between gap-3 border-l-[3px] p-4 text-left ${
                        selectedId === incident.id
                          ? "border-amber-400 bg-amber-50/40"
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div>
                        <p className="font-mono text-[9px] text-slate-400">
                          {incident.id} / {incident.category}
                        </p>
                        <p className="mt-1 text-xs font-semibold">{incident.title}</p>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {incident.locationText ?? "Location not specified"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge value={incident.priority} />
                        <Badge value={incident.status} />
                      </div>
                    </button>
                  ))}

                  {!displayedIncidents.length && (
                    <p className="p-6 text-sm text-slate-500">
                      No incidents match this selection.
                    </p>
                  )}
                </div>
              </section>
            </>
          ) : (
            <>
            <TransportPanel />
            <details className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <summary className="cursor-pointer px-5 py-4 text-xs font-semibold">Saved campus vehicle records</summary>
              <div className="border-b border-slate-200 p-4">
                <h2 className="text-sm font-bold">College bus fleet</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  These saved vehicle records are separate from the moving simulation above.
                </p>
              </div>

              <div className="divide-y divide-slate-100">
                {buses.map((bus) => {
                  const related = incidents.filter(
                    (incident) => incident.busId === bus.id && isOpen(incident)
                  );

                  return (
                    <article key={bus.id} className="p-5">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <p className="font-mono text-xs font-bold">{bus.fleetCode}</p>
                          <p className="mt-2 text-xs text-slate-500">
                            {bus.capacity} seats
                          </p>
                        </div>
                        <Badge value={bus.availability} />
                      </div>

                      {related.map((incident) => (
                        <button
                          key={incident.id}
                          onClick={() => { chooseIncident(incident); setView("Overview"); }}
                          className="mt-3 block text-left text-xs font-semibold text-amber-700 hover:underline"
                        >
                          Inspect {incident.id}: {incident.title} →
                        </button>
                      ))}
                    </article>
                  );
                })}

                {!buses.length && (
                  <p className="p-5 text-sm text-slate-500">
                    No vehicles registered.
                  </p>
                )}
              </div>

              <div className="border-t border-slate-200 p-4">
                <button
                  onClick={() => {
                    setView("Campus map");
                    chooseLocation("T");
                  }}
                  className="rounded bg-[#142943] px-4 py-2 text-xs font-semibold text-white"
                >
                  View bus stops on map →
                </button>
              </div>
            </details>
            </>
          )}

          {view === "Campus map" && <p className="mt-5 font-mono text-[9px] leading-5 tracking-wide text-slate-400">
            ILLUSTRATIVE LOCATION PINS · NOT LIVE GPS · REFRESH TO FETCH DATABASE CHANGES
          </p>}
        </section>

        {!fullWidthViews.includes(view) && <aside className="border-t border-slate-200 bg-white lg:border-t-0 lg:border-l">
          <div className="border-b border-slate-200 p-4">
            <p className={label}>Incident inspector</p>
          </div>

          {selected ? (
            <div className="p-5">
              <p className={label}>Selected incident</p>
              <h2 className="mt-2 break-all font-mono text-lg font-bold">{selected.id}</h2>
              <p className="mt-3 text-sm font-semibold leading-6">{selected.title}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge value={selected.priority} />
                <Badge value={selected.status} />
              </div>

              <dl className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
                {[
                  ["Location", selected.locationText ?? "Not specified"],
                  ["Category", readable(selected.category)],
                  ["Reported urgency", selected.reportedUrgency ? readable(selected.reportedUrgency) : "Not recorded"],
                  ["Operations priority", readable(selected.priority)],
                  ["Assigned technician", selected.assignee ? `${selected.assignee.name}${selected.assignee.department ? ` · ${selected.assignee.department}` : ""}` : "Unassigned"],
                  [
                    "Resolution deadline",
                    selected.resolutionDueAt
                      ? new Date(selected.resolutionDueAt).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        }) + " IST"
                      : "Not configured",
                  ],
                ].map(([name, value]) => (
                  <div key={name} className="py-3">
                    <dt className={label}>{name}</dt>
                    <dd className="mt-1 text-xs leading-5">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-6">
                <h3 className={label}>Reported details</h3>
                <p className="mt-3 text-xs leading-6 text-slate-600">
                  {selected.description}
                </p>
              </div>

              {selected.summary && (
                <div className="mt-6">
                  <h3 className={label}>Saved summary</h3>
                  <p className="mt-3 text-xs leading-6 text-slate-600">
                    {selected.summary}
                  </p>
                </div>
              )}

              {selected.blockedReason && (
                <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-4">
                  <h3 className="font-mono text-[10px] font-bold text-amber-800">
                    WORK BLOCKED
                  </h3>
                  <p className="mt-2 text-xs leading-6 text-slate-600">
                    {selected.blockedReason}
                  </p>
                </div>
              )}

              <AiTriage incidentId={selected.id} onSelectIncident={setSelectedId} />

              <Link href={`/work-orders?incident=${encodeURIComponent(selected.id)}`} prefetch={false} className="mt-6 block rounded bg-[#142943] px-4 py-3 text-center text-xs font-semibold text-white hover:bg-[#203e61]">
                Review and manage work
              </Link>
              <p className="mt-4 border-t border-slate-200 pt-4 text-[10px] leading-5 text-slate-400">
                Review, assignment, and status updates are available in work orders. AI suggestions are advisory; work-order rules still validate every change.
              </p>
            </div>
          ) : (
            <p className="p-5 text-sm leading-6 text-slate-500">
              {selectedLocation
                ? `No incident selected for ${selectedLocation.name}.`
                : "Select an incident to inspect its saved details."}
            </p>
          )}
        </aside>}
      </div>
    </main>
  );
}
