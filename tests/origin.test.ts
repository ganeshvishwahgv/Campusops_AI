import assert from "node:assert/strict";
import { test } from "node:test";
import { mutationOriginError } from "../src/lib/auth/origin";

const development = { production: false };

function request(headers: Record<string, string> = {}, url = "http://localhost:3000/api/auth/login") {
  return new Request(url, { method: "POST", headers });
}

test("development accepts the actual loopback host when Next normalizes the URL to localhost", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
    assert.equal(mutationOriginError(request({ Host: host, Origin: `http://${host}` }), development), null, host);
  }
});

test("development requires Origin to match the particular host used by the browser", () => {
  assert.equal(mutationOriginError(request({ Host: "127.0.0.1:3000", Origin: "http://localhost:3000" }), development), "forbidden");
  assert.equal(mutationOriginError(request({ Host: "localhost:3000", Origin: "http://127.0.0.1:3000" }), development), "forbidden");
  assert.equal(mutationOriginError(request({ Host: "localhost:3000", Origin: "https://attacker.example" }), development), "forbidden");
});

test("development denies missing hosts and origins rather than guessing their authority", () => {
  const missingHeaders: Array<Record<string, string>> = [
    {},
    { Host: "localhost:3000" },
    { Origin: "http://localhost:3000" },
    { Host: "localhost:3000", Origin: "null" },
    { Host: "localhost:3000", Origin: "" },
  ];
  for (const headers of missingHeaders) {
    assert.equal(mutationOriginError(request(headers), development), "forbidden");
  }
});

test("development rejects a different port even when Origin matches the supplied Host", () => {
  for (const host of ["localhost:3001", "127.0.0.1:80", "[::1]:4444"]) {
    assert.equal(mutationOriginError(request({ Host: host, Origin: `http://${host}` }), development), "forbidden", host);
  }
});

test("development rejects DNS rebinding names and malformed Host authorities", () => {
  const rejectedHosts = [
    "attacker.example:3000",
    "localhost.attacker.example:3000",
    "127.0.0.1.attacker.example:3000",
    "localhost@attacker.example:3000",
    "attacker.example@localhost:3000",
    "localhost:3000/path",
    "localhost:3000?query=1",
    "localhost:3000#fragment",
    "localhost:3000, attacker.example:3000",
    "localhost:3000\\attacker.example",
    "http://localhost:3000",
  ];
  for (const host of rejectedHosts) {
    assert.equal(mutationOriginError(request({ Host: host, Origin: "http://localhost:3000" }), development), "forbidden", host);
  }
});

test("forwarded headers do not grant a development origin permission", () => {
  assert.equal(mutationOriginError(request({
    Host: "localhost:3000",
    Origin: "https://attacker.example",
    "X-Forwarded-Host": "attacker.example",
    "X-Forwarded-Proto": "https",
  }), development), "forbidden");
  assert.equal(mutationOriginError(request({
    Host: "127.0.0.1:3000",
    Origin: "http://127.0.0.1:3000",
    "X-Forwarded-Host": "attacker.example",
    "X-Forwarded-Proto": "https",
  }), development), null);
});

test("development keeps the request protocol in the origin comparison", () => {
  const url = "https://localhost:3000/api/auth/logout";
  assert.equal(mutationOriginError(request({ Host: "127.0.0.1:3000", Origin: "https://127.0.0.1:3000" }, url), development), null);
  assert.equal(mutationOriginError(request({ Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" }, url), development), "forbidden");
});

test("same-site and cross-site fetches are rejected even with a matching Origin", () => {
  for (const site of ["same-site", "cross-site"]) {
    assert.equal(mutationOriginError(request({ Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": site }), development), "forbidden");
    assert.equal(mutationOriginError(request({ Origin: "https://campus.example", "Sec-Fetch-Site": site }), {
      production: true, configuredOrigin: "https://campus.example",
    }), "forbidden");
  }
  assert.equal(mutationOriginError(request({ Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin" }), development), null);
});

test("production requires an explicitly configured valid public origin", () => {
  const input = request({ Host: "localhost:3000", Origin: "http://localhost:3000" });
  assert.equal(mutationOriginError(input, { production: true }), "configuration");
  for (const configuredOrigin of [
    "not a URL",
    "file:///private",
    "ftp://campus.example",
    "https://user:password@campus.example",
    "https://campus.example/login",
    "https://campus.example?query=1",
    "https://campus.example#fragment",
    "http://campus.example",
  ]) {
    assert.equal(mutationOriginError(input, { production: true, configuredOrigin }), "configuration", configuredOrigin);
  }
});

test("production trusts only the configured origin, including its port", () => {
  const settings = { production: true, configuredOrigin: "https://campus.example:8443" };
  assert.equal(mutationOriginError(request({
    Host: "internal.proxy:3000",
    Origin: "https://campus.example:8443",
    "X-Forwarded-Host": "attacker.example",
  }), settings), null);
  for (const origin of ["https://attacker.example", "https://campus.example", "http://campus.example:8443", "https://campus.example:8443.attacker.example"]) {
    assert.equal(mutationOriginError(request({
      Host: "attacker.example",
      Origin: origin,
      "X-Forwarded-Host": "campus.example:8443",
      "X-Forwarded-Proto": "https",
    }), settings), "forbidden", origin);
  }
  assert.equal(mutationOriginError(request({ Host: "campus.example:8443" }), settings), "forbidden");
});

test("production loopback HTTP exceptions still require an exact configured origin", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
    const configuredOrigin = `http://${host}`;
    const settings = { production: true, configuredOrigin };
    assert.equal(mutationOriginError(request({ Origin: configuredOrigin }), settings), null);
    assert.equal(mutationOriginError(request({ Origin: "http://localhost:3001" }), settings), "forbidden");
  }
});

test("an explicit development origin is honored without opening access to other hosts", () => {
  const settings = { production: false, configuredOrigin: "http://campus.test:3000" };
  assert.equal(mutationOriginError(request({ Host: "internal.proxy:3000", Origin: "http://campus.test:3000" }), settings), null);
  assert.equal(mutationOriginError(request({ Host: "localhost:3000", Origin: "http://localhost:3000" }), settings), "forbidden");
  assert.equal(mutationOriginError(request({ Origin: "http://campus.test:3000" }), {
    production: false, configuredOrigin: "http://campus.test:3000/login",
  }), "configuration");
});
