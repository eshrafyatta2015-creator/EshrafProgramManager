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
