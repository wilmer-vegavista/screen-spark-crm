/** A scripted fetch for tests: handlers matched on method + URL substring, every call recorded. */

export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export type Handler = (call: RecordedCall, nth: number) => Response | Promise<Response>;

export interface MockFetch {
  fetch: typeof fetch;
  calls: RecordedCall[];
  /** Calls whose URL contains the fragment. */
  to(fragment: string): RecordedCall[];
}

export const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const TOKEN_OK = () => json(200, { access_token: "tok-1", expires_in: 3600 });

export function mockFetch(
  routes: Array<[method: string, urlFragment: string, handler: Handler]>,
): MockFetch {
  const calls: RecordedCall[] = [];
  const counts = new Map<number, number>();
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const body = typeof init?.body === "string" ? init.body : null;
    const call: RecordedCall = { method, url, headers, body };
    calls.push(call);
    for (let i = 0; i < routes.length; i++) {
      const [m, frag, handler] = routes[i];
      if (m.toUpperCase() === method && url.includes(frag)) {
        const nth = (counts.get(i) ?? 0) + 1;
        counts.set(i, nth);
        return await handler(call, nth);
      }
    }
    return new Response(`no mock route for ${method} ${url}`, { status: 599 });
  }) as typeof fetch;
  return {
    fetch: fetchFn,
    calls,
    to: (fragment) => calls.filter((c) => c.url.includes(fragment)),
  };
}

/** One Fortnox collection page in the real envelope shape. */
export function page<T>(
  key: string,
  rows: T[],
  current: number,
  totalPages: number,
  totalResources: number,
) {
  return {
    MetaInformation: {
      "@CurrentPage": current,
      "@TotalPages": totalPages,
      "@TotalResources": totalResources,
    },
    [key]: rows,
  };
}

export const noSleep = (_ms: number) => Promise.resolve();
