/* WeekService — الأسابيع: +7 أيام للأسبوع التالي، والبحث داخل القوائم */

import { addDays, parseIso, isoDate, weekLabelFromDates } from '../utils.js';

export function buildWeek(startIso) {
  const s = parseIso(startIso);
  if (!s) return null;
  const e = addDays(s, 6);
  return { start: isoDate(s), end: isoDate(e), label: weekLabelFromDates(isoDate(s), isoDate(e)) };
}

export function shiftWeek(week, days) {
  if (!week) return null;
  const s = addDays(parseIso(week.start), days);
  return buildWeek(isoDate(s));
}

/* الأسبوع التالي = الحالي + 7 أيام (§15) */
export function nextWeek(week) {
  return shiftWeek(week, 7);
}

export function prevWeek(week) {
  return shiftWeek(week, -7);
}

export function weekInList(weeks, start) {
  return (weeks || []).find((w) => w.start === start) || null;
}
