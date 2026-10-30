import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_FLEET, stepBus, type Bus } from "../src/lib/transport/fleet";
import { findRescuePlan, haversineKm } from "../src/lib/transport/rescue";

function bus(overrides: Partial<Bus> = {}): Bus {
  return { ...structuredClone(INITIAL_FLEET[0]), ...overrides };
}

test("a moving bus advances along its demo route while a broken bus stays put", () => {
  const moving = bus({ lat: 13.03, lng: 80.17, route: [[13.04, 80.18]], wp: 0 });
  const before = structuredClone(moving);
  const next = stepBus(moving);
  assert.notEqual(next.lat, moving.lat);
  assert.notEqual(next.lng, moving.lng);
  assert(haversineKm(next.lat, next.lng, 13.04, 80.18) < haversineKm(moving.lat, moving.lng, 13.04, 80.18));
  assert.deepEqual(moving, before, "Movement should not mutate the previous state");
  const broken = { ...moving, status: "BREAKDOWN" as const };
  assert.deepEqual(stepBus(broken), broken);
});

test("nearby rescue allocation uses only running buses with enough aggregate free seats", () => {
  const broken = bus({ id: "broken", occupied: 25, status: "BREAKDOWN", lat: 13.03, lng: 80.17 });
  const nearest = bus({ id: "near", name: "Near", capacity: 40, occupied: 30, lat: 13.031, lng: 80.17 });
  const next = bus({ id: "next", name: "Next", capacity: 40, occupied: 20, lat: 13.04, lng: 80.17 });
  const full = bus({ id: "full", occupied: 50, capacity: 50, lat: 13.03, lng: 80.17 });
  const busy = bus({ id: "busy", occupied: 0, status: "RESCUING", lat: 13.03, lng: 80.17 });
  const distant = bus({ id: "distant", occupied: 0, lat: 14, lng: 80.17 });
  const plan = findRescuePlan(broken, [broken, next, busy, full, distant, nearest]);
  assert.deepEqual(plan.assignments.map((item) => item.busId), ["near", "next"]);
  assert.deepEqual(plan.assignments.map((item) => item.seatsAllocated), [10, 15]);
  assert.equal(plan.uncovered, 0);
  assert.equal(plan.stranded, 25);
  for (const item of plan.assignments) assert(item.seatsAllocated <= item.seatsFree);
});

test("rescue shortages remain explicit and no candidate is invented", () => {
  const broken = bus({ id: "broken", occupied: 30, status: "BREAKDOWN" });
  const available = bus({ id: "helper", occupied: 45, capacity: 50 });
  const partial = findRescuePlan(broken, [broken, available]);
  assert.equal(partial.assignments.length, 1);
  assert.equal(partial.assignments[0].seatsAllocated, 5);
  assert.equal(partial.uncovered, 25);
  const empty = findRescuePlan(broken, [broken]);
  assert.equal(empty.assignments.length, 0);
  assert.equal(empty.uncovered, 30);
  assert.match(empty.summary, /No running bus/);
});

test("straight-line distance is symmetric, finite and zero for the same point", () => {
  assert.equal(haversineKm(13.03, 80.17, 13.03, 80.17), 0);
  const forward = haversineKm(13.03, 80.17, 13.04, 80.18);
  assert(Number.isFinite(forward) && forward > 0);
  assert(Math.abs(forward - haversineKm(13.04, 80.18, 13.03, 80.17)) < 1e-10);
});
