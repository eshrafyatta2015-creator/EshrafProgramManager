/* Config — مصادر البيانات والثوابت (لا أسرار هنا) */

/* المصادر الثلاثة مفصولة صراحةً — لا تُخلط ولا تُدمج أبداً:
   1) الأرشيف النهائي (Link1): القراءة للاستعلام التاريخي + الإضافة فقط أثناء الترحيل.
      ممنوع: الحذف أو التعديل على صفوفه من التطبيق.
   2) البيانات المرجعية (Link2): المدارس/الفعاليات/قائمة المشرفيين — قراءة فقط،
      ولا يُسمح بأي كتابة/حذف/تعديل عليها إطلاقاً.
   3) ردود الاستمارة الحيّة (Link3): تُقرأ وقت الترحيل فقط — أثناء الترحيل
      لا يُحذف منها شيء ولا يُعدَّل، والإضافة تتم في الأرشيف (Link1) فقط. */
export const ARCHIVE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1rthlmaZES8c95kUI6ErfD4YgiymWq4RoKXNXqgoBPnI/export?format=csv';
export const RESPONSES_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/16Sw_4TjAM0fhYKicxyZE0EzGoT98ZnlMSxYKxU3ILLk/export?format=csv';
export const MASTER_DATA_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1P2X7VK_ZnSqhrLtVJbDTwnjJqoVuNWaK-7i3EqvN6Gg/export?format=csv';

export const CFG = {
  sheets: {
    admin: ARCHIVE_SHEET_URL,
    programs: RESPONSES_SHEET_URL,
    lists: MASTER_DATA_SHEET_URL,
  },
  sheetIds: {
    admin: '1rthlmaZES8c95kUI6ErfD4YgiymWq4RoKXNXqgoBPnI',
    programs: '16Sw_4TjAM0fhYKicxyZE0EzGoT98ZnlMSxYKxU3ILLk',
    lists: '1P2X7VK_ZnSqhrLtVJbDTwnjJqoVuNWaK-7i3EqvN6Gg',
  },

  appName: 'EshrafProgramManager',
  displayName: 'إدارة ومتابعة برامج المشرفين',
  headerLine1: 'مديرية التربية والتعليم يطا',
  headerLine2: 'قسم الإشراف والتأهيل التربوي',

  days: [
    { key: 'sun', label: 'الأحد', sheet: '[الاحد]' },
    { key: 'mon', label: 'الاثنين', sheet: '[الاثنين]' },
    { key: 'tue', label: 'الثلاثاء', sheet: '[الثلاثاء]' },
    { key: 'wed', label: 'الاربعاء', sheet: '[الاربعاء]' },
    { key: 'thu', label: 'الخميس', sheet: '[الخميس]' },
    { key: 'sat', label: 'السبت', sheet: '[السبت]' },
  ],

  typePlanning: 'تخطيط',
  typeActual: 'فعلي',
  types: ['تخطيط', 'فعلي'],

  magicHeader: '(اخترمن القائمة)اسم المشرف',
  noteRowPrefix: 'الدوام',

  /* §7 تسميات الحالات النهائية (تُستخدم في البطاقات والجداول والتصدير) */
  statuses: {
    both: { key: 'both', icon: '🟢', label: 'مكتمل', cls: 'st-both' },
    planning: { key: 'planning', icon: '🟠', label: 'أرسل التخطيط ولم يرسل الفعلي', cls: 'st-planning' },
    actual: { key: 'actual', icon: '🟢', label: 'أرسل الفعلي', cls: 'st-actual' },
    none: { key: 'none', icon: '🔴', label: 'لم يرسل البرنامج', cls: 'st-none' },
  },
  statusFilters: [
    { key: 'all', label: 'الجميع' },
    { key: 'planning', label: 'أرسل التخطيط' },
    { key: 'notPlanning', label: 'لم يرسل التخطيط' },
    { key: 'actual', label: 'أرسل الفعلي' },
    { key: 'notActual', label: 'لم يرسل الفعلي' },
    { key: 'complete', label: 'مكتمل' },
    { key: 'incomplete', label: 'غير مكتمل' },
  ],

  messages: {
    planning: 'السلام عليكم، يرجى منكم إرسال البرنامج الأسبوعي التخطيطي للأسبوع المحدد ({الاسبوع}) عبر تطبيق برنامج المشرفين، شاكرين تعاونكم.',
    actual: 'السلام عليكم، يرجى منكم إرسال البرنامج الأسبوعي الفعلي للأسبوع المحدد ({الاسبوع}) عبر تطبيق برنامج المشرفين، شاكرين تعاونكم.',
    both: 'السلام عليكم، يرجى منكم إرسال البرنامج الأسبوعي التخطيطي/الفعلي للأسبوع المحدد ({الاسبوع}) عبر تطبيق برنامج المشرفين، شاكرين تعاونكم.',
    none: 'السلام عليكم، لم نستلم منكم أي برنامج (تخطيطي أو فعلي) للأسبوع المحدد ({الاسبوع}) — يرجى الإرسال عبر تطبيق برنامج المشرفين، شاكرين تعاونكم.',
    complete: 'السلام عليكم، نشكر لكم إرسال برامجكم التخطيطية والفعلية للأسبوع المحدد ({الاسبوع}) — بارك الله فيكم وشكراً لتعاونكم.',
  },

  storage: {
    cache: 'epm.cache.v1',
    settings: 'epm.settings.v1',
    log: 'epm.log.v1',
    phones: 'epm.phones.v1',
    role: 'epm.role.v1',
    migrations: 'epm.migrations.v1',
    header: 'epm.header.v1',
  },

  /* أسماء المصادر الثلاثة للعرض في الإعدادات */
  sourceLabels: {
    lists: 'البيانات الأساسية (مرجعي)',
    programs: 'ردود الاستمارة (حيّة)',
    admin: 'الأرشيف النهائي',
  },

  /* نصوص موحّدة (§6/§17/§29/§38) — تُستخدم في الواجهة والاختبارات */
  texts: {
    matchRule: 'Supervisor matching key = Supervisor Name',
    orphanWarning: '⚠ يوجد مشرف في ملف الردود غير موجود في البيانات الأساسية',
    orphanReview: 'يتطلب مراجعة إدارية',
    failKeepResponses: '❌ فشل الترحيل، تم الاحتفاظ ببيانات الردود ولم يتم حذفها.',
    incompleteKeepResponses: '⚠ لم تكتمل عملية الترحيل. تم الاحتفاظ ببيانات الردود لحمايتها.',
    alreadyMigrated: '⚠ تم ترحيل هذا الأسبوع مسابقاً',
    nextWeekReady: 'تم إعداد الأسبوع التالي',
    confirmMigrate: 'تأكيد الترحيل والحذف',
    cancel: 'إلغاء',
  },

  logMax: 500,
  requestTimeoutMs: 25000,
};
