/* ResponsesService — ردود الاستمارة الحيّة (Link3): قراءة فقط
   أثناء الترحيل لا يُحذف من هذا المصدر ولا يُعدَّل — الإضافة للأرشيف فقط. */

import { CFG } from '../config.js';
import { normName } from '../utils.js';
import { fetchResponsesCsv } from './sheetsService.js';

/* المنهجية المركزية لقراءة سجلات الردود — كل شاشات الردود تمر من هنا */
export function getResponseRecords(data, weekStart) {
  const recs = ((data && data.records) || []).filter((r) => r.source === 'programs');
  if (!weekStart) return recs;
  return recs.filter((r) => r.weekStart === weekStart);
}

export function responseRecords(data) {
  return getResponseRecords(data);
}

export function responsesOfWeek(data, weekStart) {
  if (!weekStart) return [];
  return getResponseRecords(data, weekStart);
}

/* كل سجلات الردود + الصفوف المستبعدة عند القراءة + عدّاد الصفوف الخام (للتشخيص) */
export function getAllResponseRecords(data) {
  const programs = (data && data.programs) || {};
  const records = getResponseRecords(data);
  const excluded = programs.excluded || [];
  const rawRows = programs.rawRows != null ? programs.rawRows : records.length + excluded.length;
  return {
    records,
    excluded,
    rawRows,
    headerWeek: programs.headerWeek || null,
    early: records.filter((r) => r.early).length,
    lastUpdate: (data && data.ts) || 0,
    sources: (data && data.sources) || {},
    offline: !!(data && data.offline),
  };
}

/* إحصاءات الردود (§تشخيص): إجمالي/مميز/تخطيط/فعلي/غائب — مرقّمة لا نصوص فقط */
export function responseStats(data, weekStart) {
  const recs = getResponseRecords(data, weekStart);
  const senders = new Set(recs.map((r) => r.supervisorNorm || normName(r.supervisor)));
  const types = typeCounts(recs);
  const master = (data && data.master) || [];
  const missing = weekStart ? master.filter((s) => !senders.has(s.nameNorm)) : [];
  const { orphans } = splitByMaster(master, recs);
  const excluded = (data && data.programs && data.programs.excluded) || [];
  return {
    totalResponses: recs.length,
    uniqueSupervisors: senders.size,
    planningResponses: types[CFG.typePlanning],
    actualResponses: types[CFG.typeActual],
    missingSupervisors: missing.length,
    missingList: missing,
    orphanRecords: orphans.length,
    excluded: excluded.length,
    early: recs.filter((r) => r.early).length,
  };
}

/* الردود المفقودة عن شاشة الأسبوع: الصفوف المستبعدة + سجلات أسابيع أخرى + غير المطابقين — كل صف بسببه */
export function findMissingResponseRecords(data, weekStart) {
  const out = [];
  const excluded = (data && data.programs && data.programs.excluded) || [];
  for (const e of excluded) {
    out.push({
      row: e.row,
      supervisor: e.supervisor || '—',
      timestamp: e.timestamp || '',
      weekLabel: '',
      reason: 'مستبعد عند القراءة: ' + e.reason,
    });
  }
  const master = (data && data.master) || [];
  const known = new Set(master.map((s) => s.nameNorm));
  for (const r of getResponseRecords(data)) {
    const k = r.supervisorNorm || normName(r.supervisor);
    if (weekStart && r.weekStart !== weekStart) {
      out.push({
        row: r.rowIndex,
        supervisor: r.supervisor,
        timestamp: r.timestamp || '',
        weekLabel: r.week ? r.week.label : r.weekStart,
        reason: 'خارج الأسبوع المحدد — مُنسب إلى أسبوع ' + (r.week ? r.week.label : r.weekStart) + (r.early ? ' (إرسال مبكر)' : ''),
      });
    } else if (!known.has(k)) {
      out.push({
        row: r.rowIndex,
        supervisor: r.supervisor,
        timestamp: r.timestamp || '',
        weekLabel: r.week ? r.week.label : r.weekStart,
        reason: 'غير مطابق لأي مشرف في البيانات الأساسية',
      });
    }
  }
  return out;
}

/* مقارنة المصدر (قراءة طازجة بلا كاش) مع ما يعرضه الموقع (الذاكرة الحالية) */
export async function compareSourceWithSite(data, weekStart) {
  const fresh = await fetchResponsesCsv();
  const p = fresh.parsed;
  const siteRecords = getResponseRecords(data);
  const siteWeek = weekStart ? siteRecords.filter((r) => r.weekStart === weekStart) : [];
  const fileWeek = weekStart ? p.records.filter((r) => r.weekStart === weekStart) : [];
  return {
    ok: true,
    fetchedAt: Date.now(),
    headerWeek: p.headerWeek,
    fileTotal: p.records.length,
    siteTotal: siteRecords.length,
    totalDifference: p.records.length - siteRecords.length,
    fileWeek: fileWeek.length,
    siteWeek: siteWeek.length,
    weekDifference: fileWeek.length - siteWeek.length,
    excluded: p.excluded || [],
    early: p.records.filter((r) => r.early).length,
    rawRows: p.rawRows != null ? p.rawRows : p.records.length,
  };
}

export function weeksWithResponses(data) {
  const map = new Map();
  for (const r of responseRecords(data)) if (r.weekStart) map.set(r.weekStart, r.week);
  return Array.from(map.values()).sort((a, b) => (a.start < b.start ? 1 : -1));
}

export function splitByMaster(master, records) {
  const known = new Set(master.map((s) => s.nameNorm));
  const kept = [];
  const orphans = [];
  for (const r of records) {
    const k = r.supervisorNorm || normName(r.supervisor);
    if (known.has(k)) kept.push(r);
    else orphans.push(r);
  }
  return { kept, orphans };
}

export function typeCounts(records) {
  const out = { [CFG.typePlanning]: 0, [CFG.typeActual]: 0, none: 0 };
  for (const r of records) {
    if (r.type === CFG.typePlanning) out[CFG.typePlanning]++;
    else if (r.type === CFG.typeActual) out[CFG.typeActual]++;
    else out.none++;
  }
  return out;
}
