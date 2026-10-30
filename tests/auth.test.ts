import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { IncidentStatus, Priority, Role } from "../src/generated/prisma/enums";
import type { Technician, WorkflowEvent as PublicEvent, WorkOrder as WorkflowView } from "../src/lib/workflow/types";
import type { Booking, BookingEvent, BookingImpact, RoomCandidate } from "../src/lib/bookings/types";
import type { TransportSnapshot } from "../src/lib/transport/types";
import type { RescuePlan } from "../src/lib/transport/rescue";
import {
  hashPassword,
  verifyPassword,
  validatePassword,
} from "../src/lib/auth/password";

// Integration tests use a NEW database, never the user's campusops.db.
// Run `npm.cmd run build`, then `npm.cmd run test:auth`.
const workspace = process.cwd();
const fixtureRoot = path.join(workspace, ".auth-tests");
const accounts = new Map<string, { id: string; username: string; password: string }>();
const privateIncident = "PRIVATE AUTH TEST INCIDENT";
let fixtureDirectory: string;
let prisma: PrismaClient;
let server: ChildProcess | undefined;
let origin: string;
let port: number;
let databaseUrl: string;
let serverOutput = "";

function randomPassword() {
  return `Test-${randomBytes(24).toString("base64url")}`;
}

async function freePort() {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  assert(address && typeof address !== "string");
  const selected = address.port;
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return selected;
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const current = server;
  const stopped = new Promise<void>((resolve) => current.once("exit", () => resolve()));
  current.kill();
  await Promise.race([stopped, delay(8_000)]);
  if (current.exitCode === null && current.signalCode === null) {
    current.kill("SIGKILL");
    await Promise.race([stopped, delay(3_000)]);
  }
  server = undefined;
}

async function startServer() {
  serverOutput = "";
  server = spawn(
    process.execPath,
    [path.join(workspace, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: workspace,
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: databaseUrl,
        APP_ORIGIN: origin,
        // Never send fixture data to an external AI service or spend API credits.
        OPENAI_API_KEY: "",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const capture = (chunk: Buffer) => {
    serverOutput = (serverOutput + chunk.toString()).slice(-12_000);
  };
  server.stdout?.on("data", capture);
  server.stderr?.on("data", capture);
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${serverOutput}`);
    try {
      const response = await fetch(`${origin}/api/auth/me`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 401) return;
      if (response.status >= 500) throw new Error(`Auth server failed: ${serverOutput}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Auth server failed")) throw error;
    }
    await delay(250);
  }
  throw new Error(`Test server did not become ready: ${serverOutput}`);
}

function request(route: string, init: RequestInit = {}) {
  return fetch(`${origin}${route}`, { ...init, redirect: "manual" });
}

function post(route: string, body: unknown, cookie?: string, extraHeaders?: Record<string, string>) {
  return request(route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function login(role: Role | "SECOND_TECHNICIAN", cookie?: string) {
  const account = accounts.get(role)!;
  const response = await post("/api/auth/login", {
    username: account.username,
    password: account.password,
  }, cookie);
  assert.equal(response.status, 200, `Login should work for ${role}`);
  const setCookie = response.headers.get("set-cookie");
  assert(setCookie, "Login must set a session cookie");
  const sessionCookie = setCookie.split(";")[0];
  assert.match(sessionCookie, /^campusops_session=.+/);
  return { response, cookie: sessionCookie, token: decodeURIComponent(sessionCookie.split("=")[1]), setCookie };
}

async function assertRedirect(response: Response, destination: string) {
  if ([303, 307, 308].includes(response.status)) {
    assert.equal(new URL(response.headers.get("location")!, origin).pathname, destination);
    return;
  }
  // With Cache Components, a Suspense redirect can be sent in streamed HTML.
  assert.equal(response.status, 200);
  const html = await response.text();
  assert(!html.includes(privateIncident), "Redirect must not leak protected records");
  assert(
    html.includes(`url=${destination}`) || html.includes(`NEXT_REDIRECT;replace;${destination};`),
    `Expected server redirect to ${destination}`,
  );
}

before(async () => {
  assert(existsSync(path.join(workspace, ".next/BUILD_ID")), "Build first: npm.cmd run build");
  await mkdir(fixtureRoot, { recursive: true });
  fixtureDirectory = await mkdtemp(path.join(fixtureRoot, "auth-"));
  const file = path.join(fixtureDirectory, "test.db");
  const sqlite = new Database(file);
  try {
    const migrationsPath = path.join(workspace, "prisma/migrations");
    const migrations = (await readdir(migrationsPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const migration of migrations) {
      sqlite.exec(await readFile(path.join(migrationsPath, migration, "migration.sql"), "utf8"));
    }
    assert.equal(sqlite.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    sqlite.close();
  }
  databaseUrl = `file:${file.replaceAll("\\", "/")}`;
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
  for (const role of Object.values(Role)) {
    const username = `test.${role.toLowerCase()}`;
    const password = randomPassword();
    const user = await prisma.user.create({
      data: {
        name: `Auth test ${role}`,
        email: `${username}@example.invalid`,
        role,
        credential: { create: { username, passwordHash: await hashPassword(password) } },
      },
    });
    accounts.set(role, { id: user.id, username, password });
  }
  const secondUsername = "test.second.technician";
  const secondPassword = randomPassword();
  const secondTechnician = await prisma.user.create({ data: {
    name: "Second workflow technician", email: `${secondUsername}@example.invalid`, role: Role.TECHNICIAN,
    credential: { create: { username: secondUsername, passwordHash: await hashPassword(secondPassword) } },
  } });
  accounts.set("SECOND_TECHNICIAN", { id: secondTechnician.id, username: secondUsername, password: secondPassword });
  await prisma.building.create({ data: { id: "test-main", code: "TEST", name: "Test Main Block", mapX: 36, mapY: 40 } });
  await prisma.building.create({ data: { id: "test-other", code: "ZZTEST", name: "Test Academic Block" } });
  await prisma.room.createMany({ data: [
    { id: "test-room", code: "101", name: "Test Main Room", buildingId: "test-main", capacity: 40 },
    { id: "test-other-room", code: "201", name: "Test Academic Room", buildingId: "test-other", capacity: 50 },
  ] });
  await prisma.asset.createMany({ data: [
    { id: "test-projector", assetTag: "TEST-PROJECTOR", name: "Test Projector", category: "EQUIPMENT", roomId: "test-room" },
    { id: "test-other-asset", assetTag: "TEST-OTHER", name: "Test Other Asset", category: "NETWORK", roomId: "test-other-room" },
  ] });
  await prisma.bus.create({ data: { id: "test-bus", fleetCode: "TEST-BUS", registrationNumber: "PRIVATE-TEST-REG", capacity: 40 } });
  await prisma.incident.create({
    data: { title: privateIncident, description: "Only operations admins may see this record.", buildingId: "test-main", reporterId: accounts.get(Role.FACULTY)!.id },
  });
  port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  await startServer();
}, { timeout: 60_000 });

after(async () => {
  await stopServer();
  await prisma?.$disconnect();
  // Remove only this run's verified fixture directory, never a configured DB path.
  if (fixtureDirectory && path.dirname(path.resolve(fixtureDirectory)) === path.resolve(fixtureRoot)) {
    await rm(fixtureDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("passwords have unique salts and reject wrong passwords and malformed hashes", async () => {
  const password = randomPassword();
  const one = await hashPassword(password);
  const two = await hashPassword(password);
  assert.notEqual(one, two);
  assert(!one.includes(password));
  assert(await verifyPassword(password, one));
  assert.equal(await verifyPassword(`${password}wrong`, one), false);
  assert.equal(await verifyPassword(password, "invalid-hash"), false);
  assert.equal(validatePassword(password), null);
  assert(validatePassword("short"));
  assert(validatePassword("x".repeat(129)));
});

test("local account setup refuses piped secrets without changing credentials", async () => {
  const before = await prisma.credential.count();
  const password = randomPassword();
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/setup-login.ts"], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  // Child may exit before consuming stdin; input refusal should remain safe.
  child.stdin.on("error", () => {});
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  child.stdin.end(password);
  assert.equal(await closed, 1);
  assert.match(output, /normal PowerShell terminal/);
  assert.match(output, /Piped input is disabled/);
  assert(!output.includes(password), "Refused password must never be echoed");
  assert.equal(await prisma.credential.count(), before);
});

test("signed-out pages redirect and APIs never disclose private data", async () => {
  await assertRedirect(await request("/"), "/login");
  for (const route of ["/api/dashboard", "/api/auth/me"]) {
    const response = await request(route);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const body = await response.text();
    assert(!body.includes(privateIncident));
    assert(!body.includes("passwordHash"));
  }
  const loginPage = await request("/login");
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /[Uu]sername/);
});

test("unknown, wrong-password, and inactive accounts receive the same failure", async () => {
  const student = accounts.get(Role.STUDENT)!;
  const wrong = await post("/api/auth/login", { username: student.username, password: randomPassword() });
  const unknown = await post("/api/auth/login", { username: "test.unknown", password: randomPassword() });
  await prisma.user.update({ where: { id: student.id }, data: { active: false } });
  try {
    const inactive = await post("/api/auth/login", { username: student.username, password: student.password });
    for (const response of [wrong, unknown, inactive]) {
      assert.equal(response.status, 401);
      assert(!response.headers.get("set-cookie")?.includes("Max-Age=28800"));
    }
    const failure = await wrong.json();
    assert.deepEqual(failure, await unknown.json());
    assert.deepEqual(failure, await inactive.json());
  } finally {
    await prisma.user.update({ where: { id: student.id }, data: { active: true } });
  }
});

test("login rejects cross-origin, missing-origin, non-JSON and oversized submissions", async () => {
  const account = accounts.get(Role.FACULTY)!;
  const body = { username: account.username, password: account.password };
  const rejectedHeaders: Record<string, string>[] = [
    { Origin: "https://attacker.example" },
    { Origin: "null" },
    { "Sec-Fetch-Site": "cross-site" },
  ];
  for (const headers of rejectedHeaders) {
    assert.equal((await post("/api/auth/login", body, undefined, headers)).status, 403);
  }
  const missingOrigin = await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(missingOrigin.status, 403);
  const form = await request("/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: "username=test&password=test" });
  assert([400, 415].includes(form.status));
  assert.equal((await post("/api/auth/login", { username: "x".repeat(5_000), password: "x" })).status, 413);
  const malformed = await request("/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
});

test("all seven roles have backend-enforced access and narrow self profiles", async (t) => {
  for (const role of Object.values(Role)) {
    await t.test(role, async () => {
      const { cookie } = await login(role);
      const self = await request("/api/auth/me", { headers: { Cookie: cookie } });
      assert.equal(self.status, 200);
      const profile = await self.json();
      assert.equal(profile.user.role, role);
      assert.deepEqual(Object.keys(profile.user).sort(), ["department", "id", "name", "role"]);
      const response = await request("/api/dashboard?role=SYSTEM_ADMIN", { headers: { Cookie: cookie, "X-Role": "SYSTEM_ADMIN" } });
      const allowed = role === Role.SYSTEM_ADMIN || role === Role.FACILITIES_ADMIN;
      assert.equal(response.status, allowed ? 200 : 403);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      const body = await response.text();
      assert.equal(body.includes(privateIncident), allowed);
      if (allowed) {
        const dashboard = JSON.parse(body);
        assert.equal(dashboard.buildings[0].mapX, 36);
        assert.equal(dashboard.buildings[0].mapY, 40);
        assert.equal(dashboard.incidents.length, 1);
      } else if (role === Role.STUDENT || role === Role.FACULTY) {
        await assertRedirect(await request("/", { headers: { Cookie: cookie } }), "/complaints");
      } else if (role === Role.TECHNICIAN) {
        await assertRedirect(await request("/", { headers: { Cookie: cookie } }), "/work-orders");
      } else if (role === Role.DEPARTMENT_MANAGER) {
        await assertRedirect(await request("/", { headers: { Cookie: cookie } }), "/bookings");
      } else {
        const page = await request("/", { headers: { Cookie: cookie } });
        assert.equal(page.status, 200);
        const html = await page.text();
        assert(!html.includes(privateIncident));
        assert.match(html, /not yet available|being prepared|coming soon|not yet implemented|pending/i);
      }
      await assertRedirect(await request("/login", { headers: { Cookie: cookie } }), "/");
    });
  }
});

test("sessions persist only token hashes and production cookies have safe attributes", async () => {
  const { cookie, token, setCookie } = await login(Role.SYSTEM_ADMIN);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /(?:^|;)\s*Secure(?:;|$)/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Max-Age=28800/i);
  assert(token.length >= 40);
  const hash = createHash("sha256").update(token).digest("hex");
  const session = await prisma.session.findUnique({ where: { tokenHash: hash } });
  assert(session);
  assert.notEqual(session.tokenHash, token);
  assert(session.expiresAt.getTime() > Date.now() + 7.9 * 60 * 60 * 1_000);
  assert(!JSON.stringify(session).includes(token));
  const forged = `${cookie.slice(0, -1)}${cookie.endsWith("A") ? "B" : "A"}`;
  assert.equal((await request("/api/dashboard", { headers: { Cookie: forged } })).status, 401);
});

test("a new login rotates the current session; logout revokes the stolen token", async () => {
  const first = await login(Role.SYSTEM_ADMIN);
  const second = await login(Role.SYSTEM_ADMIN, first.cookie);
  assert.notEqual(first.cookie, second.cookie);
  assert.equal((await request("/api/auth/me", { headers: { Cookie: first.cookie } })).status, 401);
  const forgedLogout = await post("/api/auth/logout", {}, second.cookie, { Origin: "https://attacker.example" });
  assert.equal(forgedLogout.status, 403);
  assert.equal((await request("/api/auth/me", { headers: { Cookie: second.cookie } })).status, 200);
  assert.equal((await request("/api/auth/logout", { headers: { Cookie: second.cookie } })).status, 405);
  const logout = await post("/api/auth/logout", {}, second.cookie);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  assert.equal((await request("/api/dashboard", { headers: { Cookie: second.cookie } })).status, 401);
  await assertRedirect(await request("/", { headers: { Cookie: second.cookie } }), "/login");
  assert.equal((await post("/api/auth/logout", {}, second.cookie)).status, 200);
});

test("expired sessions, deactivation, and role changes take effect on the server", async () => {
  const expired = await login(Role.FACILITIES_ADMIN);
  await prisma.session.update({ where: { tokenHash: createHash("sha256").update(expired.token).digest("hex") }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  const expiredResponse = await request("/api/dashboard", { headers: { Cookie: expired.cookie } });
  assert.equal(expiredResponse.status, 401);
  assert.match(expiredResponse.headers.get("set-cookie") ?? "", /Max-Age=0/i);
  await assertRedirect(await request("/", { headers: { Cookie: expired.cookie } }), "/login");
  const current = await login(Role.FACILITIES_ADMIN);
  const user = accounts.get(Role.FACILITIES_ADMIN)!;
  try {
    await prisma.user.update({ where: { id: user.id }, data: { role: Role.STUDENT } });
    assert.equal((await request("/api/dashboard", { headers: { Cookie: current.cookie } })).status, 403);
    const self = await request("/api/auth/me", { headers: { Cookie: current.cookie } });
    assert.equal((await self.json()).user.role, Role.STUDENT);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    assert.equal((await request("/api/auth/me", { headers: { Cookie: current.cookie } })).status, 401);
    assert.equal((await request("/api/dashboard", { headers: { Cookie: current.cookie } })).status, 401);
  } finally {
    await prisma.user.update({ where: { id: user.id }, data: { role: Role.FACILITIES_ADMIN, active: true } });
  }
});

test("account throttling normalizes usernames and survives a server restart", { timeout: 45_000 }, async () => {
  const { username, password } = accounts.get(Role.FACULTY)!;
  const persistent = await login(Role.STUDENT);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await post("/api/auth/login", { username, password: randomPassword() })).status, 401);
  }
  await stopServer();
  await startServer();
  assert.equal((await request("/api/auth/me", { headers: { Cookie: persistent.cookie } })).status, 200);
  const limited = await post("/api/auth/login", { username: `  ${username.toUpperCase()}  `, password });
  assert.equal(limited.status, 429);
  assert(Number(limited.headers.get("retry-after")) > 0);
  await prisma.loginThrottle.updateMany({ data: { expiresAt: new Date(Date.now() - 60_000) } });
  assert.equal((await post("/api/auth/login", { username, password })).status, 200);
});

test("concurrent attempts cannot bypass the account attempt budget", async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () =>
    post("/api/auth/login", { username: "test.concurrent-limit", password: randomPassword() }),
  ));
  assert.equal(responses.filter((response) => response.status === 401).length, 5);
  assert.equal(responses.filter((response) => response.status === 429).length, 3);
});

test("the shared attempt budget also blocks username rotation", async () => {
  const key = createHash("sha256").update("login:global").digest("hex");
  const expiresAt = new Date(Date.now() + 60_000);
  await prisma.loginThrottle.upsert({
    where: { key },
    create: { key, attempts: 100, expiresAt },
    update: { attempts: 100, expiresAt },
  });
  try {
    const response = await post("/api/auth/login", { username: "test.entirely-new-username", password: randomPassword() });
    assert.equal(response.status, 429);
    assert(Number(response.headers.get("retry-after")) > 0);
  } finally {
    await prisma.loginThrottle.deleteMany({ where: { key } });
  }
});

function complaintPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Projector has stopped working",
    description: "The projector in the main classroom will not turn on during the scheduled lesson.",
    category: "EQUIPMENT",
    reportedUrgency: "HIGH",
    buildingId: "test-main",
    roomId: "test-room",
    assetId: "test-projector",
    busId: null,
    locationDetails: "Near the teaching desk",
    ...overrides,
  };
}

function submitComplaint(cookie: string, body = complaintPayload(), key: string = randomUUID()) {
  return post("/api/complaints", body, cookie, { "Idempotency-Key": key });
}

test("complaint APIs and pages require authentication", async () => {
  await assertRedirect(await request("/complaints"), "/login");
  for (const route of ["/api/complaints", "/api/complaints/options", "/api/complaints/unknown-request"]) {
    const response = await request(route);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert(!((await response.text()).includes(privateIncident)));
  }
  const response = await post("/api/complaints", complaintPayload(), undefined, { "Idempotency-Key": randomUUID() });
  assert.equal(response.status, 401);
});

test("complaint permission checks apply to every role and reference data stays narrow", async (t) => {
  for (const role of Object.values(Role)) {
    await t.test(role, async () => {
      const { cookie } = await login(role);
      const permitted = role === Role.STUDENT || role === Role.FACULTY ||
        role === Role.FACILITIES_ADMIN || role === Role.SYSTEM_ADMIN;
      const options = await request("/api/complaints/options", { headers: { Cookie: cookie } });
      const list = await request("/api/complaints", { headers: { Cookie: cookie } });
      assert.equal(options.status, permitted ? 200 : 403);
      assert.equal(list.status, permitted ? 200 : 403);
      if (!permitted) {
        assert.equal((await submitComplaint(cookie)).status, 403);
        assert.equal((await request("/api/complaints/unknown-request", { headers: { Cookie: cookie } })).status, 403);
        await assertRedirect(await request("/complaints", { headers: { Cookie: cookie } }), "/");
        return;
      }
      assert.match(options.headers.get("cache-control") ?? "", /no-store/);
      const body = await options.json();
      assert.deepEqual(Object.keys(body).sort(), ["assets", "buildings", "buses", "rooms"]);
      assert.deepEqual(Object.keys(body.buildings[0]).sort(), ["code", "id", "name"]);
      assert.deepEqual(Object.keys(body.rooms[0]).sort(), ["buildingId", "id", "name"]);
      assert.deepEqual(Object.keys(body.assets[0]).sort(), ["assetTag", "id", "name", "roomId"]);
      assert.deepEqual(Object.keys(body.buses[0]).sort(), ["fleetCode", "id"]);
      assert(!JSON.stringify(body).includes("PRIVATE-TEST-REG"));
      assert(!JSON.stringify(body).includes(privateIncident));
      assert.equal((await request("/complaints", { headers: { Cookie: cookie } })).status, 200);
    });
  }
});

test("submitted complaints persist, use server ownership, and enter the operations dashboard", async () => {
  const student = await login(Role.STUDENT);
  const submitted = await submitComplaint(student.cookie, complaintPayload({ reportedUrgency: "CRITICAL" }));
  assert.equal(submitted.status, 201);
  assert.match(submitted.headers.get("cache-control") ?? "", /no-store/);
  const { complaint, replayed } = await submitted.json();
  assert.equal(replayed, false);
  assert.equal(complaint.status, "REPORTED");
  assert.equal(complaint.reportedUrgency, "CRITICAL");
  assert.equal(complaint.building.name, "Test Main Block");
  assert.equal(complaint.room.name, "Test Main Room");
  assert.equal(complaint.asset.name, "Test Projector");
  assert.match(complaint.locationText, /Near the teaching desk/);
  assert(Number.isFinite(Date.parse(complaint.createdAt)));
  const row = await prisma.incident.findUniqueOrThrow({ where: { id: complaint.id } });
  assert.equal(row.reporterId, accounts.get(Role.STUDENT)!.id);
  assert.equal(row.priority, "MEDIUM", "Reported urgency must not silently become operational priority");
  assert.equal(row.assigneeId, null);
  assert.equal(row.status, "REPORTED");
  const selfDetail = await request(`/api/complaints/${complaint.id}`, { headers: { Cookie: student.cookie } });
  assert.equal(selfDetail.status, 200);
  const selfBody = await selfDetail.json();
  assert.equal(selfBody.complaint.id, complaint.id);
  assert.equal(selfBody.complaint.history.length, 1);
  assert.equal(selfBody.complaint.history[0].action, "SUBMITTED");
  assertPublicEvent(selfBody.complaint.history[0]);
  const forbiddenFields = ["reporterId", "reporter", "assigneeId", "assignee", "email", "priority", "blockedReason", "summary", "submissionKey", "submissionHash"];
  for (const field of forbiddenFields) assert(!(field in selfBody.complaint), `Own complaint must not expose ${field}`);

  const admin = await login(Role.FACILITIES_ADMIN);
  const dashboard = await request("/api/dashboard", { headers: { Cookie: admin.cookie } });
  assert.equal(dashboard.status, 200);
  const data = await dashboard.json();
  assert(data.incidents.some((incident: { id: string }) => incident.id === complaint.id));
  assert.equal((await request("/api/dashboard", { headers: { Cookie: student.cookie } })).status, 403);

  await stopServer();
  await startServer();
  const afterRestart = await request(`/api/complaints/${complaint.id}`, { headers: { Cookie: student.cookie } });
  assert.equal(afterRestart.status, 200);
  assert.equal((await afterRestart.json()).complaint.description, complaintPayload().description);
});

test("complaints remain owner-scoped even with query spoofing or an admin cookie", async () => {
  const student = await login(Role.STUDENT);
  const faculty = await login(Role.FACULTY);
  const admin = await login(Role.SYSTEM_ADMIN);
  const title = `Private faculty report ${randomBytes(6).toString("hex")}`;
  const created = await submitComplaint(faculty.cookie, complaintPayload({ title }));
  assert.equal(created.status, 201);
  const { complaint } = await created.json();
  for (const cookie of [student.cookie, admin.cookie]) {
    const other = await request(`/api/complaints/${complaint.id}`, { headers: { Cookie: cookie } });
    const unknown = await request("/api/complaints/does-not-exist", { headers: { Cookie: cookie } });
    assert.equal(other.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await other.json(), await unknown.json());
    const list = await request(`/api/complaints?reporterId=${accounts.get(Role.FACULTY)!.id}&role=SYSTEM_ADMIN`, { headers: { Cookie: cookie, "X-Role": "SYSTEM_ADMIN" } });
    assert([200, 400].includes(list.status));
    assert(!(await list.text()).includes(title));
  }
  const facultyList = await request("/api/complaints", { headers: { Cookie: faculty.cookie } });
  assert((await facultyList.text()).includes(title));
});

test("complaint submission validates fields and location relationships without partial writes", async () => {
  const { cookie } = await login(Role.STUDENT);
  const before = await prisma.incident.count();
  const invalid = [
    { title: "bad" },
    { title: "x".repeat(121) },
    { description: "too short" },
    { description: "x".repeat(4001) },
    { category: "UNAUTHORIZED_CATEGORY" },
    { reportedUrgency: "ASAP" },
    { buildingId: "" },
    { buildingId: "missing-building" },
    { roomId: "missing-room", assetId: null },
    { roomId: "test-other-room", assetId: null },
    { assetId: "test-other-asset" },
    { assetId: "missing-asset" },
    { roomId: null, assetId: "test-projector" },
    { busId: "test-bus" },
    { category: "TRANSPORT", busId: "missing-bus" },
    { locationDetails: "x".repeat(201) },
    { title: 42 },
    { reporterId: accounts.get(Role.FACULTY)!.id },
    { status: "RESOLVED" },
    { priority: "CRITICAL" },
    { assigneeId: accounts.get(Role.TECHNICIAN)!.id },
    { summary: "Forged administrative summary" },
  ];
  for (const overrides of invalid) {
    const response = await submitComplaint(cookie, complaintPayload(overrides));
    assert.equal(response.status, 400, `Invalid submission accepted: ${JSON.stringify(Object.keys(overrides))}`);
  }
  assert.equal((await post("/api/complaints", complaintPayload(), cookie)).status, 400);
  assert.equal((await submitComplaint(cookie, complaintPayload(), "not-a-uuid")).status, 400);
  assert.equal(await prisma.incident.count(), before);
  const transport = await submitComplaint(cookie, complaintPayload({
    title: "Bus needs maintenance inspection",
    category: "TRANSPORT",
    roomId: null,
    assetId: null,
    busId: "test-bus",
  }));
  assert.equal(transport.status, 201);
  assert.equal((await transport.json()).complaint.bus.fleetCode, "TEST-BUS");
});

test("complaint mutations reject cross-origin, malformed, and oversized requests", async () => {
  const { cookie } = await login(Role.STUDENT);
  const before = await prisma.incident.count();
  const rejectedHeaders: Record<string, string>[] = [
    { Origin: "https://attacker.example" },
    { Origin: "null" },
    { "Sec-Fetch-Site": "cross-site" },
  ];
  for (const headers of rejectedHeaders) {
    const response = await post("/api/complaints", complaintPayload(), cookie, { "Idempotency-Key": randomUUID(), ...headers });
    assert.equal(response.status, 403);
  }
  const missingOrigin = await request("/api/complaints", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(complaintPayload()) });
  assert.equal(missingOrigin.status, 403);
  const form = await request("/api/complaints", { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": randomUUID() }, body: "title=forged" });
  assert.equal(form.status, 415);
  const malformed = await request("/api/complaints", { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await submitComplaint(cookie, complaintPayload({ description: "x".repeat(30_000) }))).status, 413);
  assert.equal(await prisma.incident.count(), before);
});

test("repeated and concurrent submissions create one complaint per user and key", async () => {
  const student = await login(Role.STUDENT);
  const faculty = await login(Role.FACULTY);
  const key = randomUUID();
  const payload = complaintPayload({ title: "Repeated submission should stay unique" });
  const before = await prisma.incident.count();
  const responses = await Promise.all(Array.from({ length: 5 }, () => submitComplaint(student.cookie, payload, key)));
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  assert.equal(responses.filter((response) => response.status === 200).length, 4);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(new Set(bodies.map((body) => body.complaint.id)).size, 1);
  assert.equal(bodies.filter((body) => body.replayed).length, 4);
  assert.equal(await prisma.incident.count(), before + 1);
  assert.equal(await prisma.incidentEvent.count({ where: { incidentId: bodies[0].complaint.id, action: "SUBMITTED" } }), 1);
  const normalizedRetry = await submitComplaint(student.cookie, {
    ...payload,
    title: `  ${payload.title}  `,
    description: `\n${payload.description}\n`,
  }, key.toUpperCase());
  assert.equal(normalizedRetry.status, 200);
  assert.equal((await normalizedRetry.json()).complaint.id, bodies[0].complaint.id);
  const conflict = await submitComplaint(student.cookie, complaintPayload({ title: "Different complaint with reused key" }), key);
  assert.equal(conflict.status, 409);
  assert.equal(await prisma.incident.count(), before + 1);
  const sameKeyOtherUser = await submitComplaint(faculty.cookie, payload, key);
  assert.equal(sameKeyOtherUser.status, 201);
  assert.notEqual((await sameKeyOtherUser.json()).complaint.id, bodies[0].complaint.id);
});

test("own complaint search, status filtering, and pagination do not reveal another reporter", async () => {
  const { cookie } = await login(Role.FACULTY);
  const prefix = `Pagination-${randomBytes(6).toString("hex")}`;
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await prisma.incident.createMany({ data: Array.from({ length: 25 }, (_, index) => ({
    id: `test-page-${randomUUID()}`,
    title: `${prefix} ${index}`,
    description: "A saved request for exercising pagination and status filtering.",
    reporterId: accounts.get(Role.FACULTY)!.id,
    buildingId: "test-main",
    createdAt: old,
    status: index < 4 ? "RESOLVED" as const : "REPORTED" as const,
    resolvedAt: index < 4 ? old : null,
    blockedReason: "PRIVATE OPERATIONS NOTE",
    summary: "PRIVATE STAFF SUMMARY",
  })) });
  await prisma.incident.create({ data: { title: `${prefix} different reporter`, description: "This must not affect somebody else's search count.", reporterId: accounts.get(Role.STUDENT)!.id, createdAt: old } });
  const query = encodeURIComponent(prefix);
  const first = await request(`/api/complaints?q=${query}&page=1`, { headers: { Cookie: cookie } });
  assert.equal(first.status, 200);
  const one = await first.json();
  assert.equal(one.total, 25);
  assert.equal(one.pageSize, 20);
  assert.equal(one.totalPages, 2);
  assert.equal(one.items.length, 20);
  const second = await request(`/api/complaints?q=${query}&page=2`, { headers: { Cookie: cookie } });
  const two = await second.json();
  assert.equal(two.items.length, 5);
  const ids = [...one.items, ...two.items].map((item: { id: string }) => item.id);
  assert.equal(new Set(ids).size, 25);
  const filtered = await request(`/api/complaints?q=${query}&status=RESOLVED`, { headers: { Cookie: cookie } });
  const resolved = await filtered.json();
  assert.equal(resolved.total, 4);
  assert(resolved.items.every((item: { status: string }) => item.status === "RESOLVED"));
  assert(!JSON.stringify(one).includes("PRIVATE OPERATIONS NOTE"));
  assert(!JSON.stringify(one).includes("PRIVATE STAFF SUMMARY"));
  for (const suffix of ["page=0", "page=bad", "status=MADE_UP", `q=${"x".repeat(101)}`]) {
    assert.equal((await request(`/api/complaints?${suffix}`, { headers: { Cookie: cookie } })).status, 400);
  }
});

test("expired, inactive, and role-revoked sessions cannot submit or read complaints", async () => {
  const session = await login(Role.STUDENT);
  const userId = accounts.get(Role.STUDENT)!.id;
  const check = async (status: number) => {
    assert.equal((await request("/api/complaints", { headers: { Cookie: session.cookie } })).status, status);
    assert.equal((await request("/api/complaints/options", { headers: { Cookie: session.cookie } })).status, status);
    assert.equal((await submitComplaint(session.cookie)).status, status);
  };
  try {
    await prisma.user.update({ where: { id: userId }, data: { role: Role.TECHNICIAN } });
    await check(403);
    await prisma.user.update({ where: { id: userId }, data: { role: Role.STUDENT, active: false } });
    await check(401);
  } finally {
    await prisma.user.update({ where: { id: userId }, data: { role: Role.STUDENT, active: true } });
  }
  await prisma.session.update({ where: { tokenHash: createHash("sha256").update(session.token).digest("hex") }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await check(401);
});

test("the hourly submission cap blocks new writes but permits safe retries", async () => {
  const username = `quota.${randomBytes(6).toString("hex")}`;
  const password = randomPassword();
  const user = await prisma.user.create({ data: {
    name: "Complaint quota test", email: `${username}@example.invalid`, role: Role.STUDENT,
    credential: { create: { username, passwordHash: await hashPassword(password) } },
  } });
  const signedIn = await post("/api/auth/login", { username, password });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get("set-cookie")!.split(";")[0];
  await prisma.incident.createMany({ data: Array.from({ length: 19 }, (_, index) => ({
    title: `Quota fixture ${index}`, description: "A recent submitted complaint used only for the isolated quota test.",
    reporterId: user.id, submissionKey: randomUUID(), submissionHash: "a".repeat(64),
    reportedUrgency: "MEDIUM" as const, buildingId: "test-main",
  })) });
  const key = randomUUID();
  const payload = complaintPayload();
  const twentieth = await submitComplaint(cookie, payload, key);
  assert.equal(twentieth.status, 201);
  const id = (await twentieth.json()).complaint.id;
  const capped = await submitComplaint(cookie, complaintPayload({ title: "The twenty first new complaint" }));
  assert.equal(capped.status, 429);
  assert(Number(capped.headers.get("retry-after")) > 0);
  assert.equal(await prisma.incident.count({ where: { reporterId: user.id } }), 20);
  const retry = await submitComplaint(cookie, payload, key);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).complaint.id, id);
  await prisma.incident.updateMany({ where: { reporterId: user.id }, data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
  assert.equal((await submitComplaint(cookie, complaintPayload({ title: "New complaint after the time window" }))).status, 201);
});

function assertPublicEvent(event: PublicEvent) {
  assert.deepEqual(Object.keys(event).sort(), [
    "id", "action", "fromStatus", "toStatus", "fromCategory", "toCategory", "fromPriority", "toPriority",
    "fromAssigneeName", "toAssigneeName", "actorName", "actorRole", "note", "createdAt",
  ].sort());
  assert(Number.isFinite(Date.parse(event.createdAt)));
}

function workflowAction(cookie: string, id: string, body: Record<string, unknown>, key: string = randomUUID()) {
  return post(`/api/work-orders/${id}/actions`, body, cookie, { "Idempotency-Key": key });
}

async function act(cookie: string, order: Pick<WorkflowView, "id" | "version">, action: string, extra: Record<string, unknown> = {}) {
  const response = await workflowAction(cookie, order.id, {
    action, expectedVersion: order.version, note: `Test ${action.toLowerCase()} explanation`, ...extra,
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${action} failed: ${JSON.stringify(body)}`);
  assert.equal(body.replayed, false);
  assert.equal(body.workOrder.version, order.version + 1);
  return body.workOrder as WorkflowView;
}

async function getOrder(cookie: string, id: string) {
  const response = await request(`/api/work-orders/${id}`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  return (await response.json()).workOrder as WorkflowView;
}

async function fixtureOrder(overrides: {
  title?: string; status?: IncidentStatus; priority?: Priority; category?: string;
  assigneeId?: string | null; createdAt?: Date; closedAt?: Date;
} = {}) {
  return prisma.incident.create({ data: {
    title: `Workflow fixture ${randomUUID()}`, description: "An isolated work order used to verify workflow protections.",
    reporterId: accounts.get(Role.STUDENT)!.id, buildingId: "test-main", category: "EQUIPMENT", ...overrides,
  } });
}

function putWorkforce(cookie: string, userId: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return request(`/api/workforce/${userId}`, {
    method: "PUT", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function workforcePayload(expectedVersion: number, overrides: Record<string, unknown> = {}) {
  return { expectedVersion, skills: ["EQUIPMENT"], onDuty: true, maxActiveJobs: 3, availableFrom: null, availableUntil: null, ...overrides };
}

async function configureTechnician(cookie: string, userId: string, overrides: Record<string, unknown> = {}) {
  const profile = await prisma.technicianProfile.findUnique({ where: { userId } });
  const response = await putWorkforce(cookie, userId, workforcePayload(profile?.version ?? 0, overrides));
  const body = await response.json();
  assert.equal(response.status, 200, `Technician configuration failed: ${JSON.stringify(body)}`);
  return body;
}

async function orderSnapshot(id: string) {
  return {
    order: await prisma.incident.findUniqueOrThrow({ where: { id } }),
    events: await prisma.incidentEvent.findMany({ where: { incidentId: id }, orderBy: { id: "asc" } }),
  };
}

test("work orders and workforce enforce session and role access on every endpoint", async () => {
  await assertRedirect(await request("/work-orders"), "/login");
  for (const route of ["/api/work-orders", "/api/work-orders/missing", "/api/work-orders/missing/candidates", "/api/workforce"]) {
    const response = await request(route);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
  const signedOutAction = await post("/api/work-orders/missing/actions", {
    action: "TRIAGE", expectedVersion: 0, note: "Unauthenticated action", category: "EQUIPMENT", priority: "HIGH",
  }, undefined, { "Idempotency-Key": randomUUID() });
  assert.equal(signedOutAction.status, 401);
  for (const role of Object.values(Role)) {
    const { cookie } = await login(role);
    const admin = role === Role.FACILITIES_ADMIN || role === Role.SYSTEM_ADMIN;
    const allowed = admin || role === Role.TECHNICIAN;
    assert.equal((await request("/api/work-orders", { headers: { Cookie: cookie } })).status, allowed ? 200 : 403);
    assert.equal((await request("/api/workforce", { headers: { Cookie: cookie } })).status, admin ? 200 : 403);
    assert.equal((await request("/api/work-orders/missing/candidates", { headers: { Cookie: cookie } })).status, admin ? 404 : 403);
    if (allowed) {
      assert.equal((await request("/work-orders", { headers: { Cookie: cookie } })).status, 200);
    } else {
      await assertRedirect(await request("/work-orders", { headers: { Cookie: cookie } }), "/");
      assert.equal((await workflowAction(cookie, "missing", { action: "START", expectedVersion: 0, note: "Forged role action" })).status, 403);
    }
    if (!admin) {
      assert.equal((await putWorkforce(cookie, accounts.get(Role.TECHNICIAN)!.id, workforcePayload(0))).status, 403);
    }
  }
});

test("workforce configuration validates fields, protects credentials, and rejects stale edits", async () => {
  const { cookie } = await login(Role.SYSTEM_ADMIN);
  const techId = accounts.get("SECOND_TECHNICIAN")!.id;
  const credentials = await prisma.credential.findMany({ orderBy: { id: "asc" } });
  assert.equal(await prisma.technicianProfile.findUnique({ where: { userId: techId } }), null);
  const workforce = await request("/api/workforce", { headers: { Cookie: cookie } });
  assert.equal(workforce.status, 200);
  const defaultTechnician = ((await workforce.json()).technicians as Technician[]).find((entry) => entry.id === techId)!;
  assert.deepEqual(defaultTechnician.skills, []);
  assert.equal(defaultTechnician.onDuty, false);
  assert.equal(defaultTechnician.version, 0);
  assert.equal(defaultTechnician.maxActiveJobs, 3);
  assert.equal(defaultTechnician.eligible, false);
  for (const field of ["email", "credential", "passwordHash", "sessions"]) assert(!(field in defaultTechnician));
  const invalid = [
    { skills: [] }, { skills: ["UNKNOWN"] }, { skills: "EQUIPMENT" }, { onDuty: "true" },
    { maxActiveJobs: 0 }, { maxActiveJobs: 21 }, { maxActiveJobs: 1.5 }, { expectedVersion: -1 },
    { availableFrom: "tomorrow" }, { availableUntil: "not-a-date" },
    { availableFrom: "2026-10-31T12:00:00.000Z", availableUntil: "2026-10-30T12:00:00.000Z" },
    { role: "SYSTEM_ADMIN" }, { active: true }, { password: randomPassword() }, { userId: accounts.get(Role.STUDENT)!.id },
  ];
  for (const overrides of invalid) {
    assert.equal((await putWorkforce(cookie, techId, workforcePayload(0, overrides))).status, 400);
  }
  assert.equal(await prisma.technicianProfile.findUnique({ where: { userId: techId } }), null);
  assert.equal((await putWorkforce(cookie, techId, workforcePayload(0), { Origin: "https://attacker.example" })).status, 403);
  assert.equal((await putWorkforce(cookie, techId, workforcePayload(0), { "Content-Type": "text/plain" })).status, 415);
  await configureTechnician(cookie, techId);
  assert.equal((await prisma.technicianProfile.findUniqueOrThrow({ where: { userId: techId } })).version, 1);
  assert.equal((await putWorkforce(cookie, techId, workforcePayload(0, { onDuty: false }))).status, 409);
  assert.equal((await prisma.technicianProfile.findUniqueOrThrow({ where: { userId: techId } })).onDuty, true);
  const wrongRole = await putWorkforce(cookie, accounts.get(Role.STUDENT)!.id, workforcePayload(0));
  assert([400, 404, 409].includes(wrongRole.status));
  assert.deepEqual(await prisma.credential.findMany({ orderBy: { id: "asc" } }), credentials);
});

test("a reported complaint completes triage, assignment, repair, verification, and a public audit history", async () => {
  const student = await login(Role.STUDENT);
  const admin = await login(Role.FACILITIES_ADMIN);
  const technician = await login(Role.TECHNICIAN);
  const techId = accounts.get(Role.TECHNICIAN)!.id;
  await configureTechnician(admin.cookie, techId);
  const submitted = await submitComplaint(student.cookie, complaintPayload({ title: "Full workflow projector repair" }));
  assert.equal(submitted.status, 201);
  const id = (await submitted.json()).complaint.id as string;
  let order = await getOrder(admin.cookie, id);
  assert.equal(order.version, 0);
  assert.equal(order.history.length, 1);
  assert.equal(order.history[0].action, "SUBMITTED");
  order = await act(admin.cookie, order, "TRIAGE", { category: "EQUIPMENT", priority: "CRITICAL" });
  assert.equal(order.status, "TRIAGED");
  assert.equal(order.priority, "CRITICAL");
  order = await act(admin.cookie, order, "ASSIGN", { assigneeId: techId });
  assert.equal(order.status, "ASSIGNED");
  assert.equal(order.assignee?.id, techId);
  order = await act(technician.cookie, order, "START");
  assert.equal(order.status, "IN_PROGRESS");
  order = await act(technician.cookie, order, "BLOCK", { note: "Waiting for the replacement projector power supply" });
  assert.equal(order.status, "BLOCKED");
  assert.equal(order.blockedReason, "Waiting for the replacement projector power supply");
  order = await act(technician.cookie, order, "RESUME");
  assert.equal(order.status, "IN_PROGRESS");
  assert.equal(order.blockedReason, null);
  const resolution = "Replaced the power supply and verified a full classroom projection test";
  order = await act(technician.cookie, order, "RESOLVE", { note: resolution });
  assert.equal(order.status, "RESOLVED");
  assert.equal(order.resolutionNote, resolution);
  assert(Number.isFinite(Date.parse(order.resolvedAt!)));
  order = await act(admin.cookie, order, "CLOSE", { note: "Verified the repair with the classroom reporter" });
  assert.equal(order.status, "CLOSED");
  assert(Number.isFinite(Date.parse(order.closedAt!)));
  assert.equal(order.version, 7);
  const actions = order.history.map((event) => event.action);
  assert.equal(actions.length, 8);
  for (const action of ["SUBMITTED", "TRIAGE", "ASSIGN", "START", "BLOCK", "RESUME", "RESOLVE", "CLOSE"]) {
    assert.equal(actions.filter((value) => value === action).length, 1);
  }
  for (const event of order.history) assertPublicEvent(event);
  const assigned = order.history.find((event) => event.action === "ASSIGN")!;
  assert.equal(assigned.fromStatus, "TRIAGED");
  assert.equal(assigned.toStatus, "ASSIGNED");
  assert.equal(assigned.fromAssigneeName, null);
  assert.equal(assigned.toAssigneeName, "Auth test TECHNICIAN");
  assert.equal(assigned.actorRole, Role.FACILITIES_ADMIN);
  const tracked = await request(`/api/complaints/${id}`, { headers: { Cookie: student.cookie } });
  assert.equal(tracked.status, 200);
  const complaint = (await tracked.json()).complaint;
  assert.equal(complaint.status, "CLOSED");
  assert.deepEqual(complaint.history, order.history);
  assert(complaint.history.some((event: PublicEvent) => event.note === resolution));
  const snapshot = await orderSnapshot(id);
  assert.equal((await workflowAction(admin.cookie, id, { action: "REOPEN", expectedVersion: order.version, note: "Attempt to reopen closed work" })).status, 409);
  assert.deepEqual(await orderSnapshot(id), snapshot);
  // Historical names are snapshots, including after a display-name edit.
  await prisma.user.update({ where: { id: techId }, data: { name: "Renamed test technician" } });
  try {
    assert.deepEqual((await getOrder(admin.cookie, id)).history, order.history);
  } finally {
    await prisma.user.update({ where: { id: techId }, data: { name: "Auth test TECHNICIAN" } });
  }
});

test("reassignment removes the former technician's access and reopening clears repair state", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const first = await login(Role.TECHNICIAN);
  const second = await login("SECOND_TECHNICIAN");
  const row = await fixtureOrder({ status: "TRIAGED" });
  let order = await act(admin.cookie, row, "ASSIGN", { assigneeId: accounts.get(Role.TECHNICIAN)!.id });
  order = await act(first.cookie, order, "START");
  order = await act(first.cookie, order, "BLOCK", { note: "Requires a different specialist for the replacement" });
  order = await act(admin.cookie, order, "ASSIGN", { assigneeId: accounts.get("SECOND_TECHNICIAN")!.id });
  assert.equal(order.status, "ASSIGNED");
  assert.equal(order.blockedReason, null);
  const snapshot = await orderSnapshot(row.id);
  assert.equal((await request(`/api/work-orders/${row.id}`, { headers: { Cookie: first.cookie } })).status, 404);
  assert.equal((await workflowAction(first.cookie, row.id, { action: "START", expectedVersion: order.version, note: "Former technician attempts to start" })).status, 404);
  const formerQueue = await request(`/api/work-orders?q=${encodeURIComponent(row.title)}`, { headers: { Cookie: first.cookie } });
  assert.equal((await formerQueue.json()).total, 0);
  assert.deepEqual(await orderSnapshot(row.id), snapshot);
  order = await act(second.cookie, order, "START");
  order = await act(second.cookie, order, "RESOLVE", { note: "Replacement completed and inspected by the technician" });
  order = await act(admin.cookie, order, "REOPEN", { note: "Reporter observed the same fault after the repair" });
  assert.equal(order.status, "TRIAGED");
  assert.equal(order.assignee, null);
  assert.equal(order.resolutionNote, null);
  assert.equal(order.resolvedAt, null);
  assert.equal(order.closedAt, null);
  assert.equal((await request(`/api/work-orders/${row.id}`, { headers: { Cookie: second.cookie } })).status, 404);
  assert(order.history.some((event) => event.action === "RESOLVE"));
  const transition = order.history.find((event) => event.action === "REOPEN")!;
  assert.equal(transition.fromStatus, "RESOLVED");
  assert.equal(transition.toStatus, "TRIAGED");
  assert.equal(transition.toAssigneeName, null);
});

test("invalid transitions, forged fields, and cross-role actions leave state and audit unchanged", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const technician = await login(Role.TECHNICIAN);
  const student = await login(Role.STUDENT);
  const row = await fixtureOrder();
  const snapshot = await orderSnapshot(row.id);
  const triage = { action: "TRIAGE", expectedVersion: 0, note: "Reviewed the reported fault", category: "EQUIPMENT", priority: "HIGH" };
  const invalidBodies = [
    { ...triage, action: "DELETE" }, { ...triage, note: "bad" }, { ...triage, note: "x".repeat(2001) },
    { ...triage, expectedVersion: -1 }, { ...triage, expectedVersion: 1.5 }, { ...triage, expectedVersion: "0" },
    { ...triage, category: "UNKNOWN" }, { ...triage, priority: "URGENT" },
    { ...triage, reporterId: accounts.get(Role.FACULTY)!.id }, { ...triage, status: "CLOSED" },
    { ...triage, actorId: accounts.get(Role.SYSTEM_ADMIN)!.id }, { ...triage, resolutionNote: "Forged repair" },
    { action: "TRIAGE", expectedVersion: 0, note: "Missing required triage data" },
  ];
  for (const body of invalidBodies) assert.equal((await workflowAction(admin.cookie, row.id, body)).status, 400);
  assert.equal((await post(`/api/work-orders/${row.id}/actions`, triage, admin.cookie)).status, 400);
  assert.equal((await workflowAction(admin.cookie, row.id, triage, "invalid-key")).status, 400);
  for (const action of ["ASSIGN", "CLOSE", "REOPEN"]) {
    const response = await workflowAction(admin.cookie, row.id, {
      action, expectedVersion: 0, note: "Cannot skip the required workflow state",
      ...(action === "ASSIGN" ? { assigneeId: accounts.get(Role.TECHNICIAN)!.id } : {}),
    });
    assert.equal(response.status, 409);
  }
  assert.equal((await workflowAction(admin.cookie, row.id, { action: "START", expectedVersion: 0, note: "An administrator cannot start a repair" })).status, 403);
  assert.equal((await workflowAction(student.cookie, row.id, triage)).status, 403);
  assert.deepEqual(await orderSnapshot(row.id), snapshot);
  const assigned = await act(admin.cookie, await act(admin.cookie, row, "TRIAGE", { category: "EQUIPMENT", priority: "HIGH" }), "ASSIGN", { assigneeId: accounts.get(Role.TECHNICIAN)!.id });
  const assignedSnapshot = await orderSnapshot(row.id);
  assert.equal((await workflowAction(technician.cookie, row.id, { ...triage, expectedVersion: assigned.version })).status, 403);
  assert.equal((await workflowAction(technician.cookie, row.id, { action: "RESOLVE", expectedVersion: assigned.version, note: "Resolution before work has started" })).status, 409);
  assert.equal((await workflowAction(admin.cookie, row.id, { action: "ASSIGN", expectedVersion: assigned.version, note: "Reassigning to the same technician", assigneeId: accounts.get(Role.TECHNICIAN)!.id })).status, 409);
  assert.deepEqual(await orderSnapshot(row.id), assignedSnapshot);
  let closed = await act(technician.cookie, assigned, "START");
  closed = await act(technician.cookie, closed, "RESOLVE");
  await act(admin.cookie, closed, "CLOSE");
});

test("work-order mutations enforce origin, content type, size, and JSON parsing", async () => {
  const { cookie } = await login(Role.FACILITIES_ADMIN);
  const row = await fixtureOrder();
  const snapshot = await orderSnapshot(row.id);
  const route = `/api/work-orders/${row.id}/actions`;
  const payload = { action: "TRIAGE", expectedVersion: 0, note: "Checked the reported equipment fault", category: "EQUIPMENT", priority: "MEDIUM" };
  const rejectedHeaders: Record<string, string>[] = [
    { Origin: "https://attacker.example" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" },
  ];
  for (const extraHeaders of rejectedHeaders) {
    assert.equal((await post(route, payload, cookie, { "Idempotency-Key": randomUUID(), ...extraHeaders })).status, 403);
  }
  assert.equal((await request(route, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(payload) })).status, 403);
  assert.equal((await post(route, payload, cookie, { "Idempotency-Key": randomUUID(), "Content-Type": "text/plain" })).status, 415);
  assert.equal((await request(route, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: "{" })).status, 400);
  assert.equal((await workflowAction(cookie, row.id, { ...payload, note: "x".repeat(30_000) })).status, 413);
  assert.deepEqual(await orderSnapshot(row.id), snapshot);
});

test("assignment rejects unavailable, inactive, unqualified, and full technicians", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const techId = accounts.get("SECOND_TECHNICIAN")!.id;
  const row = await fixtureOrder({ status: "TRIAGED" });
  const snapshot = await orderSnapshot(row.id);
  const candidateFor = async () => {
    const response = await request(`/api/work-orders/${row.id}/candidates`, { headers: { Cookie: admin.cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const candidates = (await response.json()).candidates as Technician[];
    return candidates.find((entry) => entry.id === techId);
  };
  const rejectsAssignment = async () => {
    const candidate = await candidateFor();
    assert(!candidate?.eligible, "Ineligible technician must not be offered as assignable");
    if (candidate) assert(candidate.reasons.length > 0);
    assert.equal((await workflowAction(admin.cookie, row.id, {
      action: "ASSIGN", expectedVersion: 0, note: "Attempted assignment to an ineligible technician", assigneeId: techId,
    })).status, 409);
    assert.deepEqual(await orderSnapshot(row.id), snapshot);
  };
  const now = Date.now();
  const unavailable = [
    { onDuty: false },
    { skills: ["NETWORK"] },
    { availableFrom: new Date(now + 60 * 60 * 1000).toISOString() },
    { availableUntil: new Date(now - 60 * 1000).toISOString() },
  ];
  for (const settings of unavailable) {
    await configureTechnician(admin.cookie, techId, settings);
    await rejectsAssignment();
  }
  await configureTechnician(admin.cookie, techId, { maxActiveJobs: 1 });
  await prisma.user.update({ where: { id: techId }, data: { active: false } });
  try { await rejectsAssignment(); } finally {
    await prisma.user.update({ where: { id: techId }, data: { active: true } });
  }
  const occupying = await fixtureOrder({ status: "BLOCKED", assigneeId: techId });
  try { await rejectsAssignment(); } finally {
    await prisma.incident.update({ where: { id: occupying.id }, data: { status: "CLOSED", closedAt: new Date() } });
  }
  await configureTechnician(admin.cookie, techId);
  assert.equal((await candidateFor())?.eligible, true);
});

test("start and resume recheck availability and configuration cannot invalidate open assignments", async () => {
  const admin = await login(Role.FACILITIES_ADMIN);
  const technician = await login(Role.TECHNICIAN);
  const techId = accounts.get(Role.TECHNICIAN)!.id;
  await configureTechnician(admin.cookie, techId, { maxActiveJobs: 2 });
  const row = await fixtureOrder({ status: "TRIAGED" });
  let order = await act(admin.cookie, row, "ASSIGN", { assigneeId: techId });
  const version = (await prisma.technicianProfile.findUniqueOrThrow({ where: { userId: techId } })).version;
  assert.equal((await putWorkforce(admin.cookie, techId, workforcePayload(version, { skills: ["NETWORK"] }))).status, 409);
  const secondRow = await fixtureOrder({ status: "TRIAGED" });
  let second = await act(admin.cookie, secondRow, "ASSIGN", { assigneeId: techId });
  assert.equal((await putWorkforce(admin.cookie, techId, workforcePayload(version, { maxActiveJobs: 1 }))).status, 409);
  await configureTechnician(admin.cookie, techId, { onDuty: false });
  let snapshot = await orderSnapshot(row.id);
  assert.equal((await workflowAction(technician.cookie, row.id, { action: "START", expectedVersion: order.version, note: "Cannot start while off duty" })).status, 409);
  assert.deepEqual(await orderSnapshot(row.id), snapshot);
  await configureTechnician(admin.cookie, techId);
  order = await act(technician.cookie, order, "START");
  order = await act(technician.cookie, order, "BLOCK");
  await configureTechnician(admin.cookie, techId, { onDuty: false });
  snapshot = await orderSnapshot(row.id);
  assert.equal((await workflowAction(technician.cookie, row.id, { action: "RESUME", expectedVersion: order.version, note: "Cannot resume while off duty" })).status, 409);
  assert.deepEqual(await orderSnapshot(row.id), snapshot);
  await configureTechnician(admin.cookie, techId);
  order = await act(technician.cookie, order, "RESUME");
  order = await act(technician.cookie, order, "RESOLVE");
  await act(admin.cookie, order, "CLOSE");
  second = await act(technician.cookie, second, "START");
  second = await act(technician.cookie, second, "RESOLVE");
  await act(admin.cookie, second, "CLOSE");
});

test("concurrent assignments to the last available slot cannot exceed workload capacity", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const technician = await login("SECOND_TECHNICIAN");
  const techId = accounts.get("SECOND_TECHNICIAN")!.id;
  await configureTechnician(admin.cookie, techId, { maxActiveJobs: 1 });
  const orders = await Promise.all([fixtureOrder({ status: "TRIAGED" }), fixtureOrder({ status: "TRIAGED" })]);
  const responses = await Promise.all(orders.map((order) => workflowAction(admin.cookie, order.id, {
    action: "ASSIGN", expectedVersion: 0, note: "Competing assignment for the final workload slot", assigneeId: techId,
  })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(await prisma.incident.count({ where: { assigneeId: techId, status: { in: ["ASSIGNED", "IN_PROGRESS", "BLOCKED"] } } }), 1);
  assert.equal(await prisma.incidentEvent.count({ where: { incidentId: { in: orders.map((order) => order.id) } } }), 1);
  const snapshots = await Promise.all(orders.map((order) => orderSnapshot(order.id)));
  assert.deepEqual(snapshots.map((snapshot) => snapshot.order.version).sort(), [0, 1]);
  const winner = snapshots.find((snapshot) => snapshot.order.status === "ASSIGNED")!.order;
  const loser = snapshots.find((snapshot) => snapshot.order.status === "TRIAGED")!.order;
  assert.equal(loser.assigneeId, null);
  let finished = await act(technician.cookie, winner, "START");
  finished = await act(technician.cookie, finished, "RESOLVE");
  await act(admin.cookie, finished, "CLOSE");
  await configureTechnician(admin.cookie, techId);
});

test("concurrent workload edits and assignments preserve the configured capacity", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const technician = await login("SECOND_TECHNICIAN");
  const techId = accounts.get("SECOND_TECHNICIAN")!.id;
  await configureTechnician(admin.cookie, techId, { maxActiveJobs: 2 });
  const first = await fixtureOrder({ status: "TRIAGED" });
  const assigned = await act(admin.cookie, first, "ASSIGN", { assigneeId: techId });
  const second = await fixtureOrder({ status: "TRIAGED" });
  const profile = await prisma.technicianProfile.findUniqueOrThrow({ where: { userId: techId } });
  const responses = await Promise.all([
    putWorkforce(admin.cookie, techId, workforcePayload(profile.version, { maxActiveJobs: 1 })),
    workflowAction(admin.cookie, second.id, { action: "ASSIGN", expectedVersion: 0, note: "Assignment competing with a lower capacity limit", assigneeId: techId }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const configured = await prisma.technicianProfile.findUniqueOrThrow({ where: { userId: techId } });
  const active = await prisma.incident.findMany({ where: { assigneeId: techId, status: { in: ["ASSIGNED", "IN_PROGRESS", "BLOCKED"] } } });
  assert(active.length <= configured.maxActiveJobs);
  assert.equal(active.length, responses[1].status === 200 ? 2 : 1);
  assert.equal(await prisma.incidentEvent.count({ where: { incidentId: second.id } }), responses[1].status === 200 ? 1 : 0);
  for (const order of active) {
    assert(order.id === assigned.id || order.id === second.id);
    let finished = await act(technician.cookie, order, "START");
    finished = await act(technician.cookie, finished, "RESOLVE");
    await act(admin.cookie, finished, "CLOSE");
  }
  await configureTechnician(admin.cookie, techId);
});

test("concurrent retry keys create one audit event while stale and changed requests conflict", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const otherAdmin = await login(Role.FACILITIES_ADMIN);
  const row = await fixtureOrder();
  const key = randomUUID();
  const payload = { action: "TRIAGE", expectedVersion: 0, note: "Reviewed the issue and confirmed its priority", category: "EQUIPMENT", priority: "HIGH" };
  const responses = await Promise.all(Array.from({ length: 5 }, () => workflowAction(admin.cookie, row.id, payload, key)));
  assert(responses.every((response) => response.status === 200), `Retry statuses: ${responses.map((response) => response.status).join(", ")}`);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(bodies.filter((body) => body.replayed === false).length, 1);
  assert.equal(bodies.filter((body) => body.replayed === true).length, 4);
  assert(bodies.every((body) => body.workOrder.version === 1));
  assert.equal(await prisma.incidentEvent.count({ where: { incidentId: row.id } }), 1);
  const snapshot = await orderSnapshot(row.id);
  assert.equal((await workflowAction(admin.cookie, row.id, { ...payload, priority: "LOW" }, key)).status, 409);
  assert.equal((await workflowAction(admin.cookie, row.id, payload)).status, 409);
  const different = await fixtureOrder();
  assert.equal((await workflowAction(admin.cookie, different.id, payload, key)).status, 409);
  assert.equal((await prisma.incident.findUniqueOrThrow({ where: { id: different.id } })).version, 0);
  assert.deepEqual(await orderSnapshot(row.id), snapshot);
  const actorScoped = await workflowAction(otherAdmin.cookie, row.id, { ...payload, expectedVersion: 1, priority: "CRITICAL" }, key);
  assert.equal(actorScoped.status, 200);
  assert.equal((await actorScoped.json()).workOrder.version, 2);
  const replay = await workflowAction(admin.cookie, row.id, payload, key);
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.replayed, true);
  assert.equal(replayBody.workOrder.version, 2);
  assert.equal(replayBody.workOrder.priority, "CRITICAL");
  assert.equal(await prisma.incidentEvent.count({ where: { incidentId: row.id } }), 2);
});

test("the work queue sorts operational priority then age, paginates, and cannot spoof technician ownership", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const technician = await login(Role.TECHNICIAN);
  const prefix = `Work-queue-${randomBytes(6).toString("hex")}`;
  const techId = accounts.get(Role.TECHNICIAN)!.id;
  const priorities = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL];
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: randomUUID(), title: `${prefix} ${index}`, priority: priorities[index % priorities.length],
    createdAt: new Date(Date.now() - (index + 1) * 60_000), status: IncidentStatus.CLOSED,
    closedAt: new Date(), category: "EQUIPMENT", assigneeId: techId,
    description: "Historical queue fixture to test priority and age ordering without consuming capacity.",
    reporterId: accounts.get(Role.STUDENT)!.id, buildingId: "test-main",
  }));
  await prisma.incident.createMany({ data: rows });
  const foreign = await fixtureOrder({ title: `${prefix} another technician`, status: "CLOSED", assigneeId: accounts.get("SECOND_TECHNICIAN")!.id, closedAt: new Date() });
  const query = encodeURIComponent(prefix);
  const first = await request(`/api/work-orders?q=${query}&page=1`, { headers: { Cookie: technician.cookie } });
  assert.equal(first.status, 200);
  const one = await first.json();
  assert.equal(one.total, 25);
  assert.equal(one.totalPages, 2);
  assert.equal(one.pageSize, 20);
  assert.equal(one.items.length, 20);
  const second = await request(`/api/work-orders?q=${query}&page=2`, { headers: { Cookie: technician.cookie } });
  const two = await second.json();
  assert.equal(two.items.length, 5);
  const expected = [...rows].sort((a, b) => priorities.indexOf(b.priority) - priorities.indexOf(a.priority) || a.createdAt.getTime() - b.createdAt.getTime());
  assert.deepEqual([...one.items, ...two.items].map((item: WorkflowView) => item.id), expected.map((row) => row.id));
  assert.equal((await request(`/api/work-orders/${foreign.id}`, { headers: { Cookie: technician.cookie } })).status, 404);
  const spoof = await request(`/api/work-orders?q=${query}&assigneeId=${accounts.get("SECOND_TECHNICIAN")!.id}&role=SYSTEM_ADMIN`, { headers: { Cookie: technician.cookie, "X-Role": "SYSTEM_ADMIN" } });
  assert([200, 400].includes(spoof.status));
  assert(!(await spoof.text()).includes(foreign.title));
  const all = await request(`/api/work-orders?q=${query}&status=CLOSED`, { headers: { Cookie: admin.cookie } });
  assert.equal((await all.json()).total, 26);
  const empty = await request(`/api/work-orders?q=${query}&status=IN_PROGRESS`, { headers: { Cookie: technician.cookie } });
  assert.equal((await empty.json()).total, 0);
  for (const suffix of ["page=0", "page=bad", "status=INVALID", `q=${"x".repeat(101)}`]) {
    assert.equal((await request(`/api/work-orders?${suffix}`, { headers: { Cookie: admin.cookie } })).status, 400);
  }
});

test("revoked roles, inactive users, and expired sessions cannot change work orders", async () => {
  const admin = await login(Role.FACILITIES_ADMIN);
  const userId = accounts.get(Role.FACILITIES_ADMIN)!.id;
  const row = await fixtureOrder();
  const snapshot = await orderSnapshot(row.id);
  const payload = { action: "TRIAGE", expectedVersion: 0, note: "This session no longer has permission", category: "EQUIPMENT", priority: "MEDIUM" };
  const check = async (status: number) => {
    assert.equal((await request("/api/work-orders", { headers: { Cookie: admin.cookie } })).status, status);
    assert.equal((await request("/api/workforce", { headers: { Cookie: admin.cookie } })).status, status);
    assert.equal((await workflowAction(admin.cookie, row.id, payload)).status, status);
    assert.equal((await putWorkforce(admin.cookie, accounts.get(Role.TECHNICIAN)!.id, workforcePayload(0))).status, status);
    assert.deepEqual(await orderSnapshot(row.id), snapshot);
  };
  try {
    await prisma.user.update({ where: { id: userId }, data: { role: Role.STUDENT } });
    await check(403);
    await prisma.user.update({ where: { id: userId }, data: { role: Role.FACILITIES_ADMIN, active: false } });
    await check(401);
  } finally {
    await prisma.user.update({ where: { id: userId }, data: { role: Role.FACILITIES_ADMIN, active: true } });
  }
  await prisma.session.update({ where: { tokenHash: createHash("sha256").update(admin.token).digest("hex") }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  await check(401);
});

async function bookingRoom(overrides: { capacity?: number; accessible?: boolean; hasProjector?: boolean; availability?: "AVAILABLE" | "UNAVAILABLE" | "MAINTENANCE"; buildingId?: string } = {}) {
  const id = `booking-room-${randomUUID()}`;
  return prisma.room.create({ data: {
    id, code: id, name: `Booking test room ${id}`, buildingId: "test-main",
    capacity: 80, accessible: true, hasProjector: true, ...overrides,
  } });
}

function bookingPayload(roomId: string, overrides: Record<string, unknown> = {}) {
  const startsAt = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 60 * 60_000).toISOString();
  return {
    title: `Booking ${randomUUID()}`, purpose: "A campus activity reserved in the isolated booking test database.",
    roomId, startsAt, endsAt, attendees: 30, needsAccessible: false, needsProjector: false,
    ...overrides,
  };
}

function submitBooking(cookie: string | undefined, body: Record<string, unknown>, key = randomUUID()) {
  return post("/api/bookings", body, cookie, { "Idempotency-Key": key });
}

function bookingCommand(cookie: string, id: string, body: Record<string, unknown>, key = randomUUID()) {
  return post(`/api/bookings/${id}/actions`, body, cookie, { "Idempotency-Key": key });
}

function availabilityQuery(body: ReturnType<typeof bookingPayload>, excludeBookingId?: string) {
  return new URLSearchParams({
    startsAt: body.startsAt, endsAt: body.endsAt, attendees: String(body.attendees),
    needsAccessible: String(body.needsAccessible), needsProjector: String(body.needsProjector),
    ...(excludeBookingId ? { excludeBookingId } : {}),
  });
}

async function createBooking(cookie: string, body: Record<string, unknown>) {
  const response = await submitBooking(cookie, body);
  const result = await response.json();
  assert.equal(response.status, 201, `Booking creation failed: ${JSON.stringify(result)}`);
  assert.equal(result.replayed, false);
  return result.booking as Booking;
}

async function bookingSnapshot(id: string) {
  return {
    booking: await prisma.roomBooking.findUniqueOrThrow({ where: { id } }),
    events: await prisma.bookingEvent.findMany({ where: { bookingId: id }, orderBy: { id: "asc" } }),
  };
}

function assertBookingHistory(event: BookingEvent) {
  assert.deepEqual(Object.keys(event).sort(), ["id", "action", "note", "actorName", "actorRole", "createdAt", "before", "after"].sort());
  assert(Number.isFinite(Date.parse(event.createdAt)));
  assert(!JSON.stringify(event).includes("requestHash"));
  assert(!JSON.stringify(event).includes("requestKey"));
  assert(!("actorId" in event));
  assert.deepEqual(Object.keys(event.after).sort(), ["title", "purpose", "roomId", "roomName", "startsAt", "endsAt", "attendees", "needsAccessible", "needsProjector", "status"].sort());
}

test("booking endpoints enforce authentication and role permissions including manager landing", async () => {
  await assertRedirect(await request("/bookings"), "/login");
  const room = await bookingRoom();
  const payload = bookingPayload(room.id);
  const availability = `/api/bookings/availability?${availabilityQuery(payload)}`;
  for (const route of ["/api/bookings", "/api/bookings/rooms", availability, "/api/bookings/missing", "/api/bookings/impact?incidentId=missing"]) {
    const response = await request(route);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
  assert.equal((await submitBooking(undefined, payload)).status, 401);
  assert.equal((await post("/api/bookings/missing/actions", { action: "CANCEL", expectedVersion: 0, note: "Not signed in" }, undefined, { "Idempotency-Key": randomUUID() })).status, 401);
  for (const role of Object.values(Role)) {
    const { cookie } = await login(role);
    const admin = role === Role.SYSTEM_ADMIN || role === Role.FACILITIES_ADMIN;
    const allowed = admin || role === Role.FACULTY || role === Role.DEPARTMENT_MANAGER;
    for (const route of ["/api/bookings", "/api/bookings/rooms", availability]) {
      const response = await request(route, { headers: { Cookie: cookie, "X-Role": "SYSTEM_ADMIN" } });
      assert.equal(response.status, allowed ? 200 : 403);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    }
    assert.equal((await request("/api/bookings/missing", { headers: { Cookie: cookie } })).status, allowed ? 404 : 403);
    assert.equal((await request("/api/bookings/impact?incidentId=missing", { headers: { Cookie: cookie } })).status, admin ? 404 : 403);
    if (allowed) {
      assert.equal((await request("/bookings", { headers: { Cookie: cookie } })).status, 200);
    } else {
      await assertRedirect(await request("/bookings", { headers: { Cookie: cookie } }), "/");
      assert.equal((await submitBooking(cookie, payload)).status, 403);
      assert.equal((await bookingCommand(cookie, "missing", { action: "CANCEL", expectedVersion: 0, note: "Role cannot book rooms" })).status, 403);
    }
  }
});

test("a room booking can be created, rescheduled, and cancelled with preserved public history", async () => {
  const faculty = await login(Role.FACULTY);
  const admin = await login(Role.FACILITIES_ADMIN);
  const firstRoom = await bookingRoom();
  const secondRoom = await bookingRoom();
  const payload = bookingPayload(firstRoom.id, { needsAccessible: true, needsProjector: true });
  const created = await createBooking(faculty.cookie, payload);
  assert.equal(created.status, "CONFIRMED");
  assert.equal(created.version, 0);
  assert.equal(created.room.id, firstRoom.id);
  assert.equal(created.history.length, 1);
  assert.equal(created.history[0].before, null);
  assert.equal(created.history[0].after.roomName, firstRoom.name);
  assert.equal(created.history[0].actorRole, Role.FACULTY);
  assert.equal(created.cancelledAt, null);
  assert.deepEqual(Object.keys(created.owner).sort(), ["department", "name"]);
  assert.equal((await prisma.roomBooking.findUniqueOrThrow({ where: { id: created.id } })).ownerId, accounts.get(Role.FACULTY)!.id);
  const moved = await bookingCommand(admin.cookie, created.id, {
    ...payload, roomId: secondRoom.id, title: "Updated campus workshop", action: "UPDATE", expectedVersion: 0,
    note: "Moved to a suitable alternate room after review",
  });
  assert.equal(moved.status, 200);
  const updated = (await moved.json()).booking as Booking;
  assert.equal(updated.version, 1);
  assert.equal(updated.room.id, secondRoom.id);
  assert.equal(updated.history.length, 2);
  assert.equal(updated.history[0].before?.roomId, firstRoom.id);
  assert.equal(updated.history[0].after.roomId, secondRoom.id);
  assert.equal(updated.history[0].actorRole, Role.FACILITIES_ADMIN);
  assert.equal(updated.createdAt, created.createdAt);
  const cancelled = await bookingCommand(faculty.cookie, created.id, { action: "CANCEL", expectedVersion: 1, note: "Workshop cancelled by the original organiser" });
  assert.equal(cancelled.status, 200);
  const closed = (await cancelled.json()).booking as Booking;
  assert.equal(closed.status, "CANCELLED");
  assert.equal(closed.version, 2);
  assert(closed.cancelledAt);
  assert.equal(closed.history.length, 3);
  closed.history.forEach(assertBookingHistory);
  assert.equal((await request(`/api/bookings/availability?${availabilityQuery(payload, created.id)}`, { headers: { Cookie: faculty.cookie } })).status, 409);
  const snapshot = await bookingSnapshot(created.id);
  assert.equal((await bookingCommand(admin.cookie, created.id, { ...payload, action: "UPDATE", expectedVersion: 2, note: "Cannot reopen a cancelled booking" })).status, 409);
  assert.equal((await bookingCommand(faculty.cookie, created.id, { action: "CANCEL", expectedVersion: 2, note: "Cannot cancel twice with a new command" })).status, 409);
  assert.deepEqual(await bookingSnapshot(created.id), snapshot);
});

test("faculty and managers see only their bookings and cannot bypass ownership through availability or retries", async () => {
  const faculty = await login(Role.FACULTY);
  const manager = await login(Role.DEPARTMENT_MANAGER);
  const admin = await login(Role.SYSTEM_ADMIN);
  const room = await bookingRoom();
  const secretTitle = `Private-booking-${randomUUID()}`;
  const payload = bookingPayload(room.id, { title: secretTitle });
  const key = randomUUID();
  const response = await submitBooking(faculty.cookie, payload, key);
  assert.equal(response.status, 201);
  const booking = (await response.json()).booking as Booking;
  const snapshot = await bookingSnapshot(booking.id);
  assert.equal((await request(`/api/bookings/${booking.id}`, { headers: { Cookie: manager.cookie } })).status, 404);
  assert.equal((await bookingCommand(manager.cookie, booking.id, { action: "CANCEL", expectedVersion: 0, note: "A different organiser tries to cancel" })).status, 404);
  const spoof = await request(`/api/bookings?q=${encodeURIComponent(secretTitle)}&ownerId=${accounts.get(Role.FACULTY)!.id}&role=SYSTEM_ADMIN`, { headers: { Cookie: manager.cookie, "X-Role": "SYSTEM_ADMIN" } });
  assert([200, 400].includes(spoof.status));
  assert(!(await spoof.text()).includes(secretTitle));
  const availability = await request(`/api/bookings/availability?${availabilityQuery(payload)}`, { headers: { Cookie: manager.cookie } });
  assert.equal(availability.status, 200);
  const candidates = await availability.json();
  const candidate = (candidates.rooms as RoomCandidate[]).find((item) => item.id === room.id)!;
  assert.equal(candidate.eligible, false);
  assert(candidate.reasons.length > 0);
  const text = JSON.stringify(candidates);
  for (const privateValue of [secretTitle, booking.id, booking.owner.name, accounts.get(Role.FACULTY)!.id, payload.purpose]) assert(!text.includes(privateValue));
  assert.equal((await request(`/api/bookings/availability?${availabilityQuery(payload, booking.id)}`, { headers: { Cookie: manager.cookie } })).status, 404);
  const ownAvailability = await request(`/api/bookings/availability?${availabilityQuery(payload, booking.id)}`, { headers: { Cookie: faculty.cookie } });
  assert.equal(ownAvailability.status, 200);
  assert.equal(((await ownAvailability.json()).rooms as RoomCandidate[]).find((item) => item.id === room.id)!.eligible, true);
  assert.equal((await request(`/api/bookings/${booking.id}`, { headers: { Cookie: admin.cookie } })).status, 200);
  const all = await request(`/api/bookings?q=${encodeURIComponent(secretTitle)}`, { headers: { Cookie: admin.cookie } });
  assert.equal((await all.json()).total, 1);
  assert.deepEqual(await bookingSnapshot(booking.id), snapshot);
});

test("room eligibility enforces capacity, accessibility, availability and projector equipment on save", async () => {
  const faculty = await login(Role.FACULTY);
  const room = await bookingRoom({ capacity: 80 });
  const otherRoom = await bookingRoom({ capacity: 150 });
  const payload = bookingPayload(room.id, { attendees: 120 });
  const availability = await request(`/api/bookings/availability?${availabilityQuery(payload)}`, { headers: { Cookie: faculty.cookie } });
  assert.equal(availability.status, 200);
  const rooms = (await availability.json()).rooms as RoomCandidate[];
  assert.equal(rooms.find((item) => item.id === room.id)!.eligible, false, "An 80-seat room cannot take 120 attendees");
  assert.equal(rooms.find((item) => item.id === otherRoom.id)!.eligible, true);
  assert.equal((await submitBooking(faculty.cookie, payload)).status, 409);
  const cases = [
    { room: { availability: "UNAVAILABLE" as const }, payload: {} },
    { room: { availability: "MAINTENANCE" as const }, payload: {} },
    { room: { accessible: false }, payload: { needsAccessible: true } },
    { room: { hasProjector: false }, payload: { needsProjector: true } },
  ];
  for (const item of cases) {
    const candidate = await bookingRoom(item.room);
    assert.equal((await submitBooking(faculty.cookie, bookingPayload(candidate.id, item.payload))).status, 409);
    assert.equal(await prisma.roomBooking.count({ where: { roomId: candidate.id } }), 0);
  }
  const equipmentRoom = await bookingRoom();
  const equipment = await prisma.asset.create({ data: { assetTag: randomUUID(), name: "Unavailable room equipment", category: "EQUIPMENT", availability: "MAINTENANCE", roomId: equipmentRoom.id } });
  assert.equal((await submitBooking(faculty.cookie, bookingPayload(equipmentRoom.id, { needsProjector: true }))).status, 409);
  await prisma.asset.update({ where: { id: equipment.id }, data: { availability: "AVAILABLE" } });
  const created = await createBooking(faculty.cookie, bookingPayload(equipmentRoom.id, { needsProjector: true }));
  assert.equal(created.room.equipmentReady, true);
  const raceRoom = await bookingRoom();
  const racePayload = bookingPayload(raceRoom.id);
  const availableBefore = await request(`/api/bookings/availability?${availabilityQuery(racePayload)}`, { headers: { Cookie: faculty.cookie } });
  assert.equal(((await availableBefore.json()).rooms as RoomCandidate[]).find((item) => item.id === raceRoom.id)!.eligible, true);
  await prisma.room.update({ where: { id: raceRoom.id }, data: { availability: "MAINTENANCE" } });
  assert.equal((await submitBooking(faculty.cookie, racePayload)).status, 409, "Displayed availability must be rechecked on save");
});

test("room booking overlap is half-open and cancellation releases the occupied interval", async () => {
  const faculty = await login(Role.FACULTY);
  const room = await bookingRoom();
  const payload = bookingPayload(room.id);
  const booked = await createBooking(faculty.cookie, payload);
  const start = Date.parse(payload.startsAt);
  const end = Date.parse(payload.endsAt);
  for (const [a, b] of [[start, end], [start - 60_000, end + 60_000], [start + 60_000, end - 60_000], [start - 60_000, start + 60_000], [end - 60_000, end + 60_000]]) {
    assert.equal((await submitBooking(faculty.cookie, bookingPayload(room.id, { startsAt: new Date(a).toISOString(), endsAt: new Date(b).toISOString() }))).status, 409);
  }
  await createBooking(faculty.cookie, bookingPayload(room.id, { startsAt: new Date(start - 60 * 60_000).toISOString(), endsAt: payload.startsAt }));
  await createBooking(faculty.cookie, bookingPayload(room.id, { startsAt: payload.endsAt, endsAt: new Date(end + 60 * 60_000).toISOString() }));
  assert.equal((await bookingCommand(faculty.cookie, booked.id, { action: "CANCEL", expectedVersion: 0, note: "Release this exact room slot" })).status, 200);
  const replacement = await createBooking(faculty.cookie, payload);
  assert.notEqual(replacement.id, booked.id);
});

test("concurrent bookings cannot both reserve the same room and time", async () => {
  const faculty = await login(Role.FACULTY);
  const manager = await login(Role.DEPARTMENT_MANAGER);
  const room = await bookingRoom();
  const payload = bookingPayload(room.id);
  const results = await Promise.all([submitBooking(faculty.cookie, payload), submitBooking(manager.cookie, { ...payload, title: "Competing booking request" })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(await prisma.roomBooking.count({ where: { roomId: room.id, status: "CONFIRMED" } }), 1);
  const only = await prisma.roomBooking.findFirstOrThrow({ where: { roomId: room.id } });
  assert.equal(await prisma.bookingEvent.count({ where: { bookingId: only.id } }), 1);
});

test("competing reschedules preserve the winner and leave the rejected booking and history unchanged", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const roomOne = await bookingRoom();
  const roomTwo = await bookingRoom();
  const target = await bookingRoom();
  const payload = bookingPayload(roomOne.id);
  const one = await createBooking(admin.cookie, payload);
  const two = await createBooking(admin.cookie, { ...payload, roomId: roomTwo.id, title: "Second event seeking the same alternative" });
  const oneBefore = await bookingSnapshot(one.id);
  const twoBefore = await bookingSnapshot(two.id);
  const outcomes = await Promise.all([one, two].map((booking) => bookingCommand(admin.cookie, booking.id, { ...payload, roomId: target.id, action: "UPDATE", expectedVersion: 0, note: "Move to the same available alternative" })));
  assert.deepEqual(outcomes.map((result) => result.status).sort(), [200, 409]);
  const rejectedIndex = outcomes.findIndex((result) => result.status === 409);
  assert.deepEqual(await bookingSnapshot([one, two][rejectedIndex].id), [oneBefore, twoBefore][rejectedIndex]);
  assert.equal(await prisma.roomBooking.count({ where: { roomId: target.id, status: "CONFIRMED" } }), 1);
});

test("booking retries are actor-scoped, exactly once, and return the latest authorized state", async () => {
  const faculty = await login(Role.FACULTY);
  const manager = await login(Role.DEPARTMENT_MANAGER);
  const room = await bookingRoom();
  const payload = bookingPayload(room.id);
  const key = randomUUID();
  const results = await Promise.all(Array.from({ length: 4 }, () => submitBooking(faculty.cookie, payload, key)));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 200, 200, 201]);
  const bodies = await Promise.all(results.map((result) => result.json()));
  assert.equal(new Set(bodies.map((body) => body.booking.id)).size, 1);
  const booking = bodies[0].booking as Booking;
  assert.equal(await prisma.bookingEvent.count({ where: { bookingId: booking.id } }), 1);
  assert.equal((await submitBooking(faculty.cookie, { ...payload, title: "Changed retry payload" }, key)).status, 409);
  const cancelKey = randomUUID();
  const cancellation = { action: "CANCEL", expectedVersion: 0, note: "Cancel once even if the client retries" };
  const commands = await Promise.all(Array.from({ length: 4 }, () => bookingCommand(faculty.cookie, booking.id, cancellation, cancelKey)));
  assert(commands.every((result) => result.status === 200));
  const commandBodies = await Promise.all(commands.map((result) => result.json()));
  assert.equal(commandBodies.filter((body) => !body.replayed).length, 1);
  assert.equal(await prisma.bookingEvent.count({ where: { bookingId: booking.id } }), 2);
  const replay = await submitBooking(faculty.cookie, payload, key);
  assert.equal(replay.status, 200);
  const current = await replay.json();
  assert.equal(current.replayed, true);
  assert.equal(current.booking.status, "CANCELLED");
  assert.equal(current.booking.version, 1);
  assert.equal((await bookingCommand(faculty.cookie, booking.id, { ...cancellation, note: "A different cancellation explanation" }, cancelKey)).status, 409);
  assert.equal((await bookingCommand(faculty.cookie, booking.id, cancellation, key)).status, 409, "Creation and action keys share one actor namespace");
  const differentRoom = await bookingRoom();
  const otherActor = await submitBooking(manager.cookie, bookingPayload(differentRoom.id), key);
  assert.equal(otherActor.status, 201, "A different actor may use the same UUID");
  assert.equal((await bookingCommand(manager.cookie, booking.id, cancellation, cancelKey)).status, 404);
});

test("stale booking edits cannot replace newer decisions and authorization survives a valid retry key", async () => {
  const faculty = await login(Role.FACULTY);
  const admin = await login(Role.SYSTEM_ADMIN);
  const room = await bookingRoom();
  const payload = bookingPayload(room.id);
  const created = await createBooking(faculty.cookie, payload);
  const key = randomUUID();
  const update = { ...payload, action: "UPDATE", expectedVersion: 0, title: "Reviewed event title", note: "Reviewed and updated by the organiser" };
  assert.equal((await bookingCommand(faculty.cookie, created.id, update, key)).status, 200);
  const before = await bookingSnapshot(created.id);
  assert.equal((await bookingCommand(admin.cookie, created.id, { ...update, title: "Outdated administrator edit" })).status, 409);
  assert.deepEqual(await bookingSnapshot(created.id), before);
  const adminKey = randomUUID();
  const administratorUpdate = { ...update, expectedVersion: 1, title: "Latest administrator review" };
  const second = await bookingCommand(admin.cookie, created.id, administratorUpdate, adminKey);
  assert.equal(second.status, 200);
  const replay = await bookingCommand(faculty.cookie, created.id, update, key);
  assert.equal(replay.status, 200);
  const current = await replay.json();
  assert.equal(current.booking.version, 2);
  assert.equal(current.booking.title, "Latest administrator review");
  assert.equal(current.replayed, true);
  const administrator = accounts.get(Role.SYSTEM_ADMIN)!;
  try {
    await prisma.user.update({ where: { id: administrator.id }, data: { role: Role.FACULTY } });
    assert.equal((await bookingCommand(admin.cookie, created.id, administratorUpdate, adminKey)).status, 404, "A former admin cannot replay access to someone else's booking");
  } finally {
    await prisma.user.update({ where: { id: administrator.id }, data: { role: Role.SYSTEM_ADMIN } });
  }
  const actor = accounts.get(Role.FACULTY)!;
  try {
    await prisma.user.update({ where: { id: actor.id }, data: { role: Role.STUDENT } });
    assert.equal((await bookingCommand(faculty.cookie, created.id, update, key)).status, 403);
  } finally {
    await prisma.user.update({ where: { id: actor.id }, data: { role: Role.FACULTY } });
  }
});

test("booking validation rejects forged fields, invalid time ranges and invalid calendar dates without writes", async () => {
  const faculty = await login(Role.FACULTY);
  const room = await bookingRoom();
  const payload = bookingPayload(room.id);
  const before = await prisma.roomBooking.count();
  const currentDate = new Date();
  const nextYear = currentDate.getUTCFullYear() + (currentDate.getUTCMonth() > 1 ? 1 : 0);
  const invalid = [
    { title: "ab" }, { title: "x".repeat(121) }, { purpose: "short" }, { purpose: "x".repeat(2001) },
    { attendees: 0 }, { attendees: 10001 }, { attendees: 1.5 }, { attendees: "30" },
    { needsAccessible: "true" }, { needsProjector: 1 }, { roomId: "" },
    { startsAt: "tomorrow" }, { startsAt: payload.startsAt.replace("Z", "") },
    { startsAt: `${nextYear}-02-30T10:00:00Z`, endsAt: `${nextYear}-03-03T11:00:00Z` },
    { startsAt: "2026-13-01T10:00:00Z" }, { startsAt: payload.startsAt.replace(/T.*$/, "T24:00:00Z") },
    { startsAt: payload.startsAt.replace("Z", "+14:30") }, { startsAt: payload.endsAt },
    { endsAt: payload.startsAt }, { endsAt: new Date(Date.parse(payload.startsAt) - 60_000).toISOString() },
    { startsAt: new Date(Date.now() - 60_000).toISOString() },
    { endsAt: new Date(Date.parse(payload.startsAt) + 8 * 24 * 60 * 60_000).toISOString() },
    { startsAt: new Date(Date.now() + 366 * 24 * 60 * 60_000).toISOString(), endsAt: new Date(Date.now() + 367 * 24 * 60 * 60_000).toISOString() },
    { ownerId: accounts.get(Role.SYSTEM_ADMIN)!.id }, { status: "CANCELLED" }, { version: 100 }, { createdAt: payload.startsAt },
  ];
  for (const overrides of invalid) {
    const response = await submitBooking(faculty.cookie, { ...payload, ...overrides });
    assert.equal(response.status, 400, `Invalid booking fields must fail: ${JSON.stringify(overrides)}`);
  }
  assert.equal((await submitBooking(faculty.cookie, { ...payload, roomId: "missing-room" })).status, 400);
  assert.equal(await prisma.roomBooking.count(), before);
  const created = await createBooking(faculty.cookie, payload);
  const snapshot = await bookingSnapshot(created.id);
  for (const body of [
    { action: "REOPEN", expectedVersion: 0, note: "Unsupported action" },
    { action: "CANCEL", expectedVersion: -1, note: "Bad version" },
    { action: "CANCEL", expectedVersion: 0.1, note: "Bad version" },
    { action: "CANCEL", expectedVersion: 0, note: "no" },
    { action: "CANCEL", expectedVersion: 0, note: "x".repeat(2001) },
    { action: "CANCEL", expectedVersion: 0, note: "Not allowed to change ownership", ownerId: accounts.get(Role.SYSTEM_ADMIN)!.id },
    { action: "UPDATE", expectedVersion: 0, note: "Missing required booking fields" },
  ]) assert.equal((await bookingCommand(faculty.cookie, created.id, body)).status, 400);
  assert.deepEqual(await bookingSnapshot(created.id), snapshot);
  for (const overrides of [{ needsAccessible: "yes" }, { needsProjector: "" }, { attendees: "0" }, { endsAt: payload.startsAt }]) {
    const query = availabilityQuery(payload);
    for (const [key, value] of Object.entries(overrides)) query.set(key, value);
    assert.equal((await request(`/api/bookings/availability?${query}`, { headers: { Cookie: faculty.cookie } })).status, 400);
  }
  const offsetRoom = await bookingRoom();
  const offsetPayload = bookingPayload(offsetRoom.id, { startsAt: payload.startsAt.replace("Z", "+05:30"), endsAt: payload.endsAt.replace("Z", "+05:30") });
  const offsetBooking = await createBooking(faculty.cookie, offsetPayload);
  assert.equal(offsetBooking.startsAt, new Date(offsetPayload.startsAt).toISOString());
});

test("booking mutations reject cross-origin, malformed, oversized and missing-key requests", async () => {
  const faculty = await login(Role.FACULTY);
  const room = await bookingRoom();
  const payload = bookingPayload(room.id);
  const created = await createBooking(faculty.cookie, payload);
  const routes = [
    { path: "/api/bookings", body: payload },
    { path: `/api/bookings/${created.id}/actions`, body: { action: "CANCEL", expectedVersion: 0, note: "Cancel this event after review" } },
  ];
  const snapshot = await bookingSnapshot(created.id);
  const count = await prisma.roomBooking.count();
  for (const route of routes) {
    const headers = { Cookie: faculty.cookie, Origin: origin, "Content-Type": "application/json", "Idempotency-Key": randomUUID() };
    const rejectedHeaders: Record<string, string>[] = [{ Origin: "https://attacker.example" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }];
    for (const extra of rejectedHeaders) assert.equal((await request(route.path, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(route.body) })).status, 403);
    const { Origin: ignored, ...noOrigin } = headers;
    assert(ignored);
    assert.equal((await request(route.path, { method: "POST", headers: noOrigin, body: JSON.stringify(route.body) })).status, 403);
    assert.equal((await request(route.path, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: JSON.stringify(route.body) })).status, 415);
    assert.equal((await request(route.path, { method: "POST", headers, body: "{" })).status, 400);
    assert.equal((await request(route.path, { method: "POST", headers, body: "[]" })).status, 400);
    assert.equal((await request(route.path, { method: "POST", headers, body: JSON.stringify({ padding: "x".repeat(32_000) }) })).status, 413);
    assert.equal((await post(route.path, route.body, faculty.cookie)).status, 400);
    assert.equal((await post(route.path, route.body, faculty.cookie, { "Idempotency-Key": "invalid" })).status, 400);
  }
  assert.equal(await prisma.roomBooking.count(), count);
  assert.deepEqual(await bookingSnapshot(created.id), snapshot);
});

test("booking lists paginate, filter and sort while keeping another organiser's details private", async () => {
  const faculty = await login(Role.FACULTY);
  const manager = await login(Role.DEPARTMENT_MANAGER);
  const admin = await login(Role.SYSTEM_ADMIN);
  const room = await bookingRoom();
  const prefix = `Booking-list-${randomBytes(6).toString("hex")}`;
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: randomUUID(), title: `${prefix} ${index}`, purpose: "Isolated records used to verify booking queue pagination.",
    roomId: room.id, ownerId: accounts.get(Role.FACULTY)!.id, attendees: 10,
    startsAt: new Date(Date.now() + (index + 5) * 24 * 60 * 60_000), endsAt: new Date(Date.now() + (index + 5) * 24 * 60 * 60_000 + 60 * 60_000),
    status: index < 4 ? "CANCELLED" as const : "CONFIRMED" as const,
  }));
  await prisma.roomBooking.createMany({ data: rows });
  await prisma.roomBooking.create({ data: { ...rows[0], id: randomUUID(), ownerId: accounts.get(Role.DEPARTMENT_MANAGER)!.id, title: `${prefix} another organiser` } });
  const query = encodeURIComponent(prefix);
  const first = await request(`/api/bookings?q=${query}`, { headers: { Cookie: faculty.cookie } });
  assert.equal(first.status, 200);
  const one = await first.json();
  assert.equal(one.total, 25);
  assert.equal(one.pageSize, 20);
  assert.equal(one.totalPages, 2);
  assert.equal(one.items.length, 20);
  assert((one.items as Booking[]).every((item) => item.history.length === 0));
  const two = await (await request(`/api/bookings?q=${query}&page=2`, { headers: { Cookie: faculty.cookie } })).json();
  assert.equal(two.items.length, 5);
  const expected = [...rows].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || a.id.localeCompare(b.id));
  assert.deepEqual([...one.items, ...two.items].map((item: Booking) => item.id), expected.map((row) => row.id));
  const cancelled = await request(`/api/bookings?q=${query}&status=CANCELLED`, { headers: { Cookie: faculty.cookie } });
  assert.equal((await cancelled.json()).total, 4);
  const managerList = await request(`/api/bookings?q=${query}`, { headers: { Cookie: manager.cookie } });
  assert.equal((await managerList.json()).total, 1);
  const administratorList = await request(`/api/bookings?q=${query}`, { headers: { Cookie: admin.cookie } });
  assert.equal((await administratorList.json()).total, 26);
  for (const suffix of ["page=0", "page=bad", "status=INVALID", `q=${"x".repeat(101)}`]) {
    assert.equal((await request(`/api/bookings?${suffix}`, { headers: { Cookie: faculty.cookie } })).status, 400);
  }
});

test("incident booking impact is admin-only and follows room or building with future confirmed activities", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const faculty = await login(Role.FACULTY);
  const room = await bookingRoom();
  const sibling = await bookingRoom();
  const elsewhere = await bookingRoom({ buildingId: "test-other" });
  const payload = bookingPayload(room.id);
  const target = await createBooking(faculty.cookie, payload);
  const adjacent = await createBooking(faculty.cookie, { ...payload, roomId: sibling.id, title: "Another activity in the same building" });
  const distant = await createBooking(faculty.cookie, { ...payload, roomId: elsewhere.id, title: "Activity in another building" });
  const cancelled = await prisma.roomBooking.create({ data: { ...payload, title: "Cancelled event should not be impacted", startsAt: new Date(payload.startsAt), endsAt: new Date(payload.endsAt), ownerId: accounts.get(Role.FACULTY)!.id, status: "CANCELLED" } });
  const past = await prisma.roomBooking.create({ data: { ...payload, title: "Past event should not be impacted", startsAt: new Date(Date.now() - 2 * 60 * 60_000), endsAt: new Date(Date.now() - 60 * 60_000), ownerId: accounts.get(Role.FACULTY)!.id } });
  const incident = await prisma.incident.create({ data: { title: "Disruption of the booked room", description: "An isolated booking impact test.", reporterId: accounts.get(Role.FACULTY)!.id, roomId: room.id, buildingId: room.buildingId } });
  assert.equal((await request(`/api/bookings/impact?incidentId=${incident.id}`, { headers: { Cookie: faculty.cookie } })).status, 403);
  const roomResponse = await request(`/api/bookings/impact?incidentId=${incident.id}`, { headers: { Cookie: admin.cookie } });
  assert.equal(roomResponse.status, 200);
  const roomImpact = await roomResponse.json() as BookingImpact;
  assert.equal(roomImpact.incident.id, incident.id);
  assert.deepEqual(roomImpact.items.map((booking) => booking.id), [target.id]);
  assert.equal(roomImpact.total, 1);
  assert.equal(roomImpact.truncated, false);
  await prisma.incident.update({ where: { id: incident.id }, data: { roomId: null } });
  const buildingResponse = await request(`/api/bookings/impact?incidentId=${incident.id}`, { headers: { Cookie: admin.cookie } });
  const buildingImpact = await buildingResponse.json() as BookingImpact;
  const ids = new Set(buildingImpact.items.map((booking) => booking.id));
  assert(ids.has(target.id)); assert(ids.has(adjacent.id));
  for (const excluded of [distant.id, cancelled.id, past.id]) assert(!ids.has(excluded));
  await prisma.incident.update({ where: { id: incident.id }, data: { buildingId: null } });
  const unrelated = await request(`/api/bookings/impact?incidentId=${incident.id}`, { headers: { Cookie: admin.cookie } });
  assert.equal((await unrelated.json()).total, 0, "An unlocated incident must not match the entire campus");
});

test("ended bookings are immutable, in-progress cancellation works, and revoked sessions lose booking access", async () => {
  const faculty = await login(Role.FACULTY);
  const room = await bookingRoom();
  const payload = bookingPayload(room.id);
  const past = await prisma.roomBooking.create({ data: { ...payload, startsAt: new Date(Date.now() - 2 * 60 * 60_000), endsAt: new Date(Date.now() - 60 * 60_000), ownerId: accounts.get(Role.FACULTY)!.id } });
  const snapshot = await bookingSnapshot(past.id);
  assert.equal((await bookingCommand(faculty.cookie, past.id, { ...payload, action: "UPDATE", expectedVersion: 0, note: "Cannot move a historical event" })).status, 409);
  assert.equal((await bookingCommand(faculty.cookie, past.id, { action: "CANCEL", expectedVersion: 0, note: "Cannot cancel a historical event" })).status, 409);
  assert.deepEqual(await bookingSnapshot(past.id), snapshot);
  const current = await prisma.roomBooking.create({ data: { ...payload, startsAt: new Date(Date.now() - 60 * 60_000), endsAt: new Date(Date.now() + 60 * 60_000), ownerId: accounts.get(Role.FACULTY)!.id } });
  assert.equal((await bookingCommand(faculty.cookie, current.id, { action: "CANCEL", expectedVersion: 0, note: "End this activity early and release the room" })).status, 200);
  const userId = accounts.get(Role.FACULTY)!.id;
  const before = await prisma.roomBooking.count();
  const check = async (status: number) => {
    for (const route of ["/api/bookings", "/api/bookings/rooms", `/api/bookings/${past.id}`, `/api/bookings/availability?${availabilityQuery(payload)}`]) {
      assert.equal((await request(route, { headers: { Cookie: faculty.cookie } })).status, status);
    }
    assert.equal((await submitBooking(faculty.cookie, payload)).status, status);
    assert.equal((await bookingCommand(faculty.cookie, past.id, { action: "CANCEL", expectedVersion: 0, note: "Account no longer has access" })).status, status);
    assert.equal(await prisma.roomBooking.count(), before);
    assert.deepEqual(await bookingSnapshot(past.id), snapshot);
  };
  try {
    await prisma.user.update({ where: { id: userId }, data: { role: Role.STUDENT } });
    await check(403);
    await prisma.user.update({ where: { id: userId }, data: { role: Role.FACULTY, active: false } });
    await check(401);
  } finally {
    await prisma.user.update({ where: { id: userId }, data: { role: Role.FACULTY, active: true } });
  }
  await prisma.session.update({ where: { tokenHash: createHash("sha256").update(faculty.token).digest("hex") }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await check(401);
});

function transportAction(cookie: string, demo: Pick<TransportSnapshot, "id" | "version">, action: string, extra: Record<string, unknown> = {}, key: string = randomUUID()) {
  return post(`/api/transport/${demo.id}/actions`, {
    action, expectedVersion: demo.version, note: `Transport test ${action.toLowerCase()} action`, ...extra,
  }, cookie, { "Idempotency-Key": key });
}

async function transportDemo(cookie: string): Promise<TransportSnapshot> {
  const response = await post("/api/transport/demo", {}, cookie, { "Idempotency-Key": randomUUID() });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  let demo = body.demo as TransportSnapshot;
  if (demo.playing) demo = await transportAct(cookie, demo, "PAUSE");
  return demo;
}

async function transportAct(cookie: string, demo: TransportSnapshot, action: string, extra: Record<string, unknown> = {}) {
  const response = await transportAction(cookie, demo, action, extra);
  const body = await response.json();
  assert.equal(response.status, 200, `${action}: ${JSON.stringify(body)}`);
  assert.equal(body.replayed, false);
  assert.equal(body.demo.version, demo.version + 1);
  return body.demo as TransportSnapshot;
}

async function transportSnapshot(id: string) {
  return {
    demo: await prisma.transportDemo.findUniqueOrThrow({ where: { id } }),
    events: await prisma.transportEvent.findMany({ where: { demoId: id }, orderBy: { id: "asc" } }),
  };
}

test("transport pages, fleet, rescue planning, and actions require an active administrator", async () => {
  const check = async (cookie: string | undefined, status: number) => {
    for (const route of ["/api/transport", "/api/transport/not-a-real-demo"]) {
      assert.equal((await request(route, { headers: cookie ? { Cookie: cookie } : {} })).status, status);
    }
    assert.equal((await post("/api/transport/demo", {}, cookie, { "Idempotency-Key": randomUUID() })).status, status);
    assert.equal((await post("/api/transport/rescue", { demoId: "not-a-real-demo", brokenBusId: "BUS-01" }, cookie)).status, status);
    assert.equal((await post("/api/transport/not-a-real-demo/actions", {
      action: "BREAKDOWN", busId: "BUS-01", expectedVersion: 0, note: "Permission check for a simulated breakdown",
    }, cookie, { "Idempotency-Key": randomUUID() })).status, status);
  };
  await check(undefined, 401);
  for (const page of ["/transport", "/transport/rescue"]) await assertRedirect(await request(page), "/login");
  for (const role of [Role.STUDENT, Role.FACULTY, Role.TECHNICIAN, Role.DEPARTMENT_MANAGER, Role.PROCUREMENT_APPROVER]) {
    const session = await login(role);
    await check(session.cookie, 403);
  }
  for (const role of [Role.FACILITIES_ADMIN, Role.SYSTEM_ADMIN]) {
    const session = await login(role);
    const response = await request("/api/transport", { headers: { Cookie: session.cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
});

test("transport demos persist separately from campus buses and retry creation exactly once", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const existingBuses = await prisma.bus.findMany({ orderBy: { id: "asc" } });
  const beforeCount = await prisma.transportDemo.count();
  const key = randomUUID();
  const created = await post("/api/transport/demo", {}, admin.cookie, { "Idempotency-Key": key });
  assert.equal(created.status, 201);
  const body = await created.json();
  const demo = body.demo as TransportSnapshot;
  assert.equal(body.replayed, false);
  assert.equal(demo.source, "SIMULATION");
  assert.equal(demo.fleet.length, 5);
  assert.equal(demo.transfers.length, 0);
  assert(demo.history.length > 0);
  const retry = await post("/api/transport/demo", {}, admin.cookie, { "Idempotency-Key": key });
  assert.equal(retry.status, 200);
  const replay = await retry.json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.demo.id, demo.id);
  assert.equal(await prisma.transportDemo.count(), beforeCount + 1);
  const snapshot = await transportSnapshot(demo.id);
  for (const route of ["/api/transport", `/api/transport/${demo.id}`]) {
    const response = await request(route, { headers: { Cookie: admin.cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await response.json()).demo.id, demo.id);
  }
  assert.deepEqual(await transportSnapshot(demo.id), snapshot, "Reading a projected simulation must not write the database");
  assert.deepEqual(await prisma.bus.findMany({ orderBy: { id: "asc" } }), existingBuses);
});

test("transport mutations reject cross-origin, forged state, invalid versions, and bad keys without writes", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const demo = await transportDemo(admin.cookie);
  const snapshot = await transportSnapshot(demo.id);
  const valid = { action: "BREAKDOWN", busId: "BUS-01", expectedVersion: demo.version, note: "An isolated simulated breakdown" };
  const route = `/api/transport/${demo.id}/actions`;
  for (const headers of [{ Origin: "https://attacker.example" }, { Origin: "" }]) {
    assert.equal((await post(route, valid, admin.cookie, { "Idempotency-Key": randomUUID(), ...headers })).status, 403);
    assert.equal((await post("/api/transport/rescue", { demoId: demo.id, brokenBusId: "BUS-01" }, admin.cookie, headers)).status, 403);
  }
  assert.equal((await post(route, valid, admin.cookie)).status, 400);
  assert.equal((await post(route, valid, admin.cookie, { "Idempotency-Key": "invalid" })).status, 400);
  for (const invalid of [
    { ...valid, fleet: [] }, { ...valid, occupied: 0 }, { ...valid, expectedVersion: -1 },
    { ...valid, expectedVersion: "0" }, { ...valid, note: "" }, { ...valid, action: "UNKNOWN" },
    { ...valid, action: "MOVE_BREAKDOWN", lat: 90, lng: 0 },
    { ...valid, action: "STEP", seconds: 100000 },
  ]) {
    const response = await post(route, invalid, admin.cookie, { "Idempotency-Key": randomUUID() });
    assert.equal(response.status, 400, JSON.stringify(invalid));
  }
  assert.equal((await post("/api/transport/rescue", { demoId: demo.id, brokenBusId: "BUS-01", fleet: [] }, admin.cookie)).status, 400);
  assert.equal((await post("/api/transport/demo", { fleet: [] }, admin.cookie, { "Idempotency-Key": randomUUID() })).status, 400);
  assert.deepEqual(await transportSnapshot(demo.id), snapshot);
});

test("rescue planning and dispatch reserve real spare seats and transfer passengers only on arrival", async () => {
  const admin = await login(Role.FACILITIES_ADMIN);
  let demo = await transportDemo(admin.cookie);
  const totalPassengers = demo.fleet.reduce((total, item) => total + item.occupied, 0);
  demo = await transportAct(admin.cookie, demo, "BREAKDOWN", { busId: "BUS-01" });
  const stopped = demo.fleet.find((item) => item.id === "BUS-01")!;
  const planResponse = await post("/api/transport/rescue", { demoId: demo.id, brokenBusId: stopped.id }, admin.cookie);
  assert.equal(planResponse.status, 200);
  const plan = (await planResponse.json()).plan as RescuePlan & { source: string; reserved: number };
  assert.equal(plan.source, "RULES");
  assert.equal(plan.reserved, 0);
  assert.equal(plan.stranded, stopped.occupied);
  assert(plan.assignments.length > 0);
  assert.equal(plan.uncovered, 0);
  const assignments = plan.assignments.map(({ busId, seatsAllocated }) => ({ busId, seatsAllocated }));
  const key = randomUUID();
  const dispatched = await transportAction(admin.cookie, demo, "DISPATCH", { brokenBusId: stopped.id, assignments }, key);
  assert.equal(dispatched.status, 200);
  const after = (await dispatched.json()).demo as TransportSnapshot;
  assert.equal(after.fleet.find((item) => item.id === stopped.id)!.occupied, stopped.occupied, "Dispatch reserves seats; arrival moves passengers");
  assert.equal(after.transfers.filter((item) => item.status === "EN_ROUTE").length, assignments.length);
  assert.equal(after.transfers.reduce((total, item) => total + item.seats, 0), stopped.occupied);
  const retry = await transportAction(admin.cookie, demo, "DISPATCH", { brokenBusId: stopped.id, assignments }, key);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).replayed, true);
  assert.equal((await transportAction(admin.cookie, demo, "DISPATCH", { brokenBusId: stopped.id, assignments })).status, 409);
  const reserved = (await (await post("/api/transport/rescue", { demoId: demo.id, brokenBusId: stopped.id }, admin.cookie)).json()).plan;
  assert.equal(reserved.reserved, stopped.occupied);
  assert.equal(reserved.assignments.length, 0);
  assert.equal(reserved.uncovered, 0);
  assert.equal((await transportAction(admin.cookie, after, "MOVE_BREAKDOWN", { busId: stopped.id, lat: 13.04, lng: 80.17 })).status, 409);
  demo = after;
  for (let index = 0; index < 60 && demo.transfers.some((item) => item.status === "EN_ROUTE"); index++) {
    demo = await transportAct(admin.cookie, demo, "STEP");
    assert.equal(demo.fleet.reduce((total, item) => total + item.occupied, 0), totalPassengers);
    assert(demo.fleet.every((item) => item.occupied >= 0 && item.occupied <= item.capacity));
    const broken = demo.fleet.find((item) => item.id === stopped.id)!;
    assert.equal(broken.lat, stopped.lat);
    assert.equal(broken.lng, stopped.lng);
  }
  assert(demo.transfers.every((item) => item.status === "COMPLETED"));
  assert.equal(demo.fleet.find((item) => item.id === stopped.id)!.occupied, 0);
  assert.equal(demo.transfers.length, assignments.length, "Retries must not duplicate pickups");
});

test("transport rejects overlapping dispatches, stale actions and reused keys atomically", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  let demo = await transportDemo(admin.cookie);
  demo = await transportAct(admin.cookie, demo, "BREAKDOWN", { busId: "BUS-01" });
  const snapshot = await transportSnapshot(demo.id);
  const helper = demo.fleet.find((item) => item.id === "BUS-02")!;
  for (const assignments of [
    [{ busId: helper.id, seatsAllocated: helper.capacity - helper.occupied + 1 }],
    [{ busId: helper.id, seatsAllocated: 1 }, { busId: helper.id, seatsAllocated: 1 }],
    [{ busId: "BUS-01", seatsAllocated: 1 }],
    [{ busId: helper.id, seatsAllocated: 0 }],
  ]) {
    const response = await transportAction(admin.cookie, demo, "DISPATCH", { brokenBusId: "BUS-01", assignments });
    assert([400, 409].includes(response.status), `Invalid assignment accepted: ${response.status}`);
    assert.deepEqual(await transportSnapshot(demo.id), snapshot);
  }
  const key = randomUUID();
  const dispatch = { brokenBusId: "BUS-01", assignments: [{ busId: helper.id, seatsAllocated: 1 }] };
  const competing = await Promise.all([
    transportAction(admin.cookie, demo, "DISPATCH", dispatch, key),
    transportAction(admin.cookie, demo, "DISPATCH", dispatch),
  ]);
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409]);
  const refreshed = (await (await request(`/api/transport/${demo.id}`, { headers: { Cookie: admin.cookie } })).json()).demo as TransportSnapshot;
  assert.equal(refreshed.transfers.length, 1);
  const winningIndex = competing.findIndex((response) => response.status === 200);
  if (winningIndex === 0) {
    assert.equal((await transportAction(admin.cookie, refreshed, "STEP", {}, key)).status, 409);
  }
  assert.equal((await transportAction(admin.cookie, demo, "STEP")).status, 409);
  assert.equal(await prisma.transportEvent.count({ where: { demoId: demo.id, action: "DISPATCH" } }), 1);
});

test("transport access is revoked immediately after an administrator role or session changes", async () => {
  const admin = await login(Role.SYSTEM_ADMIN);
  const demo = await transportDemo(admin.cookie);
  const snapshot = await transportSnapshot(demo.id);
  const userId = accounts.get(Role.SYSTEM_ADMIN)!.id;
  const check = async (status: number) => {
    assert.equal((await request(`/api/transport/${demo.id}`, { headers: { Cookie: admin.cookie } })).status, status);
    assert.equal((await post("/api/transport/rescue", { demoId: demo.id, brokenBusId: "BUS-01" }, admin.cookie)).status, status);
    assert.equal((await transportAction(admin.cookie, demo, "STEP")).status, status);
    assert.deepEqual(await transportSnapshot(demo.id), snapshot);
  };
  try {
    await prisma.user.update({ where: { id: userId }, data: { role: Role.STUDENT } });
    await check(403);
    await prisma.user.update({ where: { id: userId }, data: { role: Role.SYSTEM_ADMIN, active: false } });
    await check(401);
  } finally {
    await prisma.user.update({ where: { id: userId }, data: { role: Role.SYSTEM_ADMIN, active: true } });
  }
  await prisma.session.update({ where: { tokenHash: createHash("sha256").update(admin.token).digest("hex") }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await check(401);
});
