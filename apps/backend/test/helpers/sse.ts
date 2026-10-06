import path from 'path';

// The admin app's parser, used as the test client's parser (it is also unit-tested in clientModules.test.ts).
// Loaded with require so the test tsconfig does not pull app files into its program.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const parser = require(path.join(__dirname, '../../../../app/src/lib/sseParser.ts'));

export interface SseMessage {
  event: string;
  data: string;
  lastEventId: string;
}

export interface SseConnection {
  status: number;
  headers: Headers;
  messages: SseMessage[];
  raw: string;
  ended: boolean;
  body: any;
  close: () => void;
  waitFor: (predicate: (messages: SseMessage[]) => boolean, timeoutMs?: number) => Promise<void>;
  waitForEnd: (timeoutMs?: number) => Promise<void>;
}

export async function openStream(url: string, token: string): Promise<SseConnection> {
  const controller = new AbortController();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  const conn: SseConnection = {
    status: res.status,
    headers: res.headers,
    messages: [],
    raw: '',
    ended: false,
    body: null,
    close: () => controller.abort(),
    waitFor: async (predicate, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(conn.messages)) {
        if (Date.now() > deadline) throw new Error(`timed out waiting; got ${JSON.stringify(conn.messages.map((m) => m.event))}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    waitForEnd: async (timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (!conn.ended) {
        if (Date.now() > deadline) throw new Error('stream did not end');
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
  if (res.status !== 200 || !res.body) {
    conn.body = await res.json().catch(() => null);
    conn.ended = true;
    return conn;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let state = parser.initialSseState;
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        conn.raw += text;
        const out = parser.parseSse(state, text);
        state = out.state;
        conn.messages.push(...out.messages);
      }
    } catch {
      // aborted
    } finally {
      conn.ended = true;
    }
  })();
  return conn;
}

export const eventsOf = (conn: SseConnection, event: string) => conn.messages.filter((m) => m.event === event).map((m) => JSON.parse(m.data));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
