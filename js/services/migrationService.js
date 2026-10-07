/* MigrationService — خوارزمية الترحيل الآمن §38 كاملةً
   1) قراءة الردود  2) مطابقة بالاسم فقط  3) الترويسة  4) منع التكرار
   5) إضافة الصفوف للأرشيف  6) إعادة قراءة الأرشيف والتحقق
   7) مقارنة عدد السجلات قبل/بعد  8) حذف الصفوف المرحّلة من الردود (فقط بعد التحقق)
   9) التحقق من الحذف وسلامة الترويسة  10) تجهيز الأسبوع التالي (+7)
   11) تسجيل العملية في سجل الترحيل
   قاعدة حاكمة: لا يُحذف أي صف من الردود قبل إثبات وصوله للأرشيف. */

import { CFG } from '../config.js';
import { normName, formatDateTime, uid, storeGet, storeSet } from '../utils.js';
import { responsesOfWeek, splitByMaster, typeCounts } from './responsesService.js';
import { dedupeAgainstExisting, recordKey } from './duplicateService.js';
import { nextWeek } from './weekService.js';
import { topHeaderRow, headerMapFor } from './headerService.js';
import { appendData, deleteResponseRows, fetchArchiveCsv, fetchResponsesCsv } from './sheetsService.js';
import { recordToResponsesRow } from './exportService.js';
import { logAdd } from './logService.js';

/* ---------- قراءات مساعدة ---------- */

export function archiveRecords(data) {
  return ((data && data.records) || []).filter((r) => r.source === 'admin');
}

export function weekExistsInArchive(data, weekStart) {
  return archiveRecords(data).some((r) => r.weekStart === weekStart);
}

/* ---------- خطة الترحيل (منطق خالص) ----------
   صفوف بتنسيق ردود الاستمارة تُضاف أسفل الأرشيف مباشرةً:
   ترويسة واحدة أعلى الملف فقط إذا كان الملف فارغاً — لا ترويسة لكل أسبوع. */
export function planMigration({ archive, records, week, data }) {
  const { keep, skipped } = dedupeAgainstExisting(archive || [], records || []);
  const headerNeeded = keep.length > 0 && !(archive || []).length;
  const rows = keep.map(recordToResponsesRow);
  return {
    rows,
    keep,
    skipped,
    headerNeeded,
    headerRow: headerNeeded ? topHeaderRow(data, week && week.label) : null,
  };
}

/* ---------- المعاينة ---------- */

export function buildMigratePreview(data, week, opts = {}) {
  const includeOrphans = !!opts.includeOrphans;
  const master = (data && data.master) || [];
  const weekRecords = responsesOfWeek(data, week ? week.start : '');
  const { kept, orphans } = splitByMaster(master, weekRecords);
  const toMigrate = includeOrphans ? kept.concat(orphans) : kept;
  const archive = archiveRecords(data);
  const plan = planMigration({ archive, records: toMigrate, week, data });
  const headerInfo = headerMapFor(data);

  const planningSenders = new Set();
  const actualSenders = new Set();
  for (const r of weekRecords) {
    if (r.type === CFG.typePlanning) planningSenders.add(r.supervisorNorm);
    else if (r.type === CFG.typeActual) actualSenders.add(r.supervisorNorm);
  }

  const archiveWeekCount = archive.filter((r) => r.weekStart === (week && week.start)).length;
  const alreadyMigrated = plan.keep.length === 0 && archiveWeekCount > 0;

  const orphanSupMap = new Map();
  for (const r of orphans) {
    const k = r.supervisorNorm || normName(r.supervisor);
    if (!orphanSupMap.has(k)) orphanSupMap.set(k, r.supervisor);
  }

  return {
    week,
    nextWeek: nextWeek(week),
    masterCount: master.length,
    responses: weekRecords.length,
    kept: plan.keep.length,
    skipped: plan.skipped,
    needsHeader: plan.headerNeeded,
    headerNeeded: plan.headerNeeded,
    headerExists: weekExistsInArchive(data, week ? week.start : ''),
    headerOrigin: headerInfo.origin,
    headerOk: headerInfo.map.ok,
    archiveWeekCount,
    alreadyMigrated,
    orphans,
    orphanSupervisors: Array.from(orphanSupMap.entries()).map(([nameNorm, name]) => ({ nameNorm, name })),
    orphanCount: orphans.length,
    includeOrphans,
    planningSenders: planningSenders.size,
    actualSenders: actualSenders.size,
    types: typeCounts(plan.keep),
    plan,
    marker: plan.keep.length ? plan.keep[0].supervisor : '',
  };
}

/* ---------- التنفيذ: إضافة ← تحقق ← حذف ← تحقق ← أسبوع جديد ← سجل ---------- */

export async function executeMigration({ preview, week, data, appsScriptUrl, includeOrphans = false, user = '' }) {
  const started = Date.now();
  const wk = week || (preview && preview.week);
  const ms = () => Date.now() - started;

  if (!preview || !preview.plan || !preview.plan.rows.length) {
    return { ok: false, code: 'EMPTY', error: 'لا توجد سجلات جديدة للترحيل.', ms: ms(), week: wk, deleteAttempted: false, logged: true };
  }
  if (!appsScriptUrl) {
    return { ok: false, code: 'NOT_CONFIGURED', error: 'لم يتم ضبط رابط Apps Script بعد (الإعدادات ← ربط الكتابة).', ms: ms(), week: wk, deleteAttempted: false, logged: false };
  }

  /* مراحل 1-4: قراءة طازجة + مطابقة الأسماء + منع التكرار (قد تغيّر الملفان منذ المعاينة) */
  let freshArchive;
  let freshResponses;
  try {
    freshArchive = await fetchArchiveCsv();
    freshResponses = await fetchResponsesCsv();
  } catch (e) {
    const msg = String((e && e.message) || e);
    logAdd('ترحيل الأسبوع', 'تعذّرت القراءة الطازجة: ' + msg);
    return { ok: false, code: 'READ_ERROR', error: msg, ms: ms(), week: wk, deleteAttempted: false, logged: true };
  }

  const master = (data && data.master) || [];
  const freshWeek = freshResponses.parsed.records.filter((r) => r.weekStart === wk.start);
  const { kept: freshKept, orphans: freshOrphans } = splitByMaster(master, freshWeek);
  const toMigrate = includeOrphans ? freshKept.concat(freshOrphans) : freshKept;
  const plan = planMigration({ archive: freshArchive.records, records: toMigrate, week: wk, data });

  if (!plan.keep.length) {
    const already = freshArchive.records.some((r) => r.weekStart === wk.start);
    const code = already ? 'ALREADY_MIGRATED' : 'EMPTY';
    const error = already ? CFG.texts.alreadyMigrated : 'لا توجد سجلات جديدة للترحيل.';
    logAdd('ترحيل الأسبوع', 'توقف قبل الكتابة: ' + code);
    return { ok: false, code, error, ms: ms(), week: wk, deleteAttempted: false, logged: true };
  }

  const beforeWeekCount = freshArchive.records.filter((r) => r.weekStart === wk.start).length;
  const orphNote = freshOrphans.length && !includeOrphans
    ? ' · يتيمة غير مرحّلة=' + freshOrphans.length
    : (includeOrphans && freshOrphans.length ? ' · يتيمة (مع تأكيد)=' + freshOrphans.length : '');

  /* المرحلة 5: الإضافة (الأرشيف فقط) */
  const written = await appendData({
    rows: plan.rows,
    markerRow: plan.keep[0].supervisor,
    weekLabel: wk.label,
    headerRow: plan.headerRow,
    appsScriptUrl,
  });
  if (!written.ok) {
    logAdd('ترحيل الأسبوع', 'فشل الإضافة ' + wk.label + ': ' + (written.code || '') + ' ' + (written.error || ''));
    return { ...written, ms: ms(), week: wk, deleteAttempted: false, logged: true };
  }

  /* المراحل 6-7: إعادة قراءة الأرشيف والتحقق + مقارنة عدد السجلات قبل/بعد */
  let verify;
  try {
    const after = await fetchArchiveCsv();
    const keys = new Set(after.records.map(recordKey));
    let found = 0;
    for (const r of plan.keep) if (keys.has(recordKey(r))) found++;
    const afterWeekCount = after.records.filter((r) => r.weekStart === wk.start).length;
    verify = {
      ok: found === plan.keep.length && afterWeekCount - beforeWeekCount === written.appended,
      found,
      expected: plan.keep.length,
      beforeWeekCount,
      afterWeekCount,
      countDelta: afterWeekCount - beforeWeekCount,
      appended: written.appended,
    };
  } catch (e) {
    verify = { ok: false, found: -1, expected: plan.keep.length, error: String((e && e.message) || e) };
  }

  if (!verify.ok) {
    /* فشل التحقق — لا حذف إطلاقاً */
    logAdd('ترحيل الأسبوع', 'فشل التحقق ' + wk.label + ': ' + JSON.stringify({ found: verify.found, expected: verify.expected, delta: verify.countDelta }));
    return {
      ok: false,
      code: 'VERIFY_FAILED',
      error: CFG.texts.failKeepResponses,
      appended: written.appended,
      skipped: written.skipped,
      verify,
      ms: ms(),
      week: wk,
      deleteAttempted: false,
      keptResponses: true,
      logged: true,
    };
  }

  /* المرحلة 8: الحذف من الردود — بعد التحقق فقط، الصفوف المرحّلة حصراً */
  const delTargets = plan.keep
    .filter((r) => r.timestamp)
    .map((r) => ({ t: r.timestamp, s: r.supervisor }));
  const untargeted = plan.keep.length - delTargets.length;

  const del = await deleteResponseRows({ rows: delTargets, appsScriptUrl });
  if (!del.ok) {
    const entry = saveEntry({
      week: wk, plan, written, verify, user,
      deleted: 0, deleteExpected: delTargets.length,
      status: 'جزئي', pendingDelete: delTargets, untargeted,
      detail: 'الحذف من الردود فشل: ' + (del.code || '') + ' ' + (del.error || ''),
    });
    logAdd('ترحيل الأسبوع', 'الأرشيف مكتمل لكن الحذف فشل ' + wk.label);
    return {
      ok: true,
      partialDelete: true,
      code: del.code || 'DELETE_FAILED',
      error: del.error || '',
      appended: written.appended,
      skipped: written.skipped,
      verify,
      deleted: 0,
      deleteExpected: delTargets.length,
      pendingDelete: delTargets,
      entry,
      nextWeek: nextWeek(wk),
      ms: ms(),
      week: wk,
      deleteAttempted: true,
      logged: true,
    };
  }

  /* المرحلة 9: التحقق من الحذف وسلامة الترويسة في ملف الردود */
  let delVerify;
  try {
    const afterResp = await fetchResponsesCsv();
    const live = afterResp.parsed.records;
    let remaining = 0;
    for (const t of delTargets) {
      const tn = normName(t.s);
      if (live.some((r) => r.timestamp === t.t && (r.supervisorNorm || normName(r.supervisor)) === tn)) remaining++;
    }
    const hdr = afterResp.parsed.header || [];
    const headerOk = hdr.length > 0 &&
      String(hdr[0] || '').toLowerCase().includes('timestamp') &&
      String(hdr[1] || '').includes('اسم المشرف');
    delVerify = { ok: remaining === 0 && headerOk, remaining, headerOk };
  } catch (e) {
    delVerify = { ok: false, remaining: delTargets.length, headerOk: false, error: String((e && e.message) || e) };
  }

  const deleteOk = delVerify.ok;
  const nk = nextWeek(wk);
  const entry = saveEntry({
    week: wk,
    plan,
    written,
    verify,
    user,
    deleted: delTargets.length - (delVerify.remaining || 0),
    deleteExpected: delTargets.length,
    status: deleteOk && untargeted === 0 ? 'مكتمل' : 'جزئي',
    pendingDelete: deleteOk ? null : delTargets,
    untargeted,
    detail: deleteOk
      ? 'تم الترحيل والحذف والتحقق'
      : 'الحذف لم يكتمل: متبقي=' + (delVerify.remaining || 0) + ' ترويسة=' + (delVerify.headerOk ? 'سليمة' : 'ناقصة'),
  });

  logAdd('ترحيل الأسبوع', 'الأسبوع ' + wk.label +
    ' · أُضيف=' + written.appended + ' · تحقق=' + verify.found + '/' + verify.expected +
    ' · محذوف=' + entry.deleted + '/' + deleteTargets.length +
    ' · الحالة=' + entry.status + orphNote);

  return {
    ok: true,
    appended: written.appended,
    skipped: written.skipped,
    headerWritten: !!written.headerWritten,
    verify,
    deleted: entry.deleted,
    deleteExpected: deleteTargets.length,
    deleteOk,
    headerPresent: delVerify.headerOk,
    remaining: delVerify.remaining || 0,
    untargeted,
    entry,
    nextWeek: nk,
    ms: ms(),
    week: wk,
    deleteAttempted: true,
    logged: true,
  };
}

/* ---------- إعادة محاولة حذف متبقٍ (عند الحالة الجزئية) ---------- */

export async function retryDelete(entry, appsScriptUrl) {
  if (!entry || !entry.pendingDelete || !entry.pendingDelete.length) {
    return { ok: true, nothing: true, deleted: 0 };
  }
  const del = await deleteResponseRows({ rows: entry.pendingDelete, appsScriptUrl });
  if (!del.ok) return { ...del, nothing: false };
  try {
    const after = await fetchResponsesCsv();
    const live = after.parsed.records;
    let remaining = 0;
    for (const t of entry.pendingDelete) {
      const tn = normName(t.s);
      if (live.some((r) => r.timestamp === t.t && (r.supervisorNorm || normName(r.supervisor)) === tn)) remaining++;
    }
    const hdr = after.parsed.header || [];
    const headerOk = hdr.length > 0 && String(hdr[0] || '').toLowerCase().includes('timestamp');
    const ok = remaining === 0 && headerOk;
    updateEntry(entry.id, {
      deleted: (entry.deleted || 0) + (entry.pendingDelete.length - remaining),
      pendingDelete: ok ? null : entry.pendingDelete,
      status: ok ? 'مكتمل' : 'جزئي',
      detail: ok ? 'أُكمل الحذف بإعادة المحاولة' : 'إعادة المحاولة: متبقي=' + remaining,
    });
    logAdd('ترحيل الأسبوع', 'إعادة محاولة الحذف: ' + (ok ? 'اكتمل' : 'متبقي=' + remaining));
    return { ok, remaining, headerOk, deleted: entry.pendingDelete.length - remaining };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/* ---------- سجل الترحيل المهيكل (§29) ---------- */

function saveEntry({ week, plan, written, verify, user, deleted, deleteExpected, status, pendingDelete, untargeted, detail }) {
  const entry = {
    id: uid(),
    ts: Date.now(),
    time: formatDateTime(new Date()),
    weekStart: week.start,
    weekLabel: week.label,
    records: plan.keep.length,
    supervisors: new Set(plan.keep.map((r) => r.supervisorNorm)).size,
    added: written.appended,
    skippedServer: written.skipped || 0,
    verified: verify.found,
    verifiedExpected: verify.expected,
    deleted,
    deleteExpected,
    untargeted: untargeted || 0,
    status,
    user: user || '—',
    nextWeekLabel: '',
    pendingDelete: pendingDelete && pendingDelete.length ? pendingDelete : null,
    detail: detail || '',
  };
  const nk = nextWeek(week);
  entry.nextWeekLabel = nk ? nk.label : '';
  const list = storeGet(CFG.storage.migrations, []);
  list.unshift(entry);
  if (list.length > 100) list.length = 100;
  storeSet(CFG.storage.migrations, list);
  return entry;
}

function updateEntry(id, patch) {
  const list = storeGet(CFG.storage.migrations, []);
  const i = list.findIndex((e) => e.id === id);
  if (i >= 0) {
    list[i] = { ...list[i], ...patch };
    storeSet(CFG.storage.migrations, list);
    return list[i];
  }
  return null;
}

export function migrationList() {
  return storeGet(CFG.storage.migrations, []);
}

export function migrationHistory(limit) {
  const out = migrationList();
  return limit ? out.slice(0, limit) : out;
}

export function migrationHistoryRows(limit) {
  return migrationHistory(limit).map((e) => [
    e.time,
    e.weekLabel,
    String(e.records),
    String(e.deleted || 0) + '/' + (e.deleteExpected || 0),
    e.status,
    e.user || '—',
  ]);
}

export function historyForWeek(weekStart) {
  return migrationList().filter((e) => e.weekStart === weekStart);
}

export function pendingDeleteEntry() {
  return migrationList().find((e) => e.pendingDelete && e.pendingDelete.length) || null;
}
