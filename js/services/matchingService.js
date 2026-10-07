/* SupervisorMatchingService — مطابقة المشرفين
   قاعدة المشروع: مفتاح المطابقة = اسم المشرف فقط.
   Supervisor matching key = Supervisor Name (وليس ID/Phone/Mobile).
   normalizeSupervisorName تُستخدم للمقارنة فقط ولا تغيّر الاسم المخزّن أبداً. */

import { normName } from '../utils.js';
import { findOrphanSupervisors } from '../models.js';

export const MATCH_KEY = 'name';

/* مقارنة فقط — لا يُحفظ الناتج مكان الاسم الأصلي */
export function normalizeSupervisorName(s) {
  return normName(s);
}

export function masterNameSet(master) {
  return new Set((master || []).map((s) => normalizeSupervisorName(s.name)));
}

/* يفصل السجلات: مطابقة (بنفس الاسم) / غير مطابقة (يتيمة) */
export function matchByName(master, records) {
  const known = masterNameSet(master);
  const matched = [];
  const unmatched = [];
  for (const r of records || []) {
    const k = normalizeSupervisorName(r.supervisorNorm || r.supervisor);
    if (known.has(k)) matched.push(r);
    else unmatched.push(r);
  }
  return { matched, unmatched };
}

/* أسماء المشرفين الموجودين في الردود وغير موجودين في البيانات الأساسية */
export function findUnmatchedSupervisors(master, records) {
  return findOrphanSupervisors(master, records);
}

/* سجل واحد لا يطابق أي اسم في القائمة؟ */
export function isKnownName(master, name) {
  return masterNameSet(master).has(normalizeSupervisorName(name));
}
