// D’Chicken Express · interacciones y carrito (sin librerías).
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const WA = "51904558521";
  const top = $(".top");
  const hero = $(".hero");
  const heroImg = $("[data-depth]");
  const dock = $(".dock");
  const visit = document.getElementById("visitanos");

  // WhatsApp directo siempre en una pestaña nueva (en el celular abre la app).
  for (const a of $$("a[data-wa]")) {
    a.target = "_blank";
    a.rel = "noopener";
  }

  // ── Carrito ───────────────────────────────────────────────
  let CAT = {};
  try {
    CAT = JSON.parse($("#catalogo").textContent);
  } catch (e) {}
  const KEY = "dchicken_web_pedido_v1";
  let state = { items: {}, entrega: "delivery", direccion: "", nombre: "", nota: "" };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && typeof saved.items === "object") state = { ...state, ...saved };
  } catch (e) {}
  for (const id of Object.keys(state.items)) if (!CAT[id] || !(state.items[id] > 0)) delete state.items[id];

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {}
  };
  const money = (p) => "S/" + (p % 1 ? p.toFixed(2) : String(p));
  const lines = () => Object.entries(state.items).filter(([id, q]) => CAT[id] && q > 0);
  const count = () => lines().reduce((s, [, q]) => s + q, 0);
  const total = () => Math.round(lines().reduce((s, [id, q]) => s + (CAT[id].p || 0) * q, 0) * 100) / 100;
  const pending = () => lines().some(([id]) => CAT[id].p === null);
  const totalText = () => money(total()) + (pending() ? " +" : "");

  // ── Horario: siempre con la hora de Lima, aunque el celular tenga otra zona ──
  const OPEN = 12 * 60,
    CLOSE = 23 * 60,
    LAST_CALL = 30;
  function limaMinutes() {
    try {
      const p = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Lima",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date());
      const v = (t) => Number(p.find((x) => x.type === t).value);
      return v("hour") * 60 + v("minute");
    } catch (e) {
      const d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    }
  }
  function hours() {
    const t = limaMinutes();
    if (t < OPEN) return { open: false, when: "hoy" };
    if (t >= CLOSE) return { open: false, when: "mañana" };
    return { open: true, left: CLOSE - t };
  }
  function paintHours() {
    const h = hours();
    const status = $("[data-open-status]");
    if (status)
      status.textContent = h.open
        ? "Abierto ahora · hasta las 11:00 p.m."
        : `Cerrado ahora · abrimos ${h.when} a las 12:00 p.m.`;
    $(".hero .dot")?.classList.toggle("open", h.open);
    $(".hero .dot")?.classList.toggle("closed", !h.open);
    const note = cart && $("[data-hours]", cart);
    if (note) {
      if (!h.open) {
        note.innerHTML = `<b>Ahora estamos cerrados.</b> Abrimos ${h.when} a las 12:00 p.m. Puedes dejar tu pedido y te respondemos apenas abramos.`;
        note.hidden = false;
      } else if (h.left <= LAST_CALL) {
        note.innerHTML = `<b>Cerramos a las 11:00 p.m.</b> (en ${h.left} min). Envía tu pedido pronto.`;
        note.hidden = false;
      } else note.hidden = true;
      const label = $("[data-send-label]", cart);
      if (label) label.textContent = h.open ? "Enviar pedido por WhatsApp" : "Dejar pedido por WhatsApp";
    }
  }

  function message() {
    const out = ["Hola D’Chicken, quiero hacer este pedido:", ""];
    if (!hours().open) out.splice(1, 0, "(Lo envío fuera de horario: es para cuando abran.)");
    for (const [id, q] of lines()) {
      const it = CAT[id];
      out.push(`• ${q} × ${it.n} — ${it.p === null ? "precio por confirmar" : money(Math.round(it.p * q * 100) / 100)}`);
    }
    out.push("", `*Total de platos: ${money(total())}*${pending() ? " (+ productos por confirmar)" : ""}`);
    if (state.entrega === "delivery") {
      out.push("Entrega: delivery (el costo según mi zona me lo confirman)");
      if (state.direccion.trim()) out.push(`Dirección: ${state.direccion.trim()}`);
    } else out.push("Entrega: recojo en el local");
    if (state.nombre.trim()) out.push(`Nombre: ${state.nombre.trim()}`);
    if (state.nota.trim()) out.push(`Nota: ${state.nota.trim()}`);
    return out.join("\n");
  }
  const waLink = () => `https://wa.me/${WA}?text=${encodeURIComponent(message())}`;

  const cart = $("#cart");
  const list = cart ? $(".cart-list", cart) : null;
  const MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // Cantidad en cada plato de la carta: aparece «− n» junto al «+».
  function paintDish(li) {
    const id = li.dataset.item,
      q = state.items[id] || 0,
      ctl = $(".dish-ctl", li);
    if (!ctl) return;
    li.classList.toggle("has", q > 0);
    let minus = $(".minus", ctl),
      n = $(".n", ctl);
    if (q > 0 && !minus) {
      minus = document.createElement("button");
      minus.type = "button";
      minus.className = "minus";
      minus.dataset.sub = id;
      minus.innerHTML = MINUS;
      n = document.createElement("span");
      n.className = "n";
      ctl.prepend(minus, n);
    }
    if (q > 0) {
      minus.setAttribute("aria-label", `Quitar un ${CAT[id]?.n || ""}`);
      n.textContent = q;
    } else {
      minus?.remove();
      n?.remove();
    }
  }

  function paintCart() {
    if (!cart) return;
    const ls = lines();
    cart.classList.toggle("empty", !ls.length);
    list.innerHTML = ls
      .map(([id, q]) => {
        const it = CAT[id];
        const priced = it.p !== null;
        return `<li class="dish has" data-item="${id}"><div class="dish-info"><span class="dish-name">${esc(it.n)}</span><span class="dish-desc">${priced ? money(it.p) + " c/u" : "Precio por confirmar"}</span></div><span class="dish-price${priced ? "" : " ask"}">${priced ? money(Math.round(it.p * q * 100) / 100) : "Consultar"}</span><div class="dish-ctl"><button type="button" class="minus" data-sub="${id}" aria-label="Quitar un ${esc(it.n)}">${MINUS}</button><span class="n">${q}</span><button type="button" class="add" data-add="${id}" aria-label="Agregar otro ${esc(it.n)}">${PLUS}</button></div></li>`;
      })
      .join("");
    const note = $("[data-note]", cart);
    const extra = pending() ? " Algunos productos tienen precio por confirmar." : "";
    note.textContent =
      state.entrega === "delivery"
        ? "El delivery cuesta de S/4 a S/8 según tu zona; te lo confirmamos por WhatsApp." + extra
        : "Te avisamos por WhatsApp cuando esté listo para recoger en Av. Belaunde Oeste 313." + extra;
    $("[data-addr]", cart).hidden = state.entrega !== "delivery";
    $(".cart-send", cart).href = waLink();
  }

  function paintCounts() {
    const c = count();
    for (const el of $$("[data-count]")) {
      el.textContent = c;
      if (el.closest(".cart-btn")) el.hidden = c === 0;
    }
    for (const el of $$("[data-total]")) el.textContent = totalText();
    const btn = $(".cart-btn");
    if (btn) btn.setAttribute("aria-label", c ? `Ver mi pedido: ${c} producto${c === 1 ? "" : "s"}` : "Ir a la carta");
    if (dock) {
      dock.classList.toggle("has-items", c > 0);
      $(".dock-wa", dock).hidden = c > 0;
      $(".dock-cart", dock).hidden = c === 0;
    }
    dockState();
  }

  function paintAll() {
    for (const li of $$(".cats .dish, .dishes-solo .dish")) paintDish(li);
    paintCounts();
    if (cart?.open) paintCart();
  }

  let addedTimer;
  const added = $(".added");
  function announce(text) {
    if (!added) return;
    added.textContent = text;
    added.classList.add("show");
    clearTimeout(addedTimer);
    addedTimer = setTimeout(() => added.classList.remove("show"), 1800);
  }
  function bump(el) {
    if (reduce || !el || !el.animate) return;
    el.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], {
      duration: 220,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
  }

  function change(id, d, src) {
    if (!CAT[id]) return;
    const q = Math.max(0, Math.min(99, (state.items[id] || 0) + d));
    if (q) state.items[id] = q;
    else delete state.items[id];
    save();
    paintAll();
    if (d > 0) {
      announce(`Agregado: ${CAT[id].n} · ${count()} en tu pedido`);
      bump($(".cart-btn .count"));
      bump($(".dock-n"));
    }
  }

  document.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) {
      e.preventDefault();
      change(add.dataset.add, 1, add);
      return;
    }
    const sub = e.target.closest("[data-sub]");
    if (sub) {
      e.preventDefault();
      change(sub.dataset.sub, -1, sub);
      return;
    }
    const open = e.target.closest("[data-open-cart]");
    if (open) {
      if (!count()) return; // sin pedido, el enlace baja a la carta
      e.preventDefault();
      openCart();
      return;
    }
    if (e.target.closest("[data-close-cart]")) closeCart();
  });

  function openCart() {
    if (!cart) return;
    paintCart();
    $('[name="direccion"]', cart).value = state.direccion;
    $('[name="nombre"]', cart).value = state.nombre;
    $('[name="nota"]', cart).value = state.nota;
    for (const r of $$('[name="entrega"]', cart)) r.checked = r.value === state.entrega;
    paintHours();
    cart.classList.remove("closing", "dismissing");
    if (typeof cart.showModal === "function") cart.showModal();
    else cart.setAttribute("open", "");
    document.body.classList.add("cart-open");
  }
  function finishClose() {
    cart.classList.remove("closing", "dismissing", "dragging");
    cart.style.transform = "";
    cart.style.transition = "";
    cart.style.animation = "";
    if (typeof cart.close === "function") cart.close();
    else cart.removeAttribute("open");
    document.body.classList.remove("cart-open");
  }
  let closeTimer;
  function closeCart() {
    if (!cart?.open || cart.classList.contains("closing")) return;
    if (reduce) return finishClose();
    cart.classList.add("closing");
    clearTimeout(closeTimer);
    closeTimer = setTimeout(finishClose, 260); // por si animationend no llega
    cart.addEventListener(
      "animationend",
      () => {
        clearTimeout(closeTimer);
        finishClose();
      },
      { once: true },
    );
  }
  // Esc también cierra con animación.
  cart?.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeCart();
  });

  paintHours();
  setInterval(paintHours, 60000);

  // ── Deslizar hacia abajo para cerrar (celular) ──
  const sheetMQ = window.matchMedia("(max-width: 719px)");
  const head = cart && $(".cart-head", cart);
  let drag = null;
  const rubber = (x) => (x * 40) / (40 + x); // resistencia si se jala hacia arriba
  head?.addEventListener("pointerdown", (e) => {
    if (!sheetMQ.matches || drag || e.button > 0 || e.target.closest("button, a")) return;
    drag = { id: e.pointerId, y: e.clientY, dy: 0, hist: [[performance.now(), e.clientY]] };
    try {
      head.setPointerCapture(e.pointerId);
    } catch (err) {}
    cart.classList.add("dragging");
    cart.style.animation = "none";
    cart.style.transition = "none";
  });
  head?.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const raw = e.clientY - drag.y;
    drag.dy = raw >= 0 ? raw : -rubber(-raw);
    drag.hist.push([performance.now(), e.clientY]);
    if (drag.hist.length > 6) drag.hist.shift();
    cart.style.transform = `translateY(${drag.dy}px)`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const [t0, y0] = drag.hist[0],
      [t1, y1] = drag.hist[drag.hist.length - 1];
    const v = t1 > t0 ? (y1 - y0) / (t1 - t0) : 0; // px por ms
    const dy = drag.dy;
    drag = null;
    cart.classList.remove("dragging");
    if (dy > 120 || (v > 0.11 && dy > 12)) {
      // Se va desde donde está, sin saltos.
      cart.classList.add("dismissing");
      cart.style.transition = "transform 200ms cubic-bezier(0.23, 1, 0.32, 1)";
      cart.style.transform = "translateY(100%)";
      clearTimeout(closeTimer);
      closeTimer = setTimeout(finishClose, 240);
    } else {
      cart.style.transition = "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)";
      cart.style.transform = "";
      setTimeout(() => {
        if (!drag) cart.style.transition = "";
      }, 320);
    }
  };
  head?.addEventListener("pointerup", endDrag);
  head?.addEventListener("pointercancel", endDrag);
  cart?.addEventListener("close", () => document.body.classList.remove("cart-open"));
  cart?.addEventListener("click", (e) => {
    if (e.target === cart) closeCart(); // tocar fuera de la hoja
  });
  cart?.addEventListener("input", (e) => {
    const f = e.target;
    if (f.name === "entrega") state.entrega = f.value;
    else if (["direccion", "nombre", "nota"].includes(f.name)) state[f.name] = f.value;
    else return;
    if (f.name === "direccion") f.removeAttribute("aria-invalid");
    save();
    paintCart();
  });
  cart?.querySelector(".cart-send")?.addEventListener("click", (e) => {
    if (!lines().length) {
      e.preventDefault();
      return;
    }
    if (state.entrega === "delivery" && !state.direccion.trim()) {
      e.preventDefault();
      const d = $('[name="direccion"]', cart);
      d.setAttribute("aria-invalid", "true");
      d.focus();
      announce("Escribe tu dirección para el delivery");
      return;
    }
    paintHours();
    e.currentTarget.href = waLink();
  });
  // Vaciar en dos toques (sin ventanas del navegador, que algunos visores bloquean).
  let clearArmed = 0;
  cart?.querySelector(".cart-clear")?.addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (Date.now() - clearArmed > 3000) {
      clearArmed = Date.now();
      b.textContent = "Toca otra vez para vaciar";
      setTimeout(() => {
        if (Date.now() - clearArmed >= 2900) b.textContent = "Vaciar pedido";
      }, 3000);
      return;
    }
    clearArmed = 0;
    b.textContent = "Vaciar pedido";
    state.items = {};
    save();
    paintAll();
    paintCart();
  });

  // ── Cabecera sólida al bajar + profundidad moderada en la foto ──
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      top.classList.toggle("scrolled", y > 24);
      if (heroImg && !reduce && y < window.innerHeight * 1.2) heroImg.style.setProperty("--py", (y * 0.22).toFixed(1) + "px");
      ticking = false;
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ── Barra inferior: aparece al pasar la portada; sin pedido se oculta en Contacto ──
  let heroIn = true,
    visitIn = false;
  function dockState() {
    if (dock) dock.classList.toggle("show", !heroIn && (!visitIn || count() > 0));
  }

  if (!("IntersectionObserver" in window)) {
    for (const el of $$(".reveal")) el.classList.add("in");
    heroIn = false;
    paintAll();
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  for (const el of $$(".reveal")) if (!el.closest(".wing-rail")) io.observe(el);
  // Alitas en celular: carrusel horizontal, aparecen todas juntas.
  const railIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const w of $$(".reveal", e.target)) w.classList.add("in");
        railIO.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  for (const rail of $$(".wing-rail")) railIO.observe(rail);

  new IntersectionObserver(([e]) => {
    heroIn = e.isIntersecting;
    dockState();
  }, { threshold: 0.08 }).observe(hero);
  if (visit)
    new IntersectionObserver(([e]) => {
      visitIn = e.isIntersecting;
      dockState();
    }).observe(visit);

  // Sección activa en el menú superior y en las categorías de la carta.
  const spyLinks = (sel) => new Map($$(sel).map((a) => [a.hash.slice(1), a]));
  const navLinks = spyLinks(".nav a"),
    chipLinks = spyLinks(".chips a");
  const chipsBox = $(".chips-in");
  const spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const map of [navLinks, chipLinks]) {
          const a = map.get(e.target.id);
          if (!a) continue;
          for (const l of map.values()) l.classList.toggle("on", l === a);
          if (map === chipLinks && chipsBox) {
            const x = a.offsetLeft - chipsBox.clientWidth / 2 + a.offsetWidth / 2;
            chipsBox.scrollTo({ left: x, behavior: reduce ? "auto" : "smooth" });
          }
        }
      }
    },
    { rootMargin: "-40% 0px -55% 0px" },
  );
  for (const id of new Set([...navLinks.keys(), ...chipLinks.keys()])) {
    const s = document.getElementById(id);
    if (s) spy.observe(s);
  }

  paintAll();
})();
