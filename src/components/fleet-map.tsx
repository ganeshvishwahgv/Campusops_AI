"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";
import { COLLEGE, type Bus } from "@/lib/transport/fleet";
import type { RescuePlan } from "@/lib/transport/rescue";
import { workButton } from "./work-order-shared";

type Props = {
  fleet: Bus[]; plans: RescuePlan[]; selectedId: string;
  onSelect: (id: string) => void; onMoveBroken: (id: string, lat: number, lng: number) => void;
  movableIds: string[];
  technicians: TechnicianMarker[];
};

export type TechnicianMarker = { id: string; name: string; busName: string; lat: number; lng: number; repairing: boolean };

export default function FleetMap({ fleet, plans, selectedId, onSelect, onMoveBroken, movableIds, technicians }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const library = useRef<typeof import("leaflet") | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const lines = useRef<Polyline[]>([]);
  const riders = useRef(new Map<string, Marker>());
  const latest = useRef({ fleet, onSelect, onMoveBroken });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [tileError, setTileError] = useState(false);

  useEffect(() => { latest.current = { fleet, onSelect, onMoveBroken }; }, [fleet, onSelect, onMoveBroken]);
  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    const savedMarkers = markers.current;
    const savedRiders = riders.current;
    async function initialise() {
      try {
        const leaflet = await import("leaflet");
        if (disposed || !container.current) return;
        library.current = leaflet;
        const instance = leaflet.map(container.current, { zoomControl: true, scrollWheelZoom: true, dragging: true }).setView([COLLEGE.lat, COLLEGE.lng], 13);
        map.current = instance;
        leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).on("tileerror", () => { if (!disposed) setTileError(true); }).addTo(instance);
        const campus = document.createElement("div"); campus.textContent = "🏫"; campus.style.cssText = "font-size:27px";
        leaflet.marker([COLLEGE.lat, COLLEGE.lng], { icon: leaflet.divIcon({ html: campus, className: "", iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindPopup("Easwari Engineering College — approximate campus position").addTo(instance);
        if (latest.current.fleet.length) instance.fitBounds(leaflet.latLngBounds(latest.current.fleet.map((bus) => [bus.lat, bus.lng])), { padding: [55, 55], maxZoom: 14 });
        resize = new ResizeObserver(() => instance.invalidateSize());
        resize.observe(container.current);
        setReady(true);
      } catch { if (!disposed) setError("The map could not load. The fleet list and rescue controls remain available."); }
    }
    void initialise();
    return () => { disposed = true; resize?.disconnect(); map.current?.remove(); map.current = null; savedMarkers.clear(); savedRiders.clear(); lines.current = []; };
  }, []);

  useEffect(() => {
    const leaflet = library.current, instance = map.current;
    if (!ready || !leaflet || !instance) return;
    const present = new Set(fleet.map((bus) => bus.id));
    for (const [id, marker] of markers.current) if (!present.has(id)) { marker.remove(); markers.current.delete(id); }
    const movements: { marker: Marker; from: [number, number]; to: [number, number] }[] = [];
    for (const bus of fleet) {
      const colour = bus.status === "BREAKDOWN" ? "#b91c1c" : bus.status === "RESCUING" ? "#b45309" : bus.status === "RETURNING" ? "#15803d" : "#166534";
      const free = Math.max(0, bus.capacity - bus.occupied);
      const movable = movableIds.includes(bus.id);
      const number = bus.id.replace("BUS-", "");
      const iconNode = document.createElement("div");
      iconNode.style.cssText = `width:max-content;height:35px;padding:0 9px;transform:translateX(-50%);border:3px solid ${selectedId === bus.id ? "#fbbf24" : "white"};border-radius:9px;background:${colour};color:white;box-shadow:0 2px 9px #0005;display:flex;align-items:center;justify-content:center;font:700 11px system-ui;white-space:nowrap;`;
      // On board / capacity for running buses; waiting students for a breakdown; pickup size for a rescue.
      iconNode.textContent = bus.status === "RETURNING" ? `✔ ${number} → college`
        : bus.status === "BREAKDOWN" ? `⚠ ${number} · ${bus.occupied} waiting`
        : bus.status === "RESCUING" ? `🚌 ${number} → +${bus.rescueTarget?.seats ?? 0}`
        : `🚌 ${number} · ${bus.occupied}/${bus.capacity}`;
      const icon = leaflet.divIcon({ html: iconNode, className: "campusops-fleet-marker", iconSize: [0, 35], iconAnchor: [0, 18] });
      let marker = markers.current.get(bus.id);
      if (!marker) {
        marker = leaflet.marker([bus.lat, bus.lng], { icon, title: bus.name, draggable: movable }).addTo(instance);
        const busId = bus.id;
        marker.on("click", () => latest.current.onSelect(busId));
        marker.on("dragend", (event) => {
          const point = (event.target as Marker).getLatLng();
          latest.current.onMoveBroken(busId, point.lat, point.lng);
        });
        markers.current.set(bus.id, marker);
      } else {
        const point = marker.getLatLng();
        movements.push({ marker, from: [point.lat, point.lng], to: [bus.lat, bus.lng] });
        marker.setIcon(icon);
      }
      if (movable) marker.dragging?.enable(); else marker.dragging?.disable();
      marker.getElement()?.setAttribute("aria-label", `${bus.name}: ${bus.occupied} of ${bus.capacity} seats taken, ${bus.status.toLowerCase()}`);
      const popup = document.createElement("div");
      const heading = document.createElement("strong"); heading.textContent = `${bus.name} · ${bus.routeName}`;
      const detail = document.createElement("p"); detail.style.cssText = "line-height:1.7;margin:8px 0 0";
      detail.textContent = bus.status === "RETURNING" ? "Repaired and driving back to college. Simulated vehicle and position." : bus.status === "BREAKDOWN" ? `${bus.occupied} students waiting for pickup. Simulated vehicle and position.`
        : `${bus.occupied}/${bus.capacity} seats taken · ${free} free${bus.rescueTarget ? ` · going to pick up ${bus.rescueTarget.seats}` : ""}. Simulated vehicle and position.`;
      popup.append(heading, detail);
      if (marker.getPopup()) marker.setPopupContent(popup); else marker.bindPopup(popup);
    }
    let animation = 0;
    const started = performance.now();
    function animate(now: number) {
      const progress = Math.min((now - started) / 900, 1);
      for (const { marker, from, to } of movements) marker.setLatLng([from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress]);
      if (progress < 1) animation = requestAnimationFrame(animate);
    }
    animation = requestAnimationFrame(animate);
    lines.current.forEach((line) => line.remove());
    lines.current = [];
    const selected = fleet.find((bus) => bus.id === selectedId);
    if (selected && selected.status === "RUNNING") lines.current.push(leaflet.polyline(selected.route, { color: "#142943", weight: 2, opacity: 0.3 }).addTo(instance));
    for (const bus of fleet) if (bus.status === "RESCUING" && bus.rescueTarget) lines.current.push(leaflet.polyline([[bus.lat, bus.lng], [bus.rescueTarget.lat, bus.rescueTarget.lng]], { color: "#d97706", weight: 3, dashArray: "7 7" }).addTo(instance));
    for (const plan of plans) {
      const broken = fleet.find((bus) => bus.id === plan.brokenBusId);
      if (broken) for (const assignment of plan.assignments) {
        const helper = fleet.find((bus) => bus.id === assignment.busId);
        if (helper?.status === "RUNNING") lines.current.push(leaflet.polyline([[helper.lat, helper.lng], [broken.lat, broken.lng]], { color: "#64748b", weight: 2, dashArray: "4 8" }).addTo(instance));
      }
    }
    return () => cancelAnimationFrame(animation);
  }, [fleet, plans, selectedId, movableIds, ready]);

  // Technicians riding out on a scooter, or repairing at the bus.
  useEffect(() => {
    const leaflet = library.current, instance = map.current;
    if (!ready || !leaflet || !instance) return;
    const present = new Set(technicians.map((rider) => rider.id));
    for (const [id, marker] of riders.current) if (!present.has(id)) { marker.remove(); riders.current.delete(id); }
    const moves: { marker: Marker; from: [number, number]; to: [number, number] }[] = [];
    for (const rider of technicians) {
      const node = document.createElement("div");
      node.style.cssText = "width:max-content;transform:translate(-50%,-50%);display:flex;align-items:center;gap:4px;padding:3px 8px 3px 4px;border-radius:999px;background:#4c1d95;color:white;border:2px solid white;box-shadow:0 2px 8px #0006;font:700 11px system-ui;white-space:nowrap;";
      node.textContent = `${rider.repairing ? "🔧" : "🛵"} ${rider.name}${rider.repairing ? " · repairing" : ""}`;
      const icon = leaflet.divIcon({ html: node, className: "campusops-rider-marker", iconSize: [0, 0], iconAnchor: [0, 0] });
      let marker = riders.current.get(rider.id);
      if (!marker) {
        marker = leaflet.marker([rider.lat, rider.lng], { icon, zIndexOffset: 1000, keyboard: false }).addTo(instance);
        riders.current.set(rider.id, marker);
      } else {
        const point = marker.getLatLng();
        moves.push({ marker, from: [point.lat, point.lng], to: [rider.lat, rider.lng] });
        marker.setIcon(icon);
      }
      marker.getElement()?.setAttribute("aria-label", `${rider.name} ${rider.repairing ? "repairing" : "riding to"} ${rider.busName}`);
    }
    let frame = 0;
    const started = performance.now();
    function glide(now: number) {
      const progress = Math.min((now - started) / 900, 1);
      for (const { marker, from, to } of moves) marker.setLatLng([from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress]);
      if (progress < 1) frame = requestAnimationFrame(glide);
    }
    frame = requestAnimationFrame(glide);
    return () => cancelAnimationFrame(frame);
  }, [technicians, ready]);

  function showFleet() {
    if (fleet.length && library.current) map.current?.fitBounds(library.current.latLngBounds(fleet.map((bus) => [bus.lat, bus.lng])), { padding: [55, 55], maxZoom: 14 });
  }
  function focus() {
    const selected = fleet.find((bus) => bus.id === selectedId);
    if (selected) map.current?.flyTo([selected.lat, selected.lng], 15, { duration: 0.6 });
  }
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="Moving simulated bus map">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div><h2 className="text-sm font-bold">College fleet map</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">Drag to pan · scroll or use + / − to zoom · select a bus</p></div><div className="flex gap-2"><button type="button" disabled={!ready} onClick={showFleet} className={workButton}>Show fleet</button><button type="button" disabled={!ready || !selectedId} onClick={focus} className={workButton}>Focus bus</button></div></div>
    {error && <p role="alert" className="p-4 text-xs leading-6 text-red-700">{error}</p>}
    <div ref={container} className="relative z-0 h-[420px] bg-slate-100 sm:h-[520px]" />
    <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 p-4 text-[11px] leading-5 text-slate-500"><span><span className="text-green-700">●</span> Running</span><span><span className="text-red-700">●</span> Breakdown</span><span><span className="text-amber-700">●</span> Rescue en route</span><span>Labels show students on board / seats · ⚠ students waiting · → students being picked up · 🛵 technician riding out · ✔ repaired bus returning</span><span>Dashed lines are straight-line connections, not driving routes.</span></div>
    {tileError && <p role="status" className="px-4 pb-4 text-xs leading-6 text-amber-800">Street-map tiles could not load. Fleet coordinates and rescue controls still work; map tiles need an internet connection.</p>}
  </section>;
}
