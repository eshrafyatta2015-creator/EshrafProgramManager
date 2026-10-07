/* DuplicateDetectionService — منع تكرار السجلات قبل الكتابة
   مفتاح السجل: الأسبوع + اسم المشرف (موحّد للمقارنة) + النوع + محتوى الأيام.
   لا يُحذف شيء من الأرشيف — الكشف فقط (تخطي المكرر). */

import { normName } from '../utils.js';

export function recordKey(r) {
  return [
    r.weekStart || '',
    r.supervisorNorm || normName(r.supervisor),
    r.type || '',
    (r.days || []).map((d) => (d.school || '') + '~' + (d.activity || '')).join('~'),
  ].join('|');
}

/* تخطي أي سجل موجود مسبقاً (ضمن القائمة نفسها أيضاً) */
export function dedupeAgainstExisting(existingRecords, newRecords) {
  const seen = new Set((existingRecords || []).map(recordKey));
  const keep = [];
  let skipped = 0;
  for (const r of newRecords || []) {
    const k = recordKey(r);
    if (seen.has(k)) { skipped++; continue; }
    seen.add(k);
    keep.push(r);
  }
  return { keep, skipped };
}

/* كم سجلاً من المجموعة الجديدة موجود أصلاً؟ */
export function countDuplicates(existingRecords, newRecords) {
  const seen = new Set((existingRecords || []).map(recordKey));
  let dup = 0;
  for (const r of newRecords || []) if (seen.has(recordKey(r))) dup++;
  return dup;
}
