/* اختبارات المنطق — 22 سيناريو من مواصفات المشروع (بيانات حقيقية + حالات حدية) */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/* localStorage mock (يجب قبل أي استخدام) */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { CFG } = await import('../js/config.js');
const U = await import('../js/utils.js');
const M = await import('../js/models.js');
const SS = await import('../js/services/sheetsService.js');
const ST = await import('../js/services/statusService.js');
const SMS = await import('../js/services/smsService.js');
const EX = await import('../js/services/exportService.js');
const RP = await import('../js/services/reportService.js');
const LOG = await import('../js/services/logService.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
};

const NC = '&nc=' + Date.now();
const [listsTxt, adminTxt, programsTxt] = await Promise.all([
  fetch(CFG.sheets.lists + NC).then((r) => r.text()),
  fetch(CFG.sheets.admin + NC).then((r) => r.text()),
  fetch(CFG.sheets.programs + NC).then((r) => r.text()),
]);

const lists = M.parseListsCsv(listsTxt);
const admin = M.parseAdminCsv(adminTxt);
const programs = M.parseProgramsCsv(programsTxt);
const master = M.buildMasterSupervisors(lists, admin.records, programs.records);
const weeks = M.allWeeks(admin.weeks, programs.headerWeek, programs.records);
const records = admin.records.concat(programs.records);

/* 1) تحميل المشرفين */
ok('1. تحميل المشرفين', master.length >= 30 && master.every((s) => s.name), master.length + ' مشرف');

/* 2) تحميل المدارس */
ok('2. تحميل المدارس', lists.schools.length >= 100, lists.schools.length + ' مدرسة');

/* 3) تحميل البرامج */
ok('3. تحميل البرامج', admin.records.length > 900 && programs.records.length > 0,
  'أرشيف=' + admin.records.length + ' حي=' + programs.records.length);

/* 4) اختيار الأسبوع */
{
  const w = U.parseWeekLabel('4/10-10/10 [الاحد]');
  const isSun = new Date(w.start).getDay() === 0;
  const def = M.defaultWeek(weeks, new Date('2026-10-06T12:00:00'));
  const bad = U.parseWeekLabel('ليس أسبوعاً');
  ok('4. اختيار الأسبوع', w && isSun && w.end > w.start && def && def.label === '4/10-10/10' && bad === null,
    'default=' + (def && def.label));
}

/* 5-7) حالات الإرسال لكل أسبوع */
{
  const wk = weeks.find((x) => x.label === '27/9-3/10') || weeks[0];
  const st = ST.computeStatus(master, records, wk, {});
  const planningOk = st.rows.some((r) => r.sentPlanning);
  const actualOk = st.rows.some((r) => r.sentActual);
  const noneOk = st.rows.some((r) => !r.sentPlanning && !r.sentActual);
  ok('5. حد من أرسل التخطيط', planningOk && st.stats.planning === st.rows.filter((r) => r.sentPlanning).length,
    'planning=' + st.stats.planning);
  ok('6. حد من أرسل الفعلي', actualOk && st.stats.actual === st.rows.filter((r) => r.sentActual).length,
    'actual=' + st.stats.actual);
  ok('7. حد من لم يرسل', noneOk && st.stats.notPlanning + st.stats.planning === st.stats.total,
    'none=' + (st.stats.total - st.stats.planning - st.stats.actual + st.rows.filter((r) => r.sentPlanning && r.sentActual).length));
  ok('5-7. اتساق الإحصائيات', st.stats.planning + st.stats.notPlanning === st.stats.total &&
    st.stats.actual + st.stats.notActual === st.stats.total &&
    st.stats.completion >= 0 && st.stats.completion <= 100, 'completion=' + st.stats.completion);
}

/* 8) البحث عن مشرف */
{
  const st = ST.computeStatus(master, records, weeks[0], {});
  const byFull = ST.filterRows(st.rows, { filter: 'all', query: 'هناء' });
  const byPart = ST.filterRows(st.rows, { filter: 'all', query: 'محمد' });
  const byId = ST.filterRows(st.rows, { filter: 'all', query: '568621477' });
  ok('8. البحث عن مشرف', byFull.length >= 1 && byPart.length >= 2 && byId.length === 1,
    'هناء=' + byFull.length + ' محمد=' + byPart.length + ' id=' + byId.length);
}

/* 9) عرض تفاصيل الأسبوع */
{
  const target = admin.records.find((r) => r.type === CFG.typePlanning && r.weekStart);
  const recs = M.recordsForSupervisor(records, target.supervisorNorm, target.week);
  const plan = M.lastRecordOfType(recs, CFG.typePlanning);
  ok('9. تفاصيل الأسبوع', recs.length >= 1 && plan && plan.days.length === 6,
    target.supervisor.slice(0, 20) + ' recs=' + recs.length);
}

/* 10-13) SMS: مفرد/متعدد/الجميع/نص معدّل */
{
  const rows = master.slice(0, 1).map((s, i) => ({
    name: s.name, nameNorm: s.nameNorm, id: s.id, phone: i === 0 ? '771234567' : '',
  }));
  const rec1 = SMS.resolveRecipients(rows, {});
  const msg1 = SMS.buildMessage(SMS.templateFor(CFG.typePlanning), { week: weeks[0], type: CFG.typePlanning, supervisor: rows[0].name });
  const msgNamed = SMS.buildMessage('أهلاً {المشرف} — {الاسبوع}', { week: weeks[0], type: CFG.typePlanning, supervisor: rows[0].name });
  ok('10. رسالة لمشرف واحد',
    rec1.entries.length === 1 && rec1.withPhone.length === 1 &&
    msg1.includes(weeks[0].label) && msg1.includes('السلام عليكم') && msgNamed.includes(rows[0].name),
    'phone=' + rec1.withPhone[0].phone);

  const multi = master.slice(0, 5).map((s) => ({ name: s.name, nameNorm: s.nameNorm, id: s.id, phone: '' }));
  const rec5 = SMS.resolveRecipients(multi, { [master[0].nameNorm]: '733333333' });
  ok('11. اختيار عدة مشرفين', rec5.entries.length === 5 && rec5.withPhone.length === 1 && rec5.withphone === undefined,
    'withPhone=' + rec5.withPhone.length);

  const all = SMS.resolveRecipients(master.map((s) => ({ name: s.name, nameNorm: s.nameNorm, id: s.id, phone: '' })), {});
  ok('12. إرسال للجميع', all.entries.length === master.length, all.entries.length + '');

  const custom = 'نص معدّل: {المشرف} / {النوع}';
  const msgC = SMS.buildMessage(custom, { week: weeks[0], type: CFG.typeActual, supervisor: 'أحمد' });
  ok('13. تعديل نص الرسالة', msgC === 'نص معدّل: أحمد / الفعلي', JSON.stringify(msgC));

  ok('13b. تأكيد قبل الإرسال', SMS.confirmText(15).includes('15 مشرفًا'), SMS.confirmText(15));
}

/* 14-15) تصدير Sheets + منع التكرار */
{
  const wk = admin.weeks[0];
  const some = admin.records.filter((r) => r.weekStart === wk.start).slice(0, 3);
  const planDup = EX.buildExportPlan(admin.records, some, wk);
  ok('14. تصدير Google Sheets — لا رأس عند وجود القسم',
    planDup.keep.length === 0 && planDup.skipped === 3 && planDup.needsHeader === false,
    'keep=' + planDup.keep.length + ' skip=' + planDup.skipped);

  const fakeWeek = { start: '2099-10-04', end: '2099-10-10', label: '4/10-10/10' };
  const newRecs = [
    { supervisor: 'اختبار تكرار', supervisorNorm: U.normName('اختبار تكرار'), weekStart: fakeWeek.start, type: 'تخطيط',
      days: [{ school: 'م1', activity: 'ف1' }, { school: '', activity: '' }, { school: '', activity: '' }, { school: '', activity: '' }, { school: '', activity: '' }, { school: '', activity: '' }], notes: '', code: '', source: 'programs' },
    { supervisor: 'اختبار تكرار', supervisorNorm: U.normName('اختبار تكرار'), weekStart: fakeWeek.start, type: 'تخطيط',
      days: [{ school: 'م1', activity: 'ف1' }, { school: '', activity: '' }, { school: '', activity: '' }, { school: '', activity: '' }, { school: '', activity: '' }, { school: '', activity: '' }], notes: 'نسخة مكررة', code: '', source: 'programs' },
  ];
  const planNew = EX.buildExportPlan([], newRecs, fakeWeek);
  ok('15. منع التكرار (نفس المفتاح يُحذف) + رأس أسبوع جديد',
    planNew.keep.length === 1 && planNew.skipped === 1 && planNew.needsHeader === true &&
    planNew.rows.length === 2 && planNew.rows[0][0] === CFG.magicHeader &&
    planNew.rows[0][1].includes('4/10-10/10') && planNew.rows[1].length === 16,
    'keep=' + planNew.keep.length + ' skip=' + planNew.skipped + ' rows=' + planNew.rows.length);

  /* الأسبوع المختلف بنفس المحتوى = سجل جديد (لا كاذب-تكرار) */
  const otherWeek = { ...fakeWeek, start: '2099-10-11', end: '2099-10-17' };
  const recOther = { ...newRecs[0], weekStart: otherWeek.start };
  const planOther = EX.buildExportPlan([{ ...newRecs[0] }], [recOther], otherWeek);
  ok('15b. الأسبوع المختلف ليس تكراراً', planOther.keep.length === 1, 'keep=' + planOther.keep.length);
}

/* 16) استيراد/تحديث البيانات من الكاش */
{
  const cached = SS.getDataFromCache();
  ok('16. استيراد البيانات من الكاش',
    !cached || (cached.master.length > 0 && cached.weeks.length > 0),
    cached ? 'master=' + cached.master.length : 'لا كاش بعد');
}

/* 17) تصدير Excel حقيقي */
{
  /* تحميل xlsx كما في المتصفح (سكربت عام) — require يعيد {} لهذا الملف الخام */
  const fsMod = await import('node:fs');
  const vmMod = await import('node:vm');
  vmMod.runInThisContext(
    fsMod.readFileSync(new URL('../vendor/xlsx.full.min.js', import.meta.url), 'utf8'),
    { filename: 'xlsx.full.min.js' },
  );
  if (!globalThis.XLSX || !globalThis.XLSX.utils) {
    globalThis.XLSX = require('../vendor/xlsx.full.min.js');
  }
  const wk = weeks[0];
  const st = ST.computeStatus(master, records, wk, {});
  const payload = {
    summary: st.stats,
    statusRows: st.rows,
    detailRows: RP.flattenDetail(records.filter((r) => r.weekStart === wk.start)).slice(0, 50),
    planningRows: records.filter((r) => r.weekStart === wk.start && r.type === CFG.typePlanning),
    actualRows: records.filter((r) => r.weekStart === wk.start && r.type === CFG.typeActual),
  };
  try {
    const wb = EX.buildExcelWorkbook(payload);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const bytes = new Uint8Array(buf);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B;
    ok('17. تصدير Excel (ملف xlsx حقيقي)',
      wb.SheetNames.length === 5 && isZip && bytes.length > 3000,
      'sheets=' + wb.SheetNames.join(',') + ' size=' + bytes.length);
  } catch (e) {
    ok('17. تصدير Excel (ملف xlsx حقيقي)', false, String(e));
  }
}

/* 18) التقارير */
{
  const wk = weeks[0];
  const rep = RP.buildStatusReport(master, records, wk, {}, 'none');
  const filtered = RP.filterRecords(records, { weekStart: wk.start, type: CFG.typePlanning });
  const table = RP.reportTable(rep.rows);
  ok('18. التقارير',
    table.head.length === 6 && rep.rows.every((r) => !r.sentPlanning && !r.sentActual) &&
    filtered.every((r) => r.type === CFG.typePlanning),
    'rows=' + rep.rows.length + ' filtered=' + filtered.length);

  const fromTo = RP.filterRecords(records, { from: '2026-09-27', to: '2026-10-10' });
  ok('18b. فلترة التاريخ من-إلى', fromTo.length > 0 && fromTo.every((r) => r.week.end >= '2026-09-27' && r.week.start <= '2026-10-10'),
    fromTo.length + ' سجل');
}

/* 19) تحديث البيانات (شبكة حقيقية) */
{
  const data = await SS.getData({ force: true });
  ok('19. تحديث البيانات',
    data && data.master.length >= 30 && data.weeks.length >= 30 && !data.offline,
    'master=' + data.master.length + ' weeks=' + data.weeks.length);
}

/* 20) انقطاع الإنترنت */
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const offline = await SS.getData({ force: true });
    ok('20. انقطعت الشبكة → كاش محلي',
      offline && offline.offline === true && offline.master.length > 0,
      'offline=' + offline.offline + ' master=' + (offline && offline.master.length));
  } catch (e) {
    ok('20. انقطعت الشبكة → كاش محلي', false, 'throw: ' + e.message);
  } finally {
    globalThis.fetch = origFetch;
  }
}

/* 21) ملف Google Sheets فارغ */
{
  const emptyAdmin = M.parseAdminCsv('');
  const emptyLists = M.parseListsCsv('');
  const emptyProg = M.parseProgramsCsv('');
  const stEmpty = ST.computeStatus([{ name: 'أ', nameNorm: 'أ', id: '' }], [], null, {});
  ok('21. ملف فارغ',
    emptyAdmin.records.length === 0 && emptyLists.schools.length === 0 && emptyProg.records.length === 0 &&
    stEmpty.stats.total === 1 && stEmpty.stats.planning === 0 && stEmpty.rows[0].status.key === 'none',
    'بدون انهيار');
}

/* 22) بيانات ناقصة/معطوبة */
{
  const junk = 'Timestamp,اسم\n' +
    'not-a-date,\n' +
    ',\n' +
    '03/10/2026 10:00:00,فقط عمودان\n';
  const p = M.parseProgramsCsv(junk);
  const shortAdmin = 'name,day1\n' + 'ز,مدرسة\n' + '\n';
  const a = M.parseAdminCsv(shortAdmin);
  const st = ST.computeStatus(master, records, null, {});
  ok('22. بيانات ناقصة/معطوبة',
    p.records.length <= 2 && a.records.length <= 1 && st.rows.length === master.length,
    'programs=' + p.records.length + ' admin=' + a.records.length);
}

/* سجل العمليات + أدوات */
LOG.logAdd('اختبار', 'سطر تجريبي');
ok('bonus. سجل العمليات', LOG.logList().length >= 1);
ok('bonus. ltr يعزل النص', U.ltr('4/10-10/10').charCodeAt(0) === 0x2066);

console.log('\n=========================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
