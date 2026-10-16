import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// The client app has no test runner, so its pure Help modules are loaded and tested here, the way the shared realtime modules are
// (realtime.clientModules.test.ts). They use relative imports only for exactly this reason.
const CLIENT = path.join(__dirname, '../../../../client/src');
const load = (file: string): any => require(path.join(CLIENT, file)); // eslint-disable-line @typescript-eslint/no-require-imports
const read = (file: string) => fs.readFileSync(path.join(CLIENT, file), 'utf8');

const { helpContent } = load('content/help.ts');
const search = load('lib/helpSearch.ts');
const links = load('lib/helpLinks.ts');
const { buildStatusRows } = load('lib/helpStatuses.ts');
const status = load('lib/shipmentStatus.ts');
const { SHIPPING_MODES } = load('lib/shippingModes.ts');

type Block = { type: string; [key: string]: any };
const allItems = (): any[] => helpContent.categories.flatMap((c: any) => c.items);
const allBlocks = (): Block[] => allItems().flatMap((i) => i.answer as Block[]);
const linkBlocks = () => allBlocks().filter((b) => b.type === 'link');
const stringsIn = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(stringsIn) : value && typeof value === 'object' ? Object.values(value).flatMap(stringsIn) : [];

// ---- the router's route list, read from App.tsx ----
function appRoutes(): Set<string> {
  const src = read('App.tsx');
  const routes = new Set<string>();
  // Top-level absolute paths and the children of the /dashboard route (relative paths, plus the index route).
  const dashStart = src.indexOf('path="/dashboard"');
  const dashEnd = src.indexOf('</Route>', dashStart);
  const dashboard = src.slice(dashStart, dashEnd);
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"/g)) {
    const at = m.index!;
    if (m[1].startsWith('/') && !(at >= dashStart && at < dashEnd && m[1] === '/dashboard')) routes.add(m[1]);
  }
  routes.add('/dashboard');
  for (const m of dashboard.matchAll(/<Route\s+(?:\s*)path="([^"]+)"/g)) routes.add(`/dashboard/${m[1]}`);
  for (const m of dashboard.matchAll(/<Route\s+path=\s*"([^"]+)"/g)) routes.add(`/dashboard/${m[1]}`);
  // children written over several lines: path="..." on its own line
  for (const m of dashboard.matchAll(/\n\s+path="([^"]+)"/g)) routes.add(`/dashboard/${m[1]}`);
  return routes;
}
const stripQuery = (to: string) => to.split(/[?#]/)[0];

describe('help content: structure', () => {
  test('ids are unique slugs (items and categories share the #hash namespace) and related ids exist', () => {
    const ids = [...helpContent.categories.map((c: any) => c.id), ...allItems().map((i) => i.id)];
    assert.equal(new Set(ids).size, ids.length, 'duplicate id');
    for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, id);
    const itemIds = new Set(allItems().map((i) => i.id));
    for (const item of allItems()) {
      for (const rel of item.related ?? []) {
        assert.ok(itemIds.has(rel), `${item.id} relates to unknown ${rel}`);
        assert.notEqual(rel, item.id);
      }
    }
  });

  test('every item has a question, keywords and at least one known block', () => {
    const known = ['p', 'steps', 'bullets', 'note', 'link', 'statuses', 'modes', 'contact'];
    for (const item of allItems()) {
      assert.ok(item.question.trim().length > 5, item.id);
      assert.ok(item.keywords.length > 0, `${item.id} has no keywords`);
      assert.ok(item.answer.length > 0, item.id);
      for (const block of item.answer) assert.ok(known.includes(block.type), `${item.id}: unknown block ${block.type}`);
      for (const block of item.answer) {
        if (block.type === 'steps') assert.ok(block.items.length >= 2, `${item.id}: steps need two or more items`);
      }
    }
  });

  test('storable as JSON, and no HTML, placeholders or unconfirmed markers anywhere', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(helpContent)), helpContent);
    for (const text of stringsIn(helpContent)) {
      assert.doesNotMatch(text, /<\/?[a-z!][^>]*>/i, `HTML-like text: ${text.slice(0, 60)}`);
      assert.doesNotMatch(text, /CLIENT TO CONFIRM|TODO|FIXME|lorem/i, `placeholder: ${text.slice(0, 60)}`);
    }
  });

  test('no help file can inject HTML', () => {
    for (const file of ['components/help/HelpView.tsx', 'components/help/HelpBlocks.tsx', 'pages/help/PublicHelp.tsx', 'pages/dashboard/help/Help.tsx', 'content/help.ts', 'lib/helpSearch.ts']) {
      assert.doesNotMatch(read(file), /dangerouslySetInnerHTML|innerHTML\s*=/, file);
    }
  });
});

describe('help content: links', () => {
  const routes = appRoutes();

  test('the route list read from App.tsx looks right', () => {
    for (const expected of ['/signin', '/signup', '/forgot-password', '/help', '/dashboard', '/dashboard/help', '/dashboard/mail', '/dashboard/tracking', '/dashboard/settings', '/dashboard/create-shipment/air-freight']) {
      assert.ok(routes.has(expected), `parsed routes miss ${expected}`);
    }
  });

  test('every in-app link (answers and the navigation guide) points at a route that exists', () => {
    for (const block of linkBlocks()) assert.ok(routes.has(stripQuery(block.to)), `${block.label} -> ${block.to}`);
    for (const entry of helpContent.navigate) assert.ok(routes.has(stripQuery(entry.to)), `${entry.title} -> ${entry.to}`);
    for (const route of links.PUBLIC_ROUTES) assert.ok(routes.has(route), `public route ${route} is not in the router`);
  });

  test('public routes are outside the protected dashboard route, and dashboard Help is one of its children', () => {
    const src = read('App.tsx');
    const dashStart = src.indexOf('path="/dashboard"');
    const dashEnd = src.indexOf('</Route>', dashStart);
    assert.ok(dashStart > 0 && dashEnd > dashStart);
    assert.match(src.slice(dashStart, dashEnd), /<ProtectedRoute>/, 'the dashboard route is the protected one');
    for (const route of links.PUBLIC_ROUTES) {
      const at = src.indexOf(`path="${route}"`);
      assert.ok(at >= 0, `${route} is not routed`);
      assert.ok(at < dashStart || at > dashEnd, `${route} must be outside the protected dashboard route`);
    }
    const dashHelp = src.indexOf('path="help"');
    assert.ok(dashHelp > dashStart && dashHelp < dashEnd, 'dashboard help must be a child of the dashboard route');
  });

  test('members see every link as written', () => {
    for (const block of linkBlocks()) assert.deepEqual(links.resolveLink(block, 'member'), { to: block.to, label: block.label });
  });

  test('signed out: no link points to a protected route; dashboard links become "Sign in to open ..." or vanish', () => {
    for (const block of linkBlocks()) {
      const resolved = links.resolveLink(block, 'public');
      if (resolved === null) {
        assert.equal(block.hideWhenSignedOut, true, `${block.label} disappeared without hideWhenSignedOut`);
        continue;
      }
      assert.ok(links.PUBLIC_ROUTES.includes(stripQuery(resolved.to)), `signed-out link to ${resolved.to}`);
      assert.ok(!resolved.to.startsWith('/dashboard'), resolved.to);
      if (links.isPublicRoute(block.to)) assert.deepEqual(resolved, { to: block.to, label: block.label });
      else {
        assert.equal(resolved.to, '/signin');
        assert.match(resolved.label, /^Sign in to open /);
      }
    }
    assert.deepEqual(links.resolveLink({ label: 'Go to Tracking', to: '/dashboard/tracking' }, 'public'), { to: '/signin', label: 'Sign in to open Tracking' });
    assert.equal(links.resolveLink({ label: 'Go to Mail', to: '/dashboard/mail', hideWhenSignedOut: true }, 'public'), null);
    assert.deepEqual(links.resolveLink({ label: 'Go to Sign up', to: '/signup' }, 'public'), { to: '/signup', label: 'Go to Sign up' });
    assert.deepEqual(links.resolveLink({ label: 'Go to Help', to: '/help#sign-in' }, 'public'), { to: '/help#sign-in', label: 'Go to Help' });
    // look-alikes must not pass as public
    for (const to of ['/dashboard', '/dashboard/help', '/signin/../dashboard', '/signinx', '//evil.example', 'https://evil.example', '/dashboard/signin']) {
      assert.equal(links.isPublicRoute(to), false, to);
      assert.equal(links.resolveLink({ label: 'Go to X', to }, 'public')?.to, '/signin', to);
    }
  });

  test('nothing links to the static Invoice or Newsletter pages; they appear in the guide as unavailable, without a link', () => {
    for (const block of linkBlocks()) assert.doesNotMatch(block.to, /\/dashboard\/(invoice|newsletter)/);
    const unavailable = helpContent.navigate.filter((e: any) => !e.available).map((e: any) => e.title).sort();
    assert.deepEqual(unavailable, ['Invoice', 'Newsletter']);
    for (const entry of helpContent.navigate.filter((e: any) => !e.available)) assert.equal(entry.summary, "This section isn't available yet.");
    const page = read('components/help/HelpView.tsx');
    assert.match(page, /entry\.available/, 'the page must only link available entries');
  });

  test('the navigation guide is the Sidebar, in order', () => {
    const src = read('components/Sidebar.tsx');
    const fromArray = (name: string) => {
      const start = src.indexOf(`const ${name} = [`);
      const body = src.slice(start, src.indexOf('];', start));
      return [...body.matchAll(/title:\s*"([^"]+)"[\s\S]*?to:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
    };
    const sidebar = [...fromArray('mainNavItems'), ...fromArray('bottomNavItems')];
    assert.ok(sidebar.length >= 9, `parsed ${sidebar.length} sidebar items`);
    // A sidebar item with no route would send customers to a 404, so the guide cannot list it, and no such item is allowed.
    const unrouted = sidebar.filter(([, to]) => !routes.has(to));
    assert.deepEqual(unrouted.map(([, to]) => to), [], `sidebar items without a route: ${JSON.stringify(unrouted)}`);
    const routed = sidebar.filter(([, to]) => routes.has(to));
    assert.deepEqual(helpContent.navigate.map((e: any) => [e.title, e.to]), routed);
  });
});

describe('help content: generated from the app, not retyped', () => {
  test('every status in shipmentStatus.ts appears in the tracking answer, under the label customers see', () => {
    const item = allItems().find((i) => i.id === 'status-meanings');
    assert.ok(item?.answer.some((b: Block) => b.type === 'statuses'), 'status-meanings has no generated statuses block');
    const rows = buildStatusRows();
    const covered = rows.flatMap((r: any) => r.statuses).sort();
    assert.deepEqual(covered, [...status.SHIPMENT_STATUSES].sort());
    const text = search.answerText(item);
    for (const s of status.SHIPMENT_STATUSES) {
      assert.ok(text.includes(status.getStatusDisplay(s).label), `${s} (${status.getStatusDisplay(s).label}) missing from the answer`);
    }
    // draft is an internal state shown as Pending: one row, both statuses
    assert.deepEqual(rows.find((r: any) => r.label === 'Pending').statuses, ['draft', 'pending']);
  });

  test('status wording is the timeline wording, and the cancelled sentence is shared', () => {
    const rows = buildStatusRows();
    const byLabel = Object.fromEntries(rows.map((r: any) => [r.label, r.description]));
    const stageDescription = (key: string) => status.TIMELINE_STAGES.find((s: any) => s.key === key).description;
    assert.equal(byLabel['Pending'], stageDescription('order_placed'));
    assert.equal(byLabel['Processing'], stageDescription('processing'));
    assert.equal(byLabel['In transit'], stageDescription('in_transit'));
    assert.equal(byLabel['Customs clearance'], stageDescription('clearance'));
    assert.equal(byLabel['Delivered'], stageDescription('delivered'));
    assert.equal(byLabel['Cancelled'], status.CANCELLED_MESSAGE);
    // the timeline component reads the same constants (no second copy of the sentence)
    assert.doesNotMatch(read('pages/dashboard/tracking/TrackingTimeline.tsx'), /was cancelled and will not be processed/);
    assert.match(read('pages/dashboard/tracking/TrackingTimeline.tsx'), /CANCELLED_MESSAGE/);
  });

  test('shipment types: the Help answer and the Create Shipment cards read one list; every card has a route', () => {
    const item = allItems().find((i) => i.id === 'shipment-types');
    assert.ok(item.answer.some((b: Block) => b.type === 'modes'));
    const text = search.answerText(item);
    const routes = appRoutes();
    for (const mode of SHIPPING_MODES) {
      assert.ok(text.includes(mode.title) && text.includes(mode.description), mode.id);
      assert.ok(routes.has(`/dashboard/create-shipment/${mode.id}`), `no route for ${mode.id}`);
    }
    assert.match(read('pages/dashboard/create-shipment/CreateShipment.tsx'), /SHIPPING_MODES/);
    assert.doesNotMatch(read('pages/dashboard/create-shipment/CreateShipment.tsx'), /Time sensitive cargo shipping/);
  });

  test('the "active" statuses in the overview guide come from isActiveStatus', () => {
    const overview = helpContent.navigate.find((e: any) => e.title === 'Overview').summary;
    for (const s of status.SHIPMENT_STATUSES.filter((x: string) => status.isActiveStatus(x))) assert.ok(overview.includes(status.getStatusDisplay(s).label), s);
    for (const s of ['delivered', 'cancelled']) assert.ok(!overview.includes(`(${status.getStatusDisplay(s).label}`), s);
  });
});

describe('help search', () => {
  const fixture = {
    version: 1,
    navigate: [],
    categories: [
      {
        id: 'a', title: 'A',
        items: [
          { id: 'cafe', question: 'Where is the café?', keywords: ['coffee'], answer: [{ type: 'p', text: 'Next to the lobby.' }] },
          { id: 'kw', question: 'Opening hours', keywords: ['schedule'], answer: [{ type: 'p', text: 'We open early.' }] },
          { id: 'body', question: 'Parking', keywords: ['car'], answer: [{ type: 'steps', items: ['Take a schedule from the desk.', 'Park.'] }] },
          { id: 'q', question: 'Schedule changes', keywords: ['timetable'], answer: [{ type: 'p', text: 'See below.' }] },
        ],
      },
    ],
  };
  const ids = (query: string, content: any = fixture) => search.searchHelp(content, query).map((h: any) => h.item.id);

  test('normalize: case, accents, whitespace', () => {
    assert.equal(search.normalize('  Crème   BRÛLÉE '), 'creme brulee');
    assert.equal(search.normalize('Ọláwálé'), 'olawale');
    assert.equal(search.normalize(''), '');
  });

  test('case- and accent-insensitive, in both directions', () => {
    assert.deepEqual(ids('CAFE'), ['cafe']);
    assert.deepEqual(ids('café'), ['cafe']);
    assert.deepEqual(ids('CAFÉ'), ['cafe']);
    assert.deepEqual(ids('coffee'), ['cafe']); // keyword
    assert.deepEqual(ids('lobby'), ['cafe']); // answer text
  });

  test('every word must match; unknown words find nothing; an empty query returns everything in order', () => {
    assert.deepEqual(ids('cafe lobby'), ['cafe']);
    assert.deepEqual(ids('cafe parking'), []);
    assert.deepEqual(ids('zzzz'), []);
    assert.deepEqual(ids(''), ['cafe', 'kw', 'body', 'q']);
    assert.deepEqual(ids('   '), ['cafe', 'kw', 'body', 'q']);
  });

  test('ranking: question beats keyword beats answer; ties keep the content order', () => {
    // "schedule" is in the question of "q", a keyword of "kw", and the answer of "body"
    assert.deepEqual(ids('schedule'), ['q', 'kw', 'body']);
  });

  test('statuses and shipping modes are searchable through their generated text', () => {
    assert.ok(ids('Customs clearance', helpContent).includes('status-meanings'));
    assert.ok(ids('Awaiting customs processing', helpContent).includes('status-meanings'));
    assert.ok(ids('less than container load', helpContent).includes('shipment-types'));
  });

  test('realistic questions find the right answer first', () => {
    const first = (query: string) => ids(query, helpContent)[0];
    assert.equal(first('forgot password'), 'forgot-password');
    assert.equal(first('PASSWORD'), 'forgot-password');
    assert.equal(first('cancel'), 'cancel-shipment');
    assert.equal(first('awb'), 'awb-bol');
    assert.equal(first('unsubscribe'), 'unsubscribe');
    assert.equal(first('create account'), 'create-account');
    assert.equal(first('sign out'), 'log-out');
    assert.equal(first('customs clearance'), 'status-meanings'); // a keyword that is the phrase
    assert.ok(ids('junk', helpContent).includes('no-emails'));
    assert.deepEqual(ids('xqzvw', helpContent), []);
  });

  test('contact blocks add no searchable text', () => {
    assert.equal(search.blockText({ type: 'contact', text: 'Contact VHI:' }), '');
  });
});

describe('help deep links', () => {
  const ids = allItems().map((i) => i.id);

  test('#id, id and percent-encoded ids resolve to a real item', () => {
    for (const id of ids) {
      assert.equal(search.resolveHash(helpContent, `#${id}`), id);
      assert.equal(search.resolveHash(helpContent, id), id);
      assert.equal(search.resolveHash(helpContent, `#${encodeURIComponent(id)}`), id);
    }
  });

  test('unknown, empty, malformed, category and look-alike hashes resolve to nothing', () => {
    for (const hash of ['', '#', '#nope', '#Create-Account', '#create-account ', '#%E0%A4%A', '#create-account/../x', '#__proto__', '#constructor']) {
      assert.equal(search.resolveHash(helpContent, hash), null, JSON.stringify(hash));
    }
    assert.equal(search.resolveHash(helpContent, '#getting-started'), null, 'a category is not an item');
    assert.equal(search.resolveCategoryHash(helpContent, '#getting-started'), 'getting-started');
    assert.equal(search.resolveCategoryHash(helpContent, '#create-account'), null);
  });

  test('ids that support may have shared stay put', () => {
    for (const id of ['create-account', 'confirm-email', 'sign-in', 'forgot-password', 'cancel-shipment', 'edit-shipment', 'status-meanings', 'email-settings', 'message-support', 'already-processing']) {
      assert.ok(ids.includes(id), `${id} was renamed or removed`);
    }
  });
});

describe('help: cancellation wording', () => {
  const wording = load('lib/cancelWording.ts');
  const text = (id: string) => search.answerText(allItems().find((i) => i.id === id));
  const question = (id: string) => allItems().find((i) => i.id === id).question;

  test('the cancel answers use the action label from lib/cancelWording.ts (rename it there, Help follows) and no longer say Delete', () => {
    const { CANCEL_WORDING } = wording;
    const cancel = text('cancel-shipment');
    for (const expected of [CANCEL_WORDING.action, CANCEL_WORDING.dialogTitle, CANCEL_WORDING.confirm, CANCEL_WORDING.keep]) assert.ok(cancel.includes(expected), `missing ${expected}`);
    assert.doesNotMatch(cancel, /Delete/);
    assert.doesNotMatch(cancel + text('no-edit-button') + question('no-edit-button'), /Delete/);
    assert.ok(question('no-edit-button').includes(CANCEL_WORDING.action));
    assert.ok(text('no-edit-button').includes(CANCEL_WORDING.guidanceAction));
  });

  test('"My shipment is already being processed" explains the support route and links to Mail (hidden when signed out)', () => {
    const item = allItems().find((i) => i.id === 'already-processing');
    assert.equal(item.question, 'My shipment is already being processed. Can I cancel or change it?');
    const answer = search.answerText(item);
    for (const expected of [wording.CANCEL_WORDING.guidanceAction, wording.CANCEL_WORDING.messageSupport, 'Send VHI Support a message', 'Nothing is sent until you press Send']) assert.ok(answer.includes(expected), expected);
    const mail = item.answer.find((b: Block) => b.type === 'link' && b.to === '/dashboard/mail');
    assert.ok(mail && mail.hideWhenSignedOut === true);
    assert.deepEqual(links.resolveLink(mail, 'public'), null);
    assert.ok(search.searchHelp(helpContent, 'already being processed').map((h: any) => h.item.id).includes('already-processing'));
    assert.equal(search.searchHelp(helpContent, 'cancel or change').map((h: any) => h.item.id)[0], 'already-processing');
  });

  test('no help text promises something that is not there: the old "this cancels the shipment" note about Delete is gone', () => {
    for (const item of allItems()) assert.doesNotMatch(search.answerText(item), /choose Delete|Delete Shipment box|This cancels the shipment/i, item.id);
  });
});
