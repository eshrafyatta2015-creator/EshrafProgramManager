/* HeaderService — خريطة أعمدة ترويسة ملف الردود (HeaderMap)
   تُستخدم لقراءة/كتابة/استعادة الترويسة دون افتراض مواضع الأعمدة (§26/§27).
   نسخة Header تُحفظ داخل إعدادات النظام لاسترجاعها إذا فُقدت الترويسة في الملف. */

import { CFG } from '../config.js';
import { storeGet, storeSet } from '../utils.js';

export const NOTES_HEADER =
  'الملاحظات لبرنامج التخطيط او الفعلي ( يتم رصد ملاحظات لبرنامج التخطيط او ما تم تنفيذه في البرنامج الفعلي بالمقارنه مع البرنامج السابق مثلا تم تغيير المدرسه او المعلم بسبب.... الخ)';
export const CODE_HEADER = 'Valid Code(خاص بالتطبيق)';
export const TYPE_HEADER = 'نوع البرنامج  (فعلي او تخطيط اختر من القائمه)';

const WEEK_RE = /\d{1,2}\/\d{1,2}\s*-\s*\d{1,2}\/\d{1,2}/;

/* بناء خريطة الأعمدة من صف الترويسة — ترتيب غير مفترض (يُبحث بالاسم) */
export function buildHeaderMap(cells) {
  const list = (cells || []).map((c) => String(c == null ? '' : c).trim());
  const map = {
    timestamp: -1,
    supervisor: -1,
    notes: -1,
    code: -1,
    type: -1,
    days: [],
    unknown: [],
    length: list.length,
    ok: false,
  };
  const schoolCols = [];
  const activityCols = [];
  list.forEach((h, i) => {
    const low = h.toLowerCase();
    if (map.timestamp < 0 && low.includes('timestamp')) { map.timestamp = i; return; }
    if (map.supervisor < 0 && h.includes('اسم المشرف')) { map.supervisor = i; return; }
    if (map.notes < 0 && h.includes('ملاحظات')) { map.notes = i; return; }
    if (map.code < 0 && (low.includes('valid code') || h.includes('كود'))) { map.code = i; return; }
    if (map.type < 0 && h.includes('نوع البرنامج')) { map.type = i; return; }
    if (h.startsWith('تفاصيل الايام')) { activityCols.push(i); return; }
    if (WEEK_RE.test(h)) { schoolCols.push(i); return; }
    if (h) map.unknown.push(i);
  });
  const n = Math.min(schoolCols.length, activityCols.length, CFG.days.length);
  for (let d = 0; d < n; d++) {
    map.days.push({ school: schoolCols[d], activity: activityCols[d], key: CFG.days[d].key, label: CFG.days[d].label });
  }
  map.ok = map.timestamp >= 0 && map.supervisor >= 0 && map.days.length === 6;
  return map;
}

/* ترويسة بديلة مبنية من الإعدادات (تُستخدم إذا فُقدت الترويسة في الملف) */
export function defaultHeaderRow(weekLabel) {
  const out = ['Timestamp', CFG.magicHeader];
  for (const d of CFG.days) {
    out.push((weekLabel ? weekLabel + ' ' : '') + d.sheet);
    out.push('تفاصيل الايام ' + d.sheet);
  }
  out.push(NOTES_HEADER);
  out.push(CODE_HEADER);
  out.push(TYPE_HEADER);
  return out;
}

/* ترويسة الأرشيف (بدون timestamp — لوح الأرشيف القديم بأعمدة الاسم+الأيام) */
export function archiveHeaderRow(weekLabel) {
  const out = [CFG.magicHeader];
  for (const d of CFG.days) {
    out.push((weekLabel ? weekLabel + ' ' : '') + d.sheet);
    out.push('تفاصيل الايام ' + d.sheet);
  }
  out.push(NOTES_HEADER);
  out.push(CODE_HEADER);
  out.push(TYPE_HEADER);
  return out;
}

/* أعلى الملف: ترويسة واحدة فقط (لا ترويسة لكل أسبوع) */
export function topHeaderRow(data, weekLabel) {
  const live = data && data.programs && data.programs.header;
  if (live && live.length) return live.slice();
  const snap = getHeaderSnapshot();
  if (snap && snap.length) return snap.slice();
  return defaultHeaderRow(weekLabel);
}

/* خريطة الأعمدة لملف الردود: حي ← نسخة محفوظة ← افتراضية */
export function headerMapFor(data) {
  const live = data && data.programs && data.programs.header;
  if (live && live.length) {
    const m = buildHeaderMap(live);
    if (m.ok) return { map: m, origin: 'live', cells: live.slice() };
  }
  const snap = getHeaderSnapshot();
  if (snap && snap.length) {
    const m = buildHeaderMap(snap);
    if (m.ok) return { map: m, origin: 'snapshot', cells: snap.slice() };
  }
  const def = defaultHeaderRow('');
  return { map: buildHeaderMap(def), origin: 'default', cells: def };
}

/* مطابقة صفوف بتنسيق ردود الاستمارة إلى ترويسة الهدف باستخدام أسماء الأعمدة لا ترتيبها (§38 خطوة 4-5):
   - كل حقل يوضع في عموده بحسب اسمه في ترويسة الهدف.
   - العمود الناقص يُضاف أولاً في خلية ترويسة فارغة، وإلا يُلحق نهاية الترويسة — دون مس أي بيانات تاريخية.
   - لا يُكتب إلا صف الترويسة (خلاياه الفارغة/النهاية) — صفوف البيانات القديمة تبقى كما هي. */
export function alignRowsToHeader(headerCells, rows) {
  const h = (headerCells || []).map((c) => String(c == null ? '' : c).trim());
  const list = (rows || []).map((r) => Array.isArray(r) ? r.map((c) => String(c == null ? '' : c)) : r);
  const asIs = () => ({ rows: list, headerCells: h, headerOut: h.slice(), headerPatch: [], headerExtend: [], aligned: false });
  if (!h.length || !list.length) return asIs();

  const idx = { ts: -1, name: -1, notes: -1, code: -1, type: -1 };
  const schoolsOrder = [];
  const actsOrder = [];
  h.forEach((cellText, i) => {
    const low = cellText.toLowerCase();
    if (idx.ts < 0 && low.includes('timestamp')) { idx.ts = i; return; }
    if (idx.name < 0 && cellText.includes('اسم المشرف')) { idx.name = i; return; }
    if (idx.notes < 0 && cellText.includes('ملاحظات')) { idx.notes = i; return; }
    if (idx.code < 0 && (low.includes('valid code') || cellText.includes('كود'))) { idx.code = i; return; }
    if (idx.type < 0 && cellText.includes('نوع البرنامج')) { idx.type = i; return; }
    if (cellText.startsWith('تفاصيل الايام')) { actsOrder.push(i); return; }
    if (/\d{1,2}\/\d{1,2}\s*-\s*\d{1,2}\/\d{1,2}/.test(cellText)) { schoolsOrder.push(i); return; }
  });

  /* أيام الأسبوع: برمز اليوم في اسم العمود أولاً، وبالترتيب المتبادل احتياطاً */
  const days = [];
  for (let d = 0; d < CFG.days.length; d++) {
    const tok = CFG.days[d].sheet;
    let sc = -1;
    let ac = -1;
    h.forEach((c, i) => {
      const isDetail = c.startsWith('تفاصيل الايام');
      if (c.includes(tok) && !isDetail && sc < 0) sc = i;
      if (c.includes(tok) && isDetail && ac < 0) ac = i;
    });
    days.push({ school: sc, activity: ac });
  }
  const zip = Math.min(schoolsOrder.length, actsOrder.length, CFG.days.length);
  for (let d = 0; d < CFG.days.length; d++) {
    if (days[d].school < 0 && d < zip) days[d].school = schoolsOrder[d];
    if (days[d].activity < 0 && d < zip) days[d].activity = actsOrder[d];
  }
  /* ترويسة غير قابلة للمطابقة (بلا اسم مشرف أو بلا أعمدة أيام) → لا مطابقة ولا تغيير */
  if (idx.name < 0 || days.some((d) => d.school < 0 || d.activity < 0)) return asIs();

  const used = new Set([idx.name, idx.notes, idx.code, idx.type, idx.ts].filter((x) => x >= 0));
  days.forEach((d) => { used.add(d.school); used.add(d.activity); });
  const patch = [];
  const extend = [];
  const alloc = (label) => {
    for (let i = 0; i < h.length; i++) {
      if (!h[i] && !used.has(i)) { used.add(i); patch.push({ col: i + 1, name: label }); return i; }
    }
    const at = h.length + extend.length;
    used.add(at);
    extend.push(label);
    return at;
  };
  const colOf = (cur, label) => (cur >= 0 ? cur : alloc(label));

  /* ترتيب الإسناد: الكود أولاً يتلقى الخلية الفارغة في ترويسة الأرشيف
     (parseAdminCsv يقرأ الكود من الخلية 16 في الصف الاسمي)، ثم الطابع الزمني يُلحق نهاية الترويسة */
  const iType = colOf(idx.type, TYPE_HEADER);
  const iNotes = colOf(idx.notes, NOTES_HEADER);
  const iCode = colOf(idx.code, CODE_HEADER);
  const iTs = colOf(idx.ts, 'Timestamp');
  const headerOut = h.slice();
  for (const p of patch) headerOut[p.col - 1] = p.name;
  const len = Math.max(headerOut.length, h.length + extend.length);
  while (headerOut.length < len) headerOut.push(extend[headerOut.length - h.length] || '');

  const out = list.map((src) => {
    if (!Array.isArray(src) || src.length !== 17) return src;
    const row = new Array(len).fill('');
    row[iTs] = src[0] || '';
    row[idx.name] = src[1] || '';
    for (let d = 0; d < 6 && d < days.length; d++) {
      row[days[d].school] = src[2 + d * 2] || '';
      row[days[d].activity] = src[3 + d * 2] || '';
    }
    row[iNotes] = src[14] || '';
    row[iCode] = src[15] || '';
    row[iType] = src[16] || '';
    return row;
  });
  return { rows: out, headerCells: h, headerOut, headerPatch: patch, headerExtend: extend, aligned: true };
}

export function saveHeaderSnapshot(cells) {
  const list = (cells || []).map((c) => String(c == null ? '' : c));
  if (!list.length) return false;
  return storeSet(CFG.storage.header, { ts: Date.now(), cells: list });
}

export function getHeaderSnapshot() {
  const s = storeGet(CFG.storage.header, null);
  return s && s.cells && s.cells.length ? s.cells : null;
}

export function clearHeaderSnapshot() {
  try { localStorage.removeItem(CFG.storage.header); } catch (e) { /* ignore */ }
  return true;
}
