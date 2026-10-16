// Reads the text back out of a PDF made by pdfkit with `compress: false` (see renderPdf's test option), without a PDF library:
// pdfkit writes Type0/Identity-H fonts, so each shown string is a run of 2-byte glyph ids; the font's ToUnicode CMap maps them back.

function hexToUnicode(hex: string): string {
  let out = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
}

function parseCmap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hexToUnicode(m[2]));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const from = parseInt(m[1], 16);
      const to = parseInt(m[2], 16);
      const dest = m[3];
      if (dest.startsWith('[')) {
        // pdfkit 0.15 writes an EMPTY entry (<>) for some composed glyphs such as ẹ; it must still take its slot in the array.
        // A ligature is written as ONE slot with spaces inside, e.g. <0066 0066 0069> for ffi.
        [...dest.matchAll(/<([0-9a-fA-F\s]*)>/g)].forEach((d, i) => map.set(from + i, hexToUnicode(d[1].replace(/\s+/g, ''))));
      } else {
        const base = parseInt(dest.slice(1, -1), 16);
        for (let c = from; c <= to; c++) map.set(c, String.fromCharCode(base + (c - from)));
      }
    }
  }
  return map;
}

/** One string per text-showing operation, in drawing order. */
export function pdfLines(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const objects = new Map<number, string>();
  for (const m of text.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) objects.set(Number(m[1]), m[2]);

  // font resource name (F1, F2...) -> glyph map
  const fontMaps = new Map<string, Map<number, string>>();
  for (const m of text.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const font = objects.get(Number(m[2]));
    const toUnicode = font?.match(/\/ToUnicode (\d+) 0 R/);
    const cmapObject = toUnicode ? objects.get(Number(toUnicode[1])) : undefined;
    if (cmapObject) fontMaps.set(m[1], parseCmap(cmapObject));
  }

  const lines: string[] = [];
  for (const obj of objects.values()) {
    if (!/\sTf\b/.test(obj) || !/\b(TJ|Tj)\b/.test(obj)) continue; // page content streams only
    let current: Map<number, string> | undefined;
    for (const op of obj.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf|\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
      if (op[1]) {
        current = fontMaps.get(op[1]);
        continue;
      }
      const hexes = op[2] !== undefined ? [...op[2].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1]) : [op[3]];
      let line = '';
      for (const hex of hexes) {
        for (let i = 0; i + 4 <= hex.length; i += 4) {
          const gid = parseInt(hex.slice(i, i + 4), 16);
          line += gid === 0 ? '�' : current?.get(gid) ?? '�'; // glyph 0 is .notdef: the font had no glyph for the character
        }
      }
      lines.push(line);
    }
  }
  return lines;
}

export const pdfText = (pdf: Buffer) => pdfLines(pdf).join('\n');
