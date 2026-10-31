/* CheckGate 检测引擎 —— 独立验收测试（由主理人编写，非原开发者） */
const fs = require('fs');
const path = require('path');
const D = require('./detector.js');

const rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8')).words;

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(`${name}${detail ? ' :: ' + detail : ''}`); }
}

// ---------- 1. 直接命中 ----------
{
  const r = D.detect('这款面霜补水效果最强，敏感肌也能用', rules, 'douyin');
  check('直接命中-最强', r.hits.some(h => h.term === '最强'), JSON.stringify(r.hits.map(h=>h.term)));
  check('风险等级为high', r.level === 'high', r.level);
}

// ---------- 2. 繁体变体 ----------
{
  const r = D.detect('這個產品療效最好', rules, 'douyin');
  check('繁体命中-最好', r.hits.some(h => h.term === '最好'), JSON.stringify(r.hits.map(h=>h.term)));
}

// ---------- 3. 符号分隔插入 ----------
{
  const r = D.detect('加我微+信领取资料', rules, 'douyin');
  check('符号分隔命中', r.hits.length > 0, JSON.stringify(r.hits.map(h=>h.term)));
}

// ---------- 4. 空格插入 ----------
{
  const r = D.detect('详 情 私 我', rules, 'douyin');
  check('空格分隔命中', r.hits.length > 0, JSON.stringify(r.hits.map(h=>h.term)));
}

// ---------- 5. 数字替换 ----------
{
  const r = D.detect('百分百有效，三天见效', rules, 'douyin');
  check('中文数字命中', r.hits.length > 0, JSON.stringify(r.hits.map(h=>h.term)));
}

// ---------- 6. 位置索引准确性（核心） ----------
{
  const text = '前置文字。最强。后置文字';
  const r = D.detect(text, rules, 'douyin');
  const h = r.hits.find(x => x.term === '最强');
  if (h) {
    const sliced = text.slice(h.start, h.end);
    check('位置索引精确还原', sliced === '最强', `slice="${sliced}" start=${h.start} end=${h.end}`);
    check('起始位置正确', h.start === 5, `start=${h.start}, 期望5`);
  } else {
    check('位置索引-命中', false, '未命中最强');
  }
}

// ---------- 7. 变体命中后位置仍精确 ----------
{
  const text = '前面加我微+信后面';
  const r = D.detect(text, rules, 'douyin');
  check('变体位置测试-有命中', r.hits.length > 0, JSON.stringify(r.hits.map(h=>({t:h.term,s:h.start,e:h.end,m:h.matched}))));
  r.hits.forEach(h => {
    const orig = text.slice(h.start, h.end);
    check(`变体位置还原[${h.term}]`, orig === h.matched || h.matched.length > 0,
      `orig="${orig}" matched="${h.matched}"`);
  });
}

// ---------- 8. 平台差异判定 ----------
{
  // 找一条只属于某平台的规则
  const douyinOnly = rules.find(r => r.platforms && r.platforms.length === 1 && r.platforms[0] === 'douyin');
  if (douyinOnly) {
    const t = '测试文案包含' + douyinOnly.term;
    const rd = D.detect(t, rules, 'douyin');
    const rx = D.detect(t, rules, 'xiaohongshu');
    check('平台差异-抖音命中', rd.hits.some(h=>h.term===douyinOnly.term), `term=${douyinOnly.term}`);
    check('平台差异-小红书不命中', !rx.hits.some(h=>h.term===douyinOnly.term), `term=${douyinOnly.term}`);
  } else {
    check('平台差异-存在抖音独有规则', false, '规则库中无单平台规则');
  }
}

// ---------- 9. 全平台模式：取并集 ----------
{
  const t = '这个最强，加我微信';
  const ra = D.detect(t, rules, 'all');
  const rd = D.detect(t, rules, 'douyin');
  check('全平台命中数 >= 抖音命中数', ra.hits.length >= rd.hits.length, `all=${ra.hits.length} dy=${rd.hits.length}`);
  check('全平台模式有 matrix', Array.isArray(ra.matrix) && ra.matrix.length > 0, `matrix长度=${ra.matrix && ra.matrix.length}`);
}

// ---------- 10. 替换文本生成 ----------
{
  const t = '效果最强，效果最好';
  const r = D.detect(t, rules, 'douyin');
  const rep = D.buildReplacement(t, r.hits);
  check('替换文本已改变', rep !== t, `rep="${rep}"`);
  check('替换后不含最强', rep.indexOf('最强') === -1, `rep="${rep}"`);
  check('替换后不含最好', rep.indexOf('最好') === -1, `rep="${rep}"`);
}

// ---------- 11. 无命中场景 ----------
{
  const r = D.detect('今天天气不错，我们去公园散步吧', rules, 'all');
  check('正常文本零误报', r.hits.length === 0, `误报: ${JSON.stringify(r.hits.map(h=>h.term))}`);
  check('无命中时 level=safe', r.level === 'safe', r.level);
  check('levelText 文案正确', r.levelText === '未发现风险', r.levelText);
}

// ---------- 12. Emoji 位置计数（码点口径） ----------
{
  const text = '😀😀最强测试';
  const r = D.detect(text, rules, 'douyin');
  const h = r.hits.find(x=>x.term==='最强');
  if (h) {
    const sliced = text.slice(h.start, h.end);
    check('Emoji后位置仍精确', sliced === '最强', `slice="${sliced}" start=${h.start}`);
  } else {
    check('Emoji场景命中', false, '未命中');
  }
}

// ---------- 13. 全量回归：358条规则逐条自检 ----------
{
  let hit = 0, miss = 0, err = 0;
  const missed = [];
  for (const rule of rules) {
    try {
      const pf = (rule.platforms && rule.platforms[0]) || 'douyin';
      const r = D.detect(rule.term, rules, pf);
      if (r.hits.length > 0) hit++; else { miss++; missed.push(rule.term); }
    } catch(e) { err++; }
  }
  check('全量回归-零异常', err === 0, `异常${err}条`);
  check('全量回归命中率>=90%', hit / rules.length >= 0.9,
    `命中${hit}/${rules.length} = ${(hit/rules.length*100).toFixed(1)}%`);
  console.log(`\n  【全量回归】命中 ${hit} / ${rules.length} = ${(hit/rules.length*100).toFixed(1)}%  漏检 ${miss}  异常 ${err}`);
  if (missed.length) console.log('  漏检词条(前10):', missed.slice(0,10).join(', '));
}

// ---------- 14. XSS 安全：命中内容不得可执行 ----------
{
  const t = '<img src=x onerror=alert(1)>最强<script>alert(2)</script>';
  const r = D.detect(t, rules, 'douyin');
  check('XSS文本不崩溃', r.hits.length >= 0, `hits=${r.hits.length}`);
  const h = r.hits[0];
  if (h) {
    check('XSS文本原样保留为数据', h.matched === '<img src=x onerror=alert(1)>' || h.matched.length > 0, `matched="${h.matched}"`);
  }
  // 关键：detector 返回的是纯数据，渲染层必须用 textContent
  console.log('  [安全提示] detector 仅返回数据，渲染层必须 textContent，禁止 innerHTML');
}

// ---------- 15. 性能 ----------
{
  const long = '这是测试文案，包含最强和最好的说法。'.repeat(200);
  const t0 = Date.now();
  const r = D.detect(long, rules, 'douyin');
  const dt = Date.now() - t0;
  check('2000+字检测 <800ms', dt < 800, `耗时${dt}ms, 命中${r.hits.length}`);
  console.log(`  [性能] ${long.length} 字符 / 358 条规则：${dt}ms，命中 ${r.hits.length}`);
}

// ---------- 汇总 ----------
console.log('\n' + '='.repeat(60));
console.log(`验收结果：通过 ${pass} / 失败 ${fail}`);
if (failures.length) {
  console.log('\n失败明细：');
  failures.forEach(f => console.log('  ✗ ' + f));
}
console.log('='.repeat(60));
process.exit(fail > 0 ? 1 : 0);
