"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { COLLEGE, INITIAL_FLEET, stepBus, type Bus } from "@/lib/transport/fleet";
import { repairPhase, rideProgress, type Repair, type RepairPhase } from "@/lib/transport/repair";
import type { TechnicianMarker } from "./fleet-map";
import type { RescuePlan } from "@/lib/transport/rescue";
import type { TransportBrief } from "@/lib/ai/types";
import { complaintRequest, requestError } from "./complaint-shared";
import { AiButton, AiSource } from "./ai-shared";

const FleetMap = dynamic(() => import("./fleet-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center text-sm text-slate-500">
      Loading map...
    </div>
  ),
});

type LogEntry = { at: string; text: string };

function clock() {
  return new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Advance every bus one tick and board passengers when a rescue bus reaches its target. */
function tick(fleet: Bus[], log: (text: string) => void): Bus[] {
  let next = fleet.map(stepBus);
  for (const helper of next) {
    const target = helper.rescueTarget;
    if (helper.status !== "RESCUING" || !target || helper.lat !== target.lat || helper.lng !== target.lng) continue;
    const broken = next.find((bus) => bus.id === target.busId);
    const seats = Math.max(0, Math.min(target.seats, broken?.occupied ?? 0, helper.capacity - helper.occupied));
    next = next.map((bus) =>
      bus.id === helper.id ? { ...bus, status: "RUNNING" as const, occupied: bus.occupied + seats, rescueTarget: undefined }
        : bus.id === target.busId ? { ...bus, occupied: bus.occupied - seats } : bus);
    log(`${helper.name} picked up ${seats} students from ${broken?.name ?? "the broken bus"}.`);
  }
  return next;
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/**
 * Apply shared repair records on top of this browser's simulation, so every viewer sees
 * the same broken bus, the technician's ride and the repaired bus driving back.
 */
function applyRepairs(fleet: Bus[], repairs: Repair[], now: number, released: Set<string>, log: (text: string) => void): Bus[] {
  if (!repairs.length) return fleet;
  return fleet.map((bus) => {
    const repair = repairs.find((item) => item.busId === bus.id && !released.has(item.id));
    if (!repair) return bus;
    const phase = repairPhase(repair, now);
    if (phase === "BACK_AT_COLLEGE") {
      released.add(repair.id);
      log(`✔ ${bus.name} is back at college after repair by ${repair.technician ?? "the technician"}.`);
      return { ...bus, status: "RUNNING", lat: COLLEGE.lat, lng: COLLEGE.lng, wp: 0, occupied: 0, rescueTarget: undefined };
    }
    if (phase === "RETURNING") {
      const t = rideProgress(repair.resolvedAt, repair.travelMs, now);
      return { ...bus, status: "RETURNING", lat: lerp(repair.lat, COLLEGE.lat, t), lng: lerp(repair.lng, COLLEGE.lng, t), rescueTarget: undefined };
    }
    return bus.status === "RESCUING" ? bus : { ...bus, status: "BREAKDOWN", lat: repair.lat, lng: repair.lng };
  });
}

const phaseText: Record<RepairPhase, (repair: Repair, now: number) => string> = {
  AWAITING_TECHNICIAN: (r) => `Repair work order ${r.incidentId} sent to operations. Waiting for an admin to assign a technician.`,
  ASSIGNED: (r) => `${r.technician} is assigned and will ride out when they start the job.`,
  TECHNICIAN_EN_ROUTE: (r, now) => `🛵 ${r.technician} is riding out on a scooter, arriving in about ${Math.max(1, Math.round((Date.parse(r.startedAt!) + r.travelMs - now) / 1000))} s.`,
  REPAIRING: (r) => `🔧 ${r.technician} is at the bus, repairing it.`,
  RETURNING: (r, now) => `✔ Repaired by ${r.technician}. Driving back to college, about ${Math.max(1, Math.round((Date.parse(r.resolvedAt!) + r.travelMs - now) / 1000))} s to go.`,
  BACK_AT_COLLEGE: () => "Back at college and in service.",
};

export default function TransportPanel({ canAssign = false }: { canAssign?: boolean }) {
  const [fleet, setFleet] = useState<Bus[]>(INITIAL_FLEET);
  const [plans, setPlans] = useState<Record<string, RescuePlan>>({});
  const [dispatched, setDispatched] = useState<string[]>([]);
  const [briefs, setBriefs] = useState<Record<string, TransportBrief>>({});
  const [selected, setSelected] = useState(INITIAL_FLEET[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [randomBreakdowns, setRandomBreakdowns] = useState(false);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(fleet);
  useEffect(() => { latest.current = fleet; }, [fleet]);
  const repairsRef = useRef<Repair[]>([]);
  const offset = useRef(0);
  const released = useRef(new Set<string>());
  const phases = useRef(new Map<string, RepairPhase>());
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Keep the interval's view of the fleet in step with user actions.
  function commit(next: Bus[]) {
    latest.current = next;
    setFleet(next);
  }

  function log(text: string) {
    setEvents((list) => [{ at: clock(), text }, ...list].slice(0, 40));
  }

  // Live movement simulation; shared repair progress keeps moving even while paused.
  useEffect(() => {
    const t = setInterval(() => {
      const arrivals: string[] = [];
      const serverNow = Date.now() + offset.current;
      const stepped = pausedRef.current ? latest.current : tick(latest.current, (text) => arrivals.push(text));
      const next = applyRepairs(stepped, repairsRef.current, serverNow, released.current, (text) => arrivals.push(text));
      latest.current = next;
      setFleet(next);
      setNow(serverNow);
      if (arrivals.length) setEvents((list) => [...arrivals.map((text) => ({ at: clock(), text })), ...list].slice(0, 40));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Poll shared repair records (work orders drive them: assign → start → resolve).
  const loadRepairs = useCallback(async () => {
    try {
      const result = await complaintRequest<{ repairs: Repair[]; serverNow: string }>("/api/transport/breakdowns");
      offset.current = Date.parse(result.serverNow) - Date.now();
      repairsRef.current = result.repairs;
      setRepairs(result.repairs);
      const at = Date.now() + offset.current;
      for (const repair of result.repairs) {
        const phase = repairPhase(repair, at);
        const before = phases.current.get(repair.id);
        if (before && before !== phase && phase !== "BACK_AT_COLLEGE") {
          setEvents((list) => [{ at: clock(), text: `${repair.busName}: ${phaseText[phase](repair, at)}` }, ...list].slice(0, 40));
        }
        phases.current.set(repair.id, phase);
      }
    } catch { /* keep the last known repair state */ }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => void loadRepairs(), 0);
    const timer = window.setInterval(() => void loadRepairs(), 4000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [loadRepairs]);

  const repairFor = (busId: string) => repairs.find((item) => item.busId === busId && !item.returnedAt);
  const riders: TechnicianMarker[] = repairs.flatMap((repair) => {
    const phase = repairPhase(repair, now);
    if (phase !== "TECHNICIAN_EN_ROUTE" && phase !== "REPAIRING") return [];
    const t = rideProgress(repair.startedAt, repair.travelMs, now);
    // Park just beside the bus once arrived so both markers stay readable.
    return [{ id: repair.id, name: repair.technician ?? "Technician", busName: repair.busName, repairing: phase === "REPAIRING",
      lat: lerp(COLLEGE.lat, repair.lat, t) + (phase === "REPAIRING" ? 0.0012 : 0), lng: lerp(COLLEGE.lng, repair.lng, t) }];
  });
  const returning = repairs.filter((repair) => repairPhase(repair, now) === "RETURNING");

  const brokenBuses = fleet.filter((b) => b.status === "BREAKDOWN");
  const reportable = fleet.filter((b) => b.status === "RUNNING");
  const beforeRide = (busId: string) => { const repair = repairFor(busId); return !repair || ["AWAITING_TECHNICIAN", "ASSIGNED"].includes(repairPhase(repair, now)); };
  const helpersFor = (id: string) => fleet.filter((b) => b.status === "RESCUING" && b.rescueTarget?.busId === id);
  // A broken bus can be dragged until its rescue is dispatched.
  const movableIds = brokenBuses.filter((b) => !dispatched.includes(b.id) && beforeRide(b.id)).map((b) => b.id);
  const totals = {
    passengers: fleet.reduce((sum, bus) => sum + bus.occupied, 0),
    seats: fleet.filter((bus) => bus.status !== "BREAKDOWN").reduce((sum, bus) => sum + bus.capacity, 0),
    running: fleet.filter((bus) => bus.status !== "BREAKDOWN" && bus.status !== "RETURNING").length,
    stranded: brokenBuses.reduce((sum, bus) => sum + bus.occupied, 0),
  };

  async function fetchPlan(busId: string, currentFleet: Bus[]) {
    return complaintRequest<RescuePlan>("/api/transport/rescue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brokenBusId: busId, fleet: currentFleet }),
    });
  }

  /** Re-plan every breakdown still waiting for approval, because free seats elsewhere changed. */
  async function refreshPending(currentFleet: Bus[], done: string[]) {
    const pending = currentFleet.filter((bus) => bus.status === "BREAKDOWN" && !done.includes(bus.id));
    if (!pending.length) return;
    try {
      const results = await Promise.all(pending.map((bus) => fetchPlan(bus.id, currentFleet)));
      setPlans((map) => ({ ...map, ...Object.fromEntries(results.map((plan) => [plan.brokenBusId, plan])) }));
      setBriefs((map) => Object.fromEntries(Object.entries(map).filter(([id]) => !pending.some((bus) => bus.id === id))));
    } catch (cause) { setError(requestError(cause)); }
  }

  // Record the breakdown: opens a repair work order and alerts transport admins.
  async function alertBreakdown(bus: Bus, source: "AUTO" | "MANUAL") {
    try {
      const result = await complaintRequest<{ incidentId: string; created: boolean }>("/api/transport/alerts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ busId: bus.id, busName: bus.name, routeName: bus.routeName, driver: bus.driver, students: bus.occupied, lat: bus.lat, lng: bus.lng, source }),
      });
      if (result.created) log(`Repair work order ${result.incidentId} opened for ${bus.name}; operations have been asked to send a technician.`);
      await loadRepairs();
    } catch (cause) { setError(requestError(cause)); }
  }

  async function breakDown(busId: string, source: "AUTO" | "MANUAL") {
    const bus = latest.current.find((b) => b.id === busId && b.status === "RUNNING");
    if (!bus) return;
    const updated = latest.current.map((b) => (b.id === bus.id ? { ...b, status: "BREAKDOWN" as const } : b));
    commit(updated);
    log(source === "AUTO" ? `🚨 ${bus.name} broke down while running on ${bus.routeName} (${bus.occupied} students).` : `${bus.name} reported broken down with ${bus.occupied} students.`);
    void alertBreakdown(bus, source);
    await refreshPending(updated, dispatched);
    if (selected === bus.id) {
      const nextRunning = updated.find((b) => b.status === "RUNNING");
      if (nextRunning) setSelected(nextRunning.id);
    }
  }

  async function reportBreakdown() {
    setError(""); setBusy("report");
    await breakDown(selected, "MANUAL");
    setBusy(null);
  }

  // Demo mode: every 45–90 seconds a moving bus with students on board may break down.
  const breakDownRef = useRef(breakDown);
  useEffect(() => { breakDownRef.current = breakDown; });
  useEffect(() => {
    if (!randomBreakdowns || paused) return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        const running = latest.current.filter((b) => b.status === "RUNNING" && b.occupied > 0);
        if (running.length > 1) void breakDownRef.current(running[Math.floor(Math.random() * running.length)].id, "AUTO");
        schedule();
      }, 45_000 + Math.random() * 45_000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [randomBreakdowns, paused]);


  // Dragging a broken bus recalculates its plan from the new spot.
  async function moveBroken(id: string, lat: number, lng: number) {
    if (dispatched.includes(id) || !beforeRide(id)) { commit([...latest.current]); return; }
    const updated = latest.current.map((b) => (b.id === id ? { ...b, lat, lng } : b));
    commit(updated);
    const repair = repairFor(id);
    if (repair) {
      try {
        await complaintRequest(`/api/transport/breakdowns/${encodeURIComponent(repair.id)}/location`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat, lng }) });
        await loadRepairs();
      } catch (cause) { setError(requestError(cause)); }
    }
    await refreshPending(updated, dispatched);
  }

  // Human approval: the plan is recalculated against the live fleet, then helpers leave their routes.
  async function approveDispatch(brokenId: string) {
    setError(""); setBusy(brokenId);
    try {
      const plan = await fetchPlan(brokenId, latest.current);
      const broken = latest.current.find((b) => b.id === brokenId);
      if (!broken || !plan.assignments.length) { setPlans((map) => ({ ...map, [brokenId]: plan })); return; }
      const next = latest.current.map((b) => {
        const a = plan.assignments.find((x) => x.busId === b.id);
        return a && b.status === "RUNNING"
          ? { ...b, status: "RESCUING" as const, rescueTarget: { lat: broken.lat, lng: broken.lng, seats: a.seatsAllocated, busId: broken.id, transferId: `${broken.id}-${b.id}-${Date.now()}` } }
          : b;
      });
      commit(next);
      const done = [...dispatched.filter((id) => id !== brokenId), brokenId];
      setDispatched(done);
      setPlans((map) => ({ ...map, [brokenId]: plan }));
      log(`Dispatch approved for ${broken.name}: ${plan.assignments.map((a) => `${a.busName} picks up ${a.seatsAllocated}`).join(", ")}.`);
      // Helpers are now busy, so other waiting breakdowns need fresh plans.
      await refreshPending(next, done);
    } catch (cause) { setError(requestError(cause)); }
    finally { setBusy(null); }
  }

  /** After pickups, plan again for any students still waiting (e.g. not enough seats first time). */
  async function replan(brokenId: string) {
    const done = dispatched.filter((id) => id !== brokenId);
    setDispatched(done);
    await refreshPending(latest.current, done);
  }

  async function requestBrief(brokenId: string) {
    setBusy(`brief-${brokenId}`); setError("");
    try {
      const brief = await complaintRequest<TransportBrief>("/api/ai/transport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokenBusId: brokenId, fleet: latest.current }),
      });
      setBriefs((map) => ({ ...map, [brokenId]: brief }));
    } catch (cause) { setError(requestError(cause)); }
    finally { setBusy(null); }
  }

  function reset() {
    commit(INITIAL_FLEET);
    setPlans({}); setBriefs({}); setDispatched([]); setError("");
    setSelected(INITIAL_FLEET[0].id);
    log("Simulation reset.");
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Buses in service", `${totals.running}/${fleet.length}`],
          ["Students on buses", totals.passengers - totals.stranded],
          ["Seats used", `${Math.round(((totals.passengers - totals.stranded) / Math.max(1, totals.seats)) * 100)}%`],
          ["Students stranded", totals.stranded],
        ].map(([name, value]) => <div key={String(name)} className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">{name}</p>
          <p className={`mt-2 text-2xl font-bold ${name === "Students stranded" && Number(value) > 0 ? "text-red-700" : ""}`}>{value}</p>
        </div>)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <FleetMap fleet={fleet} plans={Object.values(plans).filter((plan) => !dispatched.includes(plan.brokenBusId) && fleet.some((bus) => bus.id === plan.brokenBusId && bus.status === "BREAKDOWN"))} selectedId={selected}
            onSelect={(id) => { if (reportable.some((bus) => bus.id === id)) setSelected(id); }} onMoveBroken={(id, lat, lng) => void moveBroken(id, lat, lng)} movableIds={movableIds} technicians={riders} />
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Report a breakdown</p>
              <button type="button" onClick={() => setPaused((value) => !value)} className="text-[11px] font-semibold text-amber-800 hover:underline">{paused ? "Resume simulation" : "Pause simulation"}</button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-[11px] text-slate-600"><input type="checkbox" checked={randomBreakdowns} onChange={(event) => setRandomBreakdowns(event.target.checked)} className="accent-red-600" />Random breakdowns while driving (demo drill, alerts transport admins)</label>
            <select
              aria-label="Bus to report"
              value={reportable.some((b) => b.id === selected) ? selected : ""}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!reportable.length}
              className="mt-3 w-full rounded border border-slate-300 px-2 py-2 text-xs"
            >
              {!reportable.some((b) => b.id === selected) && <option value="">Choose a running bus</option>}
              {reportable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.routeName} · {b.occupied}/{b.capacity} on board
                </option>
              ))}
            </select>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void reportBreakdown()}
                disabled={!reportable.some((b) => b.id === selected) || busy !== null}
                className="flex-1 rounded bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {busy === "report" ? "Finding buses..." : "Report breakdown"}
              </button>
              <button onClick={reset} className="rounded border border-slate-300 px-3 py-2 text-xs">
                Reset
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              You can report several breakdowns. Each one opens a repair work order for operations. Drag a red bus to correct where it stopped, until help sets off.
            </p>
            {error && <p role="alert" className="mt-2 text-[11px] leading-5 text-red-700">{error}</p>}
          </div>

          {returning.map((repair) => <div key={repair.id} className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-emerald-800">✔ {repair.busName} · repaired</p>
            <p className="mt-1 text-xs leading-5">{phaseText.RETURNING(repair, now)}</p>
          </div>)}

          {brokenBuses.map((broken) => {
            const plan = plans[broken.id];
            const isDispatched = dispatched.includes(broken.id);
            const enRoute = helpersFor(broken.id);
            const brief = briefs[broken.id];
            return <div key={broken.id} className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-800">⚠ {broken.name} · {broken.routeName}</p>
                  <p className="mt-1 text-sm font-bold">{broken.occupied} student{broken.occupied === 1 ? "" : "s"} waiting</p>
                </div>
              </div>
              {(() => {
                const repair = repairFor(broken.id);
                if (!repair) return <p className="mt-2 rounded bg-white p-2 text-[11px] leading-5 text-slate-500">Opening a repair work order...</p>;
                const phase = repairPhase(repair, now);
                return <div className="mt-2 rounded border border-violet-200 bg-white p-2 text-[11px] leading-5">
                  <p className="font-semibold text-violet-900">Repair</p>
                  <p>{phaseText[phase](repair, now)}</p>
                  {canAssign && phase === "AWAITING_TECHNICIAN" && <Link href={`/work-orders?incident=${encodeURIComponent(repair.incidentId)}`} prefetch={false} className="mt-1 inline-block font-semibold text-amber-800 underline">Assign a technician →</Link>}
                </div>;
              })()}

              {isDispatched ? <>
                {enRoute.length > 0 ? <ul className="mt-3 space-y-2">{enRoute.map((bus) => <li key={bus.id} className="rounded bg-white p-2 text-xs leading-5">
                  <b>{bus.name}</b> on the way to pick up {bus.rescueTarget?.seats} students
                  <br /><span className="text-slate-500">{bus.occupied}/{bus.capacity} on board now · {bus.driver}</span>
                </li>)}</ul>
                  : <p className="mt-3 text-xs leading-5">{broken.occupied ? `All rescue buses have arrived, but ${broken.occupied} students are still waiting.` : "Everyone has been picked up. The bus stays here until the technician repairs it."}</p>}
                {!enRoute.length && broken.occupied > 0 && <button type="button" onClick={() => void replan(broken.id)} className="mt-3 w-full rounded bg-[#142943] px-3 py-2 text-xs font-semibold text-white">Plan pickup for remaining {broken.occupied}</button>}
              </> : plan ? <>
                <p className="mt-2 text-xs leading-5 text-[#172b46]">{plan.summary}</p>
                <ul className="mt-3 space-y-2">
                  {plan.assignments.map((a) => (
                    <li key={a.busId} className="rounded bg-white p-2 text-xs leading-5">
                      <b>{a.busName}</b> picks up {a.seatsAllocated} (has {a.seatsFree} free seats)
                      <br />
                      {a.distanceKm} km away · ETA {a.etaMin} min · {a.driver} · {a.phone}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => void approveDispatch(broken.id)}
                  disabled={busy !== null || plan.assignments.length === 0}
                  className="mt-3 w-full rounded bg-[#142943] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {busy === broken.id ? "Dispatching..." : "Approve dispatch"}
                </button>
              </> : <p className="mt-2 text-xs text-slate-500">Finding nearby buses...</p>}

              {broken.occupied > 0 && <AiButton busy={busy === `brief-${broken.id}`} disabled={busy !== null && busy !== `brief-${broken.id}`} onClick={() => void requestBrief(broken.id)} className="mt-2 w-full">
                {busy === `brief-${broken.id}` ? "Writing dispatch brief..." : brief ? "Regenerate AI dispatch brief" : "AI dispatch brief & passenger SMS"}
              </AiButton>}

              {brief && <div className="mt-3 rounded border border-violet-200 bg-white p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-violet-800">AI dispatch brief</p>
                <AiSource value={brief} />
                <p className="mt-3 text-xs leading-5">{brief.assessment}</p>
                <h3 className="mt-3 text-[11px] font-bold">Passenger / parent SMS</h3>
                <p className="mt-1 rounded border border-slate-200 bg-[#fafaf8] p-2 text-xs leading-5">{brief.passengerNotice}</p>
                <button type="button" onClick={() => void navigator.clipboard?.writeText(brief.passengerNotice)} className="mt-1 text-[11px] font-semibold text-amber-800 hover:underline">Copy message</button>
                <h3 className="mt-3 text-[11px] font-bold">Driver instructions</h3>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5">{brief.driverInstructions.map((line) => <li key={line}>{line}</li>)}</ul>
                {brief.risks.length > 0 && <><h3 className="mt-3 text-[11px] font-bold">Watch for</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-amber-900">{brief.risks.map((line) => <li key={line}>{line}</li>)}</ul></>}
                <p className="mt-2 text-[10px] leading-4 text-slate-400">Messages are drafts; nothing is sent automatically.</p>
              </div>}
            </div>;
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 p-4 text-sm font-bold">Live fleet</h2>
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-2">Bus</th><th className="px-4 py-2">Route</th><th className="px-4 py-2">On board / seats</th><th className="px-4 py-2">Free seats</th><th className="px-4 py-2">Driver</th><th className="px-4 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {fleet.map((bus) => {
                const load = Math.round((bus.occupied / bus.capacity) * 100);
                const broken = bus.status === "BREAKDOWN";
                return <tr key={bus.id} className={bus.id === selected ? "bg-amber-50/50" : ""}>
                  <td className="px-4 py-3 font-semibold">{bus.name}</td>
                  <td className="px-4 py-3 text-slate-600">{bus.routeName}</td>
                  <td className="px-4 py-3">{broken ? <span className="text-red-700">{bus.occupied} waiting</span> : <div className="flex items-center gap-2"><div className="h-1.5 w-20 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-[#142943]" style={{ width: `${load}%` }} /></div><span>{bus.occupied}/{bus.capacity}</span></div>}</td>
                  <td className="px-4 py-3">{broken ? "—" : bus.rescueTarget ? `${bus.capacity - bus.occupied} (${bus.rescueTarget.seats} reserved)` : bus.capacity - bus.occupied}</td>
                  <td className="px-4 py-3 text-slate-600">{bus.driver}</td>
                  <td className="px-4 py-3"><span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${broken ? "border-red-200 bg-red-50 text-red-700" : bus.status === "RESCUING" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{bus.status === "RESCUING" ? `Rescuing ${fleet.find((b) => b.id === bus.rescueTarget?.busId)?.name ?? ""}` : bus.status === "RETURNING" ? "Repaired · returning" : broken ? "Breakdown" : "Running"}</span></td>
                </tr>;
              })}
            </tbody>
          </table>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 p-4 text-sm font-bold">Dispatch log</h2>
          {events.length ? <ol className="max-h-64 space-y-2 overflow-auto p-4 text-xs leading-5">{events.map((entry, index) => <li key={`${entry.at}-${index}`}><span className="font-mono text-[10px] text-slate-400">{entry.at}</span> {entry.text}</li>)}</ol>
            : <p className="p-4 text-xs text-slate-500">No dispatch activity yet. Report a breakdown to start a rescue.</p>}
        </section>
      </div>
      <p className="font-mono text-[9px] tracking-wide text-slate-400">SIMULATED FLEET · FICTIONAL DRIVERS AND OCCUPANCY · NOT LIVE GPS</p>
    </div>
  );
}
