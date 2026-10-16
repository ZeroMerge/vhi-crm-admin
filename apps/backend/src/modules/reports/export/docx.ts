import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, PageOrientation, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { Cell, Column, ReportDoc, TableData, cellText } from './model';

// Word layout: header block, then one Word section per report section. A section whose tables are wide is landscape; every table's
// header row repeats on each page (tableHeader), rows never split across pages, and the footer carries "Page X of Y".

const FONT = 'Arial';
const WIDE_COLUMNS = 7;
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const run = (text: string, options: { bold?: boolean; size?: number; italics?: boolean; color?: string } = {}) =>
  new TextRun({ text, font: FONT, size: options.size ?? 20, bold: options.bold, italics: options.italics, color: options.color });

const para = (text: string, options: { bold?: boolean; size?: number; italics?: boolean; after?: number } = {}) =>
  new Paragraph({ spacing: { after: options.after ?? 60 }, children: [run(text, options)] });

function cellParagraph(cell: Cell, column: Column, header = false) {
  return new Paragraph({
    alignment: column.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
    children: [run(header ? String(cell) : cellText(cell), { bold: header, size: 17 })],
  });
}

function tableFor(table: TableData): Table {
  const total = table.columns.reduce((t, c) => t + c.weight, 0);
  const pct = (c: Column) => ({ size: Math.round((c.weight / total) * 100 * 50), type: WidthType.PERCENTAGE });
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: table.columns.map((c) => new TableCell({
      width: pct(c), borders: BORDERS,
      shading: { type: ShadingType.CLEAR, fill: 'EDE7F0', color: 'auto' },
      children: [cellParagraph(c.header, c, true)],
    })),
  });
  const rows = table.rows.map((values) => new TableRow({
    cantSplit: true,
    children: table.columns.map((c, i) => new TableCell({ width: pct(c), borders: BORDERS, children: [cellParagraph(values[i] ?? null, c)] })),
  }));
  return new Table({ width: { size: 100 * 50, type: WidthType.PERCENTAGE }, rows: [header, ...rows] });
}

const footer = (doc: ReportDoc) => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      run(`${doc.company} - ${doc.title} - `, { size: 16, color: '666666' }),
      new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: '666666' }),
    ],
  })],
});

export async function renderDocx(doc: ReportDoc): Promise<Buffer> {
  const intro: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 60 }, children: [run(doc.title, { bold: true, size: 40 })] }),
    para(doc.company, { bold: true, size: 26, after: 120 }),
    para(`Date range: ${doc.rangeText}`),
    ...doc.filterLines.map((l) => para(l, { size: 18 })),
    para(`Generated: ${doc.generatedAt} by ${doc.generatedBy}`, { after: 120 }),
    ...doc.notices.map((n) => para(`Note: ${n}`, { italics: true, size: 18 })),
  ];

  const sections = doc.sections.map((section, index) => {
    const wide = section.tables.some((t) => t.columns.length >= WIDE_COLUMNS);
    const children: Array<Paragraph | Table> = index === 0 ? [...intro] : [];
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 80 }, children: [run(section.title, { bold: true, size: 30 })] }));
    for (const table of section.tables) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 60 }, children: [run(table.title, { bold: true, size: 24 })] }));
      if (table.note) children.push(para(table.note, { italics: true, size: 17 }));
      if (table.rows.length === 0) children.push(para('No rows for the selected filters.', { italics: true }));
      else children.push(tableFor(table));
      if (table.rows.length < table.total) {
        children.push(para(`Showing the first ${table.rows.length.toLocaleString('en-US')} of ${table.total.toLocaleString('en-US')} rows. Use the Excel export or narrower filters for the rest.`, { bold: true, size: 18 }));
      }
    }
    return {
      properties: { page: { size: { orientation: wide ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
      footers: { default: footer(doc) },
      children,
    };
  });

  const document = new Document({
    creator: doc.company,
    title: doc.title,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: sections.length ? sections : [{ children: intro, footers: { default: footer(doc) } }],
  });
  return Packer.toBuffer(document);
}
