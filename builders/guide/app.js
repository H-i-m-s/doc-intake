/* doc-intake 使用向导 · 交互
 * 页面全部由 content.js 渲染；三层页面堆在同一个网格单元里，
 * 所以切换页签只改变可见性，不改变卡片高度。
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

  /* 一块可点击的列表 + 固定高度的说明区。
     说明区高度用 CSS 的 min-height 预留，点击时只换文字，卡片不会跳动。 */
  function listWithCaption(items, capText, onPick) {
    var wrap = el("div", "picker");
    var list = el("div", "pick-list");
    var cap = el("p", "cap");
    cap.textContent = capText;

    items.forEach(function (item, i) {
      var btn = el("button", "pick");
      btn.type = "button";
      btn.dataset.idx = String(i);
      btn.appendChild(el("span", "pick-name", item.label));
      btn.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      if (i === 0) btn.classList.add("is-on");
      btn.addEventListener("click", function () {
        Array.prototype.forEach.call(list.children, function (n) {
          n.classList.remove("is-on");
          n.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("is-on");
        btn.setAttribute("aria-pressed", "true");
        cap.textContent = onPick(item);
      });
      list.appendChild(btn);
    });

    wrap.appendChild(list);
    wrap.appendChild(cap);
    return wrap;
  }

  /* ── 入门 ─────────────────────────────────────────── */
  function renderStart(data) {
    var page = el("div", "page");
    page.dataset.page = "start";

    var steps = section(data.stepsTitle, data.stepsHint);
    var stepWrap = el("div", "picker");
    var stepList = el("div", "steps");
    var cap = el("p", "cap");
    cap.textContent = data.steps[0].tip;

    data.steps.forEach(function (s, i) {
      var row = el("button", "step");
      row.type = "button";
      row.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      if (i === 0) row.classList.add("is-on");
      row.appendChild(el("span", "step-no", s.no));
      var body = el("span", "step-body");
      body.appendChild(el("span", "step-title", s.title));
      body.appendChild(el("span", "step-text", s.text));
      row.appendChild(body);
      row.addEventListener("click", function () {
        Array.prototype.forEach.call(stepList.children, function (n) {
          n.classList.remove("is-on");
          n.setAttribute("aria-pressed", "false");
        });
        row.classList.add("is-on");
        row.setAttribute("aria-pressed", "true");
        cap.textContent = s.tip;
      });
      stepList.appendChild(row);
    });

    stepWrap.appendChild(stepList);
    stepWrap.appendChild(cap);
    steps.appendChild(stepWrap);
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

    return page;
  }

  /* ── 进阶 ─────────────────────────────────────────── */
  function renderAdvanced(data) {
    var page = el("div", "page");
    page.dataset.page = "advanced";

    var chains = section(data.chainsTitle, data.chainsHint);
    var first = data.chains[0];

    var cap = el("p", "cap");
    cap.textContent = first.steps[0].note;

    var chainList = el("div", "pick-list");
    var flow = el("div", "flow");

    function paintFlow(chain) {
      flow.innerHTML = "";
      chain.steps.forEach(function (s, i) {
        var pill = el("button", "pill");
        pill.type = "button";
        pill.textContent = s.label;
        pill.addEventListener("click", function () {
          Array.prototype.forEach.call(flow.querySelectorAll(".pill"), function (n) {
            n.classList.remove("is-on");
          });
          pill.classList.add("is-on");
          cap.textContent = s.note;
        });
        flow.appendChild(pill);
        if (i < chain.steps.length - 1) flow.appendChild(el("span", "arrow", "›"));
      });
      var head = flow.querySelector(".pill");
      if (head) head.classList.add("is-on");
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
        paintFlow(chain);
        cap.textContent = chain.steps[0].note;
      });
      chainList.appendChild(btn);
    });

    paintFlow(first);

    chains.appendChild(chainList);
    chains.appendChild(flow);
    chains.appendChild(cap);
    page.appendChild(chains);

    var pick = section(data.pickTitle, data.pickHint);
    var advice = el("p", "cap");
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

    var box = section(null);
    box.appendChild(el("p", "why-intro", data.intro));

    var list = el("div", "why-list");
    data.items.forEach(function (item) {
      var row = el("div", "why");
      row.appendChild(el("p", "why-q", item.q));
      row.appendChild(el("p", "why-a", item.a));
      list.appendChild(row);
    });
    box.appendChild(list);
    page.appendChild(box);

    return page;
  }

  /* ── 装配 ─────────────────────────────────────────── */
  titleEl.textContent = G.title;
  ledeEl.textContent = G.lede;
  footEl.textContent = G.foot;

  var pages = {
    start: renderStart(G.start),
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
