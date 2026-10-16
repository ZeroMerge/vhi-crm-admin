import type { Writable } from 'stream';
import ExcelJS from 'exceljs';
import type { Cell, Column, ReportDoc, TableData } from './model';

// One sheet per table, written with exceljs' streaming writer straight to the response. Each sheet starts with a header block
// (title, company, range, filters, generated at/by, notices), then the table: frozen header row, autofilter, real number and date cells.

const HEADER_ROWS = 6; // rows above the table header on every sheet (row 6 is the table header)

/*
 * Formula-injection guard. Text such as =HYPERLINK(...), +2348012345678, -x, @x, a tab or a CR is written exactly as stored, as a
 * TYPED STRING cell (a shared string, never a formula object), so Excel, LibreOffice and Sheets show it as text and never evaluate
 * it; a customer phone number like +2348012345678 displays exactly as stored. No apostrophe is added. exceljs has no `quotePrefix`
 * cell style (checked in its source and typings), so the string type is the whole guard. Residual case, accepted (RISKS R-76): a
 * user who edits such a cell in Excel (F2, Enter) makes Excel re-parse it. There is no CSV export, where this would matter more.
 * The tests re-read the file and check the raw sheet XML for <f> elements.
 */

const MONEY_FORMATS: Record<string, string> = {
  NGN: '"₦"#,##0.00', USD: '"$"#,##0.00', GBP: '"£"#,##0.00', EUR: '"€"#,##0.00',
};
// Codes are validated upstream as letters only, so quoting them into a number format is safe.
export const moneyFormat = (currency: string) => MONEY_FORMATS[currency] ?? `#,##0.00" ${currency.replace(/[^A-Za-z]/g, '')}"`;
const INT_FORMAT = '#,##0';
const DATE_FORMAT = 'yyyy-mm-dd';

function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

function widths(columns: Column[], rows: Cell[][]): number[] {
  return columns.map((c, i) => {
    let longest = c.header.length;
    for (const row of rows.slice(0, 200)) {
      const cell = row[i];
      const len = cell === null || cell === undefined ? 0 : typeof cell === 'string' ? cell.length : typeof cell === 'number' ? 9 : 'money' in cell ? 16 : 11;
      if (len > longest) longest = len;
    }
    return Math.min(Math.max(longest + 2, 10), 48);
  });
}

function writeTable(wb: ExcelJS.stream.xlsx.WorkbookWriter, doc: ReportDoc, table: TableData, used: Set<string>) {
  const ws = wb.addWorksheet(sheetName(table.title, used), {
    views: [{ state: 'frozen', xSplit: 0, ySplit: HEADER_ROWS, activeCell: `A${HEADER_ROWS + 1}` }],
  });
  const w = widths(table.columns, table.rows);
  ws.columns = table.columns.map((_, i) => ({ width: w[i] }));

  const line = (text: string, bold = false, size = 11) => {
    const row = ws.addRow([text]);
    row.getCell(1).font = { bold, size };
    row.commit();
  };
  line(`${doc.title} - ${doc.company}: ${table.title}`, true, 14);
  line(`Date range: ${doc.rangeText}`);
  line(`Filters: ${doc.filterLines.join(' | ')}`);
  line(`Generated: ${doc.generatedAt} by ${doc.generatedBy}`);
  const notices = [...doc.notices.filter((n) => n.startsWith(`${table.title}:`)), ...(table.note ? [table.note] : [])];
  line(notices.join(' ') || ' ');

  const header = ws.addRow(table.columns.map((c) => c.header));
  header.eachCell((cell, n) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE7F0' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF7B2D8B' } } };
    cell.alignment = { horizontal: table.columns[n - 1].align === 'right' ? 'right' : 'left', vertical: 'middle', wrapText: true };
  });
  header.commit();

  for (const values of table.rows) {
    const row = ws.addRow(values.map((v) => (v === null || v === undefined ? null : typeof v === 'string' ? v : typeof v === 'number' ? v : 'money' in v ? Number(v.money) : new Date(`${v.date}T00:00:00Z`))));
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      if (typeof v === 'number') cell.numFmt = INT_FORMAT;
      else if (v && typeof v === 'object' && 'money' in v) cell.numFmt = moneyFormat(v.currency);
      else if (v && typeof v === 'object' && 'date' in v) cell.numFmt = DATE_FORMAT;
    });
    row.commit();
  }

  // File-level notices (currency choice, data quality) go below the table, outside the autofilter range.
  const general = doc.notices.filter((n) => !doc.sections.some((sec) => sec.tables.some((t) => n.startsWith(`${t.title}:`))));
  if (general.length) {
    ws.addRow([]).commit();
    for (const n of general) ws.addRow([n]).commit();
  }

  ws.autoFilter = { from: { row: HEADER_ROWS, column: 1 }, to: { row: HEADER_ROWS + Math.max(table.rows.length, 1), column: table.columns.length } };
  ws.commit();
}

export async function writeXlsx(doc: ReportDoc, out: Writable): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: true });
  wb.creator = doc.company;
  wb.title = doc.title;
  wb.created = new Date();
  const used = new Set<string>();
  for (const section of doc.sections) for (const table of section.tables) writeTable(wb, doc, table, used);
  await wb.commit();
}
