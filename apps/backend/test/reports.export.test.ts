import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'stream';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, TestApp } from './helpers/app';
import { adminToken, insertAdmin } from './helpers/fixtures';
import { OCT, seedReportData } from './helpers/reportsSeed';
import { pdfLines, pdfText } from './helpers/pdfText';
import pool from '../src/config/db';
import reportsRoutes, { exportLimiter } from '../src/modules/reports/reports.routes';
import { BuildContext, buildReport } from '../src/modules/reports/export/model';
import { renderPdf } from '../src/modules/reports/export/pdf';
import { safeText, writeXlsx } from '../src/modules/reports/export/xlsx';
import { parseFilters } from '../src/modules/reports/filters';
import { companyName } from '../src/utils/companyName';
import { localDate } from '../src/utils/appTime';

const FORMULA_NAME = '=HYPERLINK("http://evil.example/steal","click me")';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('safeText (formula-injection guard)', () => {
  test('anything a spreadsheet could read as a formula gets a leading apostrophe; ordinary text is untouched', () => {
    for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1', ' =1', '  @x', FORMULA_NAME, '-cmd|calc']) {
      assert.equal(safeText(bad), `'${bad}`, JSON.stringify(bad));
    }
    for (const fine of ['Ada Obi', 'a=b', 'x+y', 'Acme-Corp', '1=1', '', 'O\'Neil', '₦100', 'Ọláwálé']) {
      assert.equal(safeText(fine), fine, JSON.stringify(fine));
    }
  });
});

describe('COMPANY_NAME', () => {
  test('defaults to VHI, drops control characters and long values', () => {
    assert.equal(companyName({}), 'VHI');
    assert.equal(companyName({ COMPANY_NAME: '   ' }), 'VHI');
    assert.equal(companyName({ COMPANY_NAME: ' Acme\r\n  Freight  Ltd ' }), 'Acme Freight Ltd');
    assert.equal(companyName({ COMPANY_NAME: 'x'.repeat(300) }).length, 100);
  });
});

describe('report exports', dbTest, () => {
  let app: TestApp;
  let finance: string;
  let financeId: string;
  let support: string;
  let ids: Record<string, string>;
  let evilId: string;

  before(async () => {
    await resetDatabase();
    app = await startApp([['/api/admin/reports', reportsRoutes]]);
    await truncateAll();
    ids = await seedReportData();
    // A customer whose name is a formula, one with accents, each with a shipment and an invoice in October.
    for (const [key, first, last, industry] of [['evil', FORMULA_NAME, 'Evil', 'oil_gas'], ['accent', 'Ọláwálé', 'Çelik-Muñoz', 'others']] as const) {
      const c = (await pool.query(
        `INSERT INTO customers (user_id, firstname, lastname, email, password_hash, industry, is_active)
         VALUES ($1, $2, $3, $4, 'x', $5, true) RETURNING id`, [`VHI-${key}`, first, last, `${key}@test.local`, industry])).rows[0].id;
      ids[key] = c;
      await pool.query(
        `INSERT INTO shipments (order_id, customer_id, shipping_mode, status, is_draft, created_at, status_changed_at)
         VALUES ($1, $2, 'air_freight', 'pending', false, '2026-10-14T10:00:00Z', '2026-10-14T10:00:00Z')`, [`T-${key}`, c]);
      await pool.query(
        `INSERT INTO invoices (invoice_number, customer_id, amount, currency, status, issued_at, created_at)
         VALUES ($1, $2, 10.00, 'NGN', 'sent', '2026-10-14T10:00:00Z', '2026-10-14T10:00:00Z')`, [`INV-${key}`, c]);
    }
    evilId = ids.evil;
    const f = await insertAdmin({ assignedRoles: ['finance_officer'] });
    financeId = f.id;
    finance = adminToken({ id: f.id, email: f.email, activeRole: 'finance_officer' });
    const s = await insertAdmin({ assignedRoles: ['support_staff'] });
    support = adminToken({ id: s.id, email: s.email, activeRole: 'support_staff' });
  });
  beforeEach(() => exportLimiter.reset());
  after(async () => {
    await app?.close();
    await pool.end();
  });

  const exportRaw = (qs: string, token = finance) =>
    fetch(`${app.url}/api/admin/reports/export?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  const exportBuf = async (qs: string, token = finance) => {
    const res = await exportRaw(qs, token);
    return { res, body: Buffer.from(await res.arrayBuffer()) };
  };
  const loadXlsx = async (qs: string, token = finance) => {
    const { res, body } = await exportBuf(`format=xlsx&${qs}`, token);
    assert.equal(res.status, 200, body.toString().slice(0, 300));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body as any);
    return { wb, body, res };
  };
  const rowsOf = (ws: ExcelJS.Worksheet) => {
    // Data rows only: from row 7 to the first blank row (general notices follow a blank row under the table).
    const out: ExcelJS.Row[] = [];
    for (let n = 7; n <= ws.rowCount; n++) {
      const row = ws.getRow(n);
      if (!row.hasValues) break;
      out.push(row);
    }
    return out;
  };
  const findRow = (ws: ExcelJS.Worksheet, firstCell: (v: ExcelJS.CellValue) => boolean) => rowsOf(ws).find((r) => firstCell(r.getCell(1).value));
  const headerOf = (ws: ExcelJS.Worksheet) => (ws.getRow(6).values as any[]).slice(1).map(String);

  describe('XLSX', () => {
    test('headers, file name, content type, one sheet per table', async () => {
      const { res, wb } = await loadXlsx(OCT);
      assert.equal(res.headers.get('content-type'), XLSX_MIME);
      assert.match(res.headers.get('content-disposition')!, /^attachment; filename="vhi-report-\d{4}-\d{2}-\d{2}\.xlsx"$/);
      assert.ok(res.headers.get('content-disposition')!.includes(localDate(new Date(), 'Africa/Lagos')));
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual(wb.worksheets.map((w) => w.name), [
        'Summary', 'Shipments by period', 'Shipments by customer', 'Revenue by period', 'Revenue by customer', 'Customers',
      ]);
    });

    test('every sheet: header block, frozen header row, autofilter, column widths', async () => {
      const { wb } = await loadXlsx(OCT);
      for (const ws of wb.worksheets) {
        assert.match(String(ws.getRow(1).getCell(1).value), /^Reports - VHI: /);
        assert.equal(ws.getRow(2).getCell(1).value, 'Date range: 1 Oct 2026 to 31 Oct 2026 (Africa/Lagos)');
        const filters = String(ws.getRow(3).getCell(1).value);
        assert.ok(filters.startsWith('Filters: Range: Custom') && filters.includes('Customer: All') && filters.includes('Granularity: Day'), filters);
        assert.match(String(ws.getRow(4).getCell(1).value), /^Generated: \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} WAT by .+ \(Finance officer\)$/);
        assert.equal(ws.views[0].state, 'frozen');
        assert.equal((ws.views[0] as any).ySplit, 6);
        assert.match(String(ws.autoFilter), /^A6:[A-Z]+\d+$/, `${ws.name} autofilter`);
        assert.ok(ws.getColumn(1).width! >= 10, `${ws.name} column widths`);
        assert.ok(headerOf(ws).length >= 3);
      }
    });

    test('real number and date cells with formats; currency per row', async () => {
      const { wb } = await loadXlsx(OCT);
      const customers = wb.getWorksheet('Customers')!;
      assert.deepEqual(headerOf(customers), [
        'Customer', 'Email', 'Phone', 'Industry', 'Created', 'Pending', 'In progress', 'Completed', 'Cancelled',
        'Invoices', 'Invoiced (NGN)', 'Collected (NGN)', 'Outstanding (NGN)',
      ]);
      const ada = findRow(customers, (v) => v === 'Ada Obi')!;
      assert.equal(ada.getCell(2).value, 'A@test.local');
      assert.equal(ada.getCell(4).value, 'Oil gas');
      const created = ada.getCell(5);
      assert.equal(created.type, ExcelJS.ValueType.Number);
      assert.deepEqual([created.value, created.numFmt], [4, '#,##0']);
      const invoiced = ada.getCell(11);
      assert.equal(invoiced.type, ExcelJS.ValueType.Number);
      assert.deepEqual([invoiced.value, invoiced.numFmt], [2000, '"₦"#,##0.00']);
      assert.equal(ada.getCell(13).value, 2100);

      const byCustomer = wb.getWorksheet('Revenue by customer')!;
      assert.deepEqual(headerOf(byCustomer), ['Customer', 'Currency', 'Invoices', 'Invoiced', 'Collected', 'Outstanding (all open, today)', 'Outstanding (issued in range)']);
      const usd = rowsOf(byCustomer).find((r) => r.getCell(2).value === 'USD')!;
      assert.equal(usd.getCell(4).numFmt, '"$"#,##0.00');
      const ngn = rowsOf(byCustomer).find((r) => r.getCell(2).value === 'NGN')!;
      assert.equal(ngn.getCell(4).numFmt, '"₦"#,##0.00');

      const period = wb.getWorksheet('Shipments by period')!;
      const first = period.getRow(7);
      assert.equal(first.getCell(1).value, '2026-10-01');
      assert.ok(first.getCell(2).value instanceof Date);
      assert.equal((first.getCell(2).value as Date).toISOString(), '2026-10-01T00:00:00.000Z');
      assert.equal(first.getCell(2).numFmt, 'yyyy-mm-dd');
      assert.equal(rowsOf(period).length, 31, 'one row per day, empty days included');
    });

    test('the file holds the same figures as the screen endpoints', async () => {
      const { wb } = await loadXlsx(OCT);
      const api = await fetch(`${app.url}/api/admin/reports/revenue/series?${OCT}`, { headers: { Authorization: `Bearer ${finance}` } });
      const totals = ((await api.json()) as any).data.totals;
      for (const currency of Object.keys(totals)) {
        const sheet = wb.getWorksheet('Revenue by period')!;
        let invoiced = 0;
        let collected = 0;
        for (const r of rowsOf(sheet)) if (r.getCell(4).value === currency) { invoiced += Number(r.getCell(5).value); collected += Number(r.getCell(7).value); }
        assert.equal(Math.round(invoiced * 100), Math.round(Number(totals[currency].invoiced) * 100), `${currency} invoiced`);
        assert.equal(Math.round(collected * 100), Math.round(Number(totals[currency].collected) * 100), `${currency} collected`);
      }
      const summary = wb.getWorksheet('Summary')!;
      const created = rowsOf(summary).find((r) => r.getCell(2).value === 'Created')!;
      const api2 = await fetch(`${app.url}/api/admin/reports/summary?${OCT}`, { headers: { Authorization: `Bearer ${finance}` } });
      assert.equal(created.getCell(3).value, ((await api2.json()) as any).data.shipments.created);
    });

    test('formula injection: a customer named like a formula is text, never a formula', async () => {
      const { wb, body } = await loadXlsx(OCT);
      const row = findRow(wb.getWorksheet('Customers')!, (v) => typeof v === 'string' && v.includes('HYPERLINK'))!;
      const cell = row.getCell(1);
      assert.equal(cell.type, ExcelJS.ValueType.String);
      assert.equal(cell.value, `'${FORMULA_NAME} Evil`);
      for (const ws of wb.worksheets) {
        ws.eachRow((r) => r.eachCell((c) => assert.notEqual(c.type, ExcelJS.ValueType.Formula, `${ws.name} ${c.address}`)));
      }
      // And in the raw file: no <f> element on any sheet, and the text sits in the shared strings.
      const zip = await JSZip.loadAsync(body);
      const sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
      assert.ok(sheets.length >= 6);
      for (const name of sheets) assert.doesNotMatch(await zip.file(name)!.async('string'), /<f[\s>]/, name);
      assert.ok((await zip.file('xl/sharedStrings.xml')!.async('string')).includes('HYPERLINK'));
    });

    test('the formula-like customer in the FILTER block is text too', async () => {
      const { wb } = await loadXlsx(`${OCT}&customerId=${evilId}`);
      const ws = wb.getWorksheet('Customers')!;
      assert.ok(String(ws.getRow(3).getCell(1).value).includes(`Customer: ${FORMULA_NAME} Evil`));
      assert.equal(ws.getRow(3).getCell(1).type, ExcelJS.ValueType.String);
      assert.equal(rowsOf(ws).length, 1);
    });

    test('filters narrow the file: customer, currency, section subset', async () => {
      const { wb } = await loadXlsx(`${OCT}&customerId=${ids.B}&currency=NGN&sections=customers,revenue`);
      assert.deepEqual(wb.worksheets.map((w) => w.name), ['Revenue by period', 'Revenue by customer', 'Customers']);
      assert.deepEqual(rowsOf(wb.getWorksheet('Customers')!).map((r) => r.getCell(1).value), ['Bayo Ade']);
      for (const r of rowsOf(wb.getWorksheet('Revenue by customer')!)) assert.equal(r.getCell(2).value, 'NGN');
      assert.ok(String(wb.getWorksheet('Customers')!.getRow(3).getCell(1).value).includes('Customer: Bayo Ade'));
    });

    test('permissions: support_staff gets customers and shipments only, no money', async () => {
      const { wb } = await loadXlsx(OCT, support);
      assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Shipments by period', 'Shipments by customer', 'Customers']);
      assert.deepEqual(headerOf(wb.getWorksheet('Customers')!), ['Customer', 'Email', 'Phone', 'Industry', 'Created', 'Pending', 'In progress', 'Completed', 'Cancelled']);
      for (const r of rowsOf(wb.getWorksheet('Summary')!)) assert.doesNotMatch(String(r.getCell(1).value), /^Revenue/);
      const everything = JSON.stringify(wb.worksheets.map((w) => { const v: unknown[] = []; w.eachRow((r) => v.push(r.values)); return v; }));
      assert.doesNotMatch(everything, /Invoiced|Collected|Outstanding/);
    });
  });

  describe('DOCX', () => {
    test('opens, has the header block, tables with repeating header rows, landscape for wide tables, page numbers', async () => {
      const { res, body } = await exportBuf(`format=docx&${OCT}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), DOCX_MIME);
      assert.match(res.headers.get('content-disposition')!, /filename="vhi-report-\d{4}-\d{2}-\d{2}\.docx"/);
      assert.equal(Number(res.headers.get('content-length')), body.length);
      const zip = await JSZip.loadAsync(body);
      const xml = await zip.file('word/document.xml')!.async('string');
      const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      for (const expected of ['Reports', 'VHI', 'Date range: 1 Oct 2026 to 31 Oct 2026 (Africa/Lagos)', 'Customer: All', 'Generated:', '(Finance officer)',
        'Shipments by customer', 'Ada Obi', '₦2,000.00', '$350.50', 'Ọláwálé', 'Çelik-Muñoz', FORMULA_NAME.replace(/&/g, '&amp;')]) {
        assert.ok(text.includes(expected.replace(/"/g, '&quot;')) || text.includes(expected), `missing: ${expected}`);
      }
      assert.ok((xml.match(/<w:tblHeader/g) ?? []).length >= 6, 'every table repeats its header row');
      assert.match(xml, /w:orient="landscape"/);
      const footers = await Promise.all(Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/.test(n)).map((n) => zip.file(n)!.async('string')));
      assert.ok(footers.length >= 1 && footers.every((f) => f.includes('PAGE') && f.includes('NUMPAGES')), 'page X of Y');
    });

    test('support_staff: no money in the document', async () => {
      const { body } = await exportBuf(`format=docx&${OCT}`, support);
      const xml = await (await JSZip.loadAsync(body)).file('word/document.xml')!.async('string');
      assert.doesNotMatch(xml, /Invoiced|Collected|Outstanding|₦/);
    });
  });

  describe('PDF', () => {
    const context = async (overrides: Partial<BuildContext> = {}): Promise<BuildContext> => {
      const parsed = parseFilters({ range: 'custom', from: '2026-10-01', to: '2026-10-31' }, { timezone: 'Africa/Lagos' });
      assert.ok(parsed.ok);
      return { filters: parsed.filters, sections: ['summary', 'shipments', 'revenue', 'customers'], format: 'pdf', caps: { revenue: true, contacts: true }, company: 'VHI', generatedBy: 'Test Admin (Finance officer)', ...overrides };
    };

    test('the endpoint returns a PDF with a content length, name and type', async () => {
      const { res, body } = await exportBuf(`format=pdf&${OCT}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/pdf');
      assert.match(res.headers.get('content-disposition')!, /filename="vhi-report-\d{4}-\d{2}-\d{2}\.pdf"/);
      assert.equal(Number(res.headers.get('content-length')), body.length);
      assert.equal(body.subarray(0, 5).toString(), '%PDF-');
      assert.ok(body.length > 20_000, 'embedded fonts make it sizeable');
      assert.match(body.subarray(-16).toString(), /%%EOF/);
    });

    test('text: header block, tables, ₦, accents and Yoruba letters render (no .notdef glyph); page X of Y', async () => {
      const doc = await buildReport(await context());
      const pdf = await renderPdf(doc, { compress: false });
      const lines = pdfLines(pdf);
      const text = lines.join('\n');
      for (const expected of ['Reports', 'VHI', 'Date range: 1 Oct 2026 to 31 Oct 2026 (Africa/Lagos)', 'Customer: All', 'Generated:', '(Finance officer)',
        'Summary', 'Shipments by customer', 'Revenue by customer', 'Ada Obi', '₦2,000.00', '$350.50', 'Çelik-Muñoz', 'Ọláw', FORMULA_NAME]) {
        assert.ok(text.includes(expected), `missing: ${expected}`);
      }
      assert.ok(!text.includes('�'), 'a glyph is missing from the font');
      const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
      assert.ok(pages >= 3, `pages: ${pages}`);
      assert.ok(lines.some((l) => l.endsWith(`Page 1 of ${pages}`)), 'footer says Page 1 of N');
      assert.ok(lines.some((l) => l.endsWith(`Page ${pages} of ${pages}`)));
      // portrait for the summary, landscape for the wide customers table
      assert.ok(pdf.toString('latin1').includes('/MediaBox [0 0 595.28 841.89]'));
      assert.ok(pdf.toString('latin1').includes('/MediaBox [0 0 841.89 595.28]'));
    });

    test('support_staff context: no money anywhere', async () => {
      const doc = await buildReport(await context({ caps: { revenue: false, contacts: true }, sections: ['summary', 'shipments', 'customers'] }));
      const text = pdfText(await renderPdf(doc, { compress: false }));
      assert.doesNotMatch(text, /Invoiced|Collected|Outstanding|₦/);
    });
  });

  describe('truncation', () => {
    before(async () => {
      await pool.query(
        `INSERT INTO customers (user_id, firstname, lastname, email, password_hash, is_active)
         SELECT 'VHI-BULK' || g, 'Bulk', lpad(g::text, 5, '0'), 'bulk' || g || '@test.local', 'x', true FROM generate_series(1, 1100) g`);
    });
    const ctx = async (format: 'pdf' | 'docx' | 'xlsx', extra: Partial<BuildContext> = {}): Promise<BuildContext> => {
      const parsed = parseFilters({ range: 'custom', from: '2026-10-01', to: '2026-10-31' }, { timezone: 'Africa/Lagos' });
      assert.ok(parsed.ok);
      return { filters: parsed.filters, sections: ['customers'], format, caps: { revenue: true, contacts: true }, company: 'VHI', generatedBy: 'x', ...extra };
    };

    test('PDF and DOCX stop at 1,000 rows per table, say so, and keep repeating the header row on every page', async () => {
      const doc = await buildReport(await ctx('pdf'));
      const table = doc.sections[0].tables[0];
      assert.equal(table.rows.length, 1000);
      assert.ok(table.total >= 1100);
      assert.match(doc.notices[0], /^Customers: showing the first 1,000 of 1,1\d\d rows \(the PDF limit\)\. Use the Excel export or narrower filters/);
      const lines = pdfLines(await renderPdf(doc, { compress: false }));
      assert.ok(lines.some((l) => /^Showing the first 1,000 of 1,1\d\d rows\. Use the Excel export or narrower filters/.test(l)));
      const headers = lines.filter((l) => l === 'Industry').length;
      assert.ok(headers >= 10, `header row repeated on each page (${headers})`);

      const { res, body } = await exportBuf(`format=docx&${OCT}&sections=customers`);
      assert.equal(res.status, 200);
      const xml = await (await JSZip.loadAsync(body)).file('word/document.xml')!.async('string');
      assert.match(xml.replace(/<[^>]+>/g, ''), /Showing the first 1,000 of 1,1\d\d rows\. Use the Excel export/);
    });

    test('XLSX keeps all rows up to 50,000; a lower cap truncates with a notice on the sheet', async () => {
      const full = await loadXlsx(`${OCT}&sections=customers`);
      assert.ok(rowsOf(full.wb.getWorksheet('Customers')!).length >= 1100);

      const doc = await buildReport(await ctx('xlsx', { rowCap: 25 }));
      const sink = new PassThrough();
      const chunks: Buffer[] = [];
      sink.on('data', (c) => chunks.push(c));
      await writeXlsx(doc, sink);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.concat(chunks) as any);
      const ws = wb.getWorksheet('Customers')!;
      assert.match(String(ws.getRow(5).getCell(1).value), /^Customers: showing the first 25 of 1,1\d\d rows \(the XLSX limit\)\. Use the Excel export or narrower filters/);
      assert.equal(rowsOf(ws).length, 25);
    });

    test('the audit row records what was truncated', async () => {
      await exportBuf(`format=pdf&${OCT}&sections=customers`);
      const row = (await pool.query(`SELECT metadata FROM audit_logs WHERE action = 'EXPORT_REPORT' ORDER BY created_at DESC LIMIT 1`)).rows[0];
      assert.deepEqual(row.metadata.truncated, ['customers']);
      assert.equal(row.metadata.rowCounts.customers.shown, 1000);
      assert.ok(row.metadata.rowCounts.customers.total >= 1100);
    });
  });

  describe('audit, limits and validation', () => {
    test('every export writes an audit row: who, format, sections, filters, row counts', async () => {
      await pool.query(`DELETE FROM audit_logs WHERE action = 'EXPORT_REPORT'`);
      const { res } = await exportBuf(`format=xlsx&${OCT}&customerId=${ids.B}&sections=summary,customers`);
      assert.equal(res.status, 200);
      const rows = (await pool.query(`SELECT admin_id, active_role, actor_type, resource_type, metadata FROM audit_logs WHERE action = 'EXPORT_REPORT'`)).rows;
      assert.equal(rows.length, 1);
      const [row] = rows;
      assert.deepEqual([row.admin_id, row.active_role, row.actor_type, row.resource_type], [financeId, 'finance_officer', 'admin', 'report']);
      assert.equal(row.metadata.format, 'xlsx');
      assert.deepEqual(row.metadata.sections, ['summary', 'customers']);
      assert.equal(row.metadata.filters.customerId, ids.B);
      assert.deepEqual([row.metadata.filters.from, row.metadata.filters.to, row.metadata.filters.timezone], ['2026-10-01', '2026-10-31', 'Africa/Lagos']);
      assert.deepEqual(row.metadata.rowCounts.customers, { shown: 1, total: 1 });
      assert.deepEqual(row.metadata.truncated, []);
    });

    test('rejected requests write no audit row', async () => {
      await pool.query(`DELETE FROM audit_logs WHERE action = 'EXPORT_REPORT'`);
      await exportBuf(`format=xlsx&${OCT}&sections=revenue`, support);
      await exportBuf('format=csv');
      assert.equal((await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'EXPORT_REPORT'`)).rowCount, 0);
    });

    test('rate limit: 5 exports a minute per admin, then 429 with Retry-After; other admins are unaffected', async () => {
      const burst = await insertAdmin({ assignedRoles: ['manager'] });
      const token = adminToken({ id: burst.id, email: burst.email, activeRole: 'manager' });
      for (let i = 0; i < 5; i++) assert.equal((await exportBuf(`format=xlsx&${OCT}&sections=summary`, token)).res.status, 200, `export ${i + 1}`);
      const limited = await exportBuf(`format=xlsx&${OCT}&sections=summary`, token);
      assert.equal(limited.res.status, 429);
      assert.ok(Number(limited.res.headers.get('retry-after')) >= 1);
      assert.equal(JSON.parse(limited.body.toString()).success, false);
      assert.equal((await exportBuf(`format=xlsx&${OCT}&sections=summary`, finance)).res.status, 200);
    });

    test('validation: format, sections and filters return 400; the old CSV call is gone', async () => {
      for (const qs of [
        OCT, 'format=csv', 'format=', 'format=xlsx&format=pdf', `format=xlsx&sections=bogus`, 'format=xlsx&sections=', 'format=xlsx&sections=summary,,x',
        'format=xlsx&range=custom&from=2026-10-31&to=2026-10-01', 'format=xlsx&industry=bakery', 'format=xlsx&bogus=1', 'format=xlsx&page=2', 'period=daily',
      ]) {
        exportLimiter.reset(); // invalid requests count against the limit too
        const { res, body } = await exportBuf(qs);
        assert.equal(res.status, 400, qs);
        assert.equal(JSON.parse(body.toString()).success, false, qs);
      }
    });

    test('permissions: revenue in the request is 403 for support_staff in every format; no token is 401; no reports module is 403', async () => {
      for (const format of ['pdf', 'docx', 'xlsx']) {
        exportLimiter.reset();
        assert.equal((await exportBuf(`format=${format}&${OCT}&sections=revenue`, support)).res.status, 403, format);
        assert.equal((await exportBuf(`format=${format}&${OCT}&sections=summary,revenue`, support)).res.status, 403, format);
        assert.equal((await exportBuf(`format=${format}&${OCT}&sections=customers`, support)).res.status, 200, format);
      }
      assert.equal((await fetch(`${app.url}/api/admin/reports/export?format=xlsx`)).status, 401);
      const logistics = await insertAdmin({ assignedRoles: ['logistics_officer'] });
      const lt = adminToken({ id: logistics.id, email: logistics.email, activeRole: 'logistics_officer' });
      assert.equal((await exportBuf(`format=xlsx&${OCT}`, lt)).res.status, 403);
    });

    test('COMPANY_NAME appears in the header block', async () => {
      process.env.COMPANY_NAME = 'Acme\n Freight Ltd';
      try {
        const { wb } = await loadXlsx(`${OCT}&sections=summary`);
        assert.equal(wb.getWorksheet('Summary')!.getRow(1).getCell(1).value, 'Reports - Acme Freight Ltd: Summary');
      } finally {
        delete process.env.COMPANY_NAME;
      }
    });
  });
});
