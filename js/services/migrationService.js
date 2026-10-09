/* MigrationService — خوارزمية الترحيل الآمن §38 كاملةً
   1) قراءة الردود  2) مطابقة بالاسم فقط  3) الترويسة  4) منع التكرار
   5) إضافة الصفوف للأرشيف (مطابقة أعمدة الأرشيف بالاسم + أعمدة ناقصة)
   6) إعادة قراءة الأرشيف والتحقق
   7) مقارنة عدد السجلات قبل/بعد  8) حذف الصفوف المرحّلة من الردود (فقط بعد التحقق)
   9) التحقق من الحذف وسلامة الترويسة وبقاء السجلات غير المستهدفة
   10) تحديث ترويسة الردود إلى الأسبوع الجديد (صف الترويسة فقط)
   11) تسجيل العملية في سجل الترحيل
   قاعدة حاكمة: لا يُحذف أي صف من الردود قبل إثبات وصوله للأرشيف. */

import { CFG } from '../config.js';
import { normName, formatDateTime, uid, storeGet, storeSet } from '../utils.js';
import { responsesOfWeek, splitByMaster, typeCounts } from './responsesService.js';
import { dedupeAgainstExisting, recordKey } from './duplicateService.js';
import { nextWeek } from './weekService.js';
import { topHeaderRow, headerMapFor, alignRowsToHeader } from './headerService.js';
import { appendData, deleteResponseRows, fetchArchiveCsv, fetchResponsesCsv, updateHeaderWeek } from './sheetsService.js';
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
   صفوف بتنسيق ردود الاستمارة تُطابق أولاً بأسماء أعمدة ترويسة الأرشيف الفعلية (خطوة 4-5):
   الحقول في أعمدتها بسميتها لا بترتيبها، والعمود الناقص يُضاف في خلية ترويسة فارغة أو نهاية
   الترويسة — دون مس البيانات التاريخية. ترويسة واحدة أعلى الملف فقط إذا كان الملف فارغاً. */
export function planMigration({ archive, archiveHeader, records, week, data }) {
  const { keep, skipped } = dedupeAgainstExisting(archive || [], records || []);
  const headerNeeded = keep.length > 0 && !(archive || []).length;
  const headerRow = headerNeeded ? topHeaderRow(data, week && week.label) : null;
  const sourceRows = keep.map(recordToResponsesRow);
  /* مصدر المطابقة: ترويسة الأرشيف الحية، وإلا الترويسة التي ستُكتب للملف الفارغ */
  const baseHeader = (archiveHeader && archiveHeader.length) ? archiveHeader : headerRow;
  const al = alignRowsToHeader(baseHeader || [], sourceRows);
  return {
    rows: al.rows,
    sourceRows,
    keep,
    skipped,
    headerNeeded,
    headerRow,
    headerCells: al.headerCells,
    headerOut: al.headerOut,
    headerPatch: al.headerPatch,
    headerExtend: al.headerExtend,
    headerAligned: al.aligned,
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
  const plan = planMigration({
    archive,
    archiveHeader: (data && data.admin && data.admin.header) || null,
    records: toMigrate,
    week,
    data,
  });
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
  const plan = planMigration({
    archive: freshArchive.records,
    archiveHeader: freshArchive.header || null,
    records: toMigrate,
    week: wk,
    data,
  });

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

  /* المرحلة 5: الإضافة (الأرشيف فقط) — بالصفوف المطابقة أسماء أعمدة الترويسة */
  const written = await appendData({
    rows: plan.rows,
    markerRow: plan.keep[0].supervisor,
    weekLabel: wk.label,
    headerRow: plan.headerRow,
    headerCells: plan.headerCells,
    headerPatch: plan.headerPatch,
    headerExtend: plan.headerExtend,
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
  const nk = nextWeek(wk);
  const pendingHeaderWeek = nk ? { oldLabel: wk.label, newLabel: nk.label } : null;

  const del = await deleteResponseRows({ rows: delTargets, appsScriptUrl });
  if (!del.ok) {
    const entry = saveEntry({
      week: wk, plan, written, verify, user,
      deleted: 0, deleteExpected: delTargets.length,
      status: 'جزئي', pendingDelete: delTargets, untargeted,
      deleteTargets: delTargets,
      started, headerSnapshot: freshResponses.parsed.header || [],
      pendingHeaderWeek, headerWeekUpdated: false,
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
      deleteOk: false,
      headerWeekUpdated: false,
      entry,
      nextWeek: nextWeek(wk),
      ms: ms(),
      week: wk,
      deleteAttempted: true,
      logged: true,
    };
  }

  /* المرحلة 9: التحقق من الحذف وسلامة الترويسة وبقاء أي سجلات غير مستهدفة في الردود */
  const targetKeys = new Set(delTargets.map((t) => t.t + '\u0001' + normName(t.s)));
  const keyOfResp = (r) => (r.timestamp || '') + '\u0001' + (r.supervisorNorm || normName(r.supervisor));
  const othersBefore = (freshResponses.parsed.records || [])
    .filter((r) => !targetKeys.has(keyOfResp(r)))
    .map(recordKey);
  let delVerify;
  try {
    const afterResp = await fetchResponsesCsv();
    const live = afterResp.parsed.records;
    let remaining = 0;
    for (const t of delTargets) {
      const tn = normName(t.s);
      if (live.some((r) => r.timestamp === t.t && (r.supervisorNorm || normName(r.supervisor)) === tn)) remaining++;
    }
    const afterKeys = new Set(live.map(recordKey));
    let othersLost = 0;
    for (const k of othersBefore) if (!afterKeys.has(k)) othersLost++;
    const hdr = afterResp.parsed.header || [];
    const headerOk = hdr.length > 0 &&
      String(hdr[0] || '').toLowerCase().includes('timestamp') &&
      String(hdr[1] || '').includes('اسم المشرف');
    delVerify = { ok: remaining === 0 && headerOk && othersLost === 0, remaining, headerOk, othersLost, othersBefore: othersBefore.length };
  } catch (e) {
    delVerify = { ok: false, remaining: delTargets.length, headerOk: false, othersLost: -1, error: String((e && e.message) || e) };
  }

  const deleteOk = delVerify.ok;

  /* المرحلة 10: تحديث ترويسة الردود إلى الأسبوع الجديد — صف الترويسة فقط، وبعد نجاح الحذف والتحقق */
  let headerRes = null;
  if (deleteOk && untargeted === 0 && nk) {
    headerRes = await updateHeaderWeek({ oldLabel: wk.label, newLabel: nk.label, appsScriptUrl });
  }
  const headerWeekUpdated = !!(headerRes && headerRes.ok);
  const headerPending = nk && !headerWeekUpdated;

  const entry = saveEntry({
    week: wk,
    plan,
    written,
    verify,
    user,
    deleted: delTargets.length - (delVerify.remaining || 0),
    deleteExpected: delTargets.length,
    status: deleteOk && untargeted === 0 && !headerPending ? 'مكتمل' : 'جزئي',
    pendingDelete: deleteOk ? null : delTargets,
    untargeted,
    deleteTargets: delTargets,
    started,
    headerSnapshot: freshResponses.parsed.header || [],
    pendingHeaderWeek: headerPending && nk ? { oldLabel: wk.label, newLabel: nk.label } : null,
    headerWeekUpdated,
    detail: deleteOk
      ? (headerPending
        ? 'تم الترحيل والحذف — تحديث ترويسة الأسبوع الجديد لم يكتمل: ' + ((headerRes && (headerRes.code || headerRes.error)) || '')
        : 'تم الترحيل والحذف والتحقق' + (nk ? ' وتحديث ترويسة الأسبوع الجديد' : ''))
      : 'الحذف لم يكتمل: متبقي=' + (delVerify.remaining || 0) + ' ترويسة=' + (delVerify.headerOk ? 'سليمة' : 'ناقصة') +
        (delVerify.othersLost ? ' · سجلات أخرى مفقودة=' + delVerify.othersLost : ''),
  });

  logAdd('ترحيل الأسبوع', 'الأسبوع ' + wk.label +
    ' · أُضيف=' + written.appended + ' · تحقق=' + verify.found + '/' + verify.expected +
    ' · محذوف=' + entry.deleted + '/' + delTargets.length +
    ' · ترويسة الأسبوع الجديد=' + (nk ? (headerWeekUpdated ? 'محدَّثة' : 'بانتظار التحديث') : 'لا حاجة') +
    ' · الحالة=' + entry.status + orphNote,
    { op: 'ترحيل', week: wk.label, count: written.appended, user: user || '—', status: entry.status });

  return {
    ok: true,
    appended: written.appended,
    skipped: written.skipped,
    headerWritten: !!written.headerWritten,
    headerPatched: written.headerPatched | 0,
    headerExtended: written.headerExtended | 0,
    headerAligned: !!plan.headerAligned,
    verify,
    deleted: entry.deleted,
    deleteExpected: delTargets.length,
    deleteOk,
    headerPresent: delVerify.headerOk,
    remaining: delVerify.remaining || 0,
    othersLost: delVerify.othersLost | 0,
    untargeted,
    headerWeekUpdated,
    headerWeek: nk ? { oldLabel: wk.label, newLabel: nk.label } : null,
    headerUpdateError: headerRes && !headerRes.ok ? (headerRes.code || headerRes.error) : '',
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
    /* اكتمل الحذف ← جرّب تجهيز ترويسة الأسبوع الجديد إن كانت بانتظاره */
    let headerWeekUpdated = !!entry.headerWeekUpdated;
    let headerResult = null;
    if (ok && entry.pendingHeaderWeek) {
      headerResult = await updateHeaderWeek({ ...entry.pendingHeaderWeek, appsScriptUrl });
      headerWeekUpdated = !!(headerResult && headerResult.ok);
    }
    const headerPending = ok && !!entry.pendingHeaderWeek && !headerWeekUpdated;
    updateEntry(entry.id, {
      deleted: (entry.deleted || 0) + (entry.pendingDelete.length - remaining),
      pendingDelete: ok ? null : entry.pendingDelete,
      status: ok && !headerPending ? 'مكتمل' : 'جزئي',
      pendingHeaderWeek: ok ? (headerPending ? entry.pendingHeaderWeek : null) : entry.pendingHeaderWeek,
      headerWeekUpdated,
      detail: ok
        ? (headerPending
          ? 'أُكمل الحذف — تحديث ترويسة الأسبوع الجديد لم يكتمل: ' + ((headerResult && (headerResult.code || headerResult.error)) || '')
          : 'أُكمل الحذف بإعادة المحاولة' + (entry.pendingHeaderWeek ? ' مع تجهيز ترويسة الأسبوع الجديد' : ''))
        : 'إعادة المحاولة: متبقي=' + remaining,
    });
    logAdd('ترحيل الأسبوع', 'إعادة محاولة الحذف: ' + (ok ? 'اكتمل' : 'متبقي=' + remaining) +
      (headerPending ? ' · الترويسة بانتظار التحديث' : (headerWeekUpdated && entry.pendingHeaderWeek ? ' · حدُّثت ترويسة الأسبوع الجديد' : '')));
    return { ok, remaining, headerOk, deleted: entry.pendingDelete.length - remaining, headerWeekUpdated, headerPending };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/* إعادة محاولة تجهيز ترويسة الأسبوع الجديد وحده (عند فشلها بعد نجاح الترحيل) */
export async function retryHeaderWeek(entry, appsScriptUrl) {
  if (!entry || !entry.pendingHeaderWeek) return { ok: true, nothing: true };
  const ph = entry.pendingHeaderWeek;
  const r = await updateHeaderWeek({ oldLabel: ph.oldLabel, newLabel: ph.newLabel, appsScriptUrl });
  if (r.ok) {
    const stillPendingDelete = !!(entry.pendingDelete && entry.pendingDelete.length);
    updateEntry(entry.id, {
      headerWeekUpdated: true,
      pendingHeaderWeek: null,
      status: stillPendingDelete ? entry.status : 'مكتمل',
      detail: 'تم تجهيز ترويسة الأسبوع الجديد (' + ph.newLabel + ') بإعادة المحاولة',
    });
    logAdd('ترحيل الأسبوع', 'إعادة محاولة ترويسة الأسبوع الجديد: تم التحديث إلى ' + ph.newLabel);
  } else {
    logAdd('ترحيل الأسبوع', 'إعادة محاولة ترويسة الأسبوع الجديد فشلت: ' + (r.code || '') + ' ' + (r.error || ''));
  }
  return r;
}

/* ---------- سجل الترحيل المهيكل (§29) ---------- */

function saveEntry({ week, plan, written, verify, user, deleted, deleteExpected, status, pendingDelete, untargeted, detail, deleteTargets, started, headerSnapshot, pendingHeaderWeek, headerWeekUpdated }) {
  const list = storeGet(CFG.storage.migrations, []);
  const entry = {
    id: uid(),
    opNo: list.length + 1,
    ts: Date.now(),
    startedTs: started || Date.now(),
    finishedTs: Date.now(),
    durationMs: started ? Date.now() - started : 0,
    time: formatDateTime(new Date()),
    weekStart: week.start,
    weekEnd: week.end || '',
    weekLabel: week.label,
    records: plan.keep.length,
    supervisors: new Set(plan.keep.map((r) => r.supervisorNorm)).size,
    supervisorsList: Array.from(new Set(plan.keep.map((r) => r.supervisor))).slice(0, 50),
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
    /* ترويسة ملف الردود وقت العملية — نسخة احتياطية للاستعادة إن لزم */
    headerSnapshot: (headerSnapshot || []).slice(),
    /* تجهيز ترويسة الأسبوع الجديد: معلّق إلى أن ينجح التحديث فعلياً */
    pendingHeaderWeek: pendingHeaderWeek || null,
    headerWeekUpdated: !!headerWeekUpdated,
    detail: detail || '',
    /* معرّفات وصفوف العملية نفسها — أساس التراجع الآمن (§8): لا حذف عشوائي */
    migratedKeys: plan.keep.map(recordKey),
    migratedRows: (plan.sourceRows || plan.rows).slice(),
    deleteTargets: (deleteTargets || []).map((t) => ({ t: t.t, s: t.s })),
  };
  const nk = nextWeek(week);
  entry.nextWeekLabel = nk ? nk.label : '';
  list.unshift(entry);
  if (list.length > (CFG.migrationKeep || 100)) list.length = CFG.migrationKeep || 100;
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

/* ============ التراجع عن آخر عملية ترحيل (§6-§11) ============
   قاعدة حاكمة: لا يُنفَّذ التراجع إلا بتحديد 100% لسجلات العملية نفسها.
   أي شك ⇒ إيقاف كامل دون لمس أي بيانات. */

/* آخر عملية ناجحة وقابلة للتراجع (لا تراجع عن الأقدم إذا وُجد أحدث) */
export function lastUndoableEntry() {
  const list = migrationList();
  return list.find((e) =>
    e.status === 'مكتمل' &&
    !(e.pendingDelete && e.pendingDelete.length) &&
    e.migratedKeys && e.migratedKeys.length &&
    e.migratedRows && e.migratedRows.length &&
    e.deleteTargets && e.deleteTargets.length
  ) || null;
}

/* مانع التراجع (منطق خالص) — يُرجع رسالة التوقف أو null إذا كانت العملية صالحة */
export function undoBlockReason(entry, list) {
  if (!entry) return CFG.texts.undoNoEntry;
  const all = list || migrationList();
  if (entry.status === 'REVERSED') return CFG.texts.undoUndone;
  if (entry.status !== 'مكتمل') return CFG.texts.undoIncomplete;
  if (entry.pendingDelete && entry.pendingDelete.length) return CFG.texts.undoIncomplete;
  const newer = all.find((e) =>
    e.id !== entry.id && e.ts > entry.ts &&
    e.status === 'مكتمل' && !(e.pendingDelete && e.pendingDelete.length));
  if (newer) return CFG.texts.undoNewer;
  if (!entry.migratedKeys || !entry.migratedKeys.length ||
      !entry.migratedRows || !entry.migratedRows.length ||
      !entry.deleteTargets || !entry.deleteTargets.length) return CFG.texts.undoNoKeys;
  return null;
}

/* تحقق بحت: كل مفاتيح العملية موجودة في الأرشيف؟ (منطق خالص) */
export function verifyKeysInArchive(entry, archiveRecords) {
  const expected = (entry && entry.migratedKeys) || [];
  const keys = new Set((archiveRecords || []).map(recordKey));
  let found = 0;
  for (const k of expected) if (keys.has(k)) found++;
  return { ok: expected.length > 0 && found === expected.length, found, expected: expected.length };
}

/* الأسبوع السابق لعملية الترحيل (الأسابيع مرتّبة تنازلياً) */
export function weekBeforeEntry(entry, weeks) {
  const list = weeks || [];
  const i = list.findIndex((w) => entry && w.start === entry.weekStart);
  if (i >= 0 && i + 1 < list.length) return list[i + 1];
  return null;
}

/* تنفيذ التراجع: تحقق ← استرجاع الردود ← تحقق ← حذف من الأرشيف ← تحقق ← REVERSED */
export async function executeUndo({ entry, appsScriptUrl, user }) {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const target = entry || lastUndoableEntry();

  const reason = undoBlockReason(target);
  if (reason) return { ok: false, code: 'BLOCKED', error: reason, ms: ms() };
  if (!appsScriptUrl) {
    return { ok: false, code: 'NOT_CONFIGURED', error: 'لم يتم ضبط رابط Apps Script بعد (الإعدادات ← ربط الكتابة).', ms: ms() };
  }

  /* (1) قراءة طازجة للأرشيف والتحقق 100% من سجلات العملية */
  let freshArchive;
  try {
    freshArchive = await fetchArchiveCsv();
  } catch (e) {
    return { ok: false, code: 'READ_ERROR', error: CFG.texts.undoAbort, detail: String((e && e.message) || e), ms: ms() };
  }
  const check = verifyKeysInArchive(target, freshArchive.records);
  if (!check.ok) {
    logAdd('تراجع عن ترحيل', 'أُوقف قبل أي تعديل — تحقق الأرشيف ' + check.found + '/' + check.expected);
    return { ok: false, code: 'VERIFY_FAILED', error: CFG.texts.undoAbort, verify: check, ms: ms() };
  }

  /* (2) استرجاع سجلات الردود — قبل أي حذف */
  const restore = await appendData({
    rows: target.migratedRows,
    weekLabel: target.weekLabel,
    headerRow: null,
    appsScriptUrl,
    sheetId: CFG.sheetIds.programs,
  });
  if (!restore.ok) {
    logAdd('تراجع عن ترحيل', 'فشل استرجاع الردود: ' + (restore.code || '') + ' ' + (restore.error || ''));
    return { ok: false, code: 'RESTORE_FAILED', error: restore.error || CFG.texts.undoAbort, archiveIntact: true, ms: ms() };
  }

  /* (3) التحقق من عودة السجلات إلى ملف الردود */
  let restoreCheck;
  try {
    const resp = await fetchResponsesCsv();
    const keys = new Set(resp.parsed.records.map(recordKey));
    let found = 0;
    for (const k of target.migratedKeys) if (keys.has(k)) found++;
    restoreCheck = { ok: found === target.migratedKeys.length, found, expected: target.migratedKeys.length };
  } catch (e) {
    restoreCheck = { ok: false, found: -1, expected: target.migratedKeys.length, error: String((e && e.message) || e) };
  }
  if (!restoreCheck.ok) {
    logAdd('توقف التراجع', 'تحقّق استرجاع الردود ' + restoreCheck.found + '/' + restoreCheck.expected + ' — الأرشيف لم يُمس');
    return {
      ok: false, code: 'RESTORE_VERIFY_FAILED', error: CFG.texts.undoAbort,
      verify: restoreCheck, restored: restore.appended, archiveIntact: true, ms: ms(),
    };
  }

  /* (4) حذف سجلات العملية من الأرشيف حصراً (مفاتيح محفوظة — لا حذف عشوائي) */
  const del = await deleteResponseRows({
    rows: target.deleteTargets,
    appsScriptUrl,
    sheetId: CFG.sheetIds.admin,
  });
  if (!del.ok) {
    logAdd('تراجع عن ترحيل', 'استُرجعت الردود لكن فشل حذف الأرشيف: ' + (del.code || '') + ' ' + (del.error || ''));
    return { ok: false, code: 'ARCHIVE_DELETE_FAILED', error: del.error || 'تعذّر حذف سجلات العملية من الأرشيف.', restored: true, ms: ms() };
  }

  /* (5) التحقق من حذف سجلات العملية فقط */
  let delCheck;
  try {
    const after = await fetchArchiveCsv();
    const keys = new Set(after.records.map(recordKey));
    let remaining = 0;
    for (const k of target.migratedKeys) if (keys.has(k)) remaining++;
    delCheck = { ok: remaining === 0, remaining, deleted: del.deleted };
  } catch (e) {
    delCheck = { ok: false, remaining: -1, error: String((e && e.message) || e) };
  }
  if (!delCheck.ok) {
    logAdd('تراجع عن ترحيل', 'تحقّق حذف الأرشيف: متبقي=' + delCheck.remaining);
    return { ok: false, code: 'ARCHIVE_VERIFY_FAILED', error: CFG.texts.undoAbort, verify: delCheck, restored: true, ms: ms() };
  }

  /* (5-ب) إن كان الترحيل قد حدّث ترويسة الردود إلى الأسبوع الجديد — أعِدها إلى أسبوعها */
  let headerReverted = null;
  if (target.headerWeekUpdated && target.nextWeekLabel && target.weekLabel) {
    const hr = await updateHeaderWeek({ oldLabel: target.nextWeekLabel, newLabel: target.weekLabel, appsScriptUrl });
    headerReverted = !!hr.ok;
    if (!hr.ok) logAdd('تراجع عن ترحيل', 'تعذّر إرجاع ترويسة الردود إلى ' + target.weekLabel + ': ' + (hr.code || ''));
  }

  /* (6) تحديث سجل العملية إلى REVERSED — السجل نفسه لا يُحذف */
  const updated = updateEntry(target.id, {
    status: 'REVERSED',
    reversedAt: formatDateTime(new Date()),
    reversedBy: user || '—',
    headerReverted,
    undoDetail: 'استُرجع ' + target.migratedKeys.length + ' سجل إلى الردود وحُذفت من الأرشيف' +
      (headerReverted === true ? ' وعُدّت ترويسة الردود إلى ' + target.weekLabel
        : headerReverted === false ? ' — تعذّر إرجاع ترويسة الردود' : ''),
  });
  logAdd('تراجع عن ترحيل',
    'الأسبوع ' + target.weekLabel + ' · استُرجع=' + target.migratedKeys.length +
    ' · حُذف من الأرشيف=' + del.deleted + ' · الحالة=REVERSED',
    { op: 'تراجع', week: target.weekLabel, count: target.migratedKeys.length, user: user || '—', status: 'تم التراجع' });

  return {
    ok: true,
    entry: updated,
    count: target.migratedKeys.length,
    restored: restore.appended,
    restoredSkipped: restore.skipped || 0,
    deleted: del.deleted,
    headerReverted,
    weekLabel: target.weekLabel,
    weekStart: target.weekStart,
    ms: ms(),
  };
}
