/* MasterDataService — البيانات المرجعية (Link2): مدارس/فعاليات/قائمة المشرفين
   صلاحية القراءة فقط: لا كتابة ولا حذف ولا تعديل على هذا المصدر إطلاقاً. */

import { masterFromLists, findOrphanSupervisors } from '../models.js';

export function masterSupervisors(data) {
  return (data && data.master) || [];
}

export function masterSupervisorsOfLists(listsParsed) {
  return masterFromLists(listsParsed);
}

export function masterNamesSet(data) {
  return new Set(masterSupervisors(data).map((s) => s.nameNorm));
}

export function schools(data) {
  return (data && data.lists && data.lists.schools) || [];
}

export function activities(data) {
  return (data && data.lists && data.lists.activities) || [];
}

export function orphanSupervisors(data) {
  if (!data) return [];
  if (data.orphans) return data.orphans;
  return findOrphanSupervisors(data.master || [], data.records || []);
}
