/* GoogleSheetsService — قراءة CSV + كتابة عبر Apps Script (بدون ادعاء نجاح) */

import { CFG } from '../config.js';
import { fetchText, storeGet, storeSet } from '../utils.js';
import { parseAdminCsv, parseProgramsCsv, parseListsCsv, masterFromLists, findOrphanSupervisors, allWeeks } from '../models.js';

function cachePayload(data) {
  return {
    ts: Date.now(),
    listsRaw: data.listsRaw,
    adminRaw: data.adminRaw,
    programsRaw: data.programsRaw,
  };
}

function buildDerived(cached) {
  const lists = parseListsCsv(cached.listsRaw || '');
  const admin = parseAdminCsv(cached.adminRaw || '');
  const programs = parseProgramsCsv(cached.programsRaw || '');
  const master = masterFromLists(lists);
  const weeks = allWeeks(admin.weeks, programs.headerWeek, programs.records);
  const records = admin.records.concat(programs.records);
  return {
    ts: cached.ts || 0,
    lists,
    admin,
    programs,
    master,
    orphans: findOrphanSupervisors(master, records),
    weeks,
    records,
    sources: cached.sources || {},
    offline: !!cached.offline,
  };
}

export async function getData({ force = false } = {}) {
  const cache = storeGet(CFG.storage.cache, null);
  const defs = [
    ['lists', CFG.sheets.lists, 'listsRaw'],
    ['admin', CFG.sheets.admin, 'adminRaw'],
    ['programs', CFG.sheets.programs, 'programsRaw'],
  ];

  const sources = {};
  const raws = {};
  let anyFresh = false;

  await Promise.all(defs.map(async ([key, url, field]) => {
    try {
      const txt = await fetchText(url + (url.includes('?') ? '&nc=' : '?nc=') + Date.now(), CFG.requestTimeoutMs);
      raws[field] = txt;
      sources[key] = { ok: true, error: '' };
      anyFresh = true;
    } catch (e) {
      sources[key] = { ok: false, error: String((e && e.message) || e) };
      if (cache && cache[field] != null) raws[field] = cache[field];
    }
  }));

  if (!anyFresh && !cache) {
    const err = new Error('NO_DATA');
    err.code = 'NO_DATA';
    throw err;
  }

  const payload = {
    ts: anyFresh ? Date.now() : (cache ? cache.ts : 0),
    listsRaw: raws.listsRaw || '',
    adminRaw: raws.adminRaw || '',
    programsRaw: raws.programsRaw || '',
    sources,
    offline: !anyFresh,
  };
  if (anyFresh) storeSet(CFG.storage.cache, payload);
  else if (cache) { cache.sources = sources; cache.offline = true; storeSet(CFG.storage.cache, cache); }

  const merged = { ...payload, ...(cache && !anyFresh ? { ts: cache.ts } : {}) };
  return buildDerived(merged);
}

export function getDataFromCache() {
  const cache = storeGet(CFG.storage.cache, null);
  if (!cache) return null;
  return buildDerived({ ...cache, sources: {}, offline: true });
}

/* الكتابة: عبر Google Apps Script Web App فقط (رابط CSV للقراءة فقط) */

export async function appendData({ rows, markerRow, weekLabel, headerRow, headerCells, headerPatch, headerExtend, appsScriptUrl, sheetId }) {
  if (!appsScriptUrl) {
    return { ok: false, code: 'NOT_CONFIGURED', error: 'لم يتم ضبط رابط Apps Script بعد (الإعدادات ← ربط الكتابة).' };
  }
  if (!rows || !rows.length) {
    return { ok: false, code: 'EMPTY', error: 'لا توجد صفوف لإضافتها.' };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    let resp;
    try {
      resp = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'append',
          sheetId: sheetId || CFG.sheetIds.admin,
          rows,
          weekLabel: weekLabel || '',
          headerRow: headerRow || null,
          headerCells: headerCells || null,
          headerPatch: headerPatch && headerPatch.length ? headerPatch : null,
          headerExtend: headerExtend && headerExtend.length ? headerExtend : null,
          marker: markerRow || null,
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || data.ok !== true) {
      return { ok: false, code: data && data.code ? data.code : 'SCRIPT_ERROR', error: (data && data.error) || ('HTTP ' + resp.status), raw: data };
    }
    return { ok: true, appended: data.appended | 0, skipped: data.skipped | 0, headerWritten: !!data.headerWritten, headerPatched: data.headerPatched | 0, headerExtended: data.headerExtended | 0 };
  } catch (e) {
    return { ok: false, code: 'NETWORK', error: String((e && e.message) || e) };
  }
}

/* حذف صفوف محددة — لا يُستدعى إلا بعد تحقق فعلي من وصولها للأرشيف.
   sheetId اختياري: الردود (افتراضي) أو الأرشيف (أثناء التراجع). */
export async function deleteResponseRows({ rows, appsScriptUrl, sheetId }) {
  if (!appsScriptUrl) {
    return { ok: false, code: 'NOT_CONFIGURED', error: 'لم يتم ضبط رابط Apps Script بعد (الإعدادات ← ربط الكتابة).', deleted: 0 };
  }
  if (!rows || !rows.length) {
    return { ok: true, deleted: 0, expected: 0 };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    let resp;
    try {
      resp = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'deleteRows', sheetId: sheetId || CFG.sheetIds.programs, rows }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || data.ok !== true) {
      return { ok: false, code: 'SCRIPT_ERROR', error: (data && data.error) || ('HTTP ' + resp.status), raw: data, deleted: 0, expected: rows.length };
    }
    return { ok: true, deleted: data.deleted | 0, expected: data.expected | rows.length };
  } catch (e) {
    return { ok: false, code: 'NETWORK', error: String((e && e.message) || e), deleted: 0, expected: rows.length };
  }
}

/* تحديث تسمية الأسبوع في صف الترويسة فقط (صف 1) — تجهيز الاستمارة للأسبوع الجديد (§38).
   لا يُمس أي صف بيانات، ولا تُنشأ ترويسة متكررة، والتحقق يُعاد قراءته من الملف. */
export async function updateHeaderWeek({ oldLabel, newLabel, appsScriptUrl, sheetId }) {
  if (!appsScriptUrl) {
    return { ok: false, code: 'NOT_CONFIGURED', error: 'لم يتم ضبط رابط Apps Script بعد (الإعدادات ← ربط الكتابة).' };
  }
  if (!oldLabel || !newLabel || oldLabel === newLabel) {
    return { ok: false, code: 'BAD_LABEL', error: 'تسمية أسبوع غير صالحة لتحديث الترويسة.' };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    let resp;
    try {
      resp = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'setWeekHeader', sheetId: sheetId || CFG.sheetIds.programs, oldLabel, newLabel }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || data.ok !== true) {
      return { ok: false, code: data && data.code ? data.code : 'SCRIPT_ERROR', error: (data && data.error) || ('HTTP ' + resp.status), raw: data, updated: 0 };
    }
    return { ok: true, updated: data.updated | 0, already: !!data.already, verified: data.verified !== false };
  } catch (e) {
    return { ok: false, code: 'NETWORK', error: String((e && e.message) || e), updated: 0 };
  }
}

/* قراءة طازجة (بدون كاش) للتحقق بعد الكتابة/الحذف */
export async function fetchArchiveCsv() {
  const txt = await fetchText(CFG.sheets.admin + '&nc=' + Date.now(), CFG.requestTimeoutMs);
  return parseAdminCsv(txt);
}

export async function fetchResponsesCsv() {
  const txt = await fetchText(CFG.sheets.programs + '&nc=' + Date.now(), CFG.requestTimeoutMs);
  return { parsed: parseProgramsCsv(txt), raw: txt };
}

export function getSupervisors(data) {
  return data.master || [];
}

export function getWeeklyProgram(data, week) {
  const start = typeof week === 'string' ? week : week && week.start;
  return (data.records || []).filter((r) => r.weekStart === start);
}
