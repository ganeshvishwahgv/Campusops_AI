"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Polyline, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { workButton } from "./work-order-shared";

export type TransportMapBus = {
  id: string; label: string; college: string; lat: number; lng: number;
  freeSeats: number; occupiedSeats: number; capacity: number; status: string;
};
export type TransportMapRescue = { id: string; status: string; origin: { lat: number; lng: number }; target: { lat: number; lng: number } };

export function TransportMap({ buses, rescues, selectedId, onSelect, scenarioId }: {
  buses: TransportMapBus[]; rescues: TransportMapRescue[]; selectedId: string | null;
  onSelect: (id: string) => void; scenarioId: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const library = useRef<typeof import("leaflet") | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const routes = useRef<Polyline[]>([]);
  const currentBuses = useRef(buses);
  const select = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [tileError, setTileError] = useState(false);
  useEffect(() => { currentBuses.current = buses; select.current = onSelect; }, [buses, onSelect]);

  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    async function load() {
      try {
        const leaflet = await import("leaflet");
        if (disposed || !container.current) return;
        library.current = leaflet;
        const instance = leaflet.map(container.current, { scrollWheelZoom: false, zoomControl: true }).setView([13.035, 80.18], 13);
        map.current = instance;
        leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).on("tileerror", () => { if (!disposed) setTileError(true); }).addTo(instance);
        const points = currentBuses.current.map((bus) => [bus.lat, bus.lng] as LatLngExpression);
        if (points.length) instance.fitBounds(leaflet.latLngBounds(points), { padding: [50, 50], maxZoom: 14 });
        resize = new ResizeObserver(() => instance.invalidateSize());
        resize.observe(container.current);
        setReady(true);
      } catch { if (!disposed) setError("The interactive map could not load. Bus positions and rescue controls are still available below."); }
    }
    void load();
    return () => { disposed = true; resize?.disconnect(); map.current?.remove(); map.current = null; markers.current.clear(); routes.current = []; };
  }, []);

  useEffect(() => {
    const instance = map.current, leaflet = library.current;
    if (!ready || !instance || !leaflet) return;
    let animation = 0;
    const started = performance.now();
    const movements: { marker: Marker; from: [number, number]; to: [number, number] }[] = [];
    const present = new Set(buses.map((bus) => bus.id));
    for (const [id, marker] of markers.current) if (!present.has(id)) { marker.remove(); markers.current.delete(id); }
    for (const bus of buses) {
      const colour = bus.status === "BROKEN" ? "#b91c1c" : bus.status === "RESCUING" ? "#047857" : bus.id === selectedId ? "#b45309" : "#142943";
      const iconNode = document.createElement("div");
      iconNode.style.cssText = `width:42px;height:42px;border-radius:12px;background:${colour};color:white;border:3px solid white;box-shadow:0 2px 12px #0004;display:flex;align-items:center;justify-content:center;font-size:21px;`;
      iconNode.textContent = "🚌";
      const icon = leaflet.divIcon({ html: iconNode, className: "campusops-bus-marker", iconSize: [42, 42], iconAnchor: [21, 21] });
      let marker = markers.current.get(bus.id);
      if (!marker) {
        marker = leaflet.marker([bus.lat, bus.lng], { icon, keyboard: true, title: bus.label }).addTo(instance);
        marker.on("click", () => select.current(bus.id));
        markers.current.set(bus.id, marker);
      } else {
        const position = marker.getLatLng();
        movements.push({ marker, from: [position.lat, position.lng], to: [bus.lat, bus.lng] });
        marker.setIcon(icon);
      }
      marker.getElement()?.setAttribute("aria-label", `${bus.label}, ${bus.freeSeats} seats free, ${bus.status.toLowerCase()}`);
      const popup = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = bus.label;
      const details = document.createElement("p"); details.style.cssText = "margin:6px 0 0;line-height:1.6";
      details.textContent = `${bus.college} · ${bus.freeSeats} seats free · ${bus.status.toLowerCase()}. Simulated position.`;
      popup.append(title, details);
      marker.bindPopup(popup);
    }
    function frame(now: number) {
      const progress = Math.min((now - started) / 1100, 1);
      for (const { marker, from, to } of movements) marker.setLatLng([from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress]);
      if (progress < 1) animation = requestAnimationFrame(frame);
    }
    animation = requestAnimationFrame(frame);
    routes.current.forEach((route) => route.remove());
    routes.current = rescues.filter((rescue) => rescue.status === "DISPATCHED").map((rescue) => leaflet.polyline([[rescue.origin.lat, rescue.origin.lng], [rescue.target.lat, rescue.target.lng]], { color: "#059669", weight: 3, dashArray: "7 8" }).addTo(instance));
    return () => cancelAnimationFrame(animation);
  }, [buses, rescues, selectedId, ready]);

  useEffect(() => {
    if (!ready || !map.current || !library.current || !currentBuses.current.length) return;
    map.current.fitBounds(library.current.latLngBounds(currentBuses.current.map((bus) => [bus.lat, bus.lng])), { padding: [50, 50], maxZoom: 14 });
  }, [scenarioId, ready]);

  function focusSelected() {
    const bus = buses.find((item) => item.id === selectedId);
    if (bus) map.current?.flyTo([bus.lat, bus.lng], 15, { duration: 0.7 });
  }
  function showFleet() {
    if (buses.length && library.current) map.current?.fitBounds(library.current.latLngBounds(buses.map((bus) => [bus.lat, bus.lng])), { padding: [50, 50], maxZoom: 14 });
  }

  return <section aria-label="Interactive simulated bus map" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="text-sm font-bold">Nearby college buses</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">Drag to pan · use + / − to zoom · select a bus</p></div><div className="flex gap-2"><button type="button" onClick={showFleet} disabled={!ready} className={workButton}>Show fleet</button><button type="button" onClick={focusSelected} disabled={!ready || !selectedId} className={workButton}>Focus selected</button></div></div>
    {error && <p role="alert" className="px-4 pb-4 text-xs leading-6 text-red-700">{error}</p>}
    <div ref={container} className="relative z-0 h-[430px] bg-slate-100 sm:h-[520px]" />
    <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-200 p-4 text-[11px] text-slate-600"><span>🔵 Moving / available</span><span>🔴 Broken down</span><span>🟢 Rescue in progress</span><span>Dashed line: approximate rescue connection</span></div>
    {tileError && <p role="status" className="px-4 pb-4 text-xs leading-6 text-amber-800">Street-map tiles are unavailable. Markers still show simulated coordinates; use the fleet list while the map reconnects.</p>}
  </section>;
}
