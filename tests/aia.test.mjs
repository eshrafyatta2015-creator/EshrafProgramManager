/* اختبار حزمة AIA — الإرسال المباشر من الشريحة (SMS عبر SIM) */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

const dir = path.dirname(url.fileURLToPath(import.meta.url));
const AIA = path.join(dir, '..', 'EshrafProgramManager.aia');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
};

/* قارئ ZIP مصغّر: EOCD ← central directory ← local headers */
function readZip(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error('EOCD not found');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central dir at ' + p);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('bad local header: ' + name);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const buf = fs.readFileSync(AIA);
const zip = readZip(buf);

/* 66) الملف: توقيع ZIP + المدخلات المطلوبة بالضبط */
{
  const names = Object.keys(zip).sort();
  const want = [
    'assets/1.jfif',
    'assets/2.png',
    'src/appinventor/ai_eshrafyatta2015/EshrafProgramManager/Screen1.bky',
    'src/appinventor/ai_eshrafyatta2015/EshrafProgramManager/Screen1.scm',
    'youngandroidproject/project.properties',
  ].sort();
  ok('66. حزمة AIA: توقيع PK + المدخلات الخمس المطلوبة',
    buf[0] === 0x50 && buf[1] === 0x4b && names.length === want.length && names.every((n, i) => n === want[i]),
    names.join(' | '));
}

const scmRaw = zip['src/appinventor/ai_eshrafyatta2015/EshrafProgramManager/Screen1.scm'].toString('utf8');
const bky = zip['src/appinventor/ai_eshrafyatta2015/EshrafProgramManager/Screen1.bky'].toString('utf8');
const scm = JSON.parse(scmRaw.slice(scmRaw.indexOf('{'), scmRaw.lastIndexOf('}') + 1));

const comps = [];
const walk = (node) => {
  comps.push({ name: node.$Name, type: node.$Type, ver: node.$Version, node });
  for (const k of node.$Components ?? []) walk(k);
};
for (const k of scm.Properties.$Components) walk(k);
const byName = new Map(comps.map((c) => [c.name, c]));

/* 67) scm: 17 مكوّناً + لا actSms + الشاشة/Form */
{
  const names = comps.map((c) => c.name);
  ok('67. scm: 17 مكوّناً · لا actSms · Screen1 Form',
    comps.length === 17 && !names.includes('actSms') &&
    scm.Properties.$Name === 'Screen1' && scm.Properties.$Type === 'Form' &&
    Number(scm.Properties.$Version) === 32,
    'n=' + comps.length + ' class=' + scm.Properties.$Name + ' v' + scm.Properties.$Version);
}

/* 68) مكوّنات الإرسال الجديدة بالإصدارات الصحيحة */
{
  const t = byName.get('txt1'), c = byName.get('clock1'), l = byName.get('lstLog');
  ok('68. مكوّنات الإرسال: txt1 Texting v5 · clock1 Clock v4 · lstLog v11 · btnSend/btnAll',
    t && t.type === 'Texting' && Number(t.ver) === 5 &&
    c && c.type === 'Clock' && Number(c.ver) === 4 &&
    l && l.type === 'ListView' && Number(l.ver) === 11 &&
    'ReceivingEnabled' in t.node && 'GoogleVoiceEnabled' in t.node &&
    'TimerInterval' in c.node && 'TimerEnabled' in c.node && 'TimerAlwaysFires' in c.node &&
    byName.has('btnSend') && byName.has('btnAll') && byName.has('hrSend') && byName.has('lblLogT'),
    'txt1 v' + (t && t.ver) + ' clock1 v' + (c && c.ver));
}

/* 69) bky: توازن الكتل + فريدية المعرّفات + نهاية صحيحة */
{
  const opens = (bky.match(/<block[\s>]/g) || []).length;
  const closes = (bky.match(/<\/block>/g) || []).length;
  const ids = [...bky.matchAll(/ id="(epm\d+)"/g)].map((m) => m[1]);
  ok('69. bky: توازن ' + opens + '/' + closes + ' · ids فريدة · نهاية </xml>',
    opens === closes && opens > 700 && new Set(ids).size === ids.length && bky.endsWith('</xml>'),
    'ids=' + ids.length);
}

/* 70) الممنوعات: لا تطبيق مراسلة ولا smsto */
{
  const bad = ['smsto', 'ActivityStarter', 'StartActivity', 'actSms', 'DataUri', 'texting.SendMessage('].filter((s) => bky.includes(s));
  ok('70. لا smsto / ActivityStarter / StartActivity / actSms / SendMessage العادي',
    bad.length === 0, bad.join(','));
}

/* 71) الإرسال المباشر: SendMessageDirect على txt1 + رقم/نص قبله */
{
  const has = bky.includes('method_name="SendMessageDirect"') &&
    bky.includes('instance_name="txt1" event_name=') === false &&
    bky.includes('property_name="PhoneNumber"') && bky.includes('property_name="Message"');
  const i = bky.indexOf('method_name="SendMessageDirect"');
  const seg = bky.slice(Math.max(0, i - 300), i + 300);
  ok('71. الإرسال المباشر عبر txt1.SendMessageDirect + PhoneNumber/Message',
    has && seg.includes('instance_name="txt1"'),
    'i=' + i);
}

/* 72) صلاحية SEND_SMS: طلب + منح + رفض */
{
  const granted = bky.includes('event_name="PermissionGranted"');
  const denied = bky.includes('event_name="PermissionDenied"');
  const ask = bky.includes('method_name="AskForPermission"') && bky.includes('android.permission.SEND_SMS');
  const onScreen = bky.includes('component_type="Form" is_generic="false" instance_name="Screen1" event_name="PermissionGranted"') &&
    bky.includes('component_type="Form" is_generic="false" instance_name="Screen1" event_name="PermissionDenied"');
  ok('72. صلاحية SEND_SMS: AskForPermission + PermissionGranted/PermissionDenied على Screen1',
    granted && denied && ask && onScreen, 'granted=' + granted + ' denied=' + denied + ' ask=' + ask);
}

/* 73) حوار التأكيد + نص رفض الصلاحية */
{
  const choose = (bky.match(/method_name="ShowChooseDialog"/g) || []).length;
  const denyMsg = bky.includes('لم يتم منح صلاحية إرسال الرسائل النصية، لذلك لا يمكن إرسال الرسالة مباشرة.');
  ok('73. تأكيد قبل الإرسال: ShowChooseDialog ×≥2 + زر تأكيد وإرسال + نص رفض الصلاحية حرفيًا (§3/§8)',
    choose >= 2 && bky.includes('تأكيد وإرسال') && bky.includes('إلغاء') && denyMsg,
    'choose=' + choose);
}

/* 74) AfterPicking: تحضير فقط — لا إرسال */
{
  const i = bky.indexOf('event_name="AfterPicking"');
  if (i < 0) { ok('74. AfterPicking موجود', false); }
  else {
    let d = 0, j = bky.lastIndexOf('<block', i), k = j;
    const re = /<block[\s>]|<\/block>/g; re.lastIndex = j;
    let m, end = -1;
    while ((m = re.exec(bky))) { d += m[0][1] === 'b' ? 1 : -1; if (d === 0) { end = re.lastIndex; break; } }
    const sub = bky.slice(j, end > 0 ? end : j + 2000);
    ok('74. عند اختيار مشرف: تحضير فقط (gIdx/معاينة الاسم) بلا إرسال ولا صلاحيات',
      end > 0 && !sub.includes('SendMessageDirect') && !sub.includes('SEND_SMS') && !sub.includes('AskForPermission') &&
      sub.includes('global gIdx') && sub.includes('global gNames'),
      'len=' + (end - j));
  }
}

/* 75) الدفعة: مؤقّت + قفل gBusy + تقدّم عربي */
{
  const timer = bky.includes('component_type="Clock" is_generic="false" instance_name="clock1" event_name="Timer"');
  ok('75. الإرسال الدفعي: Timer + gBusy + «جاري الإرسال... k من N» + نص الدفعة',
    timer && bky.includes('global gBusy') &&
    bky.includes('جاري الإرسال... ') &&
    bky.includes('مشرفين باستخدام هاتفك'),
    'timer=' + timer);
}

/* 76) السجل + الملخص + إعادة الفاشل فقط */
{
  const fmt = (bky.match(/method_name="FormatDateTime"/g) || []).length;
  ok('76. السجل والملخص: PENDING/FAILED بختم وقت + إجمالي المشرفين/تم الإرسال/فشل + إعادة الفاشل فقط',
    fmt >= 2 &&
    bky.includes('PENDING: أُرسلت من الهاتف (بانتظار تأكيد الشبكة)') &&
    bky.includes('FAILED: ') &&
    bky.includes('إجمالي المشرفين: ') &&
    bky.includes('تم الإرسال: ') &&
    bky.includes('فشل: ') &&
    bky.includes('إعادة إرسال الرسائل الفاشلة'),
    'fmt=' + fmt);
}

/* 77) تنظيف الرقم وتوافق القوائم */
{
  const rep = (bky.match(/text_replace_all/g) || []).length;
  ok('77. تنظيف الرقم (استبدال فراغ/شرطة) + gPhones موازٍ لـ gNames',
    rep >= 2 &&
    bky.includes('<field name="VAR">global gPhones</field>') &&
    bky.includes('<field name="VAR">global gPhone</field>') &&
    (bky.match(/global_declaration/g) || []).length === 33,
    'replace=' + rep);
}

/* 78) كل instance_name / COMPONENT_SELECTOR موجود في scm */
{
  const inst = new Set();
  for (const re of [/instance_name="([^"]+)"/g, /<field name="COMPONENT_SELECTOR">([^<]+)<\/field>/g]) {
    let m; while ((m = re.exec(bky))) inst.add(m[1]);
  }
  const known = new Set([...comps.map((c) => c.name), scm.Properties.$Name]);
  const missing = [...inst].filter((n) => !known.has(n));
  ok('78. كل مراجع المكوّنات في الكتل موجودة في scm',
    inst.size >= 14 && missing.length === 0,
    'refs=' + inst.size + ' missing=' + missing.join(','));
}

/* 79) كل المتغيرات العالمية مُعلَّمة وكل الإجراءات مُعرَّفة */
{
  const decls = new Set([...bky.matchAll(/<block type="global_declaration"[\s\S]*?<field name="NAME">([^<]+)<\/field>/g)].map((m) => m[1]));
  const used = new Set([...bky.matchAll(/<field name="VAR">global ([^<]+)<\/field>/g)].map((m) => m[1]));
  const undef = [...used].filter((v) => !decls.has(v));
  const defs = new Set([...bky.matchAll(/<block type="procedures_defnoreturn"[\s\S]*?<field name="NAME">([^<]+)<\/field>/g)].map((m) => m[1]));
  const calls = new Set([...bky.matchAll(/<mutation name="([^"]+)"\/><field name="PROCNAME">/g)].map((m) => m[1]));
  const badCalls = [...calls].filter((c) => !defs.has(c));
  ok('79. تعريفات صحيحة: globals معلّمة + إجراءات معرّفة (pSendOne/pFinish/pSummary)',
    decls.size === 33 && undef.length === 0 && defs.size === 6 && badCalls.length === 0 &&
    defs.has('pSendOne') && defs.has('pFinish') && defs.has('pSummary'),
    'globals=' + decls.size + ' undef=' + undef.join(',') + ' badCalls=' + badCalls.join(','));
}

/* 80) الأحداث: المجموعة المتوقعة (12) */
{
  const evs = [...bky.matchAll(/event_name="([^"]+)"/g)].map((m) => m[1]).sort();
  const want = ['AfterChoosing', 'AfterPicking', 'Click', 'Click', 'Click', 'Click', 'GotText', 'GotText', 'Initialize', 'PermissionDenied', 'PermissionGranted', 'Timer'].sort();
  ok('80. مجموعة الأحداث كاملة (12) تشمل صلاحيات التأكيد والمؤقّت',
    evs.length === want.length && evs.every((e, i) => e === want[i]),
    evs.join(','));
}

console.log('\n=========================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
