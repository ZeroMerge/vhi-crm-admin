import path from 'path';
import PDFDocument from 'pdfkit';
import { Cell, Column, ReportDoc, TableData, cellText } from './model';

// PDF layout on pdfkit with embedded Noto Sans (₦, accents and Yoruba letters render). Wide tables get a landscape page; every
// table repeats its header row on each page; each page's footer says "Page X of Y". The document is built in memory (the row cap is
// small) so a failure never leaves a half-sent file.

// assets/ sits at the backend root, the same distance from src/ and from dist/ (assets are not copied by tsc).
const FONT_DIR = path.resolve(__dirname, '../../../../assets/fonts');
const REGULAR = path.join(FONT_DIR, 'NotoSans-Regular.ttf');
const BOLD = path.join(FONT_DIR, 'NotoSans-Bold.ttf');

const MARGIN = 36;
const PAD = 3;
const WIDE_COLUMNS = 7;
const INK = '#1F1A21';
const MUTED = '#5F5864';
const RULE = '#BFB8C4';
const HEADER_FILL = '#EDE7F0';

type Pdf = InstanceType<typeof PDFDocument>;

const contentWidth = (doc: Pdf) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottomLimit = (doc: Pdf) => doc.page.height - doc.page.margins.bottom;

function columnWidths(doc: Pdf, columns: Column[]): number[] {
  const total = columns.reduce((t, c) => t + c.weight, 0);
  return columns.map((c) => (c.weight / total) * contentWidth(doc));
}

function fontSizeFor(columns: Column[]): number {
  return columns.length >= 12 ? 6.5 : columns.length >= WIDE_COLUMNS ? 7.5 : 8.5;
}

function measureRow(doc: Pdf, widths: number[], cells: Cell[], size: number, header: boolean): number {
  doc.font(header ? 'Sans-Bold' : 'Sans').fontSize(size);
  const texts = cells.map((c) => (header ? String(c) : cellText(c)));
  const height = Math.max(...texts.map((t, i) => doc.heightOfString(t, { width: widths[i] - PAD * 2 }))) + PAD * 2;
  return height;
}

function paintRow(doc: Pdf, y: number, widths: number[], cells: Cell[], columns: Column[], size: number, header: boolean, height: number) {
  let x = doc.page.margins.left;
  doc.font(header ? 'Sans-Bold' : 'Sans').fontSize(size);
  cells.forEach((cell, i) => {
    if (header) doc.rect(x, y, widths[i], height).fillAndStroke(HEADER_FILL, RULE);
    else doc.rect(x, y, widths[i], height).lineWidth(0.5).stroke(RULE);
    doc.fillColor(INK).text(header ? String(cell) : cellText(cell), x + PAD, y + PAD, {
      width: widths[i] - PAD * 2,
      align: columns[i].align === 'right' ? 'right' : 'left',
    });
    x += widths[i];
  });
}

function drawTable(doc: Pdf, table: TableData, layout: 'portrait' | 'landscape') {
  const size = fontSizeFor(table.columns);
  const heads = table.columns.map((c) => c.header);
  let widths = columnWidths(doc, table.columns);

  const title = (suffix = '') => {
    doc.font('Sans-Bold').fontSize(11).fillColor(INK).text(`${table.title}${suffix}`, doc.page.margins.left, doc.y, { width: contentWidth(doc) });
    doc.moveDown(0.2);
  };
  const newPage = () => {
    doc.addPage({ size: 'A4', layout, margin: MARGIN });
    widths = columnWidths(doc, table.columns);
  };

  if (doc.y > bottomLimit(doc) - 90) newPage();
  title();
  if (table.note) {
    doc.font('Sans').fontSize(7.5).fillColor(MUTED).text(table.note, doc.page.margins.left, doc.y, { width: contentWidth(doc) });
    doc.moveDown(0.3);
  }
  if (table.rows.length === 0) {
    doc.font('Sans').fontSize(9).fillColor(MUTED).text('No rows for the selected filters.', doc.page.margins.left, doc.y);
    doc.moveDown();
    return;
  }

  let y = doc.y;
  const header = () => {
    const h = measureRow(doc, widths, heads, size, true);
    paintRow(doc, y, widths, heads, table.columns, size, true, h);
    y += h;
  };
  header();
  for (const row of table.rows) {
    const h = measureRow(doc, widths, row, size, false);
    if (y + h > bottomLimit(doc)) {
      newPage();
      title(' (continued)');
      y = doc.y;
      header(); // repeated header row on every page
    }
    paintRow(doc, y, widths, row, table.columns, size, false, h);
    y += h;
  }
  doc.y = y + 4;
  if (table.rows.length < table.total) {
    doc.font('Sans-Bold').fontSize(8.5).fillColor(INK).text(
      `Showing the first ${table.rows.length.toLocaleString('en-US')} of ${table.total.toLocaleString('en-US')} rows. Use the Excel export or narrower filters for the rest.`,
      doc.page.margins.left, doc.y + 2, { width: contentWidth(doc) },
    );
  }
  doc.moveDown(1.2);
}

/** `compress: false` is for tests only: it leaves the page content readable so the text can be checked. */
export function renderPdf(report: ReportDoc, options: { compress?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: MARGIN, bufferPages: true, autoFirstPage: false, compress: options.compress ?? true,
      info: { Title: report.title, Author: report.generatedBy, Creator: report.company, Producer: report.company },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      doc.registerFont('Sans', REGULAR);
      doc.registerFont('Sans-Bold', BOLD);

      const wide = (i: number) => report.sections[i]?.tables.some((t) => t.columns.length >= WIDE_COLUMNS) ?? false;
      doc.addPage({ size: 'A4', layout: wide(0) ? 'landscape' : 'portrait', margin: MARGIN });

      // Header block
      const left = doc.page.margins.left;
      const w = contentWidth(doc);
      doc.font('Sans-Bold').fontSize(20).fillColor(INK).text(report.title, left, doc.y, { width: w });
      doc.font('Sans-Bold').fontSize(13).fillColor('#7B2D8B').text(report.company, left, doc.y, { width: w });
      doc.moveDown(0.5);
      doc.font('Sans').fontSize(9).fillColor(INK);
      doc.text(`Date range: ${report.rangeText}`, left, doc.y, { width: w });
      for (const line of report.filterLines) doc.fillColor(MUTED).fontSize(8.5).text(line, left, doc.y, { width: w });
      doc.fillColor(INK).fontSize(9).text(`Generated: ${report.generatedAt} by ${report.generatedBy}`, left, doc.y + 2, { width: w });
      for (const n of report.notices) doc.font('Sans-Bold').fontSize(8.5).fillColor(INK).text(`Note: ${n}`, left, doc.y + 3, { width: w });
      doc.moveDown(1);

      report.sections.forEach((section, i) => {
        const layout = wide(i) ? 'landscape' : 'portrait';
        if (i > 0) doc.addPage({ size: 'A4', layout, margin: MARGIN });
        else if (layout !== (doc.page.width > doc.page.height ? 'landscape' : 'portrait')) doc.addPage({ size: 'A4', layout, margin: MARGIN });
        doc.font('Sans-Bold').fontSize(15).fillColor(INK).text(section.title, doc.page.margins.left, doc.y, { width: contentWidth(doc) });
        doc.moveDown(0.4);
        for (const table of section.tables) drawTable(doc, table, layout);
      });

      // Footer on every page. The bottom margin is lifted while writing into it, or pdfkit would add a page.
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const bottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font('Sans').fontSize(7.5).fillColor(MUTED).text(
          `${report.company} - ${report.title} - Page ${i - range.start + 1} of ${range.count}`,
          doc.page.margins.left, doc.page.height - 26, { width: contentWidth(doc), align: 'center' },
        );
        doc.page.margins.bottom = bottom;
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
