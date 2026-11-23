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
