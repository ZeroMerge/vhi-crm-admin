import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// The client's pure cancel-guidance modules, loaded here because the client has no test runner (same approach as help.test.ts).
const CLIENT = path.join(__dirname, '../../../../client/src');
const load = (file: string): any => require(path.join(CLIENT, file)); // eslint-disable-line @typescript-eslint/no-require-imports
const read = (file: string) => fs.readFileSync(path.join(CLIENT, file), 'utf8');

const draftLib = load('lib/supportDraft.ts');
const wording = load('lib/cancelWording.ts');
const status = load('lib/shipmentStatus.ts');
const count = (haystack: string, needle: RegExp) => (haystack.match(needle) ?? []).length;

const OWN = ['CL1234-56-ab', '#4821-77-zz', 'CON2001-10-qq', 'WH9999-01-xy', 'FUTURE-2030-AB'];
const DRAFT = (id: string) => `Hello, I'd like to change or cancel shipment ${id}. Reason: `;

describe('Mail draft for ?shipment=<orderId>', () => {
  test('an ID the customer owns gives the template draft, for any prefix (the ownership check is the gate, not a format)', () => {
    for (const id of OWN) assert.equal(draftLib.draftForShipmentParam(id, OWN), DRAFT(id), id);
    assert.equal(draftLib.draftForShipmentParam('X1', ['X1']), DRAFT('X1'), 'a future-style prefix that the customer owns still gets a draft');
    assert.equal(draftLib.draftForShipmentParam('ABC-123', new Set(['ABC-123'])), DRAFT('ABC-123'), 'any iterable of own IDs');
  });

  test('a foreign, unknown, differently-cased or empty-list ID gives an empty draft', () => {
    assert.equal(draftLib.draftForShipmentParam('CL9999-99-zz', OWN), '', 'sane but not theirs');
    assert.equal(draftLib.draftForShipmentParam('cl1234-56-ab', OWN), '', 'IDs match exactly');
    assert.equal(draftLib.draftForShipmentParam('CL1234-56-ab', []), '');
    assert.equal(draftLib.draftForShipmentParam('CL1234-56-ab', ['CL1234-56-ac']), '');
  });

  test('malformed values are never looked up: empty, long, spaces, quotes, markup, paths, unicode, non-strings', () => {
    const owned = ['', ' ', 'a b', "x'y", '<script>', 'a/../b', '%41', 'é1', 'a'.repeat(41), '#CL1234-56-ab\n'];
    for (const bad of ['', ' ', 'CL1234-56-ab ', ' CL1234-56-ab', 'CL1234 56-ab', "CL1234-56-ab'", 'CL1234-56-ab<b>', '<script>alert(1)</script>', '../x', 'a/b', '%23CL1234', 'é1234-56-ab', 'a'.repeat(41), 'CL1234-56-ab\nHello', null, undefined]) {
      assert.equal(draftLib.draftForShipmentParam(bad as any, [...OWN, ...owned]), '', JSON.stringify(bad));
    }
    assert.equal(draftLib.draftForShipmentParam('a'.repeat(40), ['a'.repeat(40)]), DRAFT('a'.repeat(40)), 'exactly 40 is fine');
    for (const nonString of [5, {}, ['CL1234-56-ab'], true]) assert.equal(draftLib.draftForShipmentParam(nonString as any, OWN), '');
  });

  test('no text from the URL is ever accepted: the draft is the template plus an owned ID, nothing else', () => {
    // Only the shipment parameter is read: crafted text in other parameters, or glued onto the ID, produces nothing.
    for (const crafted of ['CL1234-56-ab Reason: please refund me', 'CL1234-56-ab&body=hi', 'CL1234-56-ab%0AHi', 'CL1234-56-ab;DROP']) {
      assert.equal(draftLib.draftForShipmentParam(crafted, OWN), '', crafted);
    }
    for (const id of OWN) {
      const draft = draftLib.draftForShipmentParam(id, OWN);
      assert.equal(draft.replace(id, '<ID>'), "Hello, I'd like to change or cancel shipment <ID>. Reason: ");
    }
  });

  test('the link behind "Message support": # is encoded; an unsafe ID gives the plain Mail link', () => {
    assert.equal(draftLib.mailLinkForShipment('CL1234-56-ab'), '/dashboard/mail?shipment=CL1234-56-ab');
    assert.equal(draftLib.mailLinkForShipment('#4821-77-zz'), '/dashboard/mail?shipment=%234821-77-zz');
    assert.equal(draftLib.mailLinkForShipment('a b&c=d'), '/dashboard/mail');
    assert.equal(draftLib.SHIPMENT_PARAM, 'shipment');
    // round trip: what the link carries is what the draft function accepts
    const url = new URL(draftLib.mailLinkForShipment('#4821-77-zz'), 'http://localhost');
    assert.equal(draftLib.draftForShipmentParam(url.searchParams.get('shipment'), OWN), DRAFT('#4821-77-zz'));
  });
});

describe('Mail never sends by itself and reads one URL parameter', () => {
  const mail = read('pages/dashboard/mail/Mail.tsx');
  const chat = read('components/ChatInterface.tsx');

  test('Mail reads only the shipment parameter, and the draft comes from the template function', () => {
    assert.equal(count(mail, /searchParams\.get\(/g), 1);
    assert.match(mail, /searchParams\.get\(SHIPMENT_PARAM\)/);
    assert.match(mail, /draftForShipmentParam\(/);
    assert.doesNotMatch(mail, /searchParams\.(getAll|entries|keys|values|toString)\b|location\.search|new URLSearchParams/);
  });

  test('nothing sends without the customer: one sendMessage call (inside the Send handler) and one onSendMessage call (inside handleSend)', () => {
    assert.equal(count(mail, /\bsendMessage\(/g), 1);
    assert.match(mail, /const handleSendMessage = \(content: string\) => \{[\s\S]*?sendMessage\(/);
    assert.equal(count(chat, /\bonSendMessage\(/g), 1);
    assert.match(chat, /const handleSend = \(\) => \{[\s\S]*?onSendMessage\(trimmed\)/);
    // handleSend is reached only from Enter in the box and the Send button
    assert.equal(count(chat, /handleSend\(\)/g), 1, 'called from the key handler');
    assert.equal(count(chat, /onClick=\{handleSend\}/g), 1, 'and the Send button');
    // the initial draft is only copied into the box
    assert.match(chat, /useState\(initialInput\)/);
    // no effect (the only code that runs without a click) ever sends
    const effects = (src: string) => [...src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[/g)].map((m) => m[1]);
    assert.ok(effects(chat).length >= 2 && effects(mail).length >= 2, 'effects were found');
    for (const body of [...effects(chat), ...effects(mail)]) assert.doesNotMatch(body, /\b(onSendMessage|sendMessage)\(/);
  });

  test('a changed draft remounts the composer rather than sending: key={draft} with initialInput', () => {
    assert.match(mail, /key=\{draft\}/);
    assert.match(mail, /initialInput=\{draft\}/);
  });
});

describe('cancel wording and who gets guidance', () => {
  test('one place for the strings, with the exact wording', () => {
    const w = wording.CANCEL_WORDING;
    assert.deepEqual(
      [w.action, w.dialogTitle, w.reasonLabel, w.keep, w.confirm, w.guidanceAction, w.messageSupport, w.close],
      ['Cancel shipment', 'Cancel shipment?', 'Reason (optional)', 'Keep shipment', 'Cancel shipment', 'Need to change or cancel?', 'Message support', 'Close'],
    );
    assert.equal(w.dialogBody('#CL1234-56-ab'), "Shipment #CL1234-56-ab will be cancelled. VHI will stop working on it, and this can't be undone.");
    assert.equal(wording.CANCEL_REASON_MAX_LENGTH, 500);
    assert.equal(wording.changeOrCancelDraft('X'), DRAFT('X'));
  });

  test('guidance text per status (VHI-created drafts have their own sentence)', () => {
    assert.equal(wording.guidanceMessage('CL1', 'processing'), "Shipment CL1 is already processing, so it can't be changed or cancelled here. Send VHI Support a message and they'll help.");
    assert.match(wording.guidanceMessage('CL1', 'in_transit'), /is already in transit, so/);
    assert.match(wording.guidanceMessage('CL1', 'clearance'), /is already in customs clearance, so/);
    assert.equal(wording.guidanceMessage('CL1', 'draft'), 'Shipment CL1 was set up by VHI, so changes or cancellation go through VHI Support.');
    assert.equal(wording.guidanceMessage('CL1', 'DRAFT'), wording.guidanceMessage('CL1', 'draft'));
  });

  test('guidance statuses are exactly draft, processing, in transit, customs clearance; Pending is editable; Delivered and Cancelled get nothing', () => {
    const guidance = status.SHIPMENT_STATUSES.filter((s: string) => status.isSupportGuidanceStatus(s)).sort();
    assert.deepEqual(guidance, ['clearance', 'draft', 'in_transit', 'processing']);
    for (const s of status.SHIPMENT_STATUSES) {
      const editable = status.isClientEditable(s);
      const guided = status.isSupportGuidanceStatus(s);
      assert.ok(!(editable && guided), `${s}: Edit/Cancel and guidance never together`);
      assert.equal(editable, s === 'pending', `${s} editable`);
      if (s === 'delivered' || s === 'cancelled') assert.ok(!editable && !guided, `${s}: nothing`);
    }
    // a draft is shown as Pending but is not editable: it gets guidance, never Edit or Cancel
    assert.equal(status.getStatusDisplay('draft').label, 'Pending');
    assert.equal(status.isClientEditable('draft'), false);
    assert.equal(status.isSupportGuidanceStatus('draft'), true);
  });

  test('Manage Shipment / Overview: Edit and Cancel only inside the editable branch, no Delete wording, the reason goes with the cancel request', () => {
    const src = read('pages/dashboard/overview/components/RecentActivities.tsx');
    assert.doesNotMatch(src, /Trash2|>\s*Delete\s*</);
    assert.doesNotMatch(src, /Delete Shipment/);
    assert.equal(count(src, /isClientEditable\(row\.original\.status\)/g), 2, 'desktop menu and mobile cards');
    assert.equal(count(src, /isSupportGuidanceStatus\(row\.original\.status\)/g), 2);
    // every Edit / Cancel control sits after an isClientEditable check, before the guidance branch
    for (const marker of ['onEdit(row.original)', 'onCancel(row.original)', 'openCancel(row.original)']) {
      const at = src.indexOf(marker);
      assert.ok(at > 0, marker);
      const before = src.slice(0, at);
      assert.ok(before.lastIndexOf('isClientEditable(row.original.status)') > before.lastIndexOf('isSupportGuidanceStatus(row.original.status)'), `${marker} is outside the editable branch`);
    }
    assert.match(src, /maxLength=\{CANCEL_REASON_MAX_LENGTH\}/);
    assert.match(src, /cancelShipment\(\{ orderId: cancelTarget\.orderId, reason \}\)/);
    assert.match(read('lib/api.ts'), /data: \{ reason: trimmed \}/);
  });

  test('Tracking shows the same note for guidance statuses with a Message support link', () => {
    const src = read('pages/dashboard/tracking/TrackingTimeline.tsx');
    assert.match(src, /isSupportGuidanceStatus\(shipment\.status\)/);
    assert.match(src, /guidanceMessage\(shipment\.shipmentId, shipment\.status\)/);
    assert.match(src, /mailLinkForShipment\(shipment\.shipmentId\)/);
  });
});
