/* ResponsesService — ردود الاستمارة الحيّة (Link3): قراءة فقط
   أثناء الترحيل لا يُحذف من هذا المصدر ولا يُعدَّل — الإضافة للأرشيف فقط. */

import { CFG } from '../config.js';
import { normName } from '../utils.js';

export function responseRecords(data) {
  return ((data && data.records) || []).filter((r) => r.source === 'programs');
}

export function responsesOfWeek(data, weekStart) {
  if (!weekStart) return [];
  return responseRecords(data).filter((r) => r.weekStart === weekStart);
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
