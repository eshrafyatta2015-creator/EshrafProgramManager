/* Config — مصادر البيانات والثوابت (لا أسرار هنا) */

export const CFG = {
  sheets: {
    admin: 'https://docs.google.com/spreadsheets/d/1rthlmaZES8c95kUI6ErfD4YgiymWq4RoKXNXqgoBPnI/export?format=csv',
    programs: 'https://docs.google.com/spreadsheets/d/16Sw_4TjAM0fhYKicxyZE0EzGoT98ZnlMSxYKxU3ILLk/export?format=csv',
    lists: 'https://docs.google.com/spreadsheets/d/1P2X7VK_ZnSqhrLtVJbDTwnjJqoVuNWaK-7i3EqvN6Gg/export?format=csv',
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

  statuses: {
    both: { key: 'both', icon: '🟢', label: 'تم الإرسال', cls: 'st-both' },
    planning: { key: 'planning', icon: '🟠', label: 'أرسل التخطيط فقط', cls: 'st-planning' },
    actual: { key: 'actual', icon: '🔵', label: 'تم إرسال الفعلي', cls: 'st-actual' },
    none: { key: 'none', icon: '🔴', label: 'لم يرسل', cls: 'st-none' },
  },
  statusFilters: [
    { key: 'all', label: 'الجميع' },
    { key: 'planning', label: 'أرسل التخطيط' },
    { key: 'actual', label: 'أرسل الفعلي' },
    { key: 'none', label: 'لم يرسل' },
  ],

  messages: {
    planning: 'السلام عليكم، يرجى منكم إرسال البرنامج الأسبوعي التخطيطي للأسبوع المحدد ({الاسبوع}) عبر تطبيق برنامج المشرفين، شاكرين تعاونكم.',
    actual: 'السلام عليكم، يرجى منكم إرسال البرنامج الأسبوعي الفعلي للأسبوع المحدد ({الاسبوع}) عبر تطبيق برنامج المشرفين، شاكرين تعاونكم.',
    both: 'السلام عليكم، يرجى منكم إرسال البرنامج الأسبوعي التخطيطي/الفعلي للأسبوع المحدد ({الاسبوع}) عبر تطبيق برنامج المشرفين، شاكرين تعاونكم.',
  },

  storage: {
    cache: 'epm.cache.v1',
    settings: 'epm.settings.v1',
    log: 'epm.log.v1',
    phones: 'epm.phones.v1',
    role: 'epm.role.v1',
  },

  logMax: 500,
  requestTimeoutMs: 25000,
};
