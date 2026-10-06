/* Utils — CSV، تواريخ، أسماء، تنزيل (DOM اختياري) */

export function csvParse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

export function csvSerialize(rows) {
  return rows.map((r) => r.map((v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

export function cell(row, i) {
  const v = row && row[i] != null ? String(row[i]) : '';
  return v.trim();
}

export function normName(s) {
  return String(s || '')
    .replace(/\u0640/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- weeks ---------- */

const WEEK_RE = /(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/;

export function pad2(n) { return n < 10 ? '0' + n : '' + n; }

/* عزل النصوص الرقمية/التاريخية داخل السياق العربي حتى لا تنقلب بصرياً */
export function ltr(s) {
  return '\u2066' + String(s) + '\u2069';
}

export function isoDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

export function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

export function sundayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function formatDM(d) {
  return d.getDate() + '/' + (d.getMonth() + 1);
}

export function formatDate(d) {
  return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
}

export function formatDateTime(d) {
  return formatDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

export function parseWeekLabel(label) {
  const m = WEEK_RE.exec(String(label || ''));
  if (!m) return null;
  const d1 = +m[1], mo1 = +m[2], d2 = +m[3], mo2 = +m[4];
  const nowYear = new Date().getFullYear();
  let start = null;
  for (const y of [nowYear, nowYear - 1, nowYear + 1]) {
    const cand = new Date(y, mo1 - 1, d1);
    if (cand.getFullYear() === y && cand.getMonth() === mo1 - 1 && cand.getDate() === d1 && cand.getDay() === 0) {
      start = cand;
      break;
    }
  }
  if (!start) start = new Date(nowYear, mo1 - 1, d1);
  const end = addDays(start, 6);
  if (end.getDate() !== d2 || end.getMonth() + 1 !== mo2) {
    const labelEnd = new Date(start.getTime());
    labelEnd.setDate(d2);
    if (labelEnd.getMonth() + 1 !== mo2) { /* keep computed end; label kept as parsed */ }
  }
  return { start: isoDate(start), end: isoDate(addDays(start, 6)), label: d1 + '/' + mo1 + '-' + d2 + '/' + mo2 };
}

export function weekLabelFromDates(startIso, endIso) {
  const s = parseIso(startIso), e = parseIso(endIso);
  if (!s || !e) return '';
  return formatDM(s) + '-' + formatDM(e);
}

export function weekOfDate(dateIsoOrSlash) {
  let d = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateIsoOrSlash)) d = parseIso(dateIsoOrSlash);
  else {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(dateIsoOrSlash || '');
    if (m) d = new Date(+m[3], +m[2] - 1, +m[1]);
  }
  if (!d) return null;
  const s = sundayOf(d);
  const e = addDays(s, 6);
  return { start: isoDate(s), end: isoDate(e), label: weekLabelFromDates(isoDate(s), isoDate(e)) };
}

export function parseTimestamp(ts) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(ts || '').trim());
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

export function inWeek(date, week) {
  if (!date || !week) return false;
  const dIso = isoDate(date);
  return dIso >= week.start && dIso <= week.end;
}

export function cmpWeekDesc(a, b) {
  return a.start < b.start ? 1 : a.start > b.start ? -1 : 0;
}

/* ---------- misc ---------- */

export function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function fetchText(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 25000);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

export function storeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}

export function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { return false; }
}
