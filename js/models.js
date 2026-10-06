/* Models — تحليل ملفات CSV الحقيقية إلى سجلات موحّدة */

import { CFG } from './config.js';
import { csvParse, cell, normName, parseWeekLabel, weekOfDate, parseTimestamp, isoDate, uniqueBy } from './utils.js';

const PLACEHOLDERS = new Set([
  normName(CFG.magicHeader),
  normName('اسم المشرف'),
  normName('اسم المدرسة'),
  normName('الفعاليات'),
  normName('Timestamp'),
  normName('نوع البرنامج  (فعلي او تخطيط اختر من القائمه)'),
]);

const TS_RE = /^\d{1,2}\/\d{1,2}\/\d{4}/;
const WEEK_IN_COL_RE = /\d{1,2}\/\d{1,2}\s*-\s*\d{1,2}\/\d{1,2}/;

export function isNoiseSupervisor(name) {
  const n = normName(name);
  if (!n) return true;
  if (PLACEHOLDERS.has(n)) return true;
  if (n.startsWith(normName(CFG.noteRowPrefix))) return true;
  if (n.includes('[الاحد]')) return true;
  return false;
}

function validType(v) {
  return v === CFG.typePlanning || v === CFG.typeActual ? v : null;
}

/* ---------- LISTS: مدارس + فعاليات + مشرفون (بمعرّف فريد) ---------- */

export function parseListsCsv(text) {
  const rows = csvParse(text);
  const schools = [];
  const activities = [];
  const supervisors = [];
  if (!rows.length) return { schools, activities, supervisors, header: [] };
  const header = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const school = cell(r, 1);
    const activity = cell(r, 2);
    const sup = cell(r, 3);
    const id = cell(r, 4);
    if (school) schools.push(school);
    if (activity) activities.push(activity);
    if (sup && !isNoiseSupervisor(sup)) {
      supervisors.push({ name: sup, id: /^\d{6,}$/.test(id) ? id : '' });
    }
  }
  return {
    header,
    schools: uniqueBy(schools, (x) => normName(x)),
    activities: uniqueBy(activities, (x) => normName(x)),
    supervisors: uniqueBy(supervisors, (x) => normName(x.name)),
  };
}

/* ---------- PROGRAMS: ردود الاستمارة الحيّة ---------- */

export function parseProgramsCsv(text) {
  const rows = csvParse(text);
  const records = [];
  if (!rows.length) return { headerWeek: null, records: [] };
  const header = rows[0];
  const headerWeek = parseWeekLabel(cell(header, 2));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sup = cell(r, 1);
    if (!sup || isNoiseSupervisor(sup)) continue;
    const tsRaw = cell(r, 0);
    const ts = parseTimestamp(tsRaw);
    const week = (ts && weekOfDate(isoDate(ts))) || headerWeek;
    if (!week) continue;
    const days = [];
    for (let d = 0; d < 6; d++) {
      days.push({ school: cell(r, 2 + d * 2), activity: cell(r, 3 + d * 2) });
    }
    records.push({
      source: 'programs',
      supervisor: sup,
      supervisorNorm: normName(sup),
      weekStart: week.start,
      week: week,
      days,
      notes: cell(r, 14),
      code: cell(r, 15),
      type: validType(cell(r, 16)),
      timestamp: tsRaw,
      tsTime: ts ? ts.getTime() : null,
      rowIndex: i,
    });
  }
  return { headerWeek, records };
}

/* ---------- ADMIN: الأرشيف متعدد الأسابيع (1rthlma) ---------- */

export function parseAdminCsv(text) {
  const rows = csvParse(text);
  const records = [];
  const weeks = [];
  const skipped = { headers: 0, noise: 0, timestampLike: 0, empty: 0 };
  if (!rows.length) return { weeks, records, skipped };
  let currentWeek = parseWeekLabel(cell(rows[0], 1));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c0 = cell(r, 0);
    const c1 = cell(r, 1);

    if (!c0 && !c1) { skipped.empty++; continue; }

    const c0IsMagic = normName(c0) === normName(CFG.magicHeader) || normName(c0) === normName('اسم المشرف');
    if (c0IsMagic) {
      skipped.headers++;
      const w = parseWeekLabel(c1);
      if (w) {
        currentWeek = w;
        if (!weeks.some((x) => x.start === w.start)) weeks.push(w);
      }
      continue;
    }

    if (WEEK_IN_COL_RE.test(c0) || (c1 && WEEK_IN_COL_RE.test(c1) && !c0)) {
      const w = parseWeekLabel(c1 || c0);
      if (w) {
        skipped.headers++;
        currentWeek = w;
        if (!weeks.some((x) => x.start === w.start)) weeks.push(w);
        continue;
      }
    }

    if (TS_RE.test(c0)) { skipped.timestampLike++; continue; }
    if (isNoiseSupervisor(c0)) { skipped.noise++; continue; }
    if (!currentWeek) { skipped.noise++; continue; }

    let type = null;
    let code = '';
    const c14 = cell(r, 14);
    const c15 = cell(r, 15);
    if (validType(c15)) { type = c15; code = c14; }
    else if (validType(c14)) { type = c14; code = ''; }

    const days = [];
    let nonEmptyDays = 0;
    for (let d = 0; d < 6; d++) {
      const school = cell(r, 1 + d * 2);
      const activity = cell(r, 2 + d * 2);
      if (school || activity) nonEmptyDays++;
      days.push({ school, activity });
    }
    if (!nonEmptyDays && !cell(r, 13)) { skipped.noise++; continue; }

    records.push({
      source: 'admin',
      supervisor: c0,
      supervisorNorm: normName(c0),
      weekStart: currentWeek.start,
      week: currentWeek,
      days,
      notes: cell(r, 13),
      code,
      type,
      timestamp: '',
      tsTime: null,
      rowIndex: i,
    });
  }

  weeks.sort((a, b) => (a.start < b.start ? 1 : -1));
  return { weeks, records, skipped };
}

/* ---------- المشرفون الموحدون (مفتاح فريد: رقم الهوية ثم الاسم) ---------- */

export function buildMasterSupervisors(listParsed, adminRecords, programRecords) {
  const map = new Map();
  const put = (name, id) => {
    if (isNoiseSupervisor(name)) return;
    const k = normName(name);
    if (!k) return;
    const existing = map.get(k);
    if (existing) {
      if (id && !existing.id) existing.id = id;
    } else {
      map.set(k, { name: name.trim(), id: id || '', nameNorm: k });
    }
  };
  for (const s of listParsed.supervisors) put(s.name, s.id);
  for (const r of adminRecords) put(r.supervisor, '');
  for (const r of programRecords) put(r.supervisor, '');
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/* قائمة المتابعة: من الملف المرجعي فقط (Link2) — بدون دمج الردود أو الأرشيف */
export function masterFromLists(listParsed) {
  const map = new Map();
  for (const s of listParsed.supervisors) {
    if (isNoiseSupervisor(s.name)) continue;
    const k = normName(s.name);
    if (!k || map.has(k)) continue;
    map.set(k, { name: s.name.trim(), id: s.id || '', nameNorm: k });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/* سجلات مشرفين خارج القائمة المرجعية — تُعلَّم فقط ولا تُحذف أبداً */
export function findOrphanSupervisors(master, records) {
  const known = new Set(master.map((s) => s.nameNorm));
  const map = new Map();
  for (const r of records) {
    const k = r.supervisorNorm || normName(r.supervisor);
    if (!k || known.has(k)) continue;
    const cur = map.get(k) || { name: r.supervisor, nameNorm: k, count: 0, weeks: new Set() };
    cur.count++;
    if (r.weekStart) cur.weeks.add(r.weekStart);
    map.set(k, cur);
  }
  return Array.from(map.values())
    .map((o) => ({ name: o.name, nameNorm: o.nameNorm, count: o.count, weeks: o.weeks.size }))
    .sort((a, b) => b.count - a.count);
}

export function recordsForWeek(records, week) {
  if (!week) return [];
  return records.filter((r) => r.weekStart === week.start);
}

export function recordsForSupervisor(records, nameNorm, week) {
  return records.filter((r) => r.supervisorNorm === nameNorm && (!week || r.weekStart === week.start));
}

export function lastRecordOfType(recs, type) {
  for (let i = recs.length - 1; i >= 0; i--) {
    if (recs[i].type === type) return recs[i];
  }
  return null;
}

export function allWeeks(adminWeeks, programHeaderWeek, programRecords) {
  const map = new Map();
  for (const w of adminWeeks) map.set(w.start, w);
  if (programHeaderWeek) map.set(programHeaderWeek.start, programHeaderWeek);
  for (const r of programRecords) if (r.week) map.set(r.week.start, r.week);
  return Array.from(map.values()).sort((a, b) => (a.start < b.start ? 1 : -1));
}

export function defaultWeek(weeks, today) {
  const t = today || new Date();
  const tIso = isoDate(t);
  const inRange = weeks.find((w) => tIso >= w.start && tIso <= w.end);
  if (inRange) return inRange;
  return weeks[0] || null;
}
