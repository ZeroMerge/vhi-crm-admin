import readline from 'readline/promises';
import { getDatabaseUrl } from '../config/db';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Refuses to let a destructive script touch a non-local database.
// Only the host and database name are ever printed — never the URL, user, or password.
export async function assertLocalDatabase(scriptName: string) {
  let url: URL;
  try {
    url = new URL(getDatabaseUrl());
  } catch {
    fail(`[${scriptName}] Refusing to run: DATABASE_URL is not a valid connection URL.`);
  }

  // pg lets a ?host= query param override the URL host (e.g. unix sockets), so it decides the real target.
  const host = (url.searchParams.get('host') || url.hostname).replace(/^\[|\]$/g, '').toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (LOCAL_HOSTS.includes(host)) return;

  const target = `host "${host || '(none)'}", database "${database || '(none)'}"`;

  if (process.env.ALLOW_DESTRUCTIVE_DB !== '1') {
    fail(
      `[${scriptName}] Refusing to run against non-local ${target}.\n` +
      `Only localhost, 127.0.0.1 or ::1 are allowed. To override, set ALLOW_DESTRUCTIVE_DB=1 and confirm the database name.`
    );
  }

  if (!host || !database) {
    fail(`[${scriptName}] Refusing to run: could not determine both host and database name from DATABASE_URL.`);
  }

  if (!process.stdin.isTTY) {
    fail(`[${scriptName}] Refusing to run against ${target}: confirmation must be typed in an interactive terminal.`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `[${scriptName}] ALLOW_DESTRUCTIVE_DB=1 is set for NON-LOCAL ${target}.\nType the database name to continue: `
  );
  rl.close();

  if (answer.trim() !== database) {
    fail(`[${scriptName}] Confirmation did not match "${database}". Aborting.`);
  }

  console.log(`[${scriptName}] Confirmed. Proceeding against ${target}.`);
}
