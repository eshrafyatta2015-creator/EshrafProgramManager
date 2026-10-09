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
    smsLog: 'epm.smslog.v1',
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
    /* §38 تحديث ترويسة الردود إلى الأسبوع الجديد (صف الترويسة فقط) */
    headerWeekLabel: 'ترويسة الردود ستُحدَّث إلى',
    headerWeekUpdated: 'تم تحديث ترويسة الردود إلى الأسبوع الجديد',
    headerWeekPending: 'الترويسة لم تُحدَّث بعد — أعد المحاولة من سجل الترحيل',
    headerWeekRetry: '🔁 تجهيز ترويسة الأسبوع الجديد',
    confirmMigrate: 'تأكيد الترحيل والحذف',
    cancel: 'إلغاء',
    /* §2/§5 تأكيد الإرسال المباشر — نصوص حرفية من المواصفة */
    smsConfirmTitle: 'تأكيد إرسال الرسائل',
    smsConfirmLine: (n) => 'سيتم إرسال الرسالة إلى ' + n + ' مشرفين.',
    smsAsk: 'هل تريد إرسال الرسالة الآن؟',
    smsConfirmAction: 'تأكيد وإرسال',
    smsSelectOne: 'يرجى اختيار مشرف واحد على الأقل قبل الإرسال.',
    smsNoValidPhone: 'لا يوجد رقم جوال صالح بين المشرفين المحددين.',
    smsNoPhoneLine: (name) => name + ' — لا يوجد رقم جوال صالح',
    smsSending: 'جاري إرسال الرسائل...',
    smsProgress: (done, total) => 'تم إرسال ' + done + ' من ' + total,
    /* §6 نتيجة الإرسال */
    smsResultTotal: 'إجمالي الرسائل',
    smsResultSent: 'تم الإرسال بنجاح',
    smsResultFailed: 'فشل الإرسال',
    smsDoneTitle: 'تم إرسال جميع الرسائل',
    smsPartialTitle: 'تم الإرسال مع أخطاء',
    smsFailLine: (name, reason) => name + ' — فشل الإرسال — ' + reason,
    smsFailSentence: (name, reason) => 'تعذر إرسال الرسالة إلى ' + name + ' بسبب ' + reason + '.',
    smsProviderNotice: 'تم إرسال الطلب إلى مزود الرسائل (بلا تأكيد تسليم إلا إن أفاد المزوّد بذلك).',
    smsRetryFailed: 'إعادة إرسال الرسائل الفاشلة',
    smsBusy: 'جاري الإرسال حاليًا — انتظر انتهاء العملية.',
    /* §9/§10 عدّاد الاختيار والرسالة */
    smsChosen: (n) => 'تم اختيار ' + n + ' مشرفين',
    smsChars: (n) => 'عدد الأحرف: ' + n,
    smsParts: (n) => 'عدد الرسائل المتوقعة: ' + n,
    /* §15 أخطاء البوابة بلغة مفهومة (لا Stack Trace) */
    smsGatewayDown: 'خادم الإرسال غير متاح — شغّل node serve.mjs أو اضبط رابط بوابة SMS في الإعدادات.',
    smsGatewayNotConfigured: 'لم يتم تهيئة مزود SMS على الخادم (SMS_UPSTREAM_URL).',
    smsUpstreamDown: 'تعذر الوصول إلى مزود الرسائل — تحقق من الاتصال.',
    /* §11 حالات السجل */
    smsStatus: { SENT: 'تم الإرسال', PENDING: 'تم الطلب', DELIVERED: 'تم التسليم', FAILED: 'فشل' },
    /* §6-§10 التراجع عن الترحيل */
    undoButton: '↩ التراجع عن آخر ترحيل',
    undoConfirmTitle: 'التراجع عن عملية الترحيل',
    undoAsk: 'هل أنت متأكد من التراجع عن هذه العملية؟',
    undoConfirmAction: 'تأكيد التراجع',
    undoNoEntry: 'لا توجد عملية ترحيل قابلة للتراجع.',
    undoUndone: 'هذه العملية تراجعَت مسبقاً.',
    undoIncomplete: 'العملية غير مكتملة — لا يسمح بالتراجع قبل اكتمالها.',
    undoNewer: 'توجد عملية ترحيل أحدث — التراجع عن الأقدم غير مسموح.',
    undoNoKeys: 'لا يمكن تحديد السجلات التي تم ترحيلها لهذه العملية.',
    undoAbort: 'تعذر التحقق من السجلات المرحّلة، لذلك تم إيقاف عملية التراجع حفاظًا على البيانات.',
    undoSuccessTitle: 'تم التراجع عن عملية الترحيل',
  },

  logMax: 500,
  smsLogMax: 300,
  migrationKeep: 100,
  requestTimeoutMs: 25000,
};
