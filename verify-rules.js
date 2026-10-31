#!/usr/bin/env node
/**
 * CheckGate 规则库一致性校验
 *
 * ⚠️ ⚠️ 判别逻辑本身是需要被检查的代码 ⚠️ ⚠️
 *
 * 【本项目已发生过一次真实误报，记录在此以免重犯】
 *   误报根因：平台关键词表里曾包含裸 '微信'，
 *             把「禁止【留微信】」这种描述性文字误判成"视频号依据"，
 *             导致数据明明正确却被判为张冠李戴。
 *   危害：误报比漏报更危险 —— 它会让人把【正确的收窄当成错误推翻】。
 *   对策：平台关键词只用精确规范名（视频号 / 微信小店 / 公众号 / 腾讯），
 *         不用裸 '微信' 这类会出现在描述性文字里的词。
 *
 * 【判断标准】
 *   宁可漏报（让人多看一眼），不可误报（让人推翻正确结论）。
 *   若你修改了本文件的判别逻辑，请务必：
 *     ① 用真实数据跑一遍，看误报数是否上升
 *     ② 确认退出码仍能反映真实问题
 *   本脚本的判别逻辑若出错，输出的数字同样不可信。
 *
 * 用法：node checkgate/verify-rules.js
 *
 * 本脚本是「文档写作铁规」的自动化实现。铁规原文：
 *   凡是要写进文档的字面数字与日期，一律回到底层数据文件核对一遍，
 *   不接受任何来源的转述——包括 team-lead 的裁决原文。
 *
 * 扩展铁规（v1.4 新增，交叉一致性）：
 *   ruleSource 的平台依据必须与 platforms 一致。
 *   用 A 平台的规范解释 B 平台的词，是「张冠李戴」，
 *   比「没有依据」更糟——因为用户不会怀疑，只会困惑。
 *
 * 检查项：
 *   1. 必填字段完整性
 *   2. 合规红线（reason/suggestion 不得出现规避类表述）
 *   3. 交叉一致性：ruleSource 提到的平台 ⊆ platforms
 *   4. 收录范围分布（供文档引用）
 *   5. 溯源状态分布
 */

const fs = require('fs');
const path = require('path');

const RULES = path.join(__dirname, 'rules.json');
const data = JSON.parse(fs.readFileSync(RULES, 'utf8'));
const words = data.words || [];

// 平台识别关键词：ruleSource 中出现这些词，说明该平台有依据。
// 🔴 注意：此处必须用「规范名」而非泛称。
// 反例：'微信' 不能作为 shipinhao 的关键词——「禁止留微信」这类描述性文字
// 会把抖音/小红书的导流条款误判为视频号依据。误报会让正确的收窄被推翻。
const PLATFORM_KEYS = {
  xiaohongshu: ['小红书'],
  douyin: ['抖音'],
  shipinhao: ['视频号', '微信小店', '公众号', '腾讯'],
};
// 全国性法律：对所有平台都适用，不构成平台限制
const NATIONAL_KEYS = ['广告法', '价格法', '标识办法', '价格'];

// 语义指纹：只覆盖「会因内容变化而变」的字段
// 不含 verifiedAt / ruleDateKind —— 那两个每次核对都会变，但内容没变
const crypto = require('crypto');
function semanticFingerprint(list) {
  const sem = list
    .map((w) => `${w.term}|${w.riskLevel}|${[...(w.platforms || [])].sort().join(',')}|${w.ruleSource}`)
    .sort()
    .join('\n');
  return crypto.createHash('md5').update(sem, 'utf8').digest('hex').slice(0, 8);
}

const REQUIRED = [
  'term', 'category', 'riskLevel', 'platforms', 'appliesTo',
  'reason', 'ruleSource', 'ruleDate', 'ruleUrl', 'suggestion', 'sourceVerified',
];
// 合规红线：这些词只能出现在 term 里（被检测的违规词本身），不能出现在解释里
const RED_LINE = ['规避', '绕过', '过审', '防封', '躲审查'];

let errors = 0;

// 模式层独立语义指纹：在 [9] 处赋值、在末尾汇总处引用，故须声明在函数级作用域。
// （曾因声明在块内导致末尾 ReferenceError ——「第一次失败就停手」也不总能避免，需加自检。）
let patternFp = null;
const fail = (msg) => { console.log(`  ✗ ${msg}`); errors++; };
const pass = (msg) => console.log(`  ✓ ${msg}`);

console.log(`\nCheckGate 规则库一致性校验  ${data.version || '(无版本号)'}\n`);

// ── 1. 必填字段 ──
console.log('[1] 必填字段完整性');
const missing = [];
for (const w of words) {
  for (const k of REQUIRED) {
    if (!w[k] || (Array.isArray(w[k]) && w[k].length === 0)) missing.push(`${w.term}.${k}`);
  }
}
missing.length ? fail(`${missing.length} 处缺失: ${missing.slice(0, 5).join(', ')}`)
               : pass(`${words.length} 条全部字段完整`);

// ── 2. 合规红线 ──
console.log('\n[2] 合规红线（解释中不得出现规避类表述）');
const redline = [];
for (const w of words) {
  for (const f of ['reason', 'suggestion']) {
    for (const k of RED_LINE) if ((w[f] || '').includes(k)) redline.push(`${w.term}.${f}`);
  }
}
redline.length ? fail(`${redline.length} 处违规: ${redline.slice(0, 5).join(', ')}`)
               : pass('零违规表述');

// ── 3. 交叉一致性（核心） ──
console.log('\n[3] 交叉一致性：ruleSource 的平台依据 ⊆ platforms');
const mismatch = [];
for (const w of words) {
  const src = w.ruleSource || '';
  const hasNational = NATIONAL_KEYS.some((k) => src.includes(k));
  for (const [plat, keys] of Object.entries(PLATFORM_KEYS)) {
    const named = keys.some((k) => src.includes(k));
    if (named && !w.platforms.includes(plat)) {
      mismatch.push(`${w.term}（依据含${plat}但 platforms 无）`);
    }
  }
}
mismatch.length
  ? fail(`${mismatch.length} 处张冠李戴: ${mismatch.slice(0, 5).join(', ')}`)
  : pass('无张冠李戴');

// ── 4. 收录范围分布 ──
console.log('\n[4] 收录范围分布（引用此数据前请核对此处）');
const combo = {};
for (const w of words) {
  const k = [...w.platforms].sort().join('+');
  combo[k] = (combo[k] || 0) + 1;
}
const total = words.length;
for (const [k, v] of Object.entries(combo).sort((a, b) => b[1] - a[1])) {
  console.log(`     ${String(v).padStart(4)} 条 (${(v / total * 100).toFixed(1)}%)  ${k}`);
}

// ── 5. 溯源状态分布 ──
console.log('\n[5] 溯源状态分布');
const sv = {};
for (const w of words) sv[w.sourceVerified] = (sv[w.sourceVerified] || 0) + 1;
for (const [k, v] of Object.entries(sv)) console.log(`     ${String(v).padStart(4)} 条  ${k}`);

// ── 6. 重复词 ──
console.log('\n[6] 重复词检查');
const seen = {};
for (const w of words) seen[w.term] = (seen[w.term] || 0) + 1;
const dups = Object.entries(seen).filter(([, c]) => c > 1);
dups.length ? fail(`重复词 ${dups.length} 个: ${dups.slice(0, 5).map(([t]) => t).join(', ')}`)
            : pass('无重复词');

// ── 7. coverage 元数据 vs 实际 ──
console.log('\n[7] coverage 元数据与底层一致性');
const cov = data.coverage || {};
const cat = {}, risk = {}, scope = {};
for (const w of words) {
  cat[w.category] = (cat[w.category] || 0) + 1;
  risk[w.riskLevel] = (risk[w.riskLevel] || 0) + 1;
  scope[w.appliesTo] = (scope[w.appliesTo] || 0) + 1;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
cov.total === total ? pass(`total ${total}`) : fail(`total 声明 ${cov.total} ≠ 实际 ${total}`);
eq(cov.byRiskLevel, risk) ? pass('byRiskLevel 一致') : fail(`byRiskLevel 不一致: 声明${JSON.stringify(cov.byRiskLevel)} 实际${JSON.stringify(risk)}`);
eq(cov.byScope, scope) ? pass('byScope 一致') : fail(`byScope 不一致: 声明${JSON.stringify(cov.byScope)} 实际${JSON.stringify(scope)}`);

// ── 8. 日期语义检查（v1.4 新增） ──
console.log('\n[8] 日期语义：ruleDateKind 与 verifiedAt');
const kinds = {};
let kindMissing = 0;
for (const w of words) {
  if (!w.ruleDateKind || !w.verifiedAt) { kindMissing++; continue; }
  kinds[w.ruleDateKind] = (kinds[w.ruleDateKind] || 0) + 1;
}
kindMissing ? fail(`${kindMissing} 条缺 ruleDateKind/verifiedAt`) : pass('全部条目有 ruleDateKind + verifiedAt');
for (const [k, v] of Object.entries(kinds)) {
  const meaning = { '公布日': '法规公布/修订日', '生效日': '规则正式施行日', '整理日期': '我们核对该条之日' }[k] || '?';
  console.log(`     ${String(v).padStart(4)} 条  ${k}（${meaning}）`);
}
// 整理日期应等于 verifiedAt
const dateMismatch = words.filter((w) => w.ruleDateKind === '整理日期' && w.ruleDate !== w.verifiedAt);
dateMismatch.length
  ? fail(`${dateMismatch.length} 条「整理日期」的 ruleDate 与 verifiedAt 不一致`)
  : pass('「整理日期」条目 ruleDate === verifiedAt');

// ── 9. 模式层（patternRules）检查 ──
console.log('\n[9] 模式层 patternRules');
const pats = data.patternRules || [];
if (!pats.length) {
  console.log('     （无模式规则）');
} else {
  let patMissing = 0;
  for (const pr of pats) {
    // 排除机制二选一：exclude（单字）或 excludeWords（完整词），至少有一个非空
    const hasExclude = (pr.exclude && pr.exclude.length) || (pr.excludeWords && pr.excludeWords.length);
    for (const k of ['id', 'label', 'pattern', 'riskLevel', 'category', 'reason', 'ruleSource', 'ruleUrl', 'suggestion', 'sourceVerified']) {
      if (!pr[k]) { patMissing++; break; }
    }
    if (!hasExclude) { patMissing++; }
  }
  patMissing ? fail(`${patMissing} 条模式规则字段缺失`) : pass(`${pats.length} 条模式规则字段完整`);
  // 模式层独立语义指纹 —— 供内容侧实测表引用，规则库变了指纹即失效
  // 🔴 必须在块外声明：本文件末尾的汇总输出也要引用它。
  // （曾因定义在 [9] 的块内、而末尾汇总在块外引用，导致 ReferenceError。）
  const patSem = pats
    .map((p2) => `${p2.id}|${p2.pattern}|${p2.riskLevel}|${(p2.excludeWords || []).join(',')}|${(p2.exclude || []).join(',')}`)
    .sort()
    .join('\n');
  patternFp = crypto.createHash('md5').update(patSem, 'utf8').digest('hex').slice(0, 8);
  console.log(`     模式层语义指纹 ${patternFp}（引用此指纹即代表引用了当前模式层行为）`);
  // 模式层必须为 medium（推测不装确证）
  const badLevel = pats.filter((p2) => p2.riskLevel !== 'medium');
  badLevel.length
    ? fail(`${badLevel.length} 条模式规则风险等级非 medium（推测不得标为确证）`)
    : pass('模式层风险等级统一为 medium（推测不装确证）');
  // 模式层必须带"如何自行核对"的说明
  const noHint = pats.filter((p2) => !p2.matchHint || !p2.dedupeHint);
  noHint.length ? fail(`${noHint.length} 条模式规则缺 matchHint/dedupeHint`) : pass('模式层均带 matchHint + dedupeHint');

  // 排除词表不得排除掉规则库里的高危词本身
  const highTerms = new Set(words.filter((w) => w.riskLevel === 'high').map((w) => w.term));
  const conflict = [];
  for (const pr of pats) {
    const ex = pr.excludeWords || pr.exclude || [];
    for (const e of ex) {
      if (highTerms.has(e)) conflict.push(`${pr.id} 排除了高危词「${e}」`);
      // 词级排除：若排除词本身是某高危词的前缀，也算冲突
      for (const t of highTerms) {
        if (t.length > e.length && t.startsWith(e)) { conflict.push(`${pr.id} 排除了「${e}」，会漏掉高危词「${t}」`); break; }
      }
    }
  }
  conflict.length
    ? fail(`${conflict.length} 处排除词与高危词冲突: ${conflict.slice(0, 5).join('; ')}`)
    : pass('排除词表与高危词无冲突');
  for (const pr of pats) {
    const n = (pr.excludeWords || []).length || (pr.exclude || []).length;
    const unit = (pr.excludeWords || []).length ? '词' : '字';
    console.log(`     ${pr.id}: 「${pr.pattern}」排除 ${n} ${unit} · ${pr.riskLevel}`);
  }
}

// ── 10. PRD 快照过期检测（B 类数字必须与底层一致） ──
console.log('\n[10] PRD 6.5 核对表快照 vs 底层数据');
const prdPath = path.join(__dirname, '..', 'docs', '01-PRD-需求验证与产品规划.md');
try {
  const prd = fs.readFileSync(prdPath, 'utf8');
  // PRD 6.5 表里声明的快照
  const snap = prd.match(/规则库总条数 \| \*\*(\d+)\*\*（v([\d.]+) 快照，([\d-]+)）/);
  if (!snap) {
    console.log('     ⚠ PRD 6.5 未找到「条数（版本 快照日期）」格式的标注');
    console.log('       → 请按 6.7「两类数字规范」补齐，或确认尚未使用 B 类数字');
  } else {
    const [, n, ver, date] = snap;
    const same = String(n) === String(words.length);
    same ? pass(`条数一致：${n}`)
         : fail(`条数不一致：PRD 写 ${n}，底层 ${words.length} → PRD 6.5 已过期`);
    console.log(`     PRD 快照：v${ver} · ${date}`);
    console.log(`     底层 version：${data.version} · updatedAt：${data.updatedAt || '(无)'}`);
    if (data.updatedAt && data.updatedAt !== date) {
      console.log(`     ⚠ 快照日期(${date}) ≠ 数据 updatedAt(${data.updatedAt}) → 请重跑并更新 PRD 6.5`);
    }
    // 指纹比对：条数不变但内容变了（换了一批词）也能检出
    const fp = semanticFingerprint(words);
    const snapFp = prd.match(/指纹\s*`?([0-9a-f]{8})`?/);
    if (!snapFp) {
      console.log('     ⚠ PRD 6.5 未找到「指纹 xxxxxxxx」标注 → 请补齐，或确认尚未使用指纹');
    } else if (snapFp[1] !== fp) {
      fail(`指纹不一致：PRD ${snapFp[1]} ≠ 底层 ${fp} → 内容已变（可能条数未变但换了词）`);
    } else {
      pass(`指纹一致：${fp}`);
    }
  }
} catch (e) {
  console.log('     ⚠ 未找到 PRD 文件，跳过');
}

// [11] 指标指纹一致性 —— 防「改了三处，还有一百处是旧的」
// 本项目曾两次出现 PRD 内部数字分叉（2.3 说 353、2.6 说 376）。
// 指纹由 rules.json 的 metricsSnapshot 计算，任何指标变化都会让指纹改变，
// 文档里引用的旧指纹即失效——比对的是「快照」而非「散落在文档各处的数字」。
if (data.metricsFingerprint && data.metricsSnapshot) {
  console.log('\n[11] 指标指纹一致性');
  const live = {
    total: words.length,
    unique: Object.keys(seen).length,
    cats: cat, risks: risk, scope: scope, sv: sv, pfc: combo,
    patternRules: (data.patternRules || []).length
  };
  const liveFp = crypto.createHash('sha256').update(JSON.stringify(live)).digest('hex').slice(0, 16);
  if (liveFp === data.metricsFingerprint) {
    console.log(`  ✓ 指纹一致 ${liveFp}`);
    console.log('     文档中引用此指纹即代表引用了当前指标');
  } else {
    errors++;
    console.log(`  ✗ 指纹已变：记录 ${data.metricsFingerprint} → 实际 ${liveFp}`);
    console.log('     说明规则库指标已变更。文档内引用的旧数字需全部更新后再引用。');
  }
} else {
  console.log('\n[11] 指标指纹一致性');
  console.log('  ⚠ rules.json 缺少 metricsFingerprint，跳过（建议运行 tools/ 下的重算脚本）');
}


// ── 12. suggestion 自洽性（替换后不应再命中其他规则） ──
console.log('\n[12] suggestion 自洽性：替换文本不应含其他被禁词');
const terms = words.map((w) => w.term).filter((t) => t && t.length >= 2);
// 引用性动词：suggestion 在「引用」该词作依据/说明，而非建议用户改用它
// 引用性标记：必须紧跟在被引用词之后，才算「在引用它作依据」而非「建议用它」
// 收紧原因：'需有权威榜单佐证' 里的 '需有' 会让 '销量第一' 被误判为引用 → 漏判
const CITE_MARKERS = ['标注', '依据', '须有', '需取得', '需符合', '须符合', '真实成交', '说明', '参照', '或直接', '原定价'];
const selfBad = [];
for (const w of words) {
  const sug = w.suggestion || '';
  if (!sug) continue;
  for (const t of terms) {
    if (t === w.term) continue;
    if (!sug.includes(t)) continue;
    // 区分：引用标记须在该词之后（12 字内）出现，才算「引用它作依据」而非「建议用它」
    // 12 字：'如实标注原价与实际折扣依据' 中 '依据' 距 '原价' 约 7 字 → 需留余量
    const idx = sug.indexOf(t);
    const after = sug.slice(idx + t.length, idx + t.length + 12);
    if (CITE_MARKERS.some((m) => after.includes(m))) continue;
    // 二级判定：若该词本身是 low/medium 风险（本身非明确禁止项），不视为「替换后二次命中」
    const inner = words.find((x) => x.term === t);
    if (inner && inner.riskLevel !== 'high') continue;
    selfBad.push(`${w.term} → 含「${t}」`);
    break;
  }
}

// 自洽性检查的判定输出（必须紧跟计算块，否则 selfBad 尚未声明）
if (!selfBad.length) {
  pass('全部 suggestion 自洽（替换后不再命中其他规则）');
} else {
  fail(`${selfBad.length} 条 suggestion 含其他被禁词，替换后会二次命中`);
  for (const b of selfBad.slice(0, 8)) console.log(`       ${b}`);
  console.log('       → 「帮用户合规」的产品不能给出「替换后仍违规」的建议');
}


// ── 13. 指纹覆盖范围声明与实现一致性 ──
console.log('\n[13] 指纹覆盖范围声明');
const fpScope = data.fingerprintScope;   // 避免与第8项的 scope 变量重名
if (!fpScope || !fpScope.covered) {
  console.log('     ⚠ rules.json 缺少 fingerprintScope.covered 声明');
  console.log('       → 应声明指纹覆盖哪些字段，否则维护者无法知道「哪些字段变了不会告警」');
} else {
  const IMPL = ['term', 'riskLevel', 'platforms', 'ruleSource'];
  const same = fpScope.covered.length === IMPL.length && IMPL.every((k) => fpScope.covered.includes(k));
  same ? pass(`声明与实现一致（覆盖 ${fpScope.covered.length} 个字段）`)
       : fail(`声明与实现不一致：声明 [${fpScope.covered}] 实际 [${IMPL}]`);
  if (fpScope.notCovered && fpScope.notCovered.length) {
    console.log(`     未覆盖 ${fpScope.notCovered.length} 个字段（变化不触发 PRD 过期告警）`);
    console.log(`       → 由专项检查覆盖：suggestion[12] / 模式层[9] / coverage[7]`);
  }
}

console.log(`\n${'─'.repeat(52)}`);


if (errors === 0) {
  console.log(`✅ 全部通过（${words.length} 条）`);
  console.log(`\n供文档引用的数字：`);
  console.log(`  条数 ${total} | 唯一词 ${Object.keys(seen).length} | 重复 ${dups.length}`);
  console.log(`  分类 ${JSON.stringify(cat)}`);
  console.log(`  等级 ${JSON.stringify(risk)}`);
  console.log(`  作用域 ${JSON.stringify(scope)}`);
  console.log(`  收录 ${JSON.stringify(combo)}`);
  console.log(`  溯源 ${JSON.stringify(sv)}`);
  console.log(`  模式规则 ${(data.patternRules||[]).length} 条（统一 medium）｜模式层指纹 ${patternFp}`);
  process.exit(0);
} else {
  console.log(`❌ ${errors} 项未通过——请勿把当前数字写入任何文档`);
  process.exit(1);
}
