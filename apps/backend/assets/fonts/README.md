# Report fonts

Noto Sans Regular and Bold (static TTF), used by the PDF export (`src/modules/reports/export/pdf.ts`) so that `₦` and accented or
Yoruba letters render. Source: npm package `@expo-google-fonts/noto-sans` 0.4.2 (Noto Project, `notofonts/latin-greek-cyrillic`).
Licence: SIL Open Font License 1.1 (`OFL.txt`). Not covered: CJK (Chinese customer names would show as empty boxes in the PDF).
Checked glyphs: U+20A6 ₦, é ñ ü Ç, Ọ ẹ ṣ ń, € £ — – …; not present: →.
