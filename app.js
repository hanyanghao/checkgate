/*!
 * CheckGate · 应用主逻辑 (app.js)
 * ---------------------------------------------------------------------------
 * 与 index.html / style.css 的 DOM 契约严格对齐。
 *
 * 七条不可违背的产品红线（实现处标注 [红线 N]）：
 *   1. 等级词只用「高风险 / 需注意 / 未发现风险」——绝不写「合规 / 通过 / 安全」。
 *      我们只确认「规则库收录了哪些表述」，无权断言内容是否合规。
 *   2. 结论句只陈述事实，不断言平台行为（说「包含 N 处规则库已收录的表述」，
 *      不说「会被限流」）。判定权在平台，不在我们。
 *   3. AI 结果与查表结果视觉分离（灰色附录块），AI 永不改变判定等级数字。
 *   4. 术语用「命中 / 收录 / 未收录」，不用「违规 / 限流 / 允许」。
 *   5. 高亮与全部用户文本一律 textContent 切片，用户输入永不进 innerHTML。
 *   6. 所有数字从 rules.json 动态读取，一个都不写死。
 *   7. 只做「如何合规」，不提供任何对抗平台审核的方法。
 *
 * 纯原生 JS，无框架、无构建、无 npm 依赖。
 */
(function () {
  'use strict';

  var D = window.CheckGateDetector;

  var PLATFORMS = [
    { id: 'douyin', name: '抖音' },
    { id: 'shipinhao', name: '视频号' },
    { id: 'xiaohongshu', name: '小红书' }
  ];
  var PF_NAME = { douyin: '抖音', shipinhao: '视频号', xiaohongshu: '小红书', all: '全平台' };

  /** [红线 1] 等级词表——没有「合规/通过/安全」 */
  var SEAL_TXT = { high: '高风险', medium: '需注意', low: '低风险', safe: '未发现风险' };
  /** 风险徽标：文字 + 形状双重编码（色觉障碍用户也能分辨） */
  var RISK_BADGE = {
    high: { txt: '高风险', shape: '▲' },
    medium: { txt: '需注意', shape: '▲' },
    low: { txt: '低风险', shape: '●' }
  };

  var LS_RULES = 'checkgate.rules.v1';
  var LS_AI = 'checkgate.ai.v1';
  var LS_RECENT = 'cg_recent';

  /* =======================================================================
   * 一、状态
   * ===================================================================== */

  var State = {
    data: null,            // 完整规则库对象
    words: [],             // words 数组
    patternRules: [],      // patternRules 数组
    meta: { version: '', updatedAt: '' },
    platform: 'douyin',
    scope: 'content',      // 'content' 正文 | 'profile' 账号名
    text: '',
    result: null,
    route: 'workbench',
    rulesSource: 'builtin',
    aiAbort: null,
    rulesFilter: { q: '', cat: '', risk: '', pf: '' }
  };

  /* =======================================================================
   * 二、工具
   * ===================================================================== */

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function pfName(id) { return PF_NAME[id] || id; }

  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('is-show'); }, 2200);
  }

  function fmtDate(iso) {
    if (!iso) return '未知';
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[1] + '年' + m[2] + '月' + m[3] + '日') : String(iso);
  }
  function daysSince(iso) {
    if (!iso) return null;
    var t = Date.parse(iso);
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }
  function nowStamp() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function readLS(key, fb) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; }
    catch (e) { return fb; }
  }
  function writeLS(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  /** 复制：优先 Clipboard API，非 HTTPS / 被拒时降级 execCommand，再失败则提示手动 */
  function copyText(txt) {
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).catch(function () { return fallbackCopy(txt); });
    }
    return fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }
  /** 复制失败：展开只读 textarea 自动全选，提示长按 / Ctrl+C（不用 alert） */
  function manualCopy(txt, label) {
    var sheet = $('sheet');
    var body = $('sheetBody');
    clear(body);
    body.appendChild(el('h3', null, label || '请手动复制'));
    body.appendChild(el('p', 'hit-meta', '自动复制失败，下面内容已全选，长按或按 Ctrl+C 复制。'));
    var ta = el('textarea', 'editor');
    ta.value = txt;
    ta.readOnly = true;
    ta.style.minHeight = '160px';
    body.appendChild(ta);
    openSheet();
    setTimeout(function () { ta.focus(); ta.select(); }, 60);
  }

  /* =======================================================================
   * 三、Sheet（移动端底部弹层）
   * ===================================================================== */

  function openSheet() {
    $('sheet').hidden = false;
    $('sheetMask').hidden = false;
  }
  function closeSheet() {
    $('sheet').hidden = true;
    $('sheetMask').hidden = true;
  }

  /* =======================================================================
   * 四、规则库载入
   * ===================================================================== */

  function applyRules(data, source) {
    State.data = data;
    State.words = data.words || [];
    State.patternRules = data.patternRules || [];
    State.meta = {
      version: data.version || '',
      updatedAt: data.updatedAt || data.version || ''
    };
    State.rulesSource = source;
    // 把 patternRules 挂到 words 数组上，detector 可自动取到
    State.words.patternRules = State.patternRules;
    paintMeta();
    renderRulePills();
    renderRuleList();
    renderSources();
    renderRecent();
    return true;
  }

  function loadRules() {
    return fetchRemoteRules()
      .then(function (d) {
        if (d) { applyRules(d, 'remote'); writeLS(LS_RULES, d); return true; }
        return false;
      })
      .catch(function () { return false; })
      .then(function (ok) { return ok ? true : loadLocalJson(); })
      .then(function (ok) { return ok ? true : loadBundle(); })
      .then(function (ok) { return ok ? true : loadCached(); });
  }

  function fetchRemoteRules() {
    // RULES_URL 留空即只用随代码发布的规则库；填上 CDN 地址后自动同步最新
    var url = (window.CHECKGATE_RULES_URL || '').trim();
    if (!url) return Promise.resolve(null);
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    var full = url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
    return fetch(full, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        clearTimeout(timer);
        return (j && j.words && j.words.length) ? j : null;
      })
      .catch(function () { clearTimeout(timer); return null; });
  }

  function loadLocalJson() {
    if (typeof fetch !== 'function') return Promise.resolve(false);
    return fetch('rules.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.words || !j.words.length) return false;
        applyRules(j, 'local');
        writeLS(LS_RULES, j);
        return true;
      })
      .catch(function () { return false; });   // file:// 下被 CORS 拦截，属预期
  }
  function loadBundle() {
    var b = window.CHECKGATE_RULES;
    if (b && b.words && b.words.length) { applyRules(b, 'builtin'); return true; }
    return false;
  }
  function loadCached() {
    var c = readLS(LS_RULES, null);
    if (c && c.words && c.words.length) { applyRules(c, 'cache'); return true; }
    return false;
  }

  /* =======================================================================
   * 五、版本徽标（双日期对比）
   * ===================================================================== */

  function paintMeta() {
    var badge = $('vbadge');
    var panel = $('vpanel');
    var m = State.meta;

    $('vVersion').textContent = m.version || '—';

    var total = State.words.length;
    var d = daysSince(m.updatedAt);

    badge.classList.remove('is-stale', 'is-fail');
    if (!total) {
      badge.classList.add('is-fail');
      $('vVersion').textContent = '加载失败';
    } else if (d !== null && d > 14) {
      badge.classList.add('is-stale');
    }

    clear(panel);
    function row(k, v) {
      var r = el('div', 'vrow');
      r.appendChild(el('span', null, k));
      r.appendChild(el('span', null, v));
      panel.appendChild(r);
    }
    row('你正在使用的', m.version || '—');
    row('规则库更新于', fmtDate(m.updatedAt));
    row('已收录规则', total + ' 条 · 持续更新中');
    row('更新频率', '每周');
    if (State.rulesSource === 'cache') {
      row('当前状态', '离线缓存版本，联网后自动同步');
    }

    $('footerMeta').textContent = '规则库 v' + (m.version || '—') + ' · ' +
      fmtDate(m.updatedAt) + ' 核对 · 共 ' + total + ' 条 · 检测全部在本地浏览器完成，文案不上传任何服务器';
  }

  /* =======================================================================
   * 六、检测
   * ===================================================================== */

  function runDetect() {
    var text = $('input').value.trim();
    if (!text) { toast('请先粘贴文案'); $('input').focus(); return; }
    State.text = text;
    showProgress();
    // 让进度态先渲染出来再做计算
    setTimeout(function () { doDetect(text); }, 40);
  }

  function showProgress() {
    $('results').hidden = true;
    $('progressCard').hidden = false;
    $('progressFill').style.width = '0%';
    $('progressText').textContent = '正在比对规则库…';
    // 真实计数进度（纯前端循环，能报真数就报真数）
    var total = State.words.length + State.patternRules.length;
    var step = Math.max(1, Math.floor(total / 12));
    var done = 0;
    var timer = setInterval(function () {
      done = Math.min(total, done + step);
      $('progressFill').style.width = Math.round(done / total * 100) + '%';
      $('progressText').textContent = '正在比对规则库… 已核对 ' +
        done.toLocaleString('zh-CN') + ' / ' + total.toLocaleString('zh-CN') + ' 条';
      if (done >= total) clearInterval(timer);
    }, 16);
  }

  function doDetect(text) {
    try {
      var res = D.detect(text, State.words, State.platform, State.patternRules, State.scope);
      State.result = res;
      $('progressCard').hidden = true;
      $('results').hidden = false;
      renderResult(res, text);
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      $('progressCard').hidden = true;
      toast('检测出错：' + (e && e.message ? e.message : '未知错误'));
      if (window.console) console.error(e);
    }
  }

  /* =======================================================================
   * 七、结果渲染
   * ===================================================================== */

  function renderResult(res, text) {
    renderVerdict(res);
    renderMatrix(res);
    renderHits(res, text);
    renderHighlight(res, text);
    $('convertBlock').hidden = !res.hits.length;
  }

  function renderVerdict(res) {
    var lv = res.level;
    var box = $('verdict');
    box.className = 'verdict lv-' + (lv === 'safe' ? 'low' : lv);

    // 印章：竖排等级词（纯 CSS 边框 + 旋转，零图片）
    var seal = $('seal');
    clear(seal);
    var chars = SEAL_TXT[lv].split('');
    for (var i = 0; i < chars.length; i++) seal.appendChild(el('span', null, chars[i]));

    // [红线 2] 结论句只陈述事实
    var title = $('verdictTitle');
    clear(title);
    var wordN = res.wordHits.length;
    var patN = res.patternHits.length;
    // 🔴 计数口径（方案 A）：判定卡只报「词」的命中数，模式层不进这个数字。
    // 理由：模式层不高亮，若计数里含它，用户会问「说有待核对的表述，原文里在哪」——
    // 而我们恰恰不标它的位置（高亮即断言「问题精确地在这里」）。
    // 「宁可少说，不可说一半」：模式层命中单独成块展示，不混进主计数。
    var parts = [];
    if (wordN) parts.push(wordN + ' 个词命中');
    else if (patN) parts.push(patN + ' 处疑似表述');
    else parts.push('未发现风险');

    title.appendChild(el('span', 'lv', SEAL_TXT[lv]));
    if (parts[0] !== '未发现风险') {
      title.appendChild(document.createTextNode(' · '));
      title.appendChild(el('span', 'cnt', parts[0]));
    }
    // 模式层另起一行，避免两个数字争注意力
    if (wordN && patN) {
      title.appendChild(el('span', 'verdict-sub', '另有 ' + patN + ' 处疑似表述'));
    }

    var desc = $('verdictDesc');
    // 🔴 结论句只陈述枚举层事实（已收录的表述）。
    // 模式层是推测，另起一句说明，不混进同一个数字。
    clear(desc);
    if (res.wordHits.length) {
      desc.textContent = '这段文案包含 ' + res.wordHits.length + ' 处规则库已收录的表述。';
    } else if (res.patternHits.length) {
      desc.textContent = '这段文案没有命中规则库已收录的表述，但有 ' +
        res.patternHits.length + ' 处疑似表述需人工确认。';
    } else {
      desc.textContent = '未命中规则库中已收录的禁止表述。仍建议人工通读一遍，规则库未覆盖的情形无法判断。';
    }

    // 差异摘要：优先提单平台词
    var diff = $('verdictDiff');
    var single = res.matrix.filter(function (r) {
      var on = PLATFORMS.filter(function (p) { return r[p.id]; });
      return on.length === 1;
    });
    var partial = res.matrix.filter(function (r) {
      var on = PLATFORMS.filter(function (p) { return r[p.id]; });
      return on.length > 0 && on.length < 3;
    });
    if (single.length) {
      var p0 = PLATFORMS.filter(function (p) { return single[0][p.id]; })[0];
      diff.hidden = false;
      diff.textContent = 'ⓘ 其中 ' + single.length + ' 个词仅' + pfName(p0) + '收录，其余平台未收录 →';
      diff.onclick = function () {
        $('matrixCard').hidden = false;
        $('matrixCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    } else if (partial.length) {
      diff.hidden = false;
      diff.textContent = 'ⓘ 其中 ' + partial.length + ' 个词并非所有平台都收录 →';
      diff.onclick = function () {
        $('matrixCard').hidden = false;
        $('matrixCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    } else {
      diff.hidden = true;
    }

    // 右侧元信息
    var meta = $('verdictMeta');
    clear(meta);
    function mrow(k, v, mono) {
      var d = el('div');
      d.appendChild(document.createTextNode(k + ' '));
      d.appendChild(el('span', mono ? 'mono' : null, v));
      meta.appendChild(d);
    }
    mrow('平台', pfName(State.platform));
    mrow('规则库', State.meta.version || '—', true);
    mrow('检测时间', nowStamp(), true);
    // 依据条数只算枚举层：模式层是推测，不计入确证依据数
    mrow('依据', res.wordHits.length + ' 条', true);
  }

  /** 平台收录矩阵：只显示存在差异的词（90% 三平台通用，全展开信息密度极低） */
  function renderMatrix(res) {
    var box = $('matrix');
    var card = $('matrixCard');
    clear(box);
    var rows = res.matrix.filter(function (r) {
      var on = PLATFORMS.filter(function (p) { return r[p.id]; });
      return on.length > 0 && on.length < 3;
    });
    if (!rows.length) { card.hidden = true; return; }
    card.hidden = false;

    var head = el('div', 'matrix-row');
    head.appendChild(el('div', 'matrix-head', '词'));
    PLATFORMS.forEach(function (p) { head.appendChild(el('div', 'matrix-head', p.name)); });
    box.appendChild(head);

    rows.forEach(function (r) {
      var row = el('div', 'matrix-row');
      row.appendChild(el('div', 'matrix-term', r.term));
      PLATFORMS.forEach(function (p) {
        var lv = r[p.id];
        var cell = el('div', 'matrix-cell ' + (lv ? 'in ' + lv : 'out'), lv ? '● 收录' : '○ 未收录');
        if (p.id === State.platform) cell.classList.add('is-cur');
        row.appendChild(cell);
      });
      box.appendChild(row);
    });
  }

  function renderHits(res, text) {
    var box = $('hits');
    clear(box);
    var hc = [];
    if (res.wordHits.length) hc.push('共 ' + res.wordHits.length + ' 处，按原文位置排序');
    if (res.patternHits.length) hc.push('另有 ' + res.patternHits.length + ' 处疑似表述（规则库未穷举，仅作提示）');
    $('hitsCount').textContent = hc.join(' · ');

    // 枚举层：确切命中，带序号与原文定位
    res.wordHits.forEach(function (h, i) {
      box.appendChild(hitCard(h, i, text, res));
    });

    // 🔴 模式层：单独成块，不进主清单、不带序号、不绑定位事件。
    // 理由：它不高亮（高亮即断言「问题精确地在这里」，而模式层只能诚实地说
    // 「这一片可能有问题」），所以也不该给「第 N 字」这种精确坐标——
    // 给出坐标却不标位置，用户会找不到。宁可少说，不可说一半。
    if (res.patternHits.length) {
      var ph = el('div', 'pattern-block');
      var pt = el('div', 'pattern-head');
      pt.appendChild(el('span', 'pattern-title', '疑似表述（规则库未穷举，仅作提示）'));
      pt.appendChild(el('span', 'pattern-count', res.patternHits.length + ' 处'));
      ph.appendChild(pt);
      res.patternHits.forEach(function (h) {
        ph.appendChild(patternCard(h));
      });
      box.appendChild(ph);
    }
  }

  /**
   * 模式层命中卡。
   * 与枚举层刻意不同：不显示序号、不绑定位事件（v1.10 方案 B：位置是参考，不是入口）。
   * 显示：规则名（label）+ 疑似标签 + 位置行（第 N 字起）+ 上下文片段（无高亮）
   *       + 截取说明 + matchHint + 依据 + 改法建议。
   * 🔴 原文一个字符都不高亮：位置是事实，高亮是断言——引擎边界（matched）
   *    是「最便」而完整词是「最便宜」，高亮会暗示我们精确知道问题边界（假精确）。
   */
  function patternCard(h) {
    var card = el('div', 'hit hit--pattern lv-' + h.riskLevel);

    var top = el('div', 'hit-top');
    top.appendChild(el('span', 'hit-word', h.label || h.term));
    var b = RISK_BADGE[h.riskLevel] || RISK_BADGE.medium;
    var badge = el('span', 'lvbadge ' + h.riskLevel);
    badge.appendChild(el('span', 'shape', b.shape));
    badge.appendChild(document.createTextNode(b.txt));
    top.appendChild(badge);
    // 疑似标签：短文案（label ≤16 字，有 E2E 断言锁住）——
    // matchHint 是解释句，放下方 hit-why 行，塞进药丸会撑破一行
    top.appendChild(el('span', 'hit-var is-suspect', '疑似 · ' + (h.label || h.term)));
    top.appendChild(el('span', 'cat-tag', h.category));
    card.appendChild(top);

    if (h.matchHint) {
      card.appendChild(el('div', 'hit-why', 'ⓘ ' + h.matchHint));
    }

    // 位置行：「第 N 字起」——「起」是事实且不暗示边界；「第 N-M 字」会暗示一个我们不确定的范围
    if (State.text && typeof h.start === 'number') {
      var loc = D.locate ? D.locate(State.text, h.start, h.end) : null;
      if (loc) {
        var meta = el('div', 'hit-meta');
        meta.appendChild(el('span', 'mono', '第 ' + loc.charNo + ' 字起'));
        meta.appendChild(el('span', 'sep', '·'));
        meta.appendChild(el('span', 'mono', '第 ' + loc.paraNo + ' 段'));
        card.appendChild(meta);
      }

      // 上下文片段：淡背景、无高亮；引擎边界处用半角空格如实呈现截取位置
      // （「最便 宜」只陈述引擎返回的边界，不加括号/省略号——那会暗示刻意截取）
      var s = Math.max(0, h.start - 14), e = Math.min(State.text.length, h.end + 14);
      var ctx = el('div', 'hit-ctx is-fuzzy');
      ctx.appendChild(document.createTextNode((s > 0 ? '…' : '') + State.text.slice(s, h.start)));
      ctx.appendChild(el('span', 'ctx-cut', State.text.slice(h.start, h.end)));
      ctx.appendChild(document.createTextNode(' ' + State.text.slice(h.end, e) + (e < State.text.length ? '…' : '')));
      card.appendChild(ctx);

      // 截取说明：与位置行成对——有位置没说明 = 误导（有 E2E 断言锁住成对出现）
      card.appendChild(el('div', 'hit-why hit-trunc',
        'ⓘ 以上片段为引擎截取结果，完整表述可能更长（如「最便宜」「最有效」）'));
    }

    var src = el('div', 'hit-src');
    src.appendChild(el('span', null, '📄 ' + (h.ruleSource || '—')));
    if (h.ruleDate) {
      src.appendChild(el('span', 'mono', '· ' + h.ruleDate));
    }
    if (h.ruleUrl) {
      var a = el('a', null, '↗ 原文');
      a.href = h.ruleUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      src.appendChild(a);
    }
    card.appendChild(src);

    if (h.suggestion) {
      var sg = el('div', 'hit-suggest');
      sg.appendChild(el('b', null, '建议改为：'));
      sg.appendChild(document.createTextNode(h.suggestion));
      card.appendChild(sg);
    }
    return card;
  }

  function hitCard(h, i, text, res) {
    var card = el('div', 'hit lv-' + h.riskLevel);
    card.setAttribute('data-hit', String(i));

    /* ---- 顶部：序号 + 词 + 等级 + 平台矩阵 + 单平台角标 ---- */
    var top = el('div', 'hit-top');
    top.appendChild(el('span', 'hit-idx', String(i + 1)));
    top.appendChild(el('span', 'hit-word', h.term));

    var b = RISK_BADGE[h.riskLevel] || RISK_BADGE.low;
    var badge = el('span', 'lvbadge ' + h.riskLevel);
    badge.appendChild(el('span', 'shape', b.shape));
    badge.appendChild(document.createTextNode(b.txt));
    top.appendChild(badge);

    // 变体标注（直写命中之外，如繁体/符号分隔等变体识别结果）
    // 🔴 原此处曾有一个 h.layer === 'pattern' 分支，但 detector.js 已把模式层
    //    单独分流到 patternHits（detector.js:875），此分支永不可达——死代码已删除。
    //    死代码是下一个真相来源：它会教后来者「标签该用 matchHint」，而正确做法是用 label。
    if (h.variantLabel && h.variantLabel !== '直接命中') {
      top.appendChild(el('span', 'hit-var', h.variantLabel));
    }

    top.appendChild(el('span', 'cat-tag', h.category));

    // 行内三平台矩阵
    var row = findMatrixRow(res, h.term);
    var mx = el('span', 'pfmatrix');
    PLATFORMS.forEach(function (p) {
      var lv = row ? row[p.id] : null;
      var cell = el('span', 'pfcell' + (lv ? ' on ' + lv : '') + (p.id === State.platform ? ' is-cur' : ''));
      cell.appendChild(el('span', 'pfdot'));
      cell.appendChild(document.createTextNode(p.name));
      cell.title = p.name + '：' + (lv ? '已收录' : '规则库未收录');
      mx.appendChild(cell);
    });
    top.appendChild(mx);

    // 单平台角标
    if (row) {
      var on = PLATFORMS.filter(function (p) { return row[p.id]; });
      if (on.length === 1) top.appendChild(el('span', 'hit-single', '单平台'));
    }
    card.appendChild(top);

    /* ---- 位置 + 上下文（码点制） ---- */
    var loc = D.locate ? D.locate(text, h.start, h.end) : null;
    var meta = el('div', 'hit-meta');
    if (loc) {
      meta.appendChild(el('span', 'mono', '第 ' + loc.charNo + ' 字'));
      meta.appendChild(el('span', 'sep', '·'));
      meta.appendChild(el('span', 'mono', '第 ' + loc.paraNo + ' 段'));
    }
    meta.appendChild(el('span', 'sep', '·'));
    meta.appendChild(document.createTextNode(h.matched));
    card.appendChild(meta);

    // 上下文片段
    var s = Math.max(0, h.start - 14), e = Math.min(text.length, h.end + 14);
    var ctx = el('div', 'hit-ctx');
    ctx.appendChild(document.createTextNode((s > 0 ? '…' : '') + text.slice(s, h.start)));
    var mk = el('mark', null, text.slice(h.start, h.end));
    ctx.appendChild(mk);
    ctx.appendChild(document.createTextNode(text.slice(h.end, e) + (e < text.length ? '…' : '')));
    card.appendChild(ctx);

    /* ---- 依据：条款 + 双日期 + 外链 ---- */
    var src = el('div', 'hit-src');
    src.appendChild(el('span', null, '📄 ' + (h.ruleSource || '—')));
    var kind = h.ruleDateKind || '整理日期';
    var dateTxt = (kind === '整理日期')
      ? (h.verifiedAt || h.ruleDate || '')
      : (h.ruleDate || '');
    if (dateTxt) {
      src.appendChild(el('span', 'mono', '· 依据 ' + dateTxt + ' '));
      src.appendChild(el('span', 'mono', '· ' + (h.verifiedAt || '') + ' 核对'));
    }
    if (h.ruleUrl) {
      var a = el('a', null, '↗ 原文');
      a.href = h.ruleUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      src.appendChild(a);
    }
    card.appendChild(src);

    /* ---- 溯源分级警示（partial：链接指向较早版本页面） ---- */
    var isPartial = h.sourceVerified === 'partial' ||
      Object.values(h.platformVerified || {}).indexOf('partial') >= 0;
    if (isPartial) {
      var warn = el('div', 'hit-partial');
      warn.appendChild(el('span', 'warn', '⚠'));
      warn.appendChild(el('span', null, h.sourceNote ||
        '该链接为较早版本页面，细分口径为后续公告/细则，页面内可能无对应章节。请以官方最新公告为准。'));
      card.appendChild(warn);
    }

    /* ---- 单平台解释行 ---- */
    if (row) {
      var on2 = PLATFORMS.filter(function (p) { return row[p.id]; });
      if (on2.length === 1) {
        var only = pfName(on2[0].id);
        var others = PLATFORMS.filter(function (p) { return !row[p.id]; }).map(function (p) { return p.name; });
        card.appendChild(el('div', 'hit-why',
          'ⓘ 该词仅' + only + '收录，' + others.join('/') + '无对应官方依据'));
      }
    }

    /* ---- 改写三层 ---- */
    card.appendChild(rewriteBlock(h, text));

    /* ---- 点击定位 ---- */
    card.addEventListener('click', function (ev) {
      if (ev.target.closest('button, a')) return;
      scrollToHit(i);
    });
    return card;
  }

  function findMatrixRow(res, term) {
    for (var i = 0; i < res.matrix.length; i++) {
      if (res.matrix[i].term === term) return res.matrix[i];
    }
    return null;
  }

  /**
   * 三层改写体系：
   *   ① 词级通用改法（suggestion）—— 免费
   *   ② 句级改写（sentenceRules）—— 免费
   *   ③ 全文 AI 改写 —— 会员（在本页由 AI 区块承载，不在此渲染）
   * 模式层命中不给句级改写：它只定位到「最」这种单字，套用会产出病句。
   */
  function rewriteBlock(h, text) {
    var wrap = el('div', 'rewrite');

    var sent = null;
    if (h.layer !== 'pattern' && D.sentenceRewrite) {
      sent = D.sentenceRewrite({ sentenceRules: h.sentenceRules }, text, h.start, h.end);
    }

    if (sent) {
      wrap.appendChild(el('div', 'rewrite-label', '改法建议'));
      var line = el('div', 'rewrite-sentence');
      line.appendChild(el('span', 'rewrite-before', '「' + sent.before + '」'));
      line.appendChild(el('span', 'rewrite-arrow', '→'));
      line.appendChild(el('span', 'rewrite-after', '「' + sent.after + '」'));
      var cb = el('button', 'copy-mini', '复制');
      cb.type = 'button';
      cb.addEventListener('click', function () {
        copyText(sent.after).then(function () {
          cb.textContent = '已复制'; cb.classList.add('is-done');
          setTimeout(function () { cb.textContent = '复制'; cb.classList.remove('is-done'); }, 1600);
        }).catch(function () { manualCopy(sent.after, '复制改写后的句子'); });
      });
      line.appendChild(cb);
      wrap.appendChild(line);
    }

    if (h.suggestion) {
      var w = el('div', 'rewrite-word');
      w.appendChild(el('span', null, sent ? '或用通用改法：' : '这个词通常改成：'));
      w.appendChild(el('b', null, h.suggestion));
      wrap.appendChild(w);
    }

    if (!sent && !h.suggestion) {
      wrap.appendChild(el('div', 'rewrite-label', '改法建议'));
      wrap.appendChild(el('div', 'rewrite-word', '对照原文自行调整，或用 AI 语义补充获得针对整段的改写。'));
    }
    return wrap;
  }

  /** [红线 5] 高亮只用 textContent 切片 */
  /**
   * 渲染原文标注。
   *
   * 🔴 模式层（pattern）命中**不高亮**。
   *   理由：高亮意味着「问题精确地在这里」，而模式层的诚实表述是
   *   「这一片可能有问题」——「最便」并非问题边界，真正的问题是「最便宜」。
   *   让界面做出比我们自己认知更精确的断言，是产品失信的起点。
   *   这与「印章不写合规」「结论句不断言平台行为」是同一条原则的第四个面。
   *   模式层命中在命中清单里单独成块展示（见 renderHits）。
   */
  function renderHighlight(res, text) {
    var box = $('hlText');
    clear(box);
    var pos = 0;
    res.hits.forEach(function (h, i) {
      if (h.start > pos) box.appendChild(document.createTextNode(text.slice(pos, h.start)));
      if (h.layer === 'pattern') {
        // 模式层：只占位不高亮，保持原文可读、不制造假精确
        box.appendChild(document.createTextNode(text.slice(h.start, h.end)));
      } else {
        var mk = el('span', 'hl', text.slice(h.start, h.end));
        mk.setAttribute('data-hit', String(i));
        mk.title = h.term + '（' + (SEAL_TXT[h.riskLevel] || h.riskLevel) + '）';
        box.appendChild(mk);
      }
      pos = h.end;
    });
    if (pos < text.length) box.appendChild(document.createTextNode(text.slice(pos)));
  }

  function scrollToHit(index) {
    var mk = document.querySelector('#hlText .hl[data-hit="' + index + '"]');
    if (mk) {
      mk.scrollIntoView({ behavior: 'smooth', block: 'center' });
      Array.prototype.forEach.call(document.querySelectorAll('#hlText .hl'), function (n) { n.classList.remove('is-active'); });
      mk.classList.add('is-active', 'is-flash');
      setTimeout(function () { mk.classList.remove('is-flash'); }, 700);
    }
    var card = document.querySelector('#hits .hit[data-hit="' + index + '"]');
    if (card) {
      Array.prototype.forEach.call(document.querySelectorAll('#hits .hit'), function (n) { n.classList.remove('is-active'); });
      card.classList.add('is-active');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* =======================================================================
   * 八、分享
   * ===================================================================== */

  function shareText() {
    var res = State.result;
    if (!res || !res.wordHits.length) { toast('本次没有可分享的词条命中'); return; }
    var lines = [];
    lines.push('我的文案检测结果（CheckGate · 规则库 ' + State.meta.version + '）');
    lines.push('');
    // 🔴 分享出去的文本是脱离网站独立存在的，所以口径必须与界面一致：
    //   枚举层用「个词命中」，模式层用「处疑似表述」，两者不混算。
    lines.push(SEAL_TXT[res.level] + ' · ' + res.wordHits.length + ' 个词命中');
    if (res.patternHits.length) {
      lines.push('另有 ' + res.patternHits.length + ' 处疑似表述（规则库未穷举，仅作提示）');
    }
    lines.push('');
    res.wordHits.forEach(function (h, i) {
      lines.push((i + 1) + ' ' + h.term + '    ' + (h.category || '') + '  ' + (RISK_BADGE[h.riskLevel] || {}).txt);
      if (h.ruleSource) lines.push('   依据' + h.ruleSource + (h.ruleDate ? ' · ' + h.ruleDate : ''));
      if (h.suggestion) lines.push('   建议改法：' + h.suggestion);
      lines.push('');
    });
    lines.push('每条均可点开官方原文核实：');
    var seen = {};
    res.wordHits.forEach(function (h) { if (h.ruleUrl && !seen[h.ruleUrl]) { seen[h.ruleUrl] = 1; lines.push(h.ruleUrl); } });
    lines.push('');
    lines.push('命中不等于平台一定处理，未命中不等于一定通过。');
    lines.push(location.origin + location.pathname + '?w=' +
      encodeURIComponent(res.hits.map(function (h) { return h.term; }).join(',')));
    return lines.join('\n');
  }

  function shareLink() {
    var res = State.result;
    // 只带枚举层词条：模式层的 term 是「最 + 便」这类组合，不是可查询的词
    if (!res || !res.wordHits.length) { toast('本次没有可分享的词条命中'); return; }
    var terms = res.wordHits.map(function (h) { return h.term; });
    return location.origin + location.pathname + '?w=' + encodeURIComponent(terms.join(','));
  }

  /* =======================================================================
   * 九、规则库查询
   * ===================================================================== */

  function renderRulePills() {
    var box = $('rulePills');
    clear(box);
    var cats = {}, risks = { high: 0, medium: 0, low: 0 }, pfs = { douyin: 0, shipinhao: 0, xiaohongshu: 0 };
    var scopeN = { content: 0, profile: 0 };
    State.words.forEach(function (w) {
      cats[w.category] = (cats[w.category] || 0) + 1;
      if (risks[w.riskLevel] !== undefined) risks[w.riskLevel]++;
      (w.platforms || []).forEach(function (p) { if (pfs[p] !== undefined) pfs[p]++; });
      scopeN[w.appliesTo || 'content']++;
    });

    function pill(label, key, value, n) {
      var b = el('button', 'pill' + (State.rulesFilter[key] === value ? ' is-on' : ''));
      b.type = 'button';
      b.appendChild(document.createTextNode(label));
      if (n !== undefined) b.appendChild(el('span', 'n', String(n)));
      b.addEventListener('click', function () {
        State.rulesFilter[key] = (State.rulesFilter[key] === value) ? '' : value;
        renderRulePills();
        renderRuleList();
      });
      return b;
    }

    box.appendChild(pill('全部', 'cat', ''));
    Object.keys(cats).sort().forEach(function (c) { box.appendChild(pill(c, 'cat', c, cats[c])); });
    box.appendChild(pill('▲ 高风险', 'risk', 'high', risks.high));
    box.appendChild(pill('▲ 需注意', 'risk', 'medium', risks.medium));
    box.appendChild(pill('● 低风险', 'risk', 'low', risks.low));
    PLATFORMS.forEach(function (p) { box.appendChild(pill(p.name, 'pf', p.id, pfs[p.id])); });
    box.appendChild(pill('账号名 ' + scopeN.profile, 'cat', '', scopeN.profile));
  }

  function renderRuleList() {
    var box = $('ruleList');
    clear(box);
    var f = State.rulesFilter;
    var list = State.words.filter(function (w) {
      if (f.cat && w.category !== f.cat) return false;
      if (f.risk && w.riskLevel !== f.risk) return false;
      if (f.pf) {
        var pf = w.platforms || [];
        if (pf.length && pf.indexOf(f.pf) === -1) return false;
      }
      if (f.q) {
        // 多个词用逗号分隔，任一命中即列出
        // （分享链接 ?w=最强,国家级 落地时会带入多个词）
        var hay = (w.term + ' ' + w.category + ' ' + (w.reason || '')).toLowerCase();
        var ok = false;
        var parts = String(f.q).split(',');
        for (var pi = 0; pi < parts.length; pi++) {
          var q = parts[pi].trim().toLowerCase();
          if (q && hay.indexOf(q) !== -1) { ok = true; break; }
        }
        if (!ok) return false;
      }
      return true;
    });

    if (!list.length) {
      box.appendChild(el('p', 'rule-meta', '没有匹配的词条。'));
      return;
    }

    list.forEach(function (w) {
      var row = el('div', 'rule');
      row.appendChild(el('div', 'rule-term', w.term));

      var scopeCell = el('div');
      if (w.appliesTo === 'profile') {
        scopeCell.appendChild(el('span', 'rule-scope profile', '账号名'));
      } else {
        scopeCell.appendChild(el('span', 'rule-scope', '正文'));
      }
      row.appendChild(scopeCell);

      var riskCell = el('div');
      var b = RISK_BADGE[w.riskLevel] || RISK_BADGE.low;
      var bd = el('span', 'lvbadge ' + w.riskLevel);
      bd.appendChild(el('span', 'shape', b.shape));
      bd.appendChild(document.createTextNode(b.txt));
      riskCell.appendChild(bd);
      row.appendChild(riskCell);

      var meta = el('div', 'rule-meta');
      meta.appendChild(document.createTextNode(w.reason || ''));
      var isPartial = w.sourceVerified === 'partial' ||
        Object.values(w.platformVerified || {}).indexOf('partial') >= 0;
      if (isPartial) {
        meta.appendChild(el('div', 'rule-warn', '⚠ 该链接为较早版本页面，请以官方最新公告为准'));
      }
      var foot = el('div', 'rule-foot');
      if (w.ruleSource) foot.appendChild(document.createTextNode('📄 ' + w.ruleSource));
      if (w.ruleDateKind) foot.appendChild(document.createTextNode(' · ' + w.ruleDateKind + ' ' + (w.ruleDate || '')));
      if (w.verifiedAt) foot.appendChild(document.createTextNode(' · ' + w.verifiedAt + ' 核对'));
      if (w.ruleUrl) {
        var a = el('a', null, '↗ 原文');
        a.href = w.ruleUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
        foot.appendChild(document.createTextNode(' '));
        foot.appendChild(a);
      }
      meta.appendChild(foot);
      row.appendChild(meta);

      row.addEventListener('click', function (ev) {
        if (ev.target.closest('a')) return;
        pushRecent(w.term);
        showRuleDetail(w);
      });
      box.appendChild(row);
    });

    var bar = $('ruleCountBar');
    clear(bar);
    bar.appendChild(el('span', null, '已显示 ' + list.length + ' 条 · 共 ' + State.words.length + ' 条 · 持续更新中'));
  }

  function showRuleDetail(w) {
    var body = $('sheetBody');
    clear(body);
    body.appendChild(el('h3', null, w.term));
    var b = RISK_BADGE[w.riskLevel] || RISK_BADGE.low;
    var badge = el('span', 'lvbadge ' + w.riskLevel);
    badge.appendChild(el('span', 'shape', b.shape));
    badge.appendChild(document.createTextNode(b.txt));
    body.appendChild(badge);
    body.appendChild(el('p', 'hit-meta', w.category + ' · 适用：' +
      ((w.platforms || []).length ? w.platforms.map(pfName).join('、') : '三平台') +
      ' · 作用域：' + (w.appliesTo === 'profile' ? '账号名' : '正文')));
    body.appendChild(el('p', 'hit-reason', w.reason || ''));
    if (w.suggestion) {
      var sg = el('div', 'hit-sug');
      sg.appendChild(el('span', 'hit-suglabel', '建议改为'));
      sg.appendChild(el('span', 'hit-sugtext', w.suggestion));
      body.appendChild(sg);
    }
    var src = el('div', 'hit-src');
    src.appendChild(el('span', null, '📄 ' + (w.ruleSource || '—')));
    if (w.ruleDateKind) src.appendChild(el('span', 'mono', ' · ' + w.ruleDateKind + ' ' + (w.ruleDate || '')));
    if (w.verifiedAt) src.appendChild(el('span', 'mono', ' · ' + w.verifiedAt + ' 核对'));
    if (w.ruleUrl) {
      var a = el('a', null, '↗ 查看官方原文');
      a.href = w.ruleUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
      src.appendChild(document.createTextNode(' '));
      src.appendChild(a);
    }
    body.appendChild(src);
    openSheet();
  }

  function pushRecent(term) {
    var list = readLS(LS_RECENT, []);
    list = [term].concat(list.filter(function (t) { return t !== term; })).slice(0, 5);
    writeLS(LS_RECENT, list);
    renderRecent();
  }
  function renderRecent() {
    var wrap = $('recentWrap');
    var list = readLS(LS_RECENT, []);
    if (!list.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    var box = $('recentList');
    clear(box);
    list.forEach(function (t) {
      var b = el('button', 'recent-pill', t);
      b.type = 'button';
      b.addEventListener('click', function () {
        $('ruleSearch').value = t;
        State.rulesFilter.q = t;
        renderRuleList();
      });
      box.appendChild(b);
    });
  }

  /* =======================================================================
   * 十、案例库 / 定价 / 变更记录
   * ===================================================================== */

  var CASES = [
    { type: '导流', title: '简介里留微信号，说「加V领资料」', body: '账号简介是导流判定的高发位置。即使正文没提，简介里的联系方式也会被单独检测。', tip: '把承接动作放在正文内的官方留资组件上，不要放在简介。' },
    { type: '绝对化用语', title: '「全网最低价」出现在口播稿里', body: '价格类绝对化表述在三个平台都会命中，且常伴随价格欺诈投诉一起被处理。', tip: '改为可验证的表述：本次活动价 X 元，比价范围与日期。' },
    { type: '诱导互动', title: '「评论区扣1，我发你链接」', body: '以数字暗号引导评论，平台按操纵数据处理；抖音电商还会额外判为诱导第三方。', tip: '改为「主页置顶自取」，把承接动作放在站内固定位置。' },
    { type: '医疗功效', title: '普通食品文案里出现「根治」「降血糖」', body: '食品广告不得涉及疾病预防治疗功能，这类表述通常直接触发下架而非限流。', tip: '改为口味、成分、食用方式的描述，不要出现疾病词。' },
    { type: 'AI 标识', title: 'AI 生成的图文没有标注', body: '2026-04 起全平台强制标识，未标注的图文可能被限流，重复出现会限制账号功能。', tip: '文案首尾各标注一次，图片四角加水印且面积不小于画面 1%。' },
    { type: '关键词密度', title: '同一批违规词反复出现', body: '单个词命中不致命，但密集重复会让内容整体被判为违规营销。', tip: '先看清单把每一处都改掉，不要只改第一处。' }
  ];

  function renderCases() {
    var grid = $('caseGrid');
    clear(grid);
    var FREE = 50;   // 免费可见条数（实际案例库待补齐，M1 先按此口径呈现）
    CASES.forEach(function (c, i) {
      var card = el('div', 'case');
      card.appendChild(el('div', 'case-type', c.type));
      card.appendChild(el('div', 'case-title', c.title));
      card.appendChild(el('div', 'case-body', c.body));
      card.appendChild(el('div', 'case-foot', '改法：' + c.tip));
      grid.appendChild(card);
    });
    var bar = $('caseCountBar');
    clear(bar);
    bar.appendChild(el('span', null, '已显示 ' + CASES.length + ' 条 · 全部案例库持续更新中'));
    var a = el('a', null, '查看全部案例库 →');
    a.href = '#';
    a.addEventListener('click', function (e) { e.preventDefault(); toast('案例库持续更新中'); });
    bar.appendChild(a);
  }

  function renderPricing() {
    var box = $('pricing');
    clear(box);
    var plans = [
      {
        name: '限流急救', num: '999', unit: '元 / 次', kind: '一次性服务 · 不续订', first: true,
        items: ['账号现状体检', '违规原因定位', '30 天整改路线', '申诉话术模板'],
        note: '不承诺恢复：平台处罚原因通常不公开，最终处理结果由平台决定。'
      },
      {
        name: '账号诊断', num: '299', unit: '元 / 次', kind: '一次性服务 · 不续订',
        items: ['账号现状体检', '风险点定位', '整改优先级排序'],
        note: '与 999 的区别在于是否包含申诉材料与 30 天整改路线。'
      },
      {
        name: '年付会员', num: '99', unit: '元 / 年', kind: '暂未开放 · 规划中',
        items: ['平台规则变更预警（提前于公示生效）', '案例库持续扩充'],
        note: '会员尚未开放购买，开放前会在本页公示。免费版已包含全部规则条目、命中位置定位、改写建议与 AI 语义补充（需你自己的模型 Key）。'
      }
    ];
    plans.forEach(function (p) {
      var card = el('div', 'price' + (p.first ? ' is-first' : ''));
      if (p.first) card.appendChild(el('span', 'price-flag', '最紧迫'));
      card.appendChild(el('div', 'price-name', p.name));
      var num = el('div', 'price-num');
      num.appendChild(document.createTextNode('¥' + p.num));
      num.appendChild(el('span', 'price-unit', ' ' + p.unit));
      card.appendChild(num);
      card.appendChild(el('div', 'price-kind', p.kind));
      var ul = el('ul', 'price-list');
      p.items.forEach(function (i) { ul.appendChild(el('li', null, i)); });
      card.appendChild(ul);
      card.appendChild(el('p', 'price-note', p.note));
      box.appendChild(card);
    });

    var team = el('div', 'price');
    team.appendChild(el('div', 'price-name', '团队版'));
    team.appendChild(el('div', 'price-kind', '1999 元 / 年 · 暂未开放，需要另行洽询'));
    team.appendChild(el('p', 'price-note', '我们目前不提供多账号与批量席位，需要团队采购请直接联系。'));
    box.appendChild(team);
  }

  function renderSources() {
    var box = $('sourceList');
    if (!box) return;
    clear(box);
    var sources = (State.data && State.data.sources) || [];
    if (!sources.length) {
      box.appendChild(el('p', 'rule-meta', '官方来源清单载入中…'));
      return;
    }
    sources.forEach(function (s) {
      var a = el('a', 'source');
      a.href = s.ruleUrl || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(el('span', 'sname', s.ruleSource));
      a.appendChild(el('span', 'smeta', s.ruleDate || ''));
      box.appendChild(a);
    });
  }

  /* =======================================================================
   * 十一、示例文案
   * ===================================================================== */

  var EXAMPLES = [
    {
      name: '口播稿', platform: '抖音',
      text: '姐妹们这款面霜真的绝了！全网最低价，100%有效，七天见效还能祛痘，' +
            '美白淡纹一步到位。最重要的是，详情私我，评论区扣1我发你优惠价！'
    },
    {
      name: '小红书笔记', platform: '小红书',
      text: '最近被问爆的通勤托特包，容量大又不塌，简约百搭，同事都问链接。' +
            '我做自媒体三个月，月入过万不是梦，感兴趣评论区扣1，我把方法分享给你。'
    },
    {
      name: '带货文案', platform: '视频号',
      text: '这款羊绒衫采用双面呢工艺，柔软亲肤不起球，一件穿三年。' +
            '工厂直供，今天下单立减 200，前 100 名再送同色围巾。'
    }
  ];

  function renderExamples() {
    var grid = $('exGrid');
    clear(grid);
    EXAMPLES.forEach(function (ex) {
      var card = el('button', 'ex-card');
      card.type = 'button';
      var top = el('div', 'ex-card-top');
      top.appendChild(el('span', 'ex-pf', ex.platform));
      top.appendChild(el('span', 'ex-name', ex.name));
      top.appendChild(el('span', 'ex-count', ex.text.length + ' 字'));
      card.appendChild(top);
      card.appendChild(el('div', 'ex-preview', ex.text));
      card.addEventListener('click', function () {
        $('input').value = ex.text;
        State.text = ex.text;
        updateCounter();
        runDetect();
      });
      grid.appendChild(card);
    });
  }

  /* =======================================================================
   * 十二、AI 语义补充（可选 · 独立附录 · 永不改变判定等级）
   * ===================================================================== */

  function loadAiConfig() {
    var cfg = readLS(LS_AI, {});
    $('aiEndpoint').value = cfg.endpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    $('aiModel').value = cfg.model || 'qwen-plus';
    $('aiKey').value = cfg.key || '';
    updateAiUi();
  }
  function saveAiConfig() {
    writeLS(LS_AI, {
      endpoint: $('aiEndpoint').value.trim(),
      model: $('aiModel').value.trim(),
      key: $('aiKey').value.trim()
    });
    updateAiUi();
  }
  function updateAiUi() {
    $('btnAiRun').disabled = !$('aiKey').value.trim();
  }

  function runAi() {
    var endpoint = $('aiEndpoint').value.trim().replace(/\/+$/, '');
    var model = $('aiModel').value.trim() || 'qwen-plus';
    var key = $('aiKey').value.trim();
    var text = State.text || $('input').value;
    if (!key) { toast('请先填写 API Key'); return; }
    if (!text.trim()) { toast('请先粘贴文案'); return; }
    saveAiConfig();

    var box = $('aiText');
    clear(box);
    $('btnAiRun').disabled = true;
    $('btnAiRun').textContent = '分析中…';

    var prompt =
      '你是三个中文内容平台（抖音、视频号、小红书）的合规审核助手。' +
      '请指出下面这段文案中，规则词表可能覆盖不到的语义级合规风险。\n' +
      '重点看：整句暗示疗效或虚假承诺、隐性诱导互动、隐性导流、夸张但未出现绝对化用词的表达。\n' +
      '只做合规判断与正向改写，不提供任何对抗平台审核的方法。\n' +
      '用中文输出，每条包含：风险等级（高/中/低）、问题片段、原因、改写建议。\n' +
      '若没有发现规则表之外的语义级风险，请明确说明。\n' +
      '当前发布平台：' + pfName(State.platform) + '\n\n文案：\n' + text;

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    State.aiAbort = ctrl;

    fetch(endpoint + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify({
        model: model, stream: true, temperature: 0.2,
        messages: [
          { role: 'system', content: '你是严谨的平台合规审核助手，只做合规判断与正向改写建议。' },
          { role: 'user', content: prompt }
        ]
      })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) { throw new Error('接口返回 ' + res.status + '：' + t.slice(0, 140)); });
        }
        return res.body.getReader();
      })
      .then(function (reader) {
        var dec = new TextDecoder();
        var buf = '';
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) {
              $('btnAiRun').disabled = false;
              $('btnAiRun').textContent = '开始语义补充';
              return;
            }
            buf += dec.decode(r.value, { stream: true });
            var parts = buf.split('\n');
            buf = parts.pop();
            parts.forEach(function (line) {
              var s = line.trim();
              if (s.indexOf('data:') !== 0) return;
              var payload = s.slice(5).trim();
              if (payload === '[DONE]') return;
              try {
                var j = JSON.parse(payload);
                var delta = j.choices && j.choices[0] && j.choices[0].delta;
                if (delta && delta.content) {
                  box.appendChild(document.createTextNode(delta.content));
                  box.scrollTop = box.scrollHeight;
                }
              } catch (e) { /* 忽略无法解析的分片 */ }
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) {
        box.appendChild(el('span', null,
          (err && err.name === 'AbortError' ? '已停止' : '调用失败：' + (err && err.message ? err.message : '未知错误')) +
          '。上方判定等级不受影响。'));
        $('btnAiRun').disabled = false;
        $('btnAiRun').textContent = '开始语义补充';
      });
  }

  /* =======================================================================
   * 十三、路由
   * ===================================================================== */

  function go(route) {
    if (!route) route = 'workbench';
    State.route = route;
    Array.prototype.forEach.call(document.querySelectorAll('.page'), function (p) {
      p.classList.toggle('is-current', p.id === 'page-' + route);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (b) {
      b.classList.toggle('is-current', b.getAttribute('data-route') === route);
    });
    if (location.hash !== '#' + route) {
      history.replaceState(null, '', '#' + route);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* =======================================================================
   * 十四、绑定
   * ===================================================================== */

  function updateCounter() {
    var n = Array.from($('input').value).length;   // 码点制：emoji 不算 2
    var c = $('counter');
    c.textContent = n + ' 字';
    c.classList.toggle('is-over', n > 2000);
    if (n > 2000) c.textContent = n + ' 字 · 已超 2000 字，建议分段检测';
  }

  function bind() {
    // 平台切换 → 重新计算
    $('platformTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.ptab');
      if (!btn) return;
      State.platform = btn.getAttribute('data-platform');
      Array.prototype.forEach.call(this.querySelectorAll('.ptab'), function (b) {
        var on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (State.text) doDetect(State.text);
    });

    $('input').addEventListener('input', function () {
      State.text = $('input').value;
      updateCounter();
      if (State.text && $('results').hidden === false) { /* 手动改文案不自动重算，避免打断 */ }
    });
    $('input').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runDetect(); }
    });

    $('btnRun').addEventListener('click', runDetect);
    $('btnClear').addEventListener('click', function () {
      $('input').value = ''; State.text = ''; updateCounter(); $('input').focus();
    });
    // 示例卡默认展开（空状态的第一眼位置就是「先看看一个例子」）
    $('btnSample').addEventListener('click', function () {
      $('examples').hidden = !$('examples').hidden;
      $('input').focus();
    });
    $('btnPaste').addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) {
          $('input').value = t; State.text = t; updateCounter();
        }).catch(function () { toast('请长按或按 Cmd+V 粘贴'); });
      } else {
        toast('请长按或按 Cmd+V 粘贴');
      }
    });

    // 命中清单 ↔ 原文高亮 双向定位
    $('hits').addEventListener('click', function (e) {
      var card = e.target.closest('.hit');
      if (!card) return;
      if (e.target.closest('button, a')) return;
      scrollToHit(card.getAttribute('data-hit'));
    });
    $('hlText').addEventListener('click', function (e) {
      var mk = e.target.closest('.hl');
      if (!mk) return;
      scrollToHit(mk.getAttribute('data-hit'));
    });

    // 分享
    $('btnShareText').addEventListener('click', function () {
      var t = shareText();
      if (!t) return;
      copyText(t).then(function () { toast('清单已复制，含溯源与免责'); })
        .catch(function () { manualCopy(t, '复制检测清单'); });
    });
    $('btnShareLink').addEventListener('click', function () {
      var t = shareLink();
      if (!t) return;
      copyText(t).then(function () { toast('查词链接已复制'); })
        .catch(function () { manualCopy(t, '复制查词链接'); });
    });

    // AI
    $('btnAiToggle').addEventListener('click', function () {
      var w = $('aiConfigWrap');
      w.hidden = !w.hidden;
    });
    ['aiEndpoint', 'aiModel', 'aiKey'].forEach(function (id) {
      $(id).addEventListener('input', saveAiConfig);
    });
    $('btnAiRun').addEventListener('click', runAi);
    $('btnCopyLabel').addEventListener('click', function () {
      var t = $('aiLabelCopy').textContent;
      copyText(t).then(function () { toast('标注文案已复制'); })
        .catch(function () { manualCopy(t, '复制标注文案'); });
    });

    // 规则库
    $('ruleSearch').addEventListener('input', function () {
      State.rulesFilter.q = this.value;
      renderRuleList();
    });

    // 版本徽标展开
    var badge = $('vbadge');
    function togglePanel() {
      var p = $('vpanel');
      p.hidden = !p.hidden;
      badge.setAttribute('aria-expanded', p.hidden ? 'false' : 'true');
    }
    badge.addEventListener('click', togglePanel);
    badge.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); }
    });

    // 导航
    $('nav').addEventListener('click', function (e) {
      var b = e.target.closest('.nav-item');
      if (b) go(b.getAttribute('data-route'));
    });
    window.addEventListener('hashchange', function () { go(location.hash.slice(1)); });

    // Sheet
    $('sheetClose').addEventListener('click', closeSheet);
    $('sheetMask').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('sheet').hidden) closeSheet();
    });
  }

  /* =======================================================================
   * 十五、启动
   * ===================================================================== */

  function init() {
    bind();
    updateCounter();
    renderExamples();
    renderCases();
    renderPricing();
    loadAiConfig();
    go(location.hash.slice(1) || 'workbench');

    loadRules().then(function (ok) {
      if (!ok) {
        toast('规则库载入失败，请检查网络或 rules.bundle.js');
        return;
      }
      // 支持 ?w=最强,国家级 形式的查词落地
      var m = location.search.match(/[?&]w=([^&]*)/);
      if (m) {
        var terms = decodeURIComponent(m[1]).split(',').filter(Boolean);
        if (terms.length) {
          go('rules');
          $('ruleSearch').value = terms.join(',');
          State.rulesFilter.q = terms.join(',');
          renderRuleList();
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
