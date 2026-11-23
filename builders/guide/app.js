/* Doc-Intake 使用向导 · 交互
 * 页面全部由 content.js 渲染；三层页面堆在同一个网格单元里，
 * 切换页签只改变可见性，卡片高度取最高的那一页。
 */
(function () {
  "use strict";

  var G = window.GUIDE;
  if (!G) return;

  var tabsEl = document.getElementById("tabs");
  var pagesEl = document.getElementById("pages");
  var footEl = document.getElementById("foot-note");
  var titleEl = document.getElementById("guide-title");
  var ledeEl = document.getElementById("guide-lede");

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function section(title, hint) {
    var box = el("section", "block");
    if (title) {
      var head = el("div", "block-head");
      head.appendChild(el("h2", "block-title", title));
      if (hint) head.appendChild(el("p", "block-hint", hint));
      box.appendChild(head);
    }
    return box;
  }

  /* 可点列表 + 固定高度说明区：点击只换文字，卡片不跳 */
  function listWithCaption(items, renderItem, initial, onPick) {
    var wrap = el("div", "picker");
    var list = el("div", "pick-list");
    var cap = el("div", "cap");
    cap.appendChild(el("p", "cap-main"));
    cap.appendChild(el("p", "cap-why"));

    function show(item) {
      cap.children[0].textContent = item.note || item.tip || "";
      cap.children[1].textContent = item.why || "";
    }

    items.forEach(function (item, i) {
      var btn = renderItem(item, i);
      btn.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      if (i === 0) btn.classList.add("is-on");
      btn.addEventListener("click", function () {
        Array.prototype.forEach.call(list.children, function (n) {
          n.classList.remove("is-on");
          n.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("is-on");
        btn.setAttribute("aria-pressed", "true");
        show(item);
        if (onPick) onPick(item);
      });
      list.appendChild(btn);
    });

    show(items[0]);
    wrap.appendChild(list);
    wrap.appendChild(cap);
    return wrap;
  }

  /* ── 表格与折叠块 ───────────────────────────────── */
  function table(columns, rows) {
    var t = el("table", "cmp");
    var thead = el("thead");
    var tr = el("tr");
    columns.forEach(function (c, i) {
      var th = el("th", i === 0 ? "cmp-key" : null, c);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);

    var tbody = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (cell, i) {
        row.appendChild(el("td", i === 0 ? "cmp-key" : null, cell));
      });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    return t;
  }

  function fold(data) {
    var box = el("details", "fold");
    var sum = el("summary", "fold-sum");
    sum.appendChild(el("span", "fold-title", data.title));
    if (data.hint) sum.appendChild(el("span", "fold-hint", data.hint));
    box.appendChild(sum);
    var body = el("div", "fold-body");
    body.appendChild(table(data.columns, data.rows));
    box.appendChild(body);
    return box;
  }

  /* ── 示意图 ─────────────────────────────────────── */
  function figWrap(kind, caption) {
    var box = el("figure", "fig fig-" + kind);
    return box;
  }

  var FIGURES = {
    layout: function () {
      var box = figWrap("layout");
      var pair = el("div", "fig-pair");

      var cloud = el("div", "fig-side");
      cloud.appendChild(el("p", "fig-label", "云端：先切版面"));
      var pageA = el("div", "mini-page");
      pageA.appendChild(el("div", "mp-title"));
      var cols = el("div", "mp-cols");
      cols.appendChild(el("div", "mp-col"));
      cols.appendChild(el("div", "mp-col"));
      pageA.appendChild(cols);
      pageA.appendChild(el("div", "mp-table"));
      cloud.appendChild(pageA);

      var local = el("div", "fig-side");
      local.appendChild(el("p", "fig-label", "纯本地：按文字流读"));
      var pageB = el("div", "mini-page");
      for (var i = 0; i < 6; i++) pageB.appendChild(el("div", "mp-line"));
      local.appendChild(pageB);

      pair.appendChild(cloud);
      pair.appendChild(local);
      box.appendChild(pair);
      return box;
    },

    crop: function () {
      var box = figWrap("crop");
      var flow = el("div", "fig-flow");
      var page = el("div", "mini-page is-small");
      page.appendChild(el("div", "mp-line"));
      page.appendChild(el("div", "mp-line is-short"));
      var hot = el("div", "mp-hot");
      page.appendChild(hot);
      page.appendChild(el("div", "mp-line is-short"));

      var crop = el("div", "mini-crop");
      crop.textContent = "公式";

      flow.appendChild(page);
      flow.appendChild(el("span", "fig-arrow", "→"));
      flow.appendChild(crop);
      flow.appendChild(el("span", "fig-arrow", "→"));

      var outs = el("div", "fig-outs");
      outs.appendChild(el("span", "fig-out is-bad", "插图"));
      outs.appendChild(el("span", "fig-out is-bad", "纯文本"));
      outs.appendChild(el("span", "fig-out is-good", "小模型：LaTeX"));
      flow.appendChild(outs);
      box.appendChild(flow);
      return box;
    },

    path: function () {
      var box = figWrap("path");
      var flow = el("div", "fig-flow is-stack");
      [
        ["原生公式", "LaTeX"],
        ["MathType 对象", "LaTeX"],
        ["预览图", "图片"]
      ].forEach(function (pair) {
        var row = el("div", "fig-row");
        row.appendChild(el("span", "fig-node", pair[0]));
        row.appendChild(el("span", "fig-arrow", "→"));
        row.appendChild(el("span", "fig-node is-out", pair[1]));
        flow.appendChild(row);
      });
      var last = el("div", "fig-row");
      last.appendChild(el("span", "fig-node", "预览图"));
      last.appendChild(el("span", "fig-arrow", "→"));
      last.appendChild(el("span", "fig-node", "小模型"));
      last.appendChild(el("span", "fig-arrow", "→"));
      last.appendChild(el("span", "fig-node is-out", "LaTeX 或仍留图"));
      flow.appendChild(last);
      box.appendChild(flow);
      return box;
    },

    arrow: function () {
      var box = figWrap("arrow");
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 260 92");
      svg.setAttribute("class", "fig-svg");
      svg.innerHTML =
        '<text x="0" y="12" class="svg-cap">旧：按像素直读</text>' +
        '<line x1="14" y1="30" x2="120" y2="30" class="svg-dash"/>' +
        '<line x1="70" y1="34" x2="120" y2="34" class="svg-dash"/>' +
        '<path d="M120 24 l14 6 -14 6 z" class="svg-head"/>' +
        '<text x="0" y="66" class="svg-cap">现在：按矢量重绘</text>' +
        '<line x1="14" y1="82" x2="128" y2="82" class="svg-solid"/>' +
        '<path d="M128 74 l16 8 -16 8 z" class="svg-head"/>';
      box.appendChild(svg);
      return box;
    },

    volume: function () {
      var box = figWrap("volume");
      var row = el("div", "fig-vols");
      [
        ["D 盘产物", "D 盘回收站"],
        ["C 盘产物", "C 盘回收站"]
      ].forEach(function (p) {
        var col = el("div", "fig-vol");
        col.appendChild(el("span", "vol-disk", p[0]));
        col.appendChild(el("span", "fig-arrow", "↓"));
        col.appendChild(el("span", "vol-bin", p[1]));
        row.appendChild(col);
      });
      box.appendChild(row);
      return box;
    },

    chunk: function () {
      var box = figWrap("chunk");
      var bar = el("div", "fig-chunks");
      for (var i = 0; i < 4; i++) bar.appendChild(el("div", "chunk", "第 " + (i + 1) + " 块"));
      box.appendChild(bar);
      var row = el("div", "fig-row is-center");
      row.appendChild(el("span", "fig-arrow", "↓ 按原顺序合并"));
      box.appendChild(row);
      box.appendChild(el("div", "chunk is-whole", "一份 Markdown"));
      return box;
    },

    guard: function () {
      var box = figWrap("guard");
      var row = el("div", "fig-flow");
      row.appendChild(el("span", "fig-node", "不认识的容器"));
      row.appendChild(el("span", "fig-arrow", "→"));
      row.appendChild(el("span", "fig-out is-good", "直接说明不支持"));
      row.appendChild(el("span", "fig-arrow", "✕"));
      row.appendChild(el("span", "fig-out is-bad", "猜出来的乱码正文"));
      box.appendChild(row);
      return box;
    },

    struct: function () {
      var box = figWrap("struct");
      var pair = el("div", "fig-pair");
      var left = el("div", "fig-side");
      left.appendChild(el("p", "fig-label", "文件里本来就是结构"));
      var doc = el("div", "struct-doc");
      doc.appendChild(el("div", "struct-row"));
      doc.appendChild(el("div", "struct-row is-accent"));
      doc.appendChild(el("div", "struct-row is-short"));
      left.appendChild(doc);
      left.appendChild(el("p", "fig-caption", "标记、目录、压缩包里的 XML"));

      var right = el("div", "fig-side");
      right.appendChild(el("p", "fig-label", "文件里只有像素"));
      var pic = el("div", "struct-pic");
      pic.appendChild(el("span", "struct-dot"));
      pic.appendChild(el("span", "struct-dot is-second"));
      right.appendChild(pic);
      right.appendChild(el("p", "fig-caption", "截图、扫描页、粘贴进来的图片"));

      pair.appendChild(left);
      pair.appendChild(right);
      box.appendChild(pair);
      return box;
    },

    matrix: function () {
      var box = figWrap("matrix");
      var m = window.GUIDE.why.matrix;
      var table = el("table", "matrix");
      var thead = el("thead");
      var tr = el("tr");
      tr.appendChild(el("th", "mx-name", ""));
      m.cols.forEach(function (c) { tr.appendChild(el("th", "mx-col", c)); });
      thead.appendChild(tr);
      table.appendChild(thead);
      var tbody = el("tbody");
      m.rows.forEach(function (r) {
        var row = el("tr");
        row.appendChild(el("td", "mx-name", r.name));
        r.cells.forEach(function (c) {
          var td = el("td", "mx-cell");
          td.appendChild(el("span", "mx-dot is-" + c));
          row.appendChild(td);
        });
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      box.appendChild(table);
      box.appendChild(el("p", "fig-caption", m.legend));
      return box;
    },

    output: function () {
      var box = figWrap("output");
      var row = el("div", "fig-flow");
      row.appendChild(el("span", "fig-node", "解析完成"));
      row.appendChild(el("span", "fig-arrow", "→"));
      row.appendChild(el("span", "fig-node is-out", "磁盘上的文件"));
      var files = el("div", "fig-files");
      files.appendChild(el("span", "fig-file", "正文 .md"));
      files.appendChild(el("span", "fig-file", "媒体目录"));
      files.appendChild(el("span", "fig-file is-optional", "元数据 .json"));
      row.appendChild(el("span", "fig-arrow", "→"));
      row.appendChild(el("span", "fig-node", "摘要与路径"));
      box.appendChild(row);
      box.appendChild(files);

      var cap = el("p", "fig-caption", "对话中发得下的部分：");
      box.appendChild(cap);

      var blocks = el("div", "fig-blocks");
      blocks.appendChild(el("span", "fig-block", "≤ 28 KiB"));
      blocks.appendChild(el("span", "fig-block", "≤ 28 KiB"));
      blocks.appendChild(el("span", "fig-block", "≤ 28 KiB"));
      blocks.appendChild(el("span", "fig-block", "≤ 28 KiB"));
      blocks.appendChild(el("span", "fig-block is-more", "…"));
      box.appendChild(blocks);
      box.appendChild(el("p", "fig-caption", "默认四块，合计约 112 KiB。其余内容留在文件里，需要时按路径读取。"));
      return box;
    },

    norm: function () {
      var box = figWrap("norm");
      var row = el("div", "fig-flow");
      row.appendChild(el("span", "fig-node", "段落文本"));
      row.appendChild(el("span", "fig-node", "HTML 表格"));
      row.appendChild(el("span", "fig-node", "带坐标的块"));
      row.appendChild(el("span", "fig-arrow", "→"));
      row.appendChild(el("span", "fig-node is-out", "统一成四类"));
      box.appendChild(row);
      var kinds = el("div", "fig-kinds");
      ["段落", "表格", "公式", "媒体"].forEach(function (k) {
        kinds.appendChild(el("span", "fig-kind", k));
      });
      box.appendChild(kinds);
      return box;
    },

    enc: function () {
      var box = figWrap("enc");
      var flow = el("div", "fig-flow");
      flow.appendChild(el("span", "fig-node", "字节序标记"));
      flow.appendChild(el("span", "fig-arrow", "→"));
      flow.appendChild(el("span", "fig-node", "严格 UTF-8"));
      flow.appendChild(el("span", "fig-arrow", "→"));
      flow.appendChild(el("span", "fig-node is-out", "候选编码打分"));
      box.appendChild(flow);
      var pair = el("div", "fig-pair is-tight");
      var a = el("div", "fig-side");
      a.appendChild(el("p", "fig-caption", "UTF-8 读出：你好"));
      var b = el("div", "fig-side");
      b.appendChild(el("p", "fig-caption", "GBK 读出：浣犲ソ"));
      pair.appendChild(a);
      pair.appendChild(b);
      box.appendChild(pair);
      return box;
    },

    gui: function () {
      var box = figWrap("gui");
      var win = el("div", "gui-win");

      var title = el("div", "gui-title");
      title.appendChild(el("span", "gui-title-text", "文档提取"));
      var acts = el("div", "gui-acts");
      acts.appendChild(el("span", "gui-act", "—"));
      acts.appendChild(el("span", "gui-act", "□"));
      acts.appendChild(el("span", "gui-act", "×"));
      title.appendChild(acts);
      win.appendChild(title);

      var body = el("div", "gui-body");

      var srcRow = el("div", "gui-row");
      srcRow.appendChild(el("span", "gui-label", "源"));
      var btns = el("div", "gui-btns");
      btns.appendChild(el("span", "gui-btn", "选文件"));
      btns.appendChild(el("span", "gui-btn", "选文件夹"));
      srcRow.appendChild(btns);
      body.appendChild(srcRow);
      body.appendChild(el("div", "gui-area", "每行一个文件或文件夹"));

      var saveRow = el("div", "gui-row");
      saveRow.appendChild(el("span", "gui-label", "保存到"));
      var sb = el("div", "gui-btns");
      sb.appendChild(el("span", "gui-btn", "浏览…"));
      saveRow.appendChild(sb);
      body.appendChild(saveRow);
      body.appendChild(el("div", "gui-area is-mono", "D:\\Agent\\Doc-intake"));

      body.appendChild(el("div", "gui-run", "开始提取"));

      var adv = el("div", "gui-adv");
      adv.appendChild(el("span", "gui-adv-chev", "▾"));
      adv.appendChild(el("span", "gui-adv-label", "高级选项"));
      body.appendChild(adv);

      var inner = el("div", "gui-inner");
      [
        ["解析后端", "自动"],
        ["页码范围", "如 1-20，留空为全部"],
        ["语言", "zh"]
      ].forEach(function (r) {
        var row = el("div", "gui-row");
        row.appendChild(el("span", "gui-label", r[0]));
        row.appendChild(el("div", "gui-field", r[1]));
        inner.appendChild(row);
      });
      var checks = el("div", "gui-checks");
      [
        ["提取图片与媒体", true],
        ["另存 JSON", true],
        ["只做图片分割测试", false],
        ["只返回状态（不返回正文）", false]
      ].forEach(function (c) {
        var lab = el("label", "gui-check");
        lab.appendChild(el("span", "gui-box" + (c[1] ? " is-on" : "")));
        lab.appendChild(el("span", "gui-check-text", c[0]));
        checks.appendChild(lab);
      });
      inner.appendChild(checks);
      body.appendChild(inner);

      win.appendChild(body);
      box.appendChild(win);
      return box;
    },

    dispatch: function () {
      var box = figWrap("dispatch");
      var top = el("div", "fig-flow is-center");
      top.appendChild(el("span", "fig-node", "一批文件"));
      box.appendChild(top);

      var lanes = el("div", "fig-lanes");
      [
        ["云端队列", "PDF · 图片", "同时 4 个"],
        ["本机队列", "Office · 网页 · 电子书 · 纯文本", "同时 8 个"],
        ["转换队列", "旧版 Office", "先转再解析"]
      ].forEach(function (l) {
        var lane = el("div", "fig-lane");
        lane.appendChild(el("p", "fig-lane-name", l[0]));
        lane.appendChild(el("p", "fig-lane-items", l[1]));
        lane.appendChild(el("p", "fig-lane-cap", l[2]));
        lanes.appendChild(lane);
      });
      box.appendChild(lanes);
      return box;
    },

    folder: function () {
      var box = figWrap("folder");
      var tree = el("div", "fig-tree");
      var dir = el("div", "fig-dir");
      dir.appendChild(el("span", "fig-node is-out", "资料夹"));
      tree.appendChild(dir);
      var kids = el("div", "fig-kids");
      ["a.pdf", "b.docx", "c.epub", "说明.txt"].forEach(function (n, i) {
        kids.appendChild(el("span", "fig-node" + (i === 3 ? " is-muted" : ""), n));
      });
      tree.appendChild(kids);
      box.appendChild(tree);
      box.appendChild(el("p", "fig-caption", "按文件名排序，只取当前层，不进子目录；不支持的扩展名被忽略。"));
      return box;
    },

    async: function () {
      var box = figWrap("async");
      var flow = el("div", "fig-flow");
      flow.appendChild(el("span", "fig-node", "点击开始"));
      flow.appendChild(el("span", "fig-arrow", "→"));
      flow.appendChild(el("span", "fig-node is-out", "返回作业编号"));
      flow.appendChild(el("span", "fig-arrow", "→"));
      flow.appendChild(el("span", "fig-node", "后台逐个处理"));
      box.appendChild(flow);
      var stat = el("div", "fig-status");
      stat.appendChild(el("span", "fig-node", "等待中"));
      stat.appendChild(el("span", "fig-node", "进行中"));
      stat.appendChild(el("span", "fig-node is-out", "已完成"));
      stat.appendChild(el("span", "fig-node is-muted", "失败"));
      box.appendChild(stat);
      box.appendChild(el("p", "fig-caption", "作业记录每个文件的状态，重启后仍可查。"));
      return box;
    },

    queue: function () {
      var box = figWrap("queue");
      var lane = el("div", "fig-lane is-wide");
      lane.appendChild(el("p", "fig-lane-name", "云端队列"));
      var slots = el("div", "fig-slots");
      for (var i = 0; i < 4; i++) slots.appendChild(el("span", "fig-slot", "处理中"));
      for (var j = 0; j < 4; j++) slots.appendChild(el("span", "fig-slot is-wait", "等待"));
      lane.appendChild(slots);
      box.appendChild(lane);

      var lane2 = el("div", "fig-lane is-wide");
      lane2.appendChild(el("p", "fig-lane-name", "本机队列"));
      var slots2 = el("div", "fig-slots");
      for (var k = 0; k < 8; k++) slots2.appendChild(el("span", "fig-slot", "处理中"));
      for (var m = 0; m < 4; m++) slots2.appendChild(el("span", "fig-slot is-wait", "等待"));
      lane2.appendChild(slots2);
      box.appendChild(lane2);
      box.appendChild(el("p", "fig-caption", "默认值：云端同时 4 个，本机同时 8 个，可在设置页调整。"));
      return box;
    },

    keys: function () {
      var box = figWrap("keys");
      var flow = el("div", "fig-flow");
      flow.appendChild(el("span", "fig-node", "调用某一档"));
      flow.appendChild(el("span", "fig-arrow", "→"));
      flow.appendChild(el("span", "fig-node", "第一把密钥"));
      flow.appendChild(el("span", "fig-arrow", "→"));
      flow.appendChild(el("span", "fig-node", "失败就换下一把"));
      box.appendChild(flow);
      var row = el("div", "fig-flow is-center");
      row.appendChild(el("span", "fig-out is-bad", "全部密钥都失败"));
      row.appendChild(el("span", "fig-arrow", "→"));
      row.appendChild(el("span", "fig-out is-good", "换链路上的下一档"));
      box.appendChild(row);
      return box;
    },

    barcode: function () {
      var box = figWrap("barcode");
      var flow = el("div", "fig-flow");
      flow.appendChild(el("span", "fig-node", "内嵌图"));
      flow.appendChild(el("span", "fig-node", "整页渲染"));
      flow.appendChild(el("span", "fig-arrow", "→"));
      flow.appendChild(el("span", "fig-node", "转灰度"));
      flow.appendChild(el("span", "fig-arrow", "→"));
      flow.appendChild(el("span", "fig-node is-out", "解码"));
      flow.appendChild(el("span", "fig-arrow", "→"));
      flow.appendChild(el("span", "fig-node", "注在图下"));
      box.appendChild(flow);
      return box;
    },

    threshold: function () {
      var box = figWrap("threshold");
      var scale = el("div", "fig-scale");
      [["文档里嵌的码", "0.2% – 8%", "low"], ["扫描页中间的大码", "14% – 34%", "mid"], ["码几乎占满画面", "62% – 96%", "high"]].forEach(function (r) {
        var band = el("div", "fig-band");
        band.appendChild(el("span", "fig-band-name", r[0]));
        band.appendChild(el("div", "fig-band-bar is-" + r[2]));
        band.appendChild(el("span", "fig-band-range", r[1]));
        scale.appendChild(band);
      });
      box.appendChild(scale);
      var line = el("div", "fig-threshold");
      line.appendChild(el("span", "fig-threshold-mark", "30%"));
      line.appendChild(el("span", "fig-threshold-text", "纯码文档的判定线：低于它算文档，高于它算一张码。"));
      box.appendChild(line);
      return box;
    },

    split: function () {
      var box = figWrap("split");
      var pic = el("div", "fig-longpic");
      [
        { m: "1", cls: "is-long" },
        { m: "", cls: "is-gap" },
        { m: "2", cls: "is-long" },
        { m: "", cls: "is-gap" },
        { m: "3", cls: "is-short" }
      ].forEach(function (row) {
        var line = el("div", "fig-lp-line");
        line.appendChild(el("span", "fig-lp-mark", row.m));
        line.appendChild(el("span", "fig-lp-block " + row.cls));
        pic.appendChild(line);
      });
      box.appendChild(pic);

      var rules = el("div", "fig-rules");
      [
        ["超过宽的 1.2 倍", "才需要切"],
        ["在 1.2–1.5 倍间找空白行", "连续 5 行就切"],
        ["找不到就强切", "并留 10% 重叠"]
      ].forEach(function (r) {
        var row = el("div", "fig-rule");
        row.appendChild(el("span", "fig-rule-k", r[0]));
        row.appendChild(el("span", "fig-rule-v", r[1]));
        rules.appendChild(row);
      });
      box.appendChild(rules);
      box.appendChild(el("p", "fig-caption", "切完的块与原文结果合并时去重，避免重叠部分重复出现。"));
      return box;
    }
  };

  /* ── 入门 ─────────────────────────────────────────── */
  function renderStart(data, cmp) {
    var page = el("div", "page");
    page.dataset.page = "start";

    var what = section(data.whatTitle);
    data.whatText.forEach(function (p) {
      what.appendChild(el("p", "para", p));
    });
    var chips = el("div", "chips");
    data.chips.forEach(function (c, i) {
      chips.appendChild(el("span", "chip" + (i === 0 ? " is-accent" : ""), c));
    });
    what.appendChild(chips);
    page.appendChild(what);

    var steps = section(data.stepsTitle, data.stepsHint);
    steps.appendChild(
      listWithCaption(data.steps, function (s) {
        var row = el("button", "step");
        row.type = "button";
        row.appendChild(el("span", "step-no", s.no));
        var body = el("span", "step-body");
        body.appendChild(el("span", "step-title", s.title));
        body.appendChild(el("span", "step-text", s.text));
        row.appendChild(body);
        return row;
      })
    );
    page.appendChild(steps);

    var entries = section(data.entriesTitle);
    var entryList = el("div", "rows");
    data.entries.forEach(function (e) {
      var row = el("div", "row");
      row.appendChild(el("span", "row-name", e.name));
      row.appendChild(el("span", "row-text", e.text));
      entryList.appendChild(row);
    });
    entries.appendChild(entryList);
    page.appendChild(entries);

    var out = section(data.outTitle);
    var tree = el("div", "tree");
    data.outTree.forEach(function (t) {
      var row = el("div", "tree-row");
      row.appendChild(el("code", "tree-path", t.path));
      row.appendChild(el("span", "tree-note", t.note));
      tree.appendChild(row);
    });
    out.appendChild(tree);
    out.appendChild(el("p", "foot-note", data.outNote));
    page.appendChild(out);

    var formats = section(data.formatsTitle);
    var fList = el("div", "rows");
    data.formats.forEach(function (f) {
      var row = el("div", "row");
      row.appendChild(el("span", "row-name", f.k));
      row.appendChild(el("span", "row-text", f.v));
      fList.appendChild(row);
    });
    formats.appendChild(fList);
    formats.appendChild(el("p", "foot-note", data.formatsNote));
    page.appendChild(formats);

    var folds = el("div", "folds");
    folds.appendChild(fold(cmp.startCompare));
    folds.appendChild(fold(cmp.startTools));
    page.appendChild(folds);

    var pits = section(data.pitfallsTitle);
    var pitList = el("div", "rows");
    data.pitfalls.forEach(function (p) {
      var row = el("div", "row is-pit");
      row.appendChild(el("span", "row-name", p.title));
      row.appendChild(el("span", "row-text", p.text));
      pitList.appendChild(row);
    });
    pits.appendChild(pitList);
    page.appendChild(pits);

    return page;
  }

  /* ── 进阶 ─────────────────────────────────────────── */
  function renderAdvanced(data) {
    var page = el("div", "page");
    page.dataset.page = "advanced";

    var chains = section(data.chainsTitle, data.chainsHint);
    var cap = el("div", "cap");
    cap.appendChild(el("p", "cap-main"));
    cap.appendChild(el("p", "cap-why"));
    var flow = el("div", "flow");
    var chainList = el("div", "pick-list");

    function paint(chain) {
      flow.innerHTML = "";
      cap.children[0].textContent = chain.steps[0].note;
      cap.children[1].textContent = "为什么这样排：" + chain.why;
      chain.steps.forEach(function (s, i) {
        var pill = el("button", "pill");
        pill.type = "button";
        pill.textContent = s.label;
        if (i === 0) pill.classList.add("is-on");
        pill.addEventListener("click", function () {
          Array.prototype.forEach.call(flow.querySelectorAll(".pill"), function (n) {
            n.classList.remove("is-on");
          });
          pill.classList.add("is-on");
          cap.children[0].textContent = s.note;
          cap.children[1].textContent = s.why ? "为什么在这：" + s.why : "";
        });
        flow.appendChild(pill);
        if (i < chain.steps.length - 1) flow.appendChild(el("span", "arrow", "›"));
      });
    }

    data.chains.forEach(function (chain, i) {
      var btn = el("button", "pick");
      btn.type = "button";
      btn.appendChild(el("span", "pick-name", chain.name));
      btn.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      if (i === 0) btn.classList.add("is-on");
      btn.addEventListener("click", function () {
        Array.prototype.forEach.call(chainList.children, function (n) {
          n.classList.remove("is-on");
          n.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("is-on");
        btn.setAttribute("aria-pressed", "true");
        paint(chain);
      });
      chainList.appendChild(btn);
    });

    paint(data.chains[0]);
    chains.appendChild(chainList);
    chains.appendChild(flow);
    chains.appendChild(cap);
    page.appendChild(chains);

    var pick = section(data.pickTitle, data.pickHint);
    var advice = el("p", "cap-solo");
    var pickList = el("div", "pick-list pick-grid");
    var pickFlow = el("div", "flow");

    function paintPick(p) {
      pickFlow.innerHTML = "";
      p.chain.forEach(function (label, i) {
        pickFlow.appendChild(el("span", "pill is-static", label));
        if (i < p.chain.length - 1) pickFlow.appendChild(el("span", "arrow", "›"));
      });
      advice.textContent = p.advice;
    }

    data.picks.forEach(function (p, i) {
      var btn = el("button", "pick");
      btn.type = "button";
      btn.appendChild(el("span", "pick-name", p.label));
      btn.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      if (i === 0) btn.classList.add("is-on");
      btn.addEventListener("click", function () {
        Array.prototype.forEach.call(pickList.children, function (n) {
          n.classList.remove("is-on");
          n.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("is-on");
        btn.setAttribute("aria-pressed", "true");
        paintPick(p);
      });
      pickList.appendChild(btn);
    });

    paintPick(data.picks[0]);
    pick.appendChild(pickList);
    pick.appendChild(pickFlow);
    pick.appendChild(advice);
    page.appendChild(pick);

    var prov = section(data.providersTitle, data.providersHint);
    var provGrid = el("div", "providers");
    data.providers.forEach(function (p) {
      var card = el("div", "provider");
      card.appendChild(el("p", "provider-name", p.name));
      card.appendChild(el("p", "provider-line", p.line));
      card.appendChild(el("p", "provider-cost", "代价：" + p.cost));
      provGrid.appendChild(card);
    });
    prov.appendChild(provGrid);
    page.appendChild(prov);

    var pathBox = section(data.pathTitle, data.pathHint);
    pathBox.appendChild(
      listWithCaption(data.path, function (s) {
        var pill = el("button", "pill");
        pill.type = "button";
        pill.textContent = s.label;
        return pill;
      })
    );
    page.appendChild(pathBox);

    var opts = section(data.optionsTitle, data.optionsHint);
    var optList = el("div", "opts");
    data.options.forEach(function (o) {
      var row = el("div", "opt");
      var head = el("div", "opt-head");
      head.appendChild(el("span", "opt-key", o.k));
      head.appendChild(el("span", "opt-val", o.v));
      row.appendChild(head);
      row.appendChild(el("p", "opt-why", "为什么：" + o.why));
      optList.appendChild(row);
    });
    opts.appendChild(optList);
    page.appendChild(opts);

    var blocks = section(data.blocksTitle);
    var grid = el("div", "grid2");
    data.blocks.forEach(function (b) {
      var card = el("div", "mini");
      card.appendChild(el("h3", "mini-title", b.title));
      card.appendChild(el("p", "mini-text", b.text));
      grid.appendChild(card);
    });
    blocks.appendChild(grid);
    page.appendChild(blocks);

    var bridge = el("section", "bridge");
    bridge.appendChild(el("h3", "bridge-title", data.bridgeTitle));
    bridge.appendChild(el("p", "bridge-text", data.bridgeText));
    page.appendChild(bridge);

    var gui = section(data.guiTitle, data.guiLead);
    var guiWrap = el("div", "gui-wrap");
    guiWrap.appendChild(FIGURES.gui());
    var guiList = el("div", "gui-fields");
    data.guiFields.forEach(function (f) {
      var row = el("div", "gui-field-row");
      row.appendChild(el("span", "gui-field-k", f.k));
      row.appendChild(el("span", "gui-field-v", f.v));
      guiList.appendChild(row);
    });
    guiWrap.appendChild(guiList);
    gui.appendChild(guiWrap);
    gui.appendChild(el("p", "bc-note", data.guiNote));
    page.appendChild(gui);

    return page;
  }

  /* ── 原理 ─────────────────────────────────────────── */
  function renderWhy(data) {
    var page = el("div", "page");
    page.dataset.page = "why";

    page.appendChild(el("p", "why-intro is-standalone", data.intro));

    var princ = section(data.principlesTitle);
    var pGrid = el("div", "principles");
    data.principles.forEach(function (p) {
      var card = el("div", "principle");
      var head = el("div", "principle-head");
      head.appendChild(el("span", "principle-no", p.no));
      head.appendChild(el("h3", "principle-title", p.title));
      card.appendChild(head);
      if (p.figure && FIGURES[p.figure]) card.appendChild(FIGURES[p.figure]());
      card.appendChild(el("p", "principle-text", p.text));
      pGrid.appendChild(card);
    });
    princ.appendChild(pGrid);
    page.appendChild(princ);

    var pipe = section(data.pipeTitle, data.pipeHint);
    var steps = el("ol", "pipe");
    data.pipeline.forEach(function (step, i) {
      var row = el("li", "pipe-row");
      row.appendChild(el("span", "pipe-no", (i + 1 < 10 ? "0" : "") + (i + 1)));
      var body = el("div", "pipe-body");
      body.appendChild(el("p", "pipe-t", step.t));
      body.appendChild(el("p", "pipe-d", step.d));
      row.appendChild(body);
      steps.appendChild(row);
    });
    pipe.appendChild(steps);
    page.appendChild(pipe);

    var bc = section(data.barcodeTitle, data.barcodeLead);
    var bcGrid = el("div", "bc-grid");
    data.barcodePoints.forEach(function (b) {
      var card = el("div", "bc-card");
      card.appendChild(el("h3", "bc-k", b.k));
      card.appendChild(el("p", "bc-v", b.v));
      bcGrid.appendChild(card);
    });
    bc.appendChild(bcGrid);
    bc.appendChild(FIGURES.barcode());
    bc.appendChild(el("p", "fig-caption", data.barcodePerf));
    bc.appendChild(el("p", "bc-note", data.barcodeNote));
    page.appendChild(bc);

    var mech = section(data.mechTitle, data.mechHint);
    var list = el("div", "why-list");
    data.items.forEach(function (item) {
      var row = el("div", "why");
      row.appendChild(el("p", "why-q", item.q));
      if (item.figure && FIGURES[item.figure]) row.appendChild(FIGURES[item.figure]());
      row.appendChild(el("p", "why-a", item.a));
      row.appendChild(el("p", "why-so", item.so));
      list.appendChild(row);
    });
    mech.appendChild(list);
    page.appendChild(mech);

    return page;
  }

  /* ── 装配 ─────────────────────────────────────────── */
  titleEl.textContent = G.title;
  ledeEl.textContent = G.lede;
  footEl.textContent = G.foot;

  var pages = {
    start: renderStart(G.start, { startCompare: G.startCompare, startTools: G.startTools }),
    advanced: renderAdvanced(G.advanced),
    why: renderWhy(G.why)
  };

  G.tabs.forEach(function (t, i) {
    var btn = el("button", "tab");
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.dataset.tab = t.id;
    btn.textContent = t.label;
    btn.setAttribute("aria-selected", i === 0 ? "true" : "false");
    if (i === 0) btn.classList.add("is-on");
    btn.addEventListener("click", function () {
      activate(t.id);
    });
    btn.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      var next = (i + (e.key === "ArrowRight" ? 1 : G.tabs.length - 1)) % G.tabs.length;
      var target = tabsEl.children[next];
      target.focus();
      activate(G.tabs[next].id);
    });
    tabsEl.appendChild(btn);
  });

  Object.keys(pages).forEach(function (id) {
    var page = pages[id];
    page.setAttribute("role", "tabpanel");
    page.id = "panel-" + id;
    pagesEl.appendChild(page);
  });

  function activate(id) {
    if (!pages[id]) id = "start";
    Array.prototype.forEach.call(tabsEl.children, function (btn) {
      var on = btn.dataset.tab === id;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    });
    Object.keys(pages).forEach(function (key) {
      pages[key].classList.toggle("is-on", key === id);
    });
  }

  activate((location.hash || "#start").replace("#", "") || "start");
})();
