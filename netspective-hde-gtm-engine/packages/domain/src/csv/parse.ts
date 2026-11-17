// Small RFC 4180 CSV parser (research R-04). Pure, dependency-free. Errors are codes, never cell content.

export interface CsvLimits {
  maxBytes: number;
  maxRows: number;
}

export interface CsvSpec {
  required: readonly string[];
  optional: readonly string[];
}

export interface CsvRow {
  /** 1-based, header excluded. */
  rowNumber: number;
  values: Record<string, string>;
  /** Set when the row has the wrong number of cells; the row is then rejected on its own. */
  error?: "column_count_mismatch";
}

export type CsvResult =
  { ok: true; rows: CsvRow[] } | { ok: false; code: string; headers?: string[] };

export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function records(text: string): string[][] | null {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (!(row.length === 1 && row[0] === "")) out.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") endRow();
    else cell += ch;
    i++;
  }
  if (quoted) return null;
  if (cell !== "" || row.length > 0) endRow();
  return out;
}

export function parseCsv(text: string, spec: CsvSpec, limits: CsvLimits): CsvResult {
  if (Buffer.byteLength(text, "utf8") > limits.maxBytes)
    return { ok: false, code: "file_too_large" };
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const all = records(body);
  if (all === null) return { ok: false, code: "unterminated_quote" };
  if (all.length === 0) return { ok: false, code: "empty_file" };

  const headers = all[0]!.map((h) => h.trim().toLowerCase());
  const missing = spec.required.filter((h) => !headers.includes(h));
  if (missing.length > 0) return { ok: false, code: "missing_required_header", headers: missing };
  const allowed = new Set([...spec.required, ...spec.optional]);
  const unknown = headers.filter((h) => !allowed.has(h));
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "unknown_header",
      headers: unknown.map((h) => (/^[a-z0-9_ -]{1,40}$/.test(h) ? h : "?")),
    };
  }
  if (new Set(headers).size !== headers.length) return { ok: false, code: "duplicate_header" };

  const data = all.slice(1);
  if (data.length > limits.maxRows) return { ok: false, code: "too_many_rows" };
  const rows: CsvRow[] = data.map((cells, index) => {
    if (cells.length !== headers.length) {
      return { rowNumber: index + 1, values: {}, error: "column_count_mismatch" as const };
    }
    const values: Record<string, string> = {};
    headers.forEach((h, c) => {
      values[h] = cells[c]!.trim();
    });
    return { rowNumber: index + 1, values };
  });
  return { ok: true, rows };
}
