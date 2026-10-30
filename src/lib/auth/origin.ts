type OriginSettings = { production: boolean; configuredOrigin?: string };

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

// Pure policy so development-host and production-origin rules can be tested
// without loading a Next request context or the database.
export function mutationOriginError(
  request: Request,
  { production, configuredOrigin }: OriginSettings,
): "configuration" | "forbidden" | null {
  if (!configuredOrigin && production) return "configuration";

  let expected: URL;
  if (configuredOrigin) {
    try {
      expected = new URL(configuredOrigin);
      if (!["http:", "https:"].includes(expected.protocol) || expected.username || expected.password ||
        expected.pathname !== "/" || expected.search || expected.hash ||
        (production && expected.protocol !== "https:" && !isLoopback(expected.hostname))) {
        return "configuration";
      }
    } catch { return "configuration"; }
  } else {
    // Next dev can normalize request.url to localhost even when the browser
    // uses 127.0.0.1. Use the actual Host only for local development, bounded
    // to loopback names and this server's port. Never trust forwarded headers.
    try {
      const requestUrl = new URL(request.url);
      const host = request.headers.get("host");
      if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) {
        return "forbidden";
      }
      expected = new URL(`${requestUrl.protocol}//${host}`);
      if (!["http:", "https:"].includes(expected.protocol) || !isLoopback(expected.hostname) ||
        expected.port !== requestUrl.port) return "forbidden";
    } catch { return "forbidden"; }
  }

  if (request.headers.get("origin") !== expected.origin ||
    ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) {
    return "forbidden";
  }
  return null;
}
