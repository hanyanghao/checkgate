/*!
 * CheckGate 检测引擎 (detector.js)
 * ---------------------------------------------------------------------------
 * 纯浏览器原生 JS，零依赖、无构建步骤。同时兼容 Node（module.exports），
 * 供 test.js / verify.js 复用同一套逻辑，保证「测试通过 = 线上行为一致」。
 *
 * ============================ 核心设计 ============================
 *
 * 【1】一切匹配都发生在「规范化字符流」上，而不是原文。
 *      规范化包括：全角→半角、繁体→简体、英文小写、
 *      中文数字→阿拉伯数字、百分之N→N%、百分百→100%。
 *
 * 【2】位置还原靠「区间映射」而非「下标偏移」。
 *      切分文本时，每个规范化字符都携带它在原文中的区间 { o, e }。
 *      命中后直接取首尾字符的区间并集，即可精确还原到原文。
 *      这是高亮能落在正确位置的根本保证。
 *
 * 【3】变体识别采用「接受集合（accept set）」机制，而非逐条硬编码。
 *      规则词的每个字符都带一个可接受的等价字符集合（繁体形、同音字）。
 *      因此「薇信」「威信」都能命中规则词「微信」，且位置还原依然精确。
 *
 * 【4】插入式变体（微+信、公 众 号、加 我 微 信）由「分隔符跳隙」实现。
 *      文本被切分为「实义字符」与「分隔符」两类：
 *        · 实义字符 = 汉字、字母、数字、%、标点实体
 *        · 分隔符   = 空白与行内符号（+ * ~ · - _ | / 等）
 *      规则词与实义字符流对齐时，允许跨过连续的分隔符（上限 3 个）。
 *      而句读符号（。，、；：！？）被视为「语义边界」不可跨越，
 *      因此不会出现「最。好」被误判为「最好」这类假阳性。
 *
 * 【5】单次扫描产出全部结果。
 *      一遍规则匹配即可同时得到：命中列表、平台风险矩阵、平台差异。
 *      避免为每个平台重复扫描全文（长文性能关键）。
 *
 * ============================ 合规声明 ============================
 * 本引擎只做「如何合规」的判定与改写建议，不提供、也不描述任何
 * 规避平台审核的方法。所有命中原因均解释平台的合规逻辑与规则出处。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CheckGateDetector = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* =======================================================================
   * 一、基础字典
   * ===================================================================== */

  /**
   * 繁体 → 简体 对照表（成对书写：繁体在前，简体在后）。
   * 覆盖广告/电商/医疗/导流场景高频用字。用于「繁体输入」变体识别。
   */
  var T2S_PAIRS =
    '費费級级權权專专業业產产國国際际價价買买賣卖網网營营銷销醫医療疗藥药養养顏颜潔洁護护證证據据資资訊讯誠诚請请謝谢課课調调讚赞質质標标準准認认為为開开關关門门們们個个來来時时會会對对說说這这麼么後后過过還还現现進进遠远連连運运達达選选擇择適适應应當当機机設设備备屬属經经統统線线維维緊紧練练緣缘編编縣县總总績绩織织繼继續续罷罢罰罚羅罗義义習习聖圣聯联聰聪職职腦脑臉脸臨临舉举舊旧藝艺蘇苏蘭兰蟲虫衛卫補补裝装複复見见規规視视觀观訂订計计討讨訓训記记訪访許许訴诉診诊註注評评詞词試试該该詳详語语講讲識识議议讀读變变讓让豐丰財财貨货貧贫貴贵賓宾賞赏購购贈赠贊赞贏赢車车軍军軟软較较載载輕轻輛辆輝辉輪轮輸输轉转農农邊边過过運运遊游達达違违遙遥鄉乡醫医釋释鐘钟鐵铁鑑鉴閉闭間间關关陽阳陰阴隊队階阶際际隨随雖虽雙双雜杂雞鸡離离難难電电靈灵靜静韓韩題题額额飛飞養养馬马魚鱼鳥鸟鳳凤鴻鸿麗丽點点齊齐齒齿龍龙與与庫库廣广廠厂號号辦办務务華华銀银錢钱鐵铁錯错從从眾众體体傷伤僅仅傳传億亿優优償偿儲储兒儿內内兩两準准減减凱凯別别劃划劇剧勝胜勞劳勢势動动匯汇區区協协單单嚴严園园圓圆圖图場场塊块堅坚報报塵尘壓压壞坏壯壮夠够夢梦奧奥婦妇寧宁實实寫写寬宽層层帥帅師师幫帮幹干廚厨廳厅彈弹強强錄录徹彻懷怀戀恋掃扫攝摄敗败敵敌斷断術术檔档條条極极構构樞枢標标樹树檢检樓楼歐欧歲岁歷历歸归殘残殺杀毀毁氣气決决沒没測测溝沟滅灭滯滞灣湾潤润燈灯爭争爺爷牆墙獨独獲获環环盤盘睜睁矯矫碼码確确禮礼禍祸種种積积稱称穩稳窮穷竊窃競竞筆笔節节範范築筑簡简籃篮糧粮級级納纳紙纸終终結结絕绝統统絲丝經经綠绿網网緊紧練练緣缘編编縣县總总績绩織织繼继續续纖纤罷罢罰罚羅罗義义習习聖圣聯联聰聪職职腦脑臉脸臨临舉举舊旧藝艺蘇苏蘭兰蝦虾蠟蜡衛卫衝冲補补裝装複复見见規规視视親亲覺觉觀观訂订計计討讨訓训訊讯記记訪访設设許许訴诉診诊評评詞词試试詩诗話话該该詳详誠诚語语課课調调談谈請请論论諸诸講讲謝谢證证識识議议護护讀读變变讓让豐丰財财貨货貧贫貴贵買买費费資资賓宾賞赏賣卖質质購购贈赠贊赞贏赢車车軍军軟软較较載载輕轻輛辆輝辉輪轮輸输轉转農农邊边過过運运遊游達达違违遙遥鄉乡醫医釋释鐘钟鐵铁鑑鉴閉闭間间關关陽阳陰阴隊队階阶際际隨随雖虽雙双雜杂雞鸡離离難难電电靈灵靜静韓韩題题額额飛飞馬马駕驾魚鱼鳥鸟麗丽點点齊齐齒齿龍龙' +
    '與与專专別别將将臺台灣湾裡里後后髮发隻只幾几乾干幹干於于餘余嬰婴兒儿熱热營营燦灿燈灯爺爷牽牵獨独獲获獻献產产當当錄录彙汇絡络導导';

  /** 繁简映射：繁 → 简 */
  var T2S = Object.create(null);
  /** 简 → 繁（一个简体字可能对应多个繁体字，反向索引用于构建 accept 集合） */
  var S2T = Object.create(null);
  (function () {
    for (var i = 0; i < T2S_PAIRS.length; i += 2) {
      var trad = T2S_PAIRS.charAt(i);
      var simp = T2S_PAIRS.charAt(i + 1);
      if (trad === simp) continue;
      T2S[trad] = simp;
      if (!S2T[simp]) S2T[simp] = [];
      if (S2T[simp].indexOf(trad) === -1) S2T[simp].push(trad);
    }
  })();

  /**
   * 繁简表完整性自检。
   *
   * 这张表是「繁体紧挨简体」的无分隔符长串，一旦手工编辑时多写/少写一个字，
   * 后续所有配对都会整体错位，且不会抛错——只会让繁体识别静默失效。
   * 因此在模块加载时做一次强校验：
   *   1) 总长度必须为偶数（否则必然错位）
   *   2) 恒等对（繁简同形，如「防防」）无信息量，出现即说明错位
   *   3) 同一简体值可对应多个繁体字（如「发/發/髮」），这是正常的，不算错位
   *   4) 探针字必须能正确归一化
   * 校验失败时降级为「不做繁简转换」，宁可漏检也不产生错误归一化。
   */
  var T2S_OK = (function () {
    if (T2S_PAIRS.length % 2 !== 0) return false;
    var i;
    for (i = 0; i < T2S_PAIRS.length; i += 2) {
      // 恒等对 → 说明这对位置写错了（多写/少写一个字）
      if (T2S_PAIRS.charAt(i) === T2S_PAIRS.charAt(i + 1)) return false;
    }
    // 反向验证：常见的几个繁体字必须能正确归一化
    var probes = { '詳': '详', '費': '费', '醫': '医', '網': '网', '購': '购', '語': '语', '療': '疗', '產': '产', '個': '个' };
    for (var p in probes) {
      if (T2S[p] !== probes[p]) return false;
    }
    return true;
  })();

  if (!T2S_OK) {
    // 繁简表不可用 → 关闭繁简转换，避免错误归一化污染匹配结果
    T2S = Object.create(null);
    S2T = Object.create(null);
  }

  /**
   * 谐音 / 同音字等价组：同组字符在合规语义上等价（创作者常用同音字替换）。
   * 每组第一个字符为「代表字」。
   * 原则：只收录低频、组合后不构成常用词的字，避免误伤正常语义。
   */
  var HOMOPHONE_GROUPS = [
    ['微', '薇', '威', '危'],   // 微信 / 薇信 / 威信
    ['信', '鑫'],               // 微信 / 微鑫
    ['私', '思'],               // 私信 / 思信
    ['扣', '抠'],               // 扣1 / 抠1
    ['减', '剪'],               // 减肥 / 剪肥
    ['祛', '去'],               // 祛痘 / 去痘
    ['增', '争'],               // 增强 / 争强
    ['效', '笑'],               // 效果 / 笑果
    ['首', '手'],               // 首发 / 手发
    ['优', '忧'],               // 优惠 / 忧惠
    ['假', '甲'],               // 假一赔十 / 甲一赔十
    ['时', '十'],               // 限时 / 限十
    ['杀', '沙'],               // 秒杀 / 秒沙
    ['码', '马'],               // 二维码 / 二维马
    ['屏', '频'],               // 视频 / 视屏（常见错写）
    ['像', '象']                // 形象 / 形象
  ];

  /** 同音字代表字映射：任意同音字 → 代表字 */
  var HOMOPHONE_CANON = Object.create(null);
  /** 代表字 → 同组全部字符（含代表字自身） */
  var HOMOPHONE_GROUP_MEMBERS = Object.create(null);
  (function () {
    for (var g = 0; g < HOMOPHONE_GROUPS.length; g++) {
      var grp = HOMOPHONE_GROUPS[g];
      for (var k = 0; k < grp.length; k++) HOMOPHONE_CANON[grp[k]] = grp[0];
      HOMOPHONE_GROUP_MEMBERS[grp[0]] = grp.slice();
    }
  })();

  /**
   * 分隔符（行内符号 + 空白）：匹配规则词时允许跨过它们，
   * 从而识别「微+信」「公 众 号」这类插入式变体。
   * 刻意不含中文句读符号（。，、；：！？）——它们是语义边界，
   * 跨越会产生「最。好」误判为「最好」的假阳性。
   */
  var SEPARATOR_CHARS = ' \t\n\r 　+*_~·・-_|/\\=@#.';

  /** 语义边界字符：不可跨越 */
  var BOUNDARY_CHARS = '。，、；：！？“”‘’（）《》〈〉【】—…';

  /** 中文数字（含大写）→ 数值 */
  var CN_NUM = {
    '零': 0, '〇': 0, '一': 1, '壹': 1, '二': 2, '贰': 2, '两': 2, '三': 3, '叁': 3,
    '四': 4, '肆': 4, '五': 5, '伍': 5, '六': 6, '陆': 6, '七': 7, '柒': 7,
    '八': 8, '捌': 8, '九': 9, '玖': 9
  };
  /** 中文数字单位 */
  var CN_UNIT = { '十': 10, '拾': 10, '百': 100, '佰': 100, '千': 1000, '仟': 1000 };

  /** 可被解析为中文数字的字符 */
  var CN_NUM_CHARS = '零〇一壹二贰两三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟';

  /** 一次跳隙最多允许跨越的分隔符个数 */
  var MAX_GAP = 3;

  /* =======================================================================
   * 二、基础工具
   * ===================================================================== */

  function isSeparator(ch) {
    return SEPARATOR_CHARS.indexOf(ch) !== -1;
  }

  function isBoundary(ch) {
    return BOUNDARY_CHARS.indexOf(ch) !== -1;
  }

  /** 是否为表情符号 / 符号装饰（Unicode 区间判断，含代理对） */
  function isEmojiCode(cp) {
    return (
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x1f1e6 && cp <= 0x1f1ff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x2b00 && cp <= 0x2bff) ||
      (cp >= 0xe000 && cp <= 0xf8ff) ||
      cp === 0xfe0f || cp === 0x200d || cp === 0x20e3
    );
  }

  /** 全角 ASCII → 半角；全角空格 → 普通空格 */
  function toHalfWidth(ch) {
    var code = ch.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
    if (code === 0x3000) return ' ';
    return ch;
  }

  /** 繁体 → 简体 */
  function toSimplified(ch) {
    return T2S[ch] || ch;
  }

  /** 单字符规范化（不含数字转换）：全角→半角、繁→简、英文小写 */
  function canonChar(ch) {
    var c = toHalfWidth(ch);
    c = toSimplified(c);
    if (c >= 'A' && c <= 'Z') c = c.toLowerCase();
    return c;
  }

  /**
   * 解析连续中文数字，返回 { value, length }；非数字返回 null。
   * 支持：十、十五、二十、三十一、一百、一百二十三。
   */
  function parseCnNumber(text, start) {
    var i = start;
    var total = 0;
    var section = 0;
    var digit = 0;
    var hasAny = false;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (CN_NUM[ch] !== undefined) {
        digit = CN_NUM[ch];
        section = digit;
        hasAny = true;
        i++;
      } else if (CN_UNIT[ch] !== undefined) {
        var unit = CN_UNIT[ch];
        if (section === 0 && digit === 0) section = 1;   // 「十五」形式
        section = section * unit;
        total += section;
        section = 0;
        digit = 0;
        hasAny = true;
        i++;
      } else {
        break;
      }
    }
    if (!hasAny) return null;
    if (section !== 0) total += section;
    return { value: total, length: i - start };
  }

  /* =======================================================================
   * 三、文本切分：规范化字符流 + 原文位置映射
   * ===================================================================== */

  /**
   * 把原文切分为规范化字符流。
   *
   * cells[i] = {
   *   c   : 规范化后的字符
   *   o,e : 该字符在原文中的区间 [o, e)
   *   sep : 是否为分隔符（可被跳过的插入位）
   *   bnd : 是否为语义边界（不可跳过）
   * }
   *
   * - 表情符号被直接丢弃（不产生 cell），因此规则词可跨越它们匹配。
   * - 数字转换会把「一百」展开成 "100" 三个 cell，每个 cell 都指向
   *   同一个原文区间，命中时取区间并集即可精确还原。
   */
  function tokenize(text) {
    var cells = [];
    var i = 0;
    var len = text.length;

    while (i < len) {
      var code = text.codePointAt(i);
      var size = code > 0xffff ? 2 : 1;
      var ch = text.charAt(i);

      // 表情符号：丢弃（emoji 插入干扰由此被吸收）
      if (isEmojiCode(code)) { i += size; continue; }

      var canon = canonChar(ch);

      // 分隔符与语义边界：保留为 cell（sep/bnd 标记），匹配时可跳隙
      if (isSeparator(canon)) {
        cells.push({ c: canon, o: i, e: i + size, sep: true, bnd: false });
        i += size;
        continue;
      }
      if (isBoundary(canon)) {
        cells.push({ c: canon, o: i, e: i + size, sep: false, bnd: true });
        i += size;
        continue;
      }

      // 「百分之N」→ 百分数（如 百分之九十 → 90%；百分之百 → 100%）
      // 必须先于「百分百」判断，否则「百分之百」会被拆错。
      if (text.substr(i, 3) === '百分之') {
        var parsedPct = parseCnNumber(text, i + 3);
        if (parsedPct) {
          pushPercent(cells, parsedPct.value, i, i + 3 + parsedPct.length);
          i = i + 3 + parsedPct.length;
          continue;
        }
      }

      // 「百分百」→ 100%（口语化写法，3 字整体消费）
      // 排除「百分比」：那里第 3 个字是「比」，不等于「百」，自然不匹配。
      if (text.substr(i, 3) === '百分百') {
        pushPercent(cells, 100, i, i + 3);
        i += 3;
        continue;
      }

      // 连续中文数字 → 阿拉伯数字
      if (CN_NUM_CHARS.indexOf(ch) !== -1) {
        var parsed = parseCnNumber(text, i);
        if (parsed) {
          pushDigits(cells, String(parsed.value), i, i + parsed.length);
          i += parsed.length;
          continue;
        }
      }

      // 普通实义字符
      cells.push({ c: canon, o: i, e: i + size, sep: false, bnd: false });
      i += size;
    }
    return cells;
  }

  /** 把数字串逐位写入 cells，全部指向同一原文区间 */
  function pushDigits(cells, digits, o, e) {
    for (var k = 0; k < digits.length; k++) {
      cells.push({ c: digits.charAt(k), o: o, e: e, sep: false, bnd: false });
    }
  }

  /**
   * 写入百分数：如 90% 写成 9,0,% 三个 cell，全部指向同一原文区间。
   * 百分号必须保留为实义字符，否则「100%有效」会与「100有效」混淆。
   */
  function pushPercent(cells, value, o, e) {
    pushDigits(cells, String(value), o, e);
    cells.push({ c: '%', o: o, e: e, sep: false, bnd: false });
  }

  /* =======================================================================
   * 四、规则词 → 匹配模式
   * ===================================================================== */

  /**
   * 为一个字符构建「接受集合」：本字 + 繁体形 + 同音字。
   * 例如规则词「微信」第 0 位 accept = { 微, 薇, 威, 危 }。
   */
  function buildAccept(ch) {
    var set = Object.create(null);
    function add(c) { if (c) set[c] = true; }
    var base = canonChar(ch);
    add(base);
    if (S2T[base]) {
      for (var i = 0; i < S2T[base].length; i++) add(S2T[base][i]);
    }
    var rep = HOMOPHONE_CANON[base];
    if (rep && HOMOPHONE_GROUP_MEMBERS[rep]) {
      var members = HOMOPHONE_GROUP_MEMBERS[rep];
      for (var j = 0; j < members.length; j++) add(members[j]);
    }
    return set;
  }

  /**
   * 把规则词编译为可匹配模式。
   * accepts[i] 是第 i 位的可接受字符集合；len 为模式长度。
   * 别名（aliases）用于表达「拼音替代 / 特殊写法」，同样走 accept 机制。
   */
  function compileRule(rule) {
    var variants = [{ text: rule.term, kind: 'term' }];
    if (rule.aliases && rule.aliases.length) {
      for (var i = 0; i < rule.aliases.length; i++) {
        variants.push({ text: rule.aliases[i], kind: 'alias' });
      }
    }
    var patterns = [];
    for (var v = 0; v < variants.length; v++) {
      var raw = variants[v].text;
      if (!raw) continue;
      var cells = tokenize(raw);
      // 规则词自身不含分隔符（若含，视为可跳过的插入位）
      var accepts = [];
      for (var c = 0; c < cells.length; c++) {
        if (cells[c].sep) continue;
        accepts.push(buildAccept(cells[c].c));
      }
      if (!accepts.length) continue;
      patterns.push({ accepts: accepts, kind: variants[v].kind, raw: raw, len: accepts.length });
    }
    return patterns;
  }

  /**
   * 倒排索引：首字符 → 模式列表。
   * 只在首字符可能匹配的位置尝试完整匹配，长文性能的关键。
   */
  function buildIndex(rules) {
    var index = Object.create(null);
    for (var r = 0; r < rules.length; r++) {
      var rule = rules[r];
      var patterns = rule._compiled || (rule._compiled = compileRule(rule));
      for (var p = 0; p < patterns.length; p++) {
        var first = patterns[p].accepts[0];
        for (var key in first) {
          if (!first[key]) continue;
          if (!index[key]) index[key] = [];
          index[key].push({ rule: rule, pattern: patterns[p] });
        }
      }
    }
    return index;
  }

  /* =======================================================================
   * 五、匹配
   * ===================================================================== */

  /**
   * 从 cells[pos] 起尝试匹配模式。
   * 允许跨过连续分隔符（上限 MAX_GAP 个），
   * 但不能跨过语义边界字符（bnd），也不能跨过实义字符。
   * 返回 { end, lastMatched } 表示匹配到的实义字符位置与最后一个实义 cell。
   */
  function tryMatchFrom(cells, pos, pattern) {
    var pi = 0;                 // 模式进度
    var ti = pos;               // 文本进度
    var gap = 0;                // 当前跳过的分隔符数
    var n = cells.length;
    var lastMatched = -1;

    while (pi < pattern.len) {
      if (ti >= n) return null;
      var cell = cells[ti];

      if (cell.bnd) return null;                    // 语义边界：不可跨越
      if (cell.sep) {                              // 分隔符：跳隙
        gap++;
        if (gap > MAX_GAP) return null;
        ti++;
        continue;
      }

      // 实义字符：尝试匹配模式当前位
      if (pattern.accepts[pi][cell.c]) {
        pi++;
        gap = 0;
        lastMatched = ti;
        ti++;
        continue;
      }
      return null;                                  // 实义字符不匹配 → 失败
    }
    return { end: ti, lastMatched: lastMatched };
  }

  /**
   * 在规范化字符流中查找某模式的所有命中。
   * 每个命中含原文区间 [o, e) 与规范化片段。
   */
  function matchPattern(cells, pattern) {
    var hits = [];
    var n = cells.length;
    if (!pattern.len || n < pattern.len) return hits;

    for (var start = 0; start < n; start++) {
      var cell = cells[start];
      if (cell.sep || cell.bnd) continue;           // 模式必须从实义字符起
      if (!pattern.accepts[0][cell.c]) continue;     // 倒排索引已过滤，此处为保险

      var res = tryMatchFrom(cells, start, pattern);
      if (!res) continue;

      var o = cell.o;
      var e = cells[res.lastMatched].e;
      hits.push({
        start: start,
        end: res.lastMatched,
        o: o,
        e: e,
        matched: cells.slice(start, res.lastMatched + 1)
          .filter(function (x) { return !x.sep; })
          .map(function (x) { return x.c; })
          .join('')
      });
      start = res.lastMatched;                      // 避免重叠命中同一段
    }
    return hits;
  }

  /**
   * 判定命中属于哪一种变体类型（用于界面提示与测试断言）。
   * 依据：原文命中片段与规范化片段的差异。
   */
  function classifyVariant(original, matched) {
    var hasTrad = false, hasFull = false, hasDigit = false;
    var hasHomophone = false, hasSpace = false, hasSymbol = false, hasEmoji = false;

    for (var i = 0; i < original.length; i++) {
      var ch = original.charAt(i);
      var cp = original.codePointAt(i);
      if (cp > 0xffff) i++;
      if (isEmojiCode(cp)) { hasEmoji = true; continue; }
      if (ch === ' ' || ch === '\t' || ch === '　' || ch === '\n' || ch === '\r') { hasSpace = true; continue; }
      if (isSeparator(ch)) { hasSymbol = true; continue; }
      if (T2S[ch]) { hasTrad = true; continue; }
      var cc = canonChar(ch);
      if (cc >= '０' && cc <= '９') { hasFull = true; continue; }
      if (CN_NUM_CHARS.indexOf(ch) !== -1) { hasDigit = true; continue; }
      if (HOMOPHONE_CANON[ch] && HOMOPHONE_CANON[ch] !== ch) { hasHomophone = true; }
    }
    // 原文含数字而规范化片段不含（或反之）→ 数字替换
    var origHasDigit = /[0-9]/.test(original);
    var matchedHasDigit = /[0-9]/.test(matched);
    if (origHasDigit !== matchedHasDigit) hasDigit = true;

    if (hasEmoji) return { type: 'emoji', label: '表情干扰' };
    if (hasSpace) return { type: 'space', label: '空格分隔' };
    if (hasSymbol) return { type: 'symbol', label: '符号分隔' };
    if (hasTrad) return { type: 'traditional', label: '繁体字' };
    if (hasDigit) return { type: 'digit', label: '数字替换' };
    if (hasFull) return { type: 'fullwidth', label: '全角字符' };
    if (hasHomophone) return { type: 'homophone', label: '同音字替换' };
    return { type: 'exact', label: '直接命中' };
  }

  /* =======================================================================
   * 五·附、模式层匹配（枚举型风险）
   * ------------------------------------------------------------------------
   * 词条层解决不了「最便宜」「保证有效」这类问题：属性词可以无限组合，
   * 穷举词表永远滞后。正解是两层：
   *   词条层（words）  —— 确证违规，直接给依据
   *   模式层（patternRules）—— 枚举型风险，只给 medium + 标 partial
   *
   * 设计取舍：
   * ① 模式层只给 medium，不给 high。「最+便宜」是否违规取决于完整语境
   *    与平台执法口径，我们不做确证。宁可漏判也不误判——误判会直接
   *    摧毁"我们准"的定位。
   * ② 必须有 exclude 白名单。「最后」「最近」「最爱」是正常表达，
   *    不排除就是灾难性误报。
   * ③ 命中后要给完整上下文，让用户自己判断，而不是替他下结论。
   * ===================================================================== */
  function matchPatternRules(src, cells, prules, platform) {
    var out = [];
    if (!prules || !prules.length) return out;

    for (var i = 0; i < prules.length; i++) {
      var pr = prules[i];
      if (!pr || !pr.pattern) continue;
      var scope = pr.platforms && pr.platforms.length ? pr.platforms : PLATFORMS;
      if (platform !== 'all' && scope.indexOf(platform) === -1) continue;

      // 排除表：优先读词级（excludeWords），回退单字（exclude）。
      // 🔴 词级优先的原因：单字排除无法区分「最好」（违规）与「最自…」（可能正常）。
      // 两者并存时以词级为准——它更精确，不会误杀「最需要」「最自然」。
      var exclude = (pr.excludeWords && pr.excludeWords.length) ? pr.excludeWords : (pr.exclude || []);
      // pattern 可能是单字（「最」）或多字（「保证」），先切成字符序列
      var patChars = Array.from(pr.pattern).map(function (ch) { return canonChar(ch); });
      var patLen = patChars.length;
      if (!patLen) continue;

      var forPlat = (pr.platformRisk && pr.platformRisk[platform]) || pr.riskLevel || 'medium';

      for (var s = 0; s <= cells.length - patLen; s++) {
        // 跳过分隔符位置
        if (cells[s].sep || cells[s].bnd) continue;

        // 模式字需连续匹配
        var matchedAll = true;
        for (var m = 0; m < patLen; m++) {
          var cc = cells[s + m];
          if (!cc || cc.sep || cc.bnd || cc.c !== patChars[m]) { matchedAll = false; break; }
        }
        if (!matchedAll) continue;

        var patEnd = s + patLen - 1;

        // 取模式之后的下一个实义字符，作为判断依据（「最」+ 便 / 保」+ 证）
        var nextCh = null;
        for (var k = patEnd + 1; k < cells.length; k++) {
          // 🔴 句读边界必须中断，不能跨句取字。
          // BND 覆盖「。！？；：」等；半角逗号/句号归一化后不在 BND 里，需单独判定。
          if (cells[k].bnd) break;
          if (PAUSE_CHARS.indexOf(cells[k].c) !== -1) break;
          if (cells[k].sep) continue;
          nextCh = cells[k].c;
          break;
        }
        // 「保证」本身已构成完整风险词，无需后接字符
        var needNext = patLen === 1;
        var nxtIdx = -1;
        for (var k2 = patEnd + 1; k2 < cells.length; k2++) {
          if (cells[k2].bnd) break;
          if (PAUSE_CHARS.indexOf(cells[k2].c) !== -1) break;
          if (cells[k2].sep) continue;
          nxtIdx = k2;
          break;
        }
        // 模式字与下一个实义字符之间若隔了句读 → 不是「最+性质词」结构
        if (needNext && nxtIdx < 0) continue;

        // exclude 白名单：最近 / 最后 / 最新 / 最多 / 最爱 / 最需要 / 最自然 …
        // 🔴 必须支持多字排除：「最自然」紧跟的是「自」而非「然」，
        // 只比对单字会漏过白名单，造成「最自然」这类正常表达被误判。
        // 🔴 白名单对**多字模式**同样生效：「保证不退货」是正常否定表达，
        // 若只在单字模式下检查 exclude，这类误报会直接摧毁「我们准」的定位。
        if (exclude.length) {
          if (nextCh && exclude.indexOf(nextCh) !== -1) continue;
          if (nxtIdx >= 0 && matchExcludeSeq(cells, patEnd, exclude, s)) continue;
        }
        if (needNext) {
          // 模式字后无实义字符（句末/标点）时不命中单字模式，避免误报
          if (!nextCh) continue;
          // 单字模式时若后接同字（「最最」）也跳过
          if (nextCh === pr.pattern) continue;
        }

        var o = cells[s].o;
        var e = cells[needNext ? nxtIdx : patEnd].e;
        out.push({
          term: needNext ? (pr.pattern + ' + ' + nextCh) : pr.pattern,
          // 规则名（如「最 + 性质词」）与提示语（matchHint）供界面展示：
          // 模式层是推测，界面要显示「这是哪一类疑似表述」，而不是精确片段。
          label: pr.label || pr.pattern,
          matchHint: pr.matchHint || '',
          matched: src.slice(o, e),
          normalized: pr.pattern + (needNext && nextCh ? nextCh : ''),
          start: o,
          end: e,
          category: pr.category || '绝对化用语',
          platform: platform === 'all' ? scope[0] : platform,
          riskLevel: forPlat,
          baseRiskLevel: 'medium',
          reason: pr.reason,
          ruleSource: pr.ruleSource,
          ruleDate: pr.ruleDate,
          ruleUrl: pr.ruleUrl,
          sourceNote: pr.note || '',
          suggestion: pr.suggestion || '结合完整语境判断：若属可验证的具体描述（如销量第一并附榜单佐证）可保留；若是无依据的绝对化表述，建议改为具体表述',
          layer: 'pattern',
          variant: 'pattern',
          variantLabel: '模式匹配'
        });
        s = patEnd; // 跳过已消费的区间
      }
    }
    return out;
  }

  /** 从 from 起找到下一个字符为 target 的 cell 下标（跳过分隔符） */
  function lastCellIndex(cells, from, target) {
    for (var k = from + 1; k < cells.length; k++) {
      if (cells[k].sep) continue;
      if (cells[k].c === target) return k;
    }
    return from;
  }

  /* =======================================================================
   * 六、对外主接口
   * ===================================================================== */

  var PLATFORMS = ['douyin', 'shipinhao', 'xiaohongshu'];
  var PLATFORM_NAMES = { douyin: '抖音', shipinhao: '视频号', xiaohongshu: '小红书', all: '全平台' };
  var RISK_ORDER = { high: 3, medium: 2, low: 1 };
  var RISK_TEXT = { high: '高风险', medium: '中风险', low: '低风险' };

  /** 规则是否适用于某平台：platforms 为空数组表示全平台适用 */
  function ruleAppliesTo(rule, platform) {
    if (!rule.platforms || !rule.platforms.length) return true;
    if (platform === 'all') return true;
    return rule.platforms.indexOf(platform) !== -1;
  }

  /** 规则适用的平台列表（空数组 → 三平台全适用） */
  function rulePlatforms(rule) {
    if (!rule.platforms || !rule.platforms.length) return PLATFORMS.slice();
    return rule.platforms;
  }

  /** 取规则在指定平台的风险等级（支持 platformRisk 覆写） */
  function riskOf(rule, platform) {
    if (rule.platformRisk && platform !== 'all' && rule.platformRisk[platform]) {
      return rule.platformRisk[platform];
    }
    return rule.riskLevel;
  }

  /**
   * 主检测函数。
   *
   * @param {string} text     用户文案
   * @param {Array}  rules    规则数组
   * @param {string} platform 'douyin' | 'shipinhao' | 'xiaohongshu' | 'all'
   * @returns {Object} { level, levelText, hits, counts, matrix }
   */
  /**
   * 取出模式层规则。
   * 允许三种传入方式，兼容不同调用方：
   *   1. rules 数组带 .patternRules 属性（由 app 一次性挂载）
   *   2. rules.patternRules 显式赋值
   *   3. 全局 window.CHECKGATE_PATTERN_RULES（bundle 加载时注入）
   *   4. detect() 第 4 个参数显式传入
   */
  function ensurePatternRules(rules) {
    if (rules && Array.isArray(rules.patternRules)) return rules.patternRules;
    if (typeof window !== 'undefined' && Array.isArray(window.CHECKGATE_PATTERN_RULES)) {
      return window.CHECKGATE_PATTERN_RULES;
    }
    return [];
  }

  /**
   * 句读字符：跨过它们取字会产生假阳性。
   * 例如「这是最。好用的」若跨句取字，会被误判成「最」+「好」= 「最好」。
   * 与 tokenize 的 bnd 标记互补——半角标点在归一化后不带 bnd，需在此显式列出。
   */
  var PAUSE_CHARS = '。，、；：！？,.;:!?"\'”‘’（）()【】[]{}';

  /**
   * 多字排除匹配：判断 patEnd 之后是否紧跟 exclude 中的某个词。
   * 白名单若含「自然」「需要」等多字词，必须按连续实义字符做前缀比对，
   * 只比单字会让「最自然」这类正常表达被误判。
   */
  function matchExcludeSeq(cells, patEnd, exclude, patStart) {
    // 排除词形如「最后」「最大」——**包含模式字本身**。
    // 因此必须从模式字的起点开始收集，再与排除词做前缀比对。
    // （若从 patEnd+1 开始收集，得到的是「大优」，永远匹配不上「最大」）
    var maxLen = 1;
    exclude.forEach(function (w) {
      if (w && Array.from(w).length > maxLen) maxLen = Array.from(w).length;
    });
    var from = (typeof patStart === 'number' && patStart >= 0) ? patStart : patEnd + 1;
    var seq = [];
    for (var k = from; k < cells.length && seq.length < maxLen; k++) {
      if (cells[k].sep) continue;
      if (cells[k].bnd) break;
      seq.push(cells[k].c);
    }
    var s = seq.join('');
    for (var i = 0; i < exclude.length; i++) {
      var w = exclude[i];
      if (w && s.indexOf(w) === 0) return true;
    }
    return false;
  }

  function detect(text, rules, platform, prules, scope) {
    platform = platform || 'all';
    scope = scope || 'content';
    var src = String(text || '');
    var cells = tokenize(src);
    var index = buildIndex(rules);
    // 模式层：优先取第三参数之外的显式传入，其次取 rules.patternRules
    // （buildIndex 时若规则数组带有该属性，会一并挂上，见 ensurePatternRules）
    var patternRules = prules || ensurePatternRules(rules);
    if (!Array.isArray(patternRules)) patternRules = [];

    // records: 每条命中按「平台」维度分别记录，便于一次性产出平台矩阵
    var records = [];
    var seen = Object.create(null);

    for (var start = 0; start < cells.length; start++) {
      var cell = cells[start];
      if (cell.sep || cell.bnd) continue;
      var bucket = index[cell.c];
      if (!bucket) continue;

      for (var b = 0; b < bucket.length; b++) {
        var rule = bucket[b].rule;
        // 作用域过滤：账号命名类规则（appliesTo=profile）不参与正文检测。
        // 🔴 误报防护关键：用户写「今天分享我的养生日常」不应被判命中「养生」
        //    ——那条限制的是**账号名称**，不是正文用词。
        //    账号名场景用 scope='profile' 单独检测，绝不静默丢弃。
        if (scope !== 'all' && rule.appliesTo && rule.appliesTo !== scope) continue;
        var pattern = bucket[b].pattern;
        var res = tryMatchFrom(cells, start, pattern);
        if (!res) continue;

        var o = cell.o;
        var e = cells[res.lastMatched].e;
        var key = rule.term + '|' + o + '|' + e;
        if (seen[key]) continue;
        seen[key] = true;

        var original = src.slice(o, e);
        var normalized = cells.slice(start, res.lastMatched + 1)
          .filter(function (x) { return !x.sep; })
          .map(function (x) { return x.c; })
          .join('');
        var variant = pattern.kind === 'alias'
          ? { type: 'alias', label: '替代写法' }
          : classifyVariant(original, normalized);

        var plats = rulePlatforms(rule);
        for (var p = 0; p < plats.length; p++) {
          records.push({
            term: rule.term,
            matched: original,
            normalized: normalized,
            start: o,
            end: e,
            category: rule.category,
            platform: plats[p],
            riskLevel: riskOf(rule, plats[p]),
            baseRiskLevel: rule.riskLevel,
            reason: rule.reason,
            ruleSource: rule.ruleSource,
            ruleDate: rule.ruleDate,
            ruleDateKind: rule.ruleDateKind || '',
            ruleUrl: rule.ruleUrl,
            // 溯源分级：顶层 sourceVerified 与逐平台 platformVerified 都要读，
            // 只看顶层会漏掉 98 条逐平台 partial（小红书 2021 版页面）。
            sourceVerified: rule.sourceVerified || 'verified',
            platformVerified: rule.platformVerified || null,
            platformSources: rule.platformSources || null,
            sourceNote: rule.sourceNote || '',
            appliesTo: rule.appliesTo || 'content',
            suggestion: rule.suggestion || '',
            sentenceRules: rule.sentenceRules || null,
            layer: 'word',
            variant: variant.type,
            variantLabel: variant.label
          });
        }

        // 注意：这里**不**推进 start。
        // 推进会导致更长的规则词被更短的同前缀词抢占
        // （例如「唯一一款」被「唯一」吃掉），导致漏检。
        // 重叠由下面的 dedupeHits 统一处理。
      }
    }

    // 平台矩阵：每个词条在三个平台各自的风险等级
    var matrix = buildMatrix(records);

    // 选出当前平台（或全平台）的命中
    var picked = [];
    for (var r = 0; r < records.length; r++) {
      if (platform === 'all' || records[r].platform === platform) picked.push(records[r]);
    }

    // 模式层：枚举型风险（「最便宜」「保证有效」这类裸词无法穷举）
    // 由 rules.patternRules 提供，命中结果与词条层同构，便于上层统一渲染。
    // 设计取舍：模式层只能给 medium ——「最+便宜」是否违规取决于语境与执法口径，
    // 我们不做确证，标 partial 让用户自己判断。
    //
    // 🔴 关键：模式层必须在词条层去重**之后**合并。
    // 若与词条层一起参与去重，「最好」这种「既是枚举词条、又是模式匹配」的位置
    // 会被先到的记录吃掉——用户只看到「疑似命中」，看不到确证依据。
    // 推测永远不能挤掉确证，这是「推测不得装成确证」的另一面。
    picked = dedupeHits(picked);
    var pat = matchPatternRules(src, cells, patternRules, platform);
    for (var pi = 0; pi < pat.length; pi++) {
      // 仅当该位置尚无词条层命中时才补入模式层结果
      var dup = false;
      for (var q = 0; q < picked.length; q++) {
        if (pat[pi].start < picked[q].end && picked[q].start < pat[pi].end) { dup = true; break; }
      }
      if (!dup) picked.push(pat[pi]);
    }
    picked.sort(function (a, b) { return a.start - b.start; });

    // 🔴 计数口径必须分开：模式层命中的是「疑似表述」，不是「词」。
    // 合并成一个数字 = 把推测算成确证，违反「推测不装确证」原则。
    var counts = { high: 0, medium: 0, low: 0 };
    var wordHits = [], patternHits = [];
    for (var k = 0; k < picked.length; k++) {
      if (picked[k].layer === 'pattern') { patternHits.push(picked[k]); }
      else { wordHits.push(picked[k]); counts[picked[k].riskLevel]++; }
    }
    var level = counts.high > 0 ? 'high'
      : (counts.medium > 0 ? 'medium' : (counts.low > 0 ? 'low' : 'safe'));

    return {
      level: level,
      levelText: levelText(level),
      hits: picked,
      wordHits: wordHits,
      patternHits: patternHits,
      counts: counts,
      patternCount: patternHits.length,
      matrix: matrix
    };
  }

  /**
   * 去重与重叠处理：同一位置被多个规则命中时，保留风险更高、词条更长的一个。
   * 保证高亮区间互不重叠，前端才能逐字高亮。
   */
  function dedupeHits(hits) {
    /**
     * 重叠消解规则（按优先级）：
     *   1) 风险等级高的胜出
     *   2) 同等级时，**匹配更长的胜出**（更具体的表述更有信息量）
     *      例：「唯一一款」应保留「唯一」，而不是反过来
     *   3) 同长度时，起点更靠前的胜出（与阅读顺序一致）
     *
     * 做法：先按「优先级从高到低」排序，再贪心选取互不重叠的命中。
     * 这样保证高亮区间互不重叠，前端才能逐字高亮。
     */
    hits.sort(function (a, b) {
      var ra = RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel];
      if (ra !== 0) return ra;
      if (b.matched.length !== a.matched.length) return b.matched.length - a.matched.length;
      // 🔴 同风险、同长度时，词条层优先于模式层。
      // 「最好」既是枚举词条、也是「最+性质词」的匹配结果；
      // 若模式层排在前面，用户只会看到「疑似命中」而看不到确证依据。
      var pa = a.variant === 'pattern' ? 1 : 0;
      var pb = b.variant === 'pattern' ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return a.start - b.start;
    });

    var out = [];
    for (var i = 0; i < hits.length; i++) {
      var cur = hits[i];
      var overlap = false;
      for (var j = 0; j < out.length; j++) {
        if (cur.start < out[j].end && out[j].start < cur.end) { overlap = true; break; }
      }
      if (!overlap) out.push(cur);
    }
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  /**
   * 平台差异矩阵：对每个命中词，给出三平台各自的风险等级。
   * 这是「同一个词在 A 平台有风险、在 B 平台安全」的数据来源。
   */
  function buildMatrix(records) {
    var byTerm = Object.create(null);
    var order = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (!byTerm[rec.term]) {
        byTerm[rec.term] = {
          term: rec.term,
          category: rec.category,
          reason: rec.reason,
          ruleSource: rec.ruleSource,
          ruleDate: rec.ruleDate,
          ruleUrl: rec.ruleUrl,
          suggestion: rec.suggestion,
          douyin: null, shipinhao: null, xiaohongshu: null
        };
        order.push(rec.term);
      }
      var row = byTerm[rec.term];
      var cur = row[rec.platform];
      if (!cur || RISK_ORDER[rec.riskLevel] > RISK_ORDER[cur]) {
        row[rec.platform] = rec.riskLevel;
      }
    }
    var out = [];
    for (var k = 0; k < order.length; k++) out.push(byTerm[order[k]]);
    return out;
  }

  function levelText(level) {
    if (level === 'high') return '高风险';
    if (level === 'medium') return '中风险';
    if (level === 'low') return '低风险';
    return '未发现风险';
  }


  /* =======================================================================
   * 位置与句级改写辅助
   * ===================================================================== */

  /**
   * 计算「第 N 字」位置（从 1 开始）。
   *
   * 🔴 口径：按 **Unicode 码点** 计数，不用 UTF-16 code unit。
   * 理由：用户数的是「第 37 个字」，而 emoji 的 .length 返回 2，
   * 用 code unit 会让所有 emoji 之后的字号整体错位。
   * 段落按 \n\n 切分，「第 N 段」同理按码点计。
   */
  function locate(text, start, end) {
    var codePoints = Array.from(text);
    // UTF-16 下标 → 码点下标
    var cpIndex = 0;
    var utf16 = 0;
    while (utf16 < start && cpIndex < codePoints.length) {
      utf16 += codePoints[cpIndex].length;
      cpIndex++;
    }
    var charNo = cpIndex + 1;                 // 从 1 开始
    var cpEnd = cpIndex;
    var u16 = utf16;
    while (u16 < end && cpEnd < codePoints.length) {
      u16 += codePoints[cpEnd].length;
      cpEnd++;
    }
    var endNo = cpEnd + 1;                    // 结束位（含）

    // 段落：按 \n\n 切分
    var paraNo = 1;
    var seenPara = 0;
    for (var i = 0; i < codePoints.length && seenPara < cpIndex; i++) {
      if (codePoints[i] === '\n' && codePoints[i + 1] === '\n') { seenPara = i + 2; paraNo++; }
      else if (codePoints[i] === '\n') { seenPara = i + 1; paraNo++; }
    }
    return { charNo: charNo, endNo: endNo, paraNo: paraNo };
  }

  /**
   * 取出命中词所在的句子（用于句级改写）。
   * 句读边界：。！？；：与换行。
   * 注意：句级改写需要「句子」但不需要「位置」——
   * 句子是给改写用的素材，位置是给用户看的坐标，两者用途不同。
   */
  function extractSentence(text, start, end) {
    var PAUSE = '。！？!?；;：:\n';
    var s = start;
    while (s > 0 && PAUSE.indexOf(text.charAt(s - 1)) === -1) s--;
    var e = end;
    while (e < text.length && PAUSE.indexOf(text.charAt(e)) === -1) e++;
    return { start: s, end: e, text: text.slice(s, e) };
  }

  /**
   * 句级改写（L2 层，免费）。
   *
   * 规则来自 word.sentenceRules，为**字面量**替换而非通配：
   * 「最强续航」按通配会变成「很续航」——那不是中文。
   * 字面量替换的产出永远语法正确，代价是覆盖面小。
   * 宁可保守，不可产出病句——用户会记住「它给我的建议读不通」。
   *
   * @returns {Object|null} { before, after, rule } 匹配不到返回 null（降级到词级）
   */
  function sentenceRewrite(word, text, start, end) {
    if (!word || !word.sentenceRules || !word.sentenceRules.length) return null;
    var seg = extractSentence(text, start, end);
    var rules = word.sentenceRules;
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r || !r.from) continue;
      var idx = seg.text.indexOf(r.from);
      if (idx === -1) continue;
      var before = seg.text;
      var after = before.slice(0, idx) + (r.to || '') + before.slice(idx + r.from.length);
      return { before: before, after: after, rule: r, segStart: seg.start, segEnd: seg.end };
    }
    return null;
  }

  /**
   * 生成整段替换文本。
   * 优先级：句级改写（若有）> 词级 suggestion。
   * 模式层命中不给句级改写——它只定位到「最」这种单字，套用会产出病句。
   */
  function buildReplacement(text, hits) {
    var src = String(text || '');
    var list = (hits || []).filter(function (h) {
      if (h.layer === 'pattern') return !!h.suggestion;   // 模式层只给建议文字
      return !!h.suggestion;
    }).sort(function (a, b) { return b.start - a.start; });
    var out = src;
    for (var i = 0; i < list.length; i++) {
      out = out.slice(0, list[i].start) + list[i].suggestion + out.slice(list[i].end);
    }
    return out;
  }


  /** 逐条改写建议（用于「只改某一处」的精细编辑） */
  function buildSuggestions(hits) {
    return hits
      .filter(function (h) { return h.suggestion; })
      .map(function (h) {
        return {
          start: h.start,
          end: h.end,
          from: h.matched,
          to: h.suggestion,
          term: h.term,
          riskLevel: h.riskLevel
        };
      })
      .sort(function (a, b) { return a.start - b.start; });
  }

  /* =======================================================================
   * 七、导出
   * ===================================================================== */

  return {
    version: '1.1.0',
    tokenize: tokenize,
    canonChar: canonChar,
    compileRule: compileRule,
    detect: detect,
    buildReplacement: buildReplacement,
    buildSuggestions: buildSuggestions,
    locate: locate,
    extractSentence: extractSentence,
    sentenceRewrite: sentenceRewrite,
    levelText: levelText,
    PLATFORMS: PLATFORMS,
    PLATFORM_NAMES: PLATFORM_NAMES,
    RISK_TEXT: RISK_TEXT,
    ruleAppliesTo: ruleAppliesTo,
    rulePlatforms: rulePlatforms,
    riskOf: riskOf
  };
});
