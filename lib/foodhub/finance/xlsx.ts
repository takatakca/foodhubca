// Multi-sheet .xlsx writer for the finance workbook: styles, live formulas (with the value Food Hub computed as the
// cached result, so previews show numbers and Excel recalculates on open), frozen panes, filters, drop-down lists.
// Same approach as reports.ts toXlsx (hand-written OOXML + fflate zip), extended to several styled sheets.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type CellValue = string | number | boolean | null | undefined;
export type StyleKey =
  | 'text' | 'wrap' | 'bold' | 'title' | 'subtitle' | 'header' | 'note' | 'link' | 'xref'
  | 'money' | 'moneyBold' | 'moneyTotal' | 'pct' | 'pctBold' | 'int' | 'intBold' | 'date' | 'num'
  | 'input' | 'inputMoney' | 'inputDate' | 'inputPct' | 'fill' | 'fillMoney' | 'fillDate'
  | 'good' | 'bad' | 'warn' | 'month' | 'caption';

export interface Cell { v?: CellValue; f?: string; s?: StyleKey }
export type Row = Array<Cell | CellValue>;

export interface Sheet {
  name: string;
  rows: Row[];
  widths?: number[];
  /** Rows / columns kept visible when scrolling (e.g. { row: 1, col: 0 } freezes the header row). */
  freeze?: { row: number; col: number };
  /** Header row (1-based) that gets an auto-filter over all used columns. */
  filterRow?: number;
  validations?: Array<{ range: string; list: string[] }>;
  merges?: string[];
  tabColor?: string;
}

const STYLE_ORDER: StyleKey[] = [
  'text', 'wrap', 'bold', 'title', 'subtitle', 'header', 'note', 'link', 'xref',
  'money', 'moneyBold', 'moneyTotal', 'pct', 'pctBold', 'int', 'intBold', 'date', 'num',
  'input', 'inputMoney', 'inputDate', 'inputPct', 'fill', 'fillMoney', 'fillDate',
  'good', 'bad', 'warn', 'month', 'caption',
];
// numFmt ids: 164 money · 165 percent · 166 date · 167 integer · 168 plain number · 169 month
// fonts: 0 Arial · 1 bold · 2 title · 3 header (bold white) · 4 note (grey italic) · 5 link (blue underline) · 6 input (blue) · 7 subtitle · 8 xref (green) · 9 bold red · 10 bold green
// fills: 0 none · 1 gray125 · 2 header navy · 3 yellow (to fill in) · 4 light grey (totals) · 5 light red · 6 light green · 7 light amber
const XF: Record<StyleKey, { font: number; fill: number; numFmt: number; border?: number; wrap?: boolean }> = {
  text: { font: 0, fill: 0, numFmt: 0 }, wrap: { font: 0, fill: 0, numFmt: 0, wrap: true }, bold: { font: 1, fill: 0, numFmt: 0 },
  title: { font: 2, fill: 0, numFmt: 0 }, subtitle: { font: 7, fill: 0, numFmt: 0 }, header: { font: 3, fill: 2, numFmt: 0, wrap: true, border: 1 },
  note: { font: 4, fill: 0, numFmt: 0, wrap: true }, link: { font: 5, fill: 0, numFmt: 0 }, xref: { font: 8, fill: 0, numFmt: 164 },
  money: { font: 0, fill: 0, numFmt: 164 }, moneyBold: { font: 1, fill: 0, numFmt: 164 }, moneyTotal: { font: 1, fill: 4, numFmt: 164, border: 2 },
  pct: { font: 0, fill: 0, numFmt: 165 }, pctBold: { font: 1, fill: 0, numFmt: 165 }, int: { font: 0, fill: 0, numFmt: 167 }, intBold: { font: 1, fill: 0, numFmt: 167 },
  date: { font: 0, fill: 0, numFmt: 166 }, num: { font: 0, fill: 0, numFmt: 168 },
  input: { font: 6, fill: 0, numFmt: 0 }, inputMoney: { font: 6, fill: 0, numFmt: 164 }, inputDate: { font: 6, fill: 0, numFmt: 166 }, inputPct: { font: 6, fill: 0, numFmt: 165 },
  fill: { font: 6, fill: 3, numFmt: 0, wrap: true }, fillMoney: { font: 6, fill: 3, numFmt: 164 }, fillDate: { font: 6, fill: 3, numFmt: 166 },
  good: { font: 10, fill: 6, numFmt: 0 }, bad: { font: 9, fill: 5, numFmt: 0 }, warn: { font: 1, fill: 7, numFmt: 0, wrap: true }, month: { font: 0, fill: 0, numFmt: 169 }, caption: { font: 4, fill: 0, numFmt: 0 },
};

const STYLES_XML = (() => {
  const fonts = [
    '<font><sz val="10"/><name val="Arial"/></font>',
    '<font><b/><sz val="10"/><name val="Arial"/></font>',
    '<font><b/><sz val="14"/><color rgb="FF1F3864"/><name val="Arial"/></font>',
    '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>',
    '<font><i/><sz val="9"/><color rgb="FF595959"/><name val="Arial"/></font>',
    '<font><u/><sz val="10"/><color rgb="FF0563C1"/><name val="Arial"/></font>',
    '<font><sz val="10"/><color rgb="FF0000FF"/><name val="Arial"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF1F3864"/><name val="Arial"/></font>',
    '<font><sz val="10"/><color rgb="FF008000"/><name val="Arial"/></font>',
    '<font><b/><sz val="10"/><color rgb="FFC00000"/><name val="Arial"/></font>',
    '<font><b/><sz val="10"/><color rgb="FF006100"/><name val="Arial"/></font>',
  ];
  const solid = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', solid('1F3864'), solid('FFFF00'), solid('F2F2F2'), solid('FCE4D6'), solid('E2EFDA'), solid('FFF2CC')];
  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FF8EA9DB"/></bottom><diagonal/></border>',
    '<border><left/><right/><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom><diagonal/></border>',
  ];
  const numFmts = [
    '<numFmt numFmtId="164" formatCode="#,##0.00;(#,##0.00);&quot;-&quot;"/>',
    '<numFmt numFmtId="165" formatCode="0.0%;(0.0%);&quot;-&quot;"/>',
    '<numFmt numFmtId="166" formatCode="yyyy-mm-dd"/>',
    '<numFmt numFmtId="167" formatCode="#,##0;(#,##0);&quot;-&quot;"/>',
    '<numFmt numFmtId="168" formatCode="0.#####"/>',
    '<numFmt numFmtId="169" formatCode="yyyy-mm"/>',
  ];
  const xfs = STYLE_ORDER.map((k) => {
    const x = XF[k];
    return `<xf numFmtId="${x.numFmt}" fontId="${x.font}" fillId="${x.fill}" borderId="${x.border ?? 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${x.wrap ? ' applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' : ' applyAlignment="1"><alignment vertical="top"/></xf>'}`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
})();

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export function colName(i: number): string { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

/** ISO date (YYYY-MM-DD…) → Excel serial day number. */
export function excelDate(iso: string | null | undefined): number | null {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400_000 + 25569;
}

/** A sheet name as it must appear inside a formula. */
export const ref = (sheet: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`);

function cellXml(c: Cell | CellValue, r: string): string {
  const cell: Cell = c !== null && typeof c === 'object' ? c : { v: c };
  const s = STYLE_ORDER.indexOf(cell.s ?? (typeof cell.v === 'number' ? 'num' : 'text'));
  const sAttr = s > 0 ? ` s="${s}"` : '';
  const v = cell.v;
  if (cell.f) {
    const f = `<f>${esc(cell.f.replace(/^=/, ''))}</f>`;
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${r}"${sAttr}>${f}<v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${r}"${sAttr} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
    if (typeof v === 'string') return `<c r="${r}"${sAttr} t="str">${f}<v>${esc(v)}</v></c>`;
    return `<c r="${r}"${sAttr}>${f}</c>`;
  }
  if (v === null || v === undefined || v === '') return s > 0 ? `<c r="${r}"${sAttr}/>` : '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${r}"${sAttr}><v>${v}</v></c>` : '';
  if (typeof v === 'boolean') return `<c r="${r}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
  // Text that Excel would read as a formula stays text (inline strings are never evaluated).
  return `<c r="${r}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sh: Sheet): string {
  const maxCols = Math.max(1, ...sh.rows.map((r) => r.length));
  const parts: string[] = [];
  parts.push(`<sheetPr>${sh.tabColor ? `<tabColor rgb="FF${sh.tabColor}"/>` : ''}</sheetPr>`);
  parts.push(`<dimension ref="A1:${colName(maxCols - 1)}${Math.max(1, sh.rows.length)}"/>`);
  if (sh.freeze && (sh.freeze.row || sh.freeze.col)) {
    const tl = `${colName(sh.freeze.col)}${sh.freeze.row + 1}`;
    const pane = sh.freeze.row && sh.freeze.col ? 'bottomRight' : sh.freeze.row ? 'bottomLeft' : 'topRight';
    parts.push(`<sheetViews><sheetView workbookViewId="0" zoomScale="90"><pane${sh.freeze.col ? ` xSplit="${sh.freeze.col}"` : ''}${sh.freeze.row ? ` ySplit="${sh.freeze.row}"` : ''} topLeftCell="${tl}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${tl}" sqref="${tl}"/></sheetView></sheetViews>`);
  } else parts.push('<sheetViews><sheetView workbookViewId="0" zoomScale="90"/></sheetViews>');
  parts.push('<sheetFormatPr defaultRowHeight="13.2"/>');
  if (sh.widths?.length) parts.push(`<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`);
  const rows = sh.rows.map((row, ri) => {
    const cells = row.map((c, ci) => cellXml(c, `${colName(ci)}${ri + 1}`)).join('');
    // Header rows get a fixed height (4 wrapped lines) instead of growing with the longest label.
    const isHeader = row.length > 1 && row.every((c) => c !== null && typeof c === 'object' && c.s === 'header');
    return cells ? `<row r="${ri + 1}"${isHeader ? ' ht="52" customHeight="1"' : ''}>${cells}</row>` : '';
  }).join('');
  parts.push(`<sheetData>${rows}</sheetData>`);
  if (sh.filterRow) {
    const last = Math.max(sh.filterRow + 1, sh.rows.length);
    parts.push(`<autoFilter ref="A${sh.filterRow}:${colName(maxCols - 1)}${last}"/>`);
  }
  if (sh.merges?.length) parts.push(`<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`);
  if (sh.validations?.length) {
    parts.push(`<dataValidations count="${sh.validations.length}">${sh.validations.map((v) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.range}"><formula1>"${esc(v.list.join(','))}"</formula1></dataValidation>`).join('')}</dataValidations>`);
  }
  parts.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>');
  parts.push('<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${parts.join('')}</worksheet>`;
}

export function buildXlsx(sheets: Sheet[], meta: { title?: string; author?: string } = {}): Uint8Array {
  const names = new Set<string>();
  for (const s of sheets) {
    if (s.name.length > 31 || /[\\/?*[\]:]/.test(s.name)) throw new Error(`Invalid sheet name: ${s.name}`);
    if (names.has(s.name.toLowerCase())) throw new Error(`Duplicate sheet name: ${s.name}`);
    names.add(s.name.toLowerCase());
  }
  const filterNames = sheets.map((s, i) => (s.filterRow ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(ref(s.name))}!$A$${s.filterRow}:$${colName(Math.max(1, ...s.rows.map((r) => r.length)) - 1)}$${Math.max(s.filterRow + 1, s.rows.length)}</definedName>` : '')).join('');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title ?? '')}</dc:title><dc:creator>${esc(meta.author ?? 'TAKATAK Food Hub')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${filterNames ? `<definedNames>${filterNames}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s)); });
  return zipSync(files, { level: 6 });
}

// ---------------------------------------------------------------- read back (owner edits)

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const textOf = (frag: string) => unesc((frag.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));

/** Cell text of one named sheet (shared strings, inline strings, numbers as written). Empty array when the sheet is absent. */
export function readXlsxSheet(bytes: Uint8Array, sheetName: string): string[][] {
  const files = unzipSync(bytes);
  const wb = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : '';
  const sheet = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((s) => unesc(s.match(/name="([^"]*)"/)?.[1] ?? '') === sheetName);
  const rid = sheet?.match(/r:id="([^"]+)"/)?.[1];
  const target = rid ? [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`))?.match(/Target="([^"]+)"/)?.[1] : undefined;
  if (!target) return [];
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  if (!files[path]) return [];
  const shared = (files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : '').match(/<si>[\s\S]*?<\/si>/g)?.map(textOf) ?? [];
  const rows: string[][] = [];
  for (const r of strFromU8(files[path]).match(/<row\b[^>]*>[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []) {
    const rn = Number(r.match(/ r="(\d+)"/)?.[1] ?? rows.length + 1);
    const out: string[] = [];
    for (const c of r.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = c.match(/ r="([A-Z]+)\d+"/)?.[1];
      let col = 0; if (ref) for (const ch of ref) col = col * 26 + (ch.charCodeAt(0) - 64);
      const t = c.match(/ t="([^"]+)"/)?.[1];
      const raw = c.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
      const v = t === 'inlineStr' ? textOf(c) : t === 's' ? shared[Number(raw)] ?? '' : unesc(raw);
      while (out.length < col - 1) out.push('');
      out[col - 1] = v;
    }
    while (rows.length < rn - 1) rows.push([]);
    rows[rn - 1] = out;
  }
  return rows;
}
