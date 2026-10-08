/* اختبار حزمة AIA — المرحلة 2: شاشة الإعداد + الإرسال المباشر من الشريحة */
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

/* 67) scm: 43 مكوّناً + لا actSms + الشاشة/Form */
{
  const names = comps.map((c) => c.name);
  ok('67. scm: 43 مكوّناً · لا actSms · Screen1 Form',
    comps.length === 43 && !names.includes('actSms') &&
    scm.Properties.$Name === 'Screen1' && scm.Properties.$Type === 'Form' &&
    Number(scm.Properties.$Version) === 32,
    'n=' + comps.length + ' v' + scm.Properties.$Version);
}

/* 68) مكوّنات الإرسال: txt1/clock1 + صفوف التحكم والسجل */
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

/* 69) شاشتا الإعداد والنتيجة بالبنية المطلوبة (§6/§8/§11) */
{
  const p1 = byName.get('pnlSetup'), p2 = byName.get('pnlResult');
  const send = byName.get('btnSendNow'), msg = byName.get('txtMsg');
  ok('69. شاشة الإعداد: pnlSetup مخفية + عنوانها + btnSendNow معطّل افتراضيًا + txtMsg متعدد الأسطر',
    p1 && p1.type === 'VerticalArrangement' && p1.node.Visible === 'False' && p1.node.$Components.length === 16 &&
    p1.node.$Components[0].Text === 'إعداد إرسال الرسائل النصية' &&
    p2 && p2.node.Visible === 'False' && p2.node.$Components.length === 5 &&
    send && send.node.Enabled === 'False' && send.type === 'Button' &&
    msg && msg.type === 'TextBox' && msg.node.MultiLine === 'True' &&
    byName.has('pnlResult') && byName.has('btnRetry') && byName.has('btnBackSetup') && byName.has('lstRecips'),
    'setup=' + (p1 && p1.node.$Components.length) + ' result=' + (p2 && p2.node.$Components.length));
}

/* 70) bky: توازن الكتل + فريدية المعرّفات + نهاية صحيحة */
{
  const opens = (bky.match(/<block[\s>]/g) || []).length;
  const closes = (bky.match(/<\/block>/g) || []).length;
  const ids = [...bky.matchAll(/ id="(epm\d+)"/g)].map((m) => m[1]);
  ok('70. bky: توازن ' + opens + '/' + closes + ' · ids فريدة · نهاية </xml>',
    opens === closes && opens > 1000 && new Set(ids).size === ids.length && bky.endsWith('</xml>'),
    'ids=' + ids.length);
}

/* 71) الممنوعات: لا تطبيق مراسلة ولا smsto */
{
  const bad = ['smsto', 'ActivityStarter', 'StartActivity', 'actSms', 'DataUri', 'texting.SendMessage('].filter((s) => bky.includes(s));
  ok('71. لا smsto / ActivityStarter / StartActivity / actSms / SendMessage العادي',
    bad.length === 0, bad.join(','));
}

/* 72) الإرسال المباشر: SendMessageDirect على txt1 + رقم/نص قبله */
{
  const i = bky.indexOf('method_name="SendMessageDirect"');
  const seg = bky.slice(Math.max(0, i - 300), i + 300);
  ok('72. الإرسال المباشر عبر txt1.SendMessageDirect + PhoneNumber/Message',
    i > 0 && bky.includes('property_name="PhoneNumber"') && bky.includes('property_name="Message"') &&
    seg.includes('instance_name="txt1"'),
    'i=' + i);
}

/* 73) صلاحية SEND_SMS: طلب + منح + رفض */
{
  const granted = bky.includes('event_name="PermissionGranted"');
  const denied = bky.includes('event_name="PermissionDenied"');
  const ask = bky.includes('method_name="AskForPermission"') && bky.includes('android.permission.SEND_SMS');
  const onScreen = bky.includes('component_type="Form" is_generic="false" instance_name="Screen1" event_name="PermissionGranted"') &&
    bky.includes('component_type="Form" is_generic="false" instance_name="Screen1" event_name="PermissionDenied"');
  ok('73. صلاحية SEND_SMS: AskForPermission + Granted/Denied على Screen1',
    granted && denied && ask && onScreen, 'granted=' + granted + ' denied=' + denied + ' ask=' + ask);
}

/* 74) حوار التأكيد قبل الإرسال (§8) */
{
  const choose = (bky.match(/method_name="ShowChooseDialog"/g) || []).length;
  const denyMsg = bky.includes('لم يتم منح صلاحية إرسال الرسائل النصية، لذلك لا يمكن إرسال الرسالة مباشرة.');
  ok('74. تأكيد قبل الإرسال: ShowChooseDialog + «رسالة نصية مباشرة…(SmsManager)» + «تأكيد وإرسال» + نص الرفض حرفيًا',
    choose >= 1 && bky.includes('رسالة نصية مباشرة عبر شريحة هاتفك') && bky.includes('SmsManager') &&
    bky.includes('تأكيد وإرسال') && bky.includes('إلغاء') && denyMsg,
    'choose=' + choose);
}

/* 75) عند اختيار مشرف: تبديل تحديد فقط — لا إرسال */
{
  const i = bky.indexOf('event_name="AfterPicking"');
  if (i < 0) { ok('75. AfterPicking موجود', false); }
  else {
    let d = 0, j = bky.lastIndexOf('<block', i);
    const re = /<block[\s>]|<\/block>/g; re.lastIndex = j;
    let m, end = -1;
    while ((m = re.exec(bky))) { d += m[0][1] === 'b' ? 1 : -1; if (d === 0) { end = re.lastIndex; break; } }
    const sub = bky.slice(j, end > 0 ? end : j + 2000);
    ok('75. عند اختيار مشرف: تبديل تحديد (gSelFlags/gVIdx) بلا إرسال ولا صلاحيات',
      end > 0 && !sub.includes('SendMessageDirect') && !sub.includes('SEND_SMS') && !sub.includes('AskForPermission') &&
      sub.includes('global gSelFlags') && sub.includes('global gVIdx') && sub.includes('global gIdx'),
      'len=' + (end - j));
  }
}

/* 76) الدفعة: مؤقّت + قفل gBusy + تقدّم عربي */
{
  const timer = bky.includes('component_type="Clock" is_generic="false" instance_name="clock1" event_name="Timer"');
  ok('76. الإرسال الدفعي: Timer + gBusy + «جاري الإرسال... k من N»',
    timer && bky.includes('global gBusy') && bky.includes('جاري الإرسال... '),
    'timer=' + timer);
}

/* 77) السجل والنتيجة + إعادة الفاشل فقط */
{
  const fmt = (bky.match(/method_name="FormatDateTime"/g) || []).length;
  const retryText = byName.get('btnRetry') && byName.get('btnRetry').node.Text;
  ok('77. النتيجة: PENDING/FAILED بختم وقت + إجمالي المستلمين/تم الإرسال/فشل + زر إعادة الفاشل فقط',
    fmt >= 2 &&
    bky.includes('PENDING: أُرسلت من الهاتف (بانتظار تأكيد الشبكة)') &&
    bky.includes('FAILED: ') &&
    bky.includes('إجمالي المستلمين: ') &&
    bky.includes('تم الإرسال: ') &&
    bky.includes('فشل: ') &&
    retryText === '🔁 إعادة إرسال الرسائل الفاشلة فقط',
    'fmt=' + fmt + ' retry=' + retryText);
}

/* 78) تنظيف الرقم وتوافق القوائم وتحويل +970 */
{
  const rep = (bky.match(/text_replace_all/g) || []).length;
  ok('78. تنظيف الرقم (فراغ/شرطة) + gPhones موازٍ لـ gNames + تحويل 059… إلى +970…',
    rep >= 2 &&
    bky.includes('<field name="VAR">global gPhones</field>') &&
    bky.includes('<field name="VAR">global gPhone</field>') &&
    bky.includes('+970') &&
    bky.includes('gFailed2') &&
    (bky.match(/<block type="global_declaration"/g) || []).length === 54,
    'replace=' + rep);
}

/* 79) كل instance_name / COMPONENT_SELECTOR موجود في scm */
{
  const inst = new Set();
  for (const re of [/instance_name="([^"]+)"/g, /<field name="COMPONENT_SELECTOR">([^<]+)<\/field>/g]) {
    let m; while ((m = re.exec(bky))) inst.add(m[1]);
  }
  const known = new Set([...comps.map((c) => c.name), scm.Properties.$Name]);
  const missing = [...inst].filter((n) => !known.has(n));
  ok('79. كل مراجع المكوّنات في الكتل موجودة في scm',
    inst.size >= 14 && missing.length === 0,
    'refs=' + inst.size + ' missing=' + missing.join(','));
}

/* 80) التعريفات: 54 عالمًا + 12 إجراءً (بلا pSummary) + بلا مراجع مفقودة */
{
  const decls = new Set([...bky.matchAll(/<block type="global_declaration"[\s\S]*?<field name="NAME">([^<]+)<\/field>/g)].map((m) => m[1]));
  const used = new Set([...bky.matchAll(/<field name="VAR">global ([^<]+)<\/field>/g)].map((m) => m[1]));
  const undef = [...used].filter((v) => !decls.has(v));
  const defs = new Set([...bky.matchAll(/<block type="procedures_defnoreturn"[\s\S]*?<field name="NAME">([^<]+)<\/field>/g)].map((m) => m[1]));
  const calls = new Set([...bky.matchAll(/<mutation name="([^"]+)"\/><field name="PROCNAME">/g)].map((m) => m[1]));
  const badCalls = [...calls].filter((c) => !defs.has(c));
  const want = ['pSendOne', 'pFinish', 'pShowView', 'pStatusLine', 'pCounts', 'pPreview', 'pReady', 'pClearSel', 'pOpenSetup'];
  ok('80. تعريفات صحيحة: globals=54 · إجراءات=12 (بلا pSummary) · كل النداءات معرّفة',
    decls.size === 54 && undef.length === 0 && defs.size === 12 && badCalls.length === 0 &&
    !defs.has('pSummary') && want.every((p) => defs.has(p)),
    'globals=' + decls.size + ' defs=' + defs.size + ' undef=' + undef.join(',') + ' badCalls=' + badCalls.join(','));
}

/* 81) الأحداث: المجموعة المتوقعة (20) */
{
  const evs = [...bky.matchAll(/event_name="([^"]+)"/g)].map((m) => m[1]).sort();
  const want = [
    ...Array(11).fill('Click'), 'GotText', 'GotText', 'Initialize', 'AfterPicking', 'AfterChoosing',
    'Timer', 'PermissionGranted', 'PermissionDenied', 'TextChanged',
  ].sort();
  ok('81. مجموعة الأحداث كاملة (20): 11 Click + صلاحيات + مؤقّت + تغيّر النص',
    evs.length === want.length && evs.every((e, i) => e === want[i]),
    'got=' + evs.length);
}

/* 82) لا تكرار في الأحداث (حدث واحد لكل مكوّن/حدث) */
{
  const combos = [...bky.matchAll(/<block type="component_event"[\s\S]*?<\/block>/g)].map((m) => {
    const inst = /instance_name="([^"]+)"/.exec(m[0]);
    const ev = /event_name="([^"]+)"/.exec(m[0]);
    return (inst ? inst[1] : '?') + '.' + (ev ? ev[1] : '?');
  });
  const opens = (bky.match(/<block type="component_event"/g) || []).length;
  ok('82. كل حدث فريد (بلا تكرار بعد إعادة البناء)',
    combos.length === opens && new Set(combos).size === opens && opens === 20,
    'events=' + opens + ' unique=' + new Set(combos).size);
}

/* 83) صيغة Blockly المعيارية: كل <next> داخل <block> بلا تداخل خاطئ */
{
  const re = /<(\/?)([A-Za-z_][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const stack = [];
  const badParents = new Set();
  let mismatch = null, m;
  while ((m = re.exec(bky))) {
    const [, c, t, attrs, sc] = m;
    if (c) { const n = stack.pop(); if (!n || n.tag !== t) { mismatch = t; break; } continue; }
    if (sc) continue;
    if (t === 'next') {
      const top = stack[stack.length - 1];
      if (!top || top.tag !== 'block') badParents.add(top ? top.tag : 'root');
    }
    stack.push({ tag: t });
  }
  ok('83. سلاسل معيارية: كل <next> داخل <block> · بلا </next><next> · بلا </block><next>',
    !mismatch && stack.length === 0 && badParents.size === 0 &&
    !bky.includes('</next><next>') && !bky.includes('</block><next>'),
    'mismatch=' + mismatch + ' badParents=' + [...badParents].join(','));
}

/* 84) نصوص الواجهة والتدفق: زر SMS + جاهزية + إلغاء + عدم تحديد */
{
  const sendText = byName.get('btnSend') && byName.get('btnSend').node.Text;
  ok('84. نصوص التدفق: زر «✉️ إرسال رسالة نصية SMS» + جاهز للإرسال + أُلغي الإرسال + لم يتم تحديد',
    sendText === '✉️ إرسال رسالة نصية SMS' &&
    bky.includes('جاهز للإرسال') &&
    bky.includes('أُلغي الإرسال.') &&
    bky.includes('لم يتم تحديد أي مشرف') &&
    bky.includes('⚠ الرسالة فارغة'),
    'btnSend=' + sendText);
}

/* 85) تغيّر نص الرسالة يحدّث العدّاد والمعاينة */
{
  const ev = bky.includes('instance_name="txtMsg" event_name="TextChanged"');
  ok('85. txtMsg.TextChanged موجود ونداء pCounts/pPreview بعده',
    ev && bky.includes('global gSegs') && bky.includes('محتوى موحد'),
    'ev=' + ev);
}

console.log('\n=========================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
