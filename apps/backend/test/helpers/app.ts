import express, { Router } from 'express';
import type { AddressInfo } from 'net';
import { errorHandler } from '../../src/middleware/errorHandler';

export interface TestApp {
  url: string;
  close: () => Promise<void>;
}

// Mounts only the routers under test, with the same body parsing and error handler as src/index.ts.
// (Importing src/index.ts would start the real server on a fixed port.)
export async function startApp(mounts: Array<[string, Router]>): Promise<TestApp> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  for (const [mountPath, router] of mounts) app.use(mountPath, router);
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

export interface TestResponse {
  status: number;
  body: any;
}

export async function request(
  app: TestApp,
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {}
): Promise<TestResponse> {
  const res = await fetch(`${app.url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // non-JSON responses (e.g. PDFs) are returned as text
  }
  return { status: res.status, body };
}
