/* INDIA — 5 JOURNEYS · front-end (landscape phone, full-screen)
   Progressive enhancement: every section is readable without JS.
   Touch-first: no hover dependencies, a side drawer instead of tooltips,
   native scrolling (no scroll hijacking), GSAP only for light parallax.
   Events shared with gl.js:
     hero:go     (slide index)  site → gl  cross-fade the depth hero
     map:focus   (region id)    site → gl  fly the terrain camera
     map:pick    (region id)    gl → site  a 3D pin was tapped
     sheet:close (sheet key)    site → gl  return the camera                */
(() => {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const DATA = JSON.parse($("#site-data").textContent);
  const ROOT = DATA.root || "";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const R = Object.fromEntries(DATA.regions.map((r) => [r.id, r]));
  const AX = Object.fromEntries(DATA.axes.map((a) => [a.id, a]));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const vibrate = () => { try { if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(8); } catch { /* unsupported */ } };
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const landscape = () => matchMedia("(orientation: landscape)").matches;

  // one scroll-lock registry for every overlay: closing one never unlocks the page while another is open
  const locks = new Set();
  const lock = (k, on) => { on ? locks.add(k) : locks.delete(k); document.documentElement.style.overflow = locks.size ? "hidden" : ""; };
  // keep keyboard focus inside an open overlay
  const trap = (root, e) => {
    if (e.key !== "Tab") return;
    const f = $$('a[href], button:not([disabled]), input, summary, [tabindex="0"]', root).filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  /* ---------------- image fade-in (LQIP → sharp) ---------------- */
  const markLoaded = (img) => img.classList.add("is-loaded");
  $$(".pic img").forEach((img) => {
    if (img.complete && img.naturalWidth) markLoaded(img);
    else {
      img.addEventListener("load", () => markLoaded(img), { once: true });
      img.addEventListener("error", () => markLoaded(img), { once: true });   // never leave an invisible <img>
    }
  });

  /* ---------------- loader (short: never block a phone user) ---------------- */
  const loader = $(".loader");
  const finishLoader = () => {
    if (!loader) return;
    const count = $(".loader-count b", loader);
    const heroImg = $(".hero-slide.is-active img");
    let p = 0, done = false;
    const ready = () => (done = true);
    if (!heroImg || (heroImg.complete && heroImg.naturalWidth)) ready();
    else { heroImg.addEventListener("load", ready, { once: true }); heroImg.addEventListener("error", ready, { once: true }); setTimeout(ready, 1800); }
    if (reduced) return loader.classList.add("is-done");
    const tick = () => {
      p += done ? (100 - p) * 0.3 + 1.5 : Math.max(0.6, (86 - p) * 0.06);
      p = Math.min(p, done ? 100 : 86);
      count.textContent = Math.round(p);
      if (p >= 100) {
        loader.style.transition = "clip-path .8s cubic-bezier(.76,0,.24,1)";
        loader.style.clipPath = "inset(0 0 100% 0)";
        setTimeout(() => loader.classList.add("is-done"), 800);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  };

  /* ---------------- reveal-lines: split headings into lines ---------------- */
  $$(".reveal-lines").forEach((el) => {
    const parts = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = parts.map((h, i) => `<span class="rl-line"><span class="rl-inner" style="--l:${i}">${h}</span></span>`).join("");
  });

  /* ---------------- in-view observer ---------------- */
  const REVEAL = ".reveal, .reveal-lines, .radar, .heat, .cal, .persona-scores, .why-card, .season-bars, .robust-list li";
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("is-in");
    io.unobserve(e.target);
  }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  $$(REVEAL).forEach((el) => io.observe(el));
  $$(".ch-facts, .why-grid, .food-list, .timeline, .tips, .access-list, .fit-grid").forEach((g) =>
    [...g.children].forEach((c, i) => c.style.setProperty("--delay", `${Math.min(i * 0.07, 0.5)}s`)));
  $$(".heat-row").forEach((row, r) => $$(".heat-cell", row).forEach((c, i) => c.style.setProperty("--i", r * 2 + i)));
  $$(".cal-row").forEach((row, r) => $$(".cal-cell", row).forEach((c, i) => c.style.setProperty("--d", r * 4 + i)));
  // anchor jumps must land on content that is already visible (no blank-then-fade)
  const revealAll = (root) => $$(REVEAL, root).forEach((el) => el.classList.add("is-in"));

  /* ---------------- count-up ---------------- */
  const countUp = (el) => {
    const to = parseFloat(el.dataset.count), dec = +(el.dataset.decimals || 0), grp = el.dataset.format === "yen";
    const fmt = (v) => grp ? Math.round(v).toLocaleString("ja-JP") : v.toFixed(dec);
    if (reduced) return (el.textContent = fmt(to));
    const t0 = performance.now(), dur = 1500;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = fmt(to * (1 - Math.pow(1 - k, 4))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const cio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { countUp(e.target); cio.unobserve(e.target); } }), { threshold: 0.4 });
  $$("[data-count]").forEach((el) => cio.observe(el));

  /* ---------------- scroll progress, nav, tab bar ---------------- */
  const bar = $(".progress i"), nav = $("[data-nav]"), tabbar = $(".tabbar");
  const hero = $(".hero, .rp-hero");
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.transform = `scaleX(${h > 0 ? Math.min(1, y / h) : 0})`;
    nav.classList.toggle("is-scrolled", y > 30);
    if (tabbar) {
      const away = !landscape() && (y > h - 40 || (hero && y < hero.offsetHeight * 0.35));   // side rail stays put
      tabbar.classList.toggle("is-away", !!away || document.body.classList.contains("menu-open"));
    }
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener("resize", onScroll);
  onScroll();

  // current section → one highlighted rail item (none while still inside the hero)
  const tabLinks = $$(".tabbar a, .nav-links a");
  const targets = [...new Set(tabLinks.map((a) => a.hash.slice(1)).filter(Boolean))].map((id) => document.getElementById(id)).filter(Boolean);
  const setCurrent = () => {
    const probe = innerHeight * 0.42;
    let cur = null;
    for (const t of targets) { const r = t.getBoundingClientRect(); if (r.top <= probe && r.bottom > probe) cur = t.id; }
    tabLinks.forEach((a) => {
      const on = !!cur && a.hash === "#" + cur && a.pathname === location.pathname;
      a.classList.toggle("is-current", on);
      on ? a.setAttribute("aria-current", "location") : a.removeAttribute("aria-current");
    });
  };
  let stRaf = 0;
  addEventListener("scroll", () => { if (!stRaf) stRaf = requestAnimationFrame(() => { stRaf = 0; setCurrent(); }); }, { passive: true });
  setCurrent();
  $$(".tabbar a").forEach((a) => a.addEventListener("click", () => { vibrate(); const t = document.getElementById(a.hash.slice(1)); if (t) revealAll(t); }));
  if (location.hash) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) revealAll(t); }

  /* ---------------- menu ---------------- */
  const toggle = $(".nav-toggle"), menu = $("#menu");
  let menuT = 0;
  const setMenu = (open) => {
    toggle.setAttribute("aria-expanded", open);
    toggle.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
    document.body.classList.toggle("menu-open", open);
    lock("menu", open);
    clearTimeout(menuT);
    if (open) { menu.hidden = false; requestAnimationFrame(() => { menu.classList.add("is-open"); $("a", menu)?.focus({ preventScroll: true }); }); }
    else { menu.classList.remove("is-open"); menuT = setTimeout(() => (menu.hidden = true), 800); }
    onScroll();
  };
  toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
  menu.addEventListener("keydown", (e) => trap(menu, e));
  menu.addEventListener("click", (e) => { if (e.target === menu) setMenu(false); });
  $$("a", menu).forEach((a) => a.addEventListener("click", () => {
    setMenu(false);
    const t = a.hash && a.pathname === location.pathname && document.getElementById(a.hash.slice(1));
    if (t) revealAll(t);
  }));

  /* ---------------- side drawer / bottom sheet ---------------- */
  const sheet = $(".sheet"), sheetBody = $(".sheet-body", sheet), panel = $(".sheet-panel", sheet);
  let lastFocus = null, sheetT = 0, sheetKey = null;
  const openSheet = (html, accent, key = null) => {
    if (!sheet.classList.contains("is-open")) lastFocus = document.activeElement;
    clearTimeout(sheetT);                        // re-opening during the close animation must not blank the new content
    sheetKey = key;
    sheetBody.innerHTML = html;
    panel.scrollTop = 0;
    panel.style.transform = "";
    panel.style.setProperty("--accent", accent || "");
    sheet.hidden = false;
    lock("sheet", true);
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add("is-open")));
    $(".sheet-close", sheet).focus({ preventScroll: true });
    vibrate();
  };
  const closeSheet = () => {
    if (sheet.hidden || !sheet.classList.contains("is-open")) return;
    sheet.classList.remove("is-open");
    lock("sheet", false);
    clearTimeout(sheetT);
    sheetT = setTimeout(() => { sheet.hidden = true; sheetBody.innerHTML = ""; panel.style.transform = ""; }, 450);
    $$(".is-sel").forEach((x) => x.classList.remove("is-sel"));
    $$(".map-list button.is-hot, .pin.is-hot").forEach((x) => x.classList.remove("is-hot"));
    emit("sheet:close", sheetKey);
    sheetKey = null;
    lastFocus?.focus?.({ preventScroll: true });
  };
  $$("[data-close]", sheet).forEach((b) => b.addEventListener("click", closeSheet));
  sheet.addEventListener("keydown", (e) => trap(sheet, e));
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!sheet.hidden) closeSheet();
    else if (document.body.classList.contains("menu-open")) { setMenu(false); toggle.focus({ preventScroll: true }); }
  });
  // swipe to dismiss: rightwards for the landscape drawer, downwards for the portrait sheet
  let g0 = null;
  panel.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    g0 = { x: t.clientX, y: t.clientY, top: panel.scrollTop, axis: null, d: 0 };
  }, { passive: true });
  panel.addEventListener("touchmove", (e) => {
    if (!g0) return;
    const t = e.touches[0], dx = t.clientX - g0.x, dy = t.clientY - g0.y;
    if (!g0.axis && Math.hypot(dx, dy) > 8) g0.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (landscape() && g0.axis === "x" && dx > 0) { g0.d = dx; sheet.classList.add("is-dragging"); panel.style.transform = `translateX(${dx}px)`; }
    else if (!landscape() && g0.axis === "y" && dy > 0 && g0.top <= 0) { g0.d = dy; sheet.classList.add("is-dragging"); panel.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  const gEnd = () => {
    if (!g0) return;
    const d = g0.d; g0 = null;
    sheet.classList.remove("is-dragging");
    if (d > 90) closeSheet(); else panel.style.transform = "";
  };
  panel.addEventListener("touchend", gEnd);
  panel.addEventListener("touchcancel", gEnd);

  const regionSheet = (id) => {
    const r = R[id], a = DATA.assets[r.heroId];
    const w = a ? (a.variants.find((v) => v >= 920) || a.variants[a.variants.length - 1]) : 1280;
    const facts = r.facts.map((f) => `<div><dt>${esc(f.k)}</dt><dd>${esc(f.v)}</dd></div>`).join("");
    openSheet(`
      <div class="sh-img" role="img" aria-label="${esc(a ? a.alt : r.name)}" style="background-image:url('${ROOT}${r.hero}/${w}.webp');background-color:${a?.color || "#1d1814"}"></div>
      <p class="sh-en">0${r.order} — ${esc(r.en)}</p>
      <h3 class="sh-t" id="sheet-t">${esc(r.name)}</h3>
      <p class="sh-c">${esc(r.catch)}</p>
      <div class="sh-score"><b>${r.balanced.toFixed(1)}</b><small>/100 バランス型の総合点</small></div>
      <dl class="sh-facts">${facts}</dl>
      <a class="btn btn-solid" href="${ROOT}${r.url}">${esc(r.name)}のガイドを読む →</a>`, r.accent, id);
  };

  /* ---------------- hero slideshow (+ swipe) ---------------- */
  const slides = $$(".hero-slide"), dots = $$(".hi"), credits = $$("[data-credit]");
  let cur = 0, timer = 0, heroVisible = true;
  const DUR = 6500;
  const go = (i) => {
    cur = (i + slides.length) % slides.length;
    slides.forEach((s, k) => { s.classList.toggle("is-active", k === cur); s.setAttribute("aria-hidden", k !== cur); });
    dots.forEach((d, k) => { d.classList.toggle("is-active", k === cur); d.setAttribute("aria-selected", k === cur); d.tabIndex = k === cur ? 0 : -1; });
    credits.forEach((c, k) => (c.hidden = k !== cur));
    const img = $("img", slides[cur]); if (img && img.loading === "lazy") img.loading = "eager";
    clearTimeout(timer);
    timer = reduced || !heroVisible || document.hidden ? 0 : setTimeout(() => go(cur + 1), DUR);
    emit("hero:go", cur);
  };
  if (slides.length > 1) {
    dots.forEach((d) => {
      d.style.setProperty("--dur", DUR + "ms");
      d.addEventListener("click", () => go(+d.dataset.go));
      d.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault(); go(cur + (e.key === "ArrowRight" ? 1 : -1)); dots[cur].focus();
      });
    });
    const heroEl = $(".hero");
    let hx = null, hy = null;
    heroEl.addEventListener("touchstart", (e) => {
      if (e.target.closest("a, button") || e.touches.length > 1) { hx = null; return; }
      hx = e.touches[0].clientX; hy = e.touches[0].clientY;
    }, { passive: true });
    heroEl.addEventListener("touchend", (e) => {
      if (hx === null) return;
      const dx = e.changedTouches[0].clientX - hx, dy = e.changedTouches[0].clientY - hy; hx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) go(cur + (dx < 0 ? 1 : -1));
    });
    // autoplay only while the hero is on screen and the tab is visible (no hidden background churn)
    new IntersectionObserver((es) => es.forEach((e) => {
      const was = heroVisible; heroVisible = e.isIntersecting;
      if (heroVisible && !was) go(cur);
      if (!heroVisible) { clearTimeout(timer); timer = 0; }
    }), { threshold: 0.15 }).observe(heroEl);
    document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(timer); timer = 0; } else if (heroVisible) go(cur); });
    addEventListener("load", () => setTimeout(() => slides.forEach((s) => { const im = $("img", s); if (im) im.loading = "eager"; }), 1500));
  }

  /* ---------------- map: tap pin / list / 3D label → drawer ---------------- */
  const map = $(".map");
  if (map) {
    $$(".map-land path", map).forEach((p) => p.style.setProperty("--len", Math.ceil(p.getTotalLength())));
    new IntersectionObserver((es, o) => es.forEach((e) => { if (e.isIntersecting) { map.classList.add("is-drawn"); o.disconnect(); } }), { threshold: 0.25 }).observe(map);
  }
  const openPin = (id) => {
    $$(".pin, .map-list button").forEach((p) => p.classList.toggle("is-hot", p.dataset.pin === id));
    emit("map:focus", id);
    regionSheet(id);
  };
  $$("[data-pin]").forEach((el) => {
    el.addEventListener("click", () => openPin(el.dataset.pin));
    if (el.classList.contains("pin")) el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPin(el.dataset.pin); } });
  });
  document.addEventListener("map:pick", (e) => R[e.detail] && openPin(e.detail));

  /* ---------------- horizontal carousels (region deck, highlights) ---------------- */
  const carousel = (track, items, navEl, dotEls = []) => {
    if (!track || !items.length) return;
    const prev = navEl && $(".deck-prev", navEl), next = navEl && $(".deck-next", navEl);
    const current = () => {
      const tr = track.getBoundingClientRect(), mid = tr.left + tr.width / 2;
      let best = 0, bd = Infinity;
      items.forEach((el, i) => { const r = el.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    const to = (i) => {
      const el = items[Math.max(0, Math.min(items.length - 1, i))];
      const tr = track.getBoundingClientRect(), r = el.getBoundingClientRect();
      track.scrollBy({ left: r.left + r.width / 2 - (tr.left + tr.width / 2), behavior: reduced ? "auto" : "smooth" });
    };
    let raf = 0;
    const sync = () => {
      raf = 0;
      const i = current(), max = track.scrollWidth - track.clientWidth;
      dotEls.forEach((d, k) => d.classList.toggle("on", k === i));
      if (prev) prev.disabled = track.scrollLeft <= 4;
      if (next) next.disabled = track.scrollLeft >= max - 4;
    };
    track.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(sync); }, { passive: true });
    addEventListener("resize", sync);
    prev?.addEventListener("click", () => { vibrate(); to(current() - 1); });
    next?.addEventListener("click", () => { vibrate(); to(current() + 1); });
    dotEls.forEach((d, k) => d.addEventListener("click", () => to(k)));
    track.addEventListener("keydown", (e) => {
      if (e.target !== track) return;
      if (e.key === "ArrowRight") { e.preventDefault(); to(current() + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); to(current() - 1); }
    });
    sync();
  };
  const deck = $(".deck");
  if (deck) carousel(deck, $$(".card", deck), $(".regions .deck-nav"), $$(".deck-dots i"));
  const spotsEl = $(".spots");
  if (spotsEl) carousel(spotsEl, $$(".spot", spotsEl), $(".rp-highlights .deck-nav"));

  /* ---------------- finder ---------------- */
  const ranking = $(".ranking");
  if (ranking) {
    const sliders = $$(".weights input"), weightsBox = $(".weights"), desc = $(".persona-desc");
    const rows = Object.fromEntries($$(".rank", ranking).map((li) => [li.dataset.region, li]));
    const P = Object.fromEntries(DATA.personas.map((p) => [p.id, p]));
    const base = DATA.regions.map((r) => r.id);
    const score = (w) => {
      const tw = Object.values(w).reduce((a, b) => a + b, 0);
      return Object.fromEntries(DATA.regions.map((r) => [r.id, tw ? Math.round(DATA.axes.reduce((s, a) => s + r.scores[a.id] * (w[a.id] || 0), 0) / tw * 100) / 10 : 0]));
    };
    const paint = (s) => {
      s.style.setProperty("--p", (s.value / s.max) * 100 + "%");
      s.nextElementSibling.textContent = s.value;
      s.setAttribute("aria-valuetext", `重み${s.value}`);
    };
    const shown = {}, anim = {};                 // displayed value per row → interrupted animations resume smoothly
    const render = (w) => {
      const totals = score(w);
      const allZero = Object.values(w).every((v) => !v);
      // deterministic order: score, then balanced score, then page order (ties never reshuffle)
      const order = Object.keys(totals).sort((a, b) => totals[b] - totals[a] || R[b].balanced - R[a].balanced || base.indexOf(a) - base.indexOf(b));
      const first = Object.fromEntries(order.map((id) => [id, rows[id].getBoundingClientRect().top]));
      let rank = 0, prevV = null;
      order.forEach((id, i) => {
        const li = rows[id];
        ranking.appendChild(li);
        if (totals[id] !== prevV) rank = i + 1;        // competition ranking: equal scores share a rank
        prevV = totals[id];
        const tie = !allZero && order.some((o) => o !== id && totals[o] === totals[id]);
        $(".rank-pos", li).textContent = allZero ? "–" : rank;
        li.classList.toggle("is-top", rank === 1 && !allZero);
        const nm = $(".rank-name", li);
        let tg = $(".rank-tie", nm);
        if (tie && !tg) { tg = document.createElement("span"); tg.className = "rank-tie"; tg.textContent = "同点"; nm.appendChild(tg); }
        if (!tie && tg) tg.remove();
        $(".rank-bar i", li).style.setProperty("--w", totals[id] + "%");
        const b = $(".rank-score b", li), from = shown[id] ?? (parseFloat(b.textContent) || 0), to = totals[id], t0 = performance.now();
        cancelAnimationFrame(anim[id]);
        const step = (t) => {
          const k = reduced ? 1 : Math.min(1, (t - t0) / 600);
          shown[id] = from + (to - from) * (1 - Math.pow(1 - k, 3));
          b.textContent = shown[id].toFixed(1);
          if (k < 1) anim[id] = requestAnimationFrame(step);
        };
        anim[id] = requestAnimationFrame(step);
        $("a", li).setAttribute("aria-label", `${allZero ? "" : rank + "位 "}${R[id].name} ${to.toFixed(1)}点${tie ? "（同点）" : ""}`);
      });
      if (!reduced) order.forEach((id) => {
        const li = rows[id], dy = first[id] - li.getBoundingClientRect().top;
        if (dy) li.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 650, easing: "cubic-bezier(.22,1,.36,1)" });
      });
      desc.classList.toggle("is-warn", allZero);
      if (allZero) desc.textContent = "すべての重みが0です。少なくとも1つの軸を1以上にしてください。";
    };
    const current = () => Object.fromEntries(sliders.map((s) => [s.dataset.axis, +s.value]));
    const setActive = (id) => $$(".persona").forEach((b) => { const on = b.dataset.persona === id; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on); });
    const setPersona = (id) => {
      setActive(id);
      weightsBox.classList.toggle("is-open", id === "custom");
      desc.classList.remove("is-warn");
      desc.textContent = id === "custom" ? "8つの軸の重み（0〜4）を自分で調整できます。今の重みから始めます。" : P[id].desc;
      if (id !== "custom") sliders.forEach((s) => { s.value = P[id].weights[s.dataset.axis]; paint(s); });
      render(current());
    };
    $$(".persona").forEach((b) => b.addEventListener("click", () => {
      vibrate(); setPersona(b.dataset.persona);
      const box = b.parentElement;                   // horizontal-only nudge — never scroll the page vertically
      if (box.scrollWidth > box.clientWidth) box.scrollTo({ left: b.offsetLeft - (box.clientWidth - b.offsetWidth) / 2, behavior: reduced ? "auto" : "smooth" });
    }));
    sliders.forEach((s) => s.addEventListener("input", () => {
      paint(s);
      weightsBox.classList.add("is-open");
      setActive("custom");
      desc.classList.remove("is-warn");
      desc.textContent = "8つの軸の重み（0〜4）を自分で調整できます。";
      render(current());
    }));
    const resetBtn = document.createElement("button");
    resetBtn.type = "button"; resetBtn.className = "weights-reset"; resetBtn.textContent = "均等（すべて1）に戻す";
    resetBtn.addEventListener("click", () => { sliders.forEach((s) => { s.value = 1; paint(s); }); desc.classList.remove("is-warn"); render(current()); });
    weightsBox.appendChild(resetBtn);
    sliders.forEach(paint);
    // first paint when visible — unless the user already interacted with the finder
    let touched = false;
    $(".finder").addEventListener("pointerdown", () => (touched = true), { once: true, capture: true });
    new IntersectionObserver((es, o) => es.forEach((e) => { if (e.isIntersecting) { if (!touched) setPersona("balanced"); o.disconnect(); } }), { threshold: 0.2 }).observe(ranking);
  }

  /* ---------------- heatmap cells → drawer (+ arrow-key grid navigation) ---------------- */
  const cells = $$(".heat-cell");
  cells.forEach((c, i) => {
    c.addEventListener("click", () => {
      $$(".is-sel").forEach((x) => x.classList.remove("is-sel"));
      c.classList.add("is-sel");
      openSheet(`
        <p class="sh-en">Why this score</p>
        <h3 class="sh-t" id="sheet-t">${esc(c.dataset.title)}</h3>
        <div class="sh-score"><b>${esc(c.dataset.v)}</b><small>/10</small></div>
        <div class="sh-meter" style="--v:${+c.dataset.v}"><i></i></div>
        <p class="sh-b">${esc(c.dataset.why)}</p>`, c.dataset.accent, "heat");
    });
    c.addEventListener("keydown", (e) => {
      const n = DATA.regions.length, m = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: n, ArrowUp: -n }[e.key];
      if (m && cells[i + m]) { e.preventDefault(); cells[i + m].focus(); }
    });
  });

  /* ---------------- axis explorer ---------------- */
  const axBars = $(".axis-bars");
  if (axBars) {
    const descEl = $(".axis-desc");
    const show = (ax) => {
      $$(".axis-chips .chip").forEach((b) => { const on = b.dataset.axis === ax; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on); });
      descEl.textContent = AX[ax].label + " — " + AX[ax].desc;
      const list = [...DATA.regions].sort((a, b) => b.scores[ax] - a.scores[ax] || b.balanced - a.balanced);
      axBars.innerHTML = list.map((r) => `<li style="--c:${r.accent};--v:0" data-v="${r.scores[ax]}"><span class="ab-n">${esc(r.short)}</span><span class="ab-t"><i></i></span><span class="ab-v">${r.scores[ax]}</span></li>`).join("");
      requestAnimationFrame(() => requestAnimationFrame(() => $$("li", axBars).forEach((li) => li.style.setProperty("--v", li.dataset.v))));
    };
    $$(".axis-chips .chip").forEach((b) => b.addEventListener("click", () => { vibrate(); show(b.dataset.axis); }));
    show(DATA.axes[0].id);
  }

  /* ---------------- VS board ---------------- */
  const vs = $(".vs-board");
  if (vs) {
    let A = $(".vs-a .is-active").dataset.id, B = $(".vs-b .is-active").dataset.id;
    const draw = () => {
      if (A === B) B = DATA.regions.find((r) => r.id !== A).id;
      // the region picked on the other side is disabled instead of being silently swapped away
      $$(".vs-a .chip").forEach((c) => { const on = c.dataset.id === A; c.classList.toggle("is-active", on); c.setAttribute("aria-pressed", on); c.disabled = c.dataset.id === B; });
      $$(".vs-b .chip").forEach((c) => { const on = c.dataset.id === B; c.classList.toggle("is-active", on); c.setAttribute("aria-pressed", on); c.disabled = c.dataset.id === A; });
      const ra = R[A], rb = R[B];
      vs.style.setProperty("--ca", ra.accent); vs.style.setProperty("--cb", rb.accent);
      let wa = 0, wb = 0; const winsA = [], winsB = [];
      $$(".vs-rows li", vs).forEach((li) => {
        const ax = li.dataset.axis, va = ra.scores[ax], vb = rb.scores[ax];
        const l = $(".vs-l", li), r = $(".vs-r", li);
        l.style.setProperty("--c", ra.accent); r.style.setProperty("--c", rb.accent);
        l.style.setProperty("--v", va); r.style.setProperty("--v", vb);
        $("b", l).textContent = va; $("b", r).textContent = vb;
        l.classList.toggle("win", va > vb); r.classList.toggle("win", vb > va);
        li.setAttribute("aria-label", `${AX[ax].label}: ${ra.short} ${va}、${rb.short} ${vb}`);
        if (va > vb) { wa++; winsA.push(AX[ax].short); } else if (vb > va) { wb++; winsB.push(AX[ax].short); }
      });
      const draws = DATA.axes.length - wa - wb;
      $(".vs-na", vs).textContent = ra.name; $(".vs-nb", vs).textContent = rb.name;
      $(".vs-score", vs).innerHTML = `${wa}<em>—</em>${wb}`;
      const lead = wa === wb ? "引き分け" : `${esc(wa > wb ? ra.short : rb.short)}が${Math.max(wa, wb)}軸で勝利`;
      $(".vs-verdict", vs).innerHTML = `<b>${lead}${draws ? `（同点${draws}軸）` : ""}。</b>`
        + (winsA.length ? `${esc(ra.short)}は<b>${winsA.join("・")}</b>で優位。` : "")
        + (winsB.length ? `${esc(rb.short)}は<b>${winsB.join("・")}</b>で優位。` : "")
        + `総合点は ${ra.balanced.toFixed(1)} 対 ${rb.balanced.toFixed(1)}。`;
    };
    $$(".vs-a .chip").forEach((c) => c.addEventListener("click", () => { A = c.dataset.id; vibrate(); draw(); }));
    $$(".vs-b .chip").forEach((c) => c.addEventListener("click", () => { B = c.dataset.id; vibrate(); draw(); }));
    $(".vs-mark")?.addEventListener("click", () => { [A, B] = [B, A]; vibrate(); draw(); });
    draw();
  }

  /* ---------------- comparison radar ---------------- */
  const rc = $(".rc-svg");
  if (rc) {
    const { size, r: RR, labels, series, colors } = DATA.radar;
    const C = size / 2, n = labels.length, NS = "http://www.w3.org/2000/svg";
    const pt = (i, v, rad = RR) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [C + Math.cos(a) * rad * v, C + Math.sin(a) * rad * v]; };
    const mk = (tag, attrs, parent = rc) => { const el = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); parent.appendChild(el); return el; };
    const g = mk("g", {});
    [0.2, 0.4, 0.6, 0.8, 1].forEach((k) => mk("polygon", { class: "rg", points: labels.map((_, i) => pt(i, k).join(",")).join(" ") }, g));
    labels.forEach((l, i) => {
      const [x, y] = pt(i, 1); mk("line", { class: "rs", x1: C, y1: C, x2: x, y2: y }, g);
      const [lx, ly] = pt(i, 1, RR + 22);
      mk("text", { class: "rl", x: lx, y: ly, "text-anchor": Math.abs(lx - C) < 8 ? "middle" : lx > C ? "start" : "end", "dominant-baseline": "middle" }, g).textContent = l;
    });
    const zero = labels.map(() => `${C},${C}`).join(" ");
    const polys = {};
    Object.keys(series).forEach((id) => { const sg = mk("g", { class: "series" }); polys[id] = mk("polygon", { points: zero, fill: colors[id], stroke: colors[id] }, sg); });
    const boxes = $$(".rc-toggle input");
    const update = () => {
      boxes.forEach((cb) => {
        const p = polys[cb.value];
        p.setAttribute("points", cb.checked ? series[cb.value].map((v, i) => pt(i, v / 10).join(",")).join(" ") : zero);
        p.parentNode.style.opacity = cb.checked ? 1 : 0;
      });
      rc.setAttribute("aria-label", "レーダーチャート比較: " + boxes.filter((b) => b.checked).map((b) => R[b.value].short).join("・"));
    };
    boxes.forEach((cb) => cb.addEventListener("change", () => {
      if (!boxes.some((x) => x.checked)) cb.checked = true;   // an empty chart explains nothing
      if (cb.checked) rc.appendChild(polys[cb.value].parentNode);   // the series just enabled is drawn on top
      vibrate(); update();
    }));
    new IntersectionObserver((es, o) => es.forEach((e) => { if (e.isIntersecting) { update(); o.disconnect(); } }), { threshold: 0.3 }).observe(rc);
  }

  /* ---------------- season / holiday filter ---------------- */
  const cal = $(".cal");
  if (cal) {
    const ans = $(".hol-answer"), initial = ans.innerHTML;
    $$(".ht").forEach((b) => b.addEventListener("click", () => {
      vibrate();
      $$(".ht").forEach((x) => { x.classList.toggle("is-active", x === b); x.setAttribute("aria-pressed", x === b); });
      const months = (b.dataset.months || "").split(",").filter(Boolean).map(Number);
      cal.classList.toggle("is-filtered", months.length > 0);
      $$("[data-m]", cal).forEach((c) => c.classList.toggle("on", months.includes(+c.dataset.m)));
      if (!months.length) return (ans.innerHTML = initial);
      const label = b.firstChild.textContent.trim();
      const avg = DATA.regions.map((r) => [r, months.reduce((s, m) => s + r.months[m - 1], 0) / months.length]).sort((x, y) => y[1] - x[1]);
      const best = avg.filter(([, v]) => v >= 4);
      const when = `${esc(label)}（${months.join("・")}月）`;
      const head = best.length
        ? `${when}なら <b>${best.map(([r]) => esc(r.short)).join("・")}</b> がベスト。`
        : `${when}は暑さ・雨の季節。比較的おすすめは <b>${esc(avg[0][0].short)}</b>。`;
      ans.innerHTML = `<p class="ha-t">${head}</p><ol>${avg.map(([r, v]) => `<li style="--c:${r.accent};--v:${v.toFixed(1)}"><a href="${ROOT}${r.url}">${esc(r.name)}</a><span>${v.toFixed(1)}<small>/5</small></span><div class="ha-bar"><i></i></div></li>`).join("")}</ol>`;
    }));
  }

  /* ---------------- lightbox (+ swipe / arrows between photos) ---------------- */
  const lb = $(".lightbox");
  if (lb) {
    const stage = $(".lb-stage", lb), items = $$("[data-lightbox]");
    let idx = 0, last = null;
    const pick = (a) => {
      const need = Math.min(innerWidth, innerHeight * (a.w / a.h)) * Math.min(devicePixelRatio || 1, 3);
      return a.variants.find((v) => v >= need) || a.variants[a.variants.length - 1];
    };
    const show = (i) => {
      idx = (i + items.length) % items.length;
      const a = DATA.assets[items[idx].dataset.lightbox], w = pick(a), jw = a.jpg.filter((v) => v <= w).pop() || a.jpg[0];
      lb.classList.add("is-loading");
      stage.innerHTML = `<picture>${a.avif ? `<source type="image/avif" srcset="${ROOT}${a.path}/${w}.avif">` : ""}<source type="image/webp" srcset="${ROOT}${a.path}/${w}.webp"><img src="${ROOT}${a.path}/${jw}.jpg" alt="${esc(a.alt)}" width="${a.w}" height="${a.h}" style="background:${a.color || "#111"}"></picture>`
        + `<p class="lb-cap" aria-live="polite">${esc(a.alt)}<span>${idx + 1} / ${items.length} · <a href="${esc(a.link)}" target="_blank" rel="noopener">Photo: ${esc(a.credit)}</a></span></p>`;
      const img = $("img", stage);
      const done = () => lb.classList.remove("is-loading");
      if (img.complete) done(); else { img.addEventListener("load", done, { once: true }); img.addEventListener("error", done, { once: true }); }
      // preload neighbours so swiping feels instant
      [idx + 1, idx - 1].forEach((k) => { const n = DATA.assets[items[(k + items.length) % items.length].dataset.lightbox]; const im = new Image(); im.src = `${ROOT}${n.path}/${pick(n)}.webp`; });
    };
    const open = (i, btn) => { last = btn; show(i); lb.hidden = false; lock("lightbox", true); $(".lb-close", lb).focus({ preventScroll: true }); };
    const close = () => { if (lb.hidden) return; lb.hidden = true; stage.innerHTML = ""; lock("lightbox", false); last?.focus({ preventScroll: true }); };
    items.forEach((b, i) => b.addEventListener("click", () => open(i, b)));
    $(".lb-close", lb).addEventListener("click", close);
    $(".lb-prev", lb)?.addEventListener("click", () => show(idx - 1));
    $(".lb-next", lb)?.addEventListener("click", () => show(idx + 1));
    lb.addEventListener("click", (e) => { if (e.target === lb || e.target === stage) close(); });
    lb.addEventListener("keydown", (e) => trap(lb, e));
    addEventListener("keydown", (e) => {
      if (lb.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") show(idx + 1);
      if (e.key === "ArrowLeft") show(idx - 1);
    });
    let lx = null, ly = null;
    lb.addEventListener("touchstart", (e) => { if (e.touches.length > 1 || e.target.closest("button, a")) { lx = null; return; } lx = e.touches[0].clientX; ly = e.touches[0].clientY; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      if (lx === null) return;
      const dx = e.changedTouches[0].clientX - lx, dy = e.changedTouches[0].clientY - ly; lx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(idx + (dx < 0 ? 1 : -1));
      else if (dy > 100 && Math.abs(dy) > Math.abs(dx)) close();
    });
  }

  /* ---------------- light motion (GSAP, touch-safe: no smooth-scroll hijack) ---------------- */
  const initMotion = () => {
    if (!window.gsap || !window.ScrollTrigger || reduced) return;
    const { gsap, ScrollTrigger } = window;
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });
    const heroChars = $$(".hero-title .ch, .rp-title .ch-en .ch");
    if (heroChars.length) {
      gsap.from(heroChars, { yPercent: 115, rotate: 6, duration: 1.2, ease: "expo.out", stagger: 0.03, delay: 0.15 });
      const intro = $$(".hero-ja, .hero-cta, .hero-eyebrow, .hero-index, .rp-hero .ch-ja, .rp-hero .ch-catch, .rp-hero .ch-num, .crumbs");
      if (intro.length) gsap.from(intro, { y: 24, opacity: 0, duration: 1.1, ease: "expo.out", stagger: 0.07, delay: 0.5, clearProps: "opacity,transform" });
    }
    if ($(".hero")) gsap.to(".hero-content", { yPercent: -18, opacity: 0.2, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
    $$(".js-parallax").forEach((el) => {
      const img = $("img", el);
      gsap.fromTo(img, { yPercent: -6 }, { yPercent: 6, ease: "none", scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
    });
    if ($(".deck")) gsap.from(".card", { y: 60, opacity: 0, duration: 1.1, ease: "expo.out", stagger: 0.08, clearProps: "opacity,transform", scrollTrigger: { trigger: ".deck", start: "top 85%", once: true } });
    addEventListener("load", () => ScrollTrigger.refresh());
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  };

  /* ---------------- full-screen + landscape lock (target: sideways phone) ---------------- */
  const fsBtn = $(".fs-btn");
  const fsEl = document.documentElement;
  const canFs = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
  const inFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement) || matchMedia("(display-mode: fullscreen)").matches;
  const syncFs = () => { document.documentElement.classList.toggle("is-fullscreen", inFs()); if (fsBtn) fsBtn.hidden = !canFs || inFs(); };
  const goFs = async () => {
    try {
      if (!inFs()) await (fsEl.requestFullscreen ? fsEl.requestFullscreen({ navigationUI: "hide" }) : fsEl.webkitRequestFullscreen());
      await screen.orientation?.lock?.("landscape").catch(() => {});
    } catch { /* user gesture / browser policy */ }
    syncFs();
  };
  fsBtn?.addEventListener("click", goFs);
  document.addEventListener("fullscreenchange", syncFs);
  document.addEventListener("webkitfullscreenchange", syncFs);
  // the first tap on plain content enters full-screen once per session. Taps on controls are left
  // alone: entering full-screen resizes the viewport under the finger and would mis-target the tap.
  let wasFs = false;
  const firstTap = (e) => {
    if (e.pointerType === "mouse" || e.target.closest("a[href], button, input, label, summary, [role=button], [role=tab], .sheet, .lightbox, .menu, .deck, .spots")) return;
    removeEventListener("pointerup", firstTap);
    if (canFs && !inFs() && !sessionStorage.getItem("fs-declined")) goFs();
  };
  addEventListener("pointerup", firstTap, { passive: true });
  document.addEventListener("fullscreenchange", () => {
    if (inFs()) wasFs = true;
    else if (wasFs) sessionStorage.setItem("fs-declined", "1");   // only a real exit counts as "declined"
  });
  syncFs();

  /* ---------------- 3D coverflow for horizontal decks ---------------- */
  const flow = (track, items) => {
    let raf = 0;
    const upd = () => {
      raf = 0;
      if (!landscape()) { items.forEach((el) => ["--ry", "--tz", "--sc"].forEach((p) => el.style.removeProperty(p))); return; }
      const tr = track.getBoundingClientRect(), mid = tr.left + tr.width / 2;
      items.forEach((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.max(-1.4, Math.min(1.4, (r.left + r.width / 2 - mid) / tr.width));
        el.style.setProperty("--ry", (-d * 22).toFixed(2));
        el.style.setProperty("--tz", (-Math.abs(d) * 140).toFixed(1));
        el.style.setProperty("--sc", (1 - Math.abs(d) * 0.08).toFixed(3));
      });
    };
    const q = () => { if (!raf) raf = requestAnimationFrame(upd); };
    track.addEventListener("scroll", q, { passive: true });
    addEventListener("resize", q);
    screen.orientation?.addEventListener?.("change", q);
    upd();
  };
  if (!reduced) {
    const d = $(".deck"); if (d) flow(d, $$(".card", d));
    const sp = $(".spots"); if (sp) flow(sp, $$(".spot", sp));
  }

  const boot = () => { finishLoader(); initMotion(); if (slides.length > 1) go(0); };
  document.readyState !== "loading" ? boot() : addEventListener("DOMContentLoaded", boot);
})();
