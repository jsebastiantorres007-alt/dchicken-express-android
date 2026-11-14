/* D'Chicken Express Control · v5 · local + Supabase optativo */
(() => {
  "use strict";
  const KEY = "dchicken_control_v3",
    OLD = "polleria_control_simple_v2",
    LOGO = "./logo.webp",
    THEME_KEY = "dchicken_theme_v8";
  let theme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  const paintTheme = () => {
    const m = document.getElementById("meta-theme");
    if (m) m.content = theme === "dark" ? "#12100e" : "#f4f2f0";
  };
  paintTheme();
  const today = () => {
    const ps = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const o = Object.fromEntries(ps.map((p) => [p.type, p.value]));
    return `${o.year}-${o.month}-${o.day}`;
  };
  const N = (x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v : 0;
  };
  const fix = (x) => Math.round((N(x) + Number.EPSILON) * 100) / 100;
  const money = (x) => "S/ " + N(x).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const int = (x) => N(x).toLocaleString("es-PE", { maximumFractionDigits: 0 });
  const esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const uid = () => crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  const sum = (a, f) => fix(a.reduce((s, r) => s + N(f(r)), 0));
  const sort = (a) =>
    [...a].sort(
      (x, y) => String(y.date || "").localeCompare(String(x.date || "")) || (y.created || 0) - (x.created || 0),
    );
  const nice = (d) => (d ? d.split("-").reverse().join("/") : "—");
  const dateOK = (s) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  const methods = [
    ["cash", "Efectivo de caja"],
    ["personal", "Efectivo personal"],
    ["yape", "Yape · BCP"],
    ["bcp_transfer", "Transferencia BCP"],
    ["bbva", "BBVA"],
  ];
  const methodOptions = (value) =>
    value === "transfer" ? [...methods, ["transfer", "Transferencia antigua (sin banco asignado)"]] : methods;
  const payLabel = (m) =>
    ({
      cash: "Efectivo de caja",
      personal: "Efectivo personal",
      yape: "Yape · BCP",
      bcp_transfer: "BCP transferencia",
      bbva: "BBVA",
      bbva_transfer: "BBVA (anterior)",
      plin: "Plin (anterior)",
      transfer: "Transferencia antigua (sin asignar)",
      mixed: "Pago combinado",
    })[m] || "—";
  const bankName = { bcp: "BCP", bbva: "BBVA" };
  const bankFor = (entry) =>
    ({ yape: "bcp", bcp_transfer: "bcp", bbva: "bbva", bbva_transfer: "bbva", plin: "bcp" })[entry.method] || null;

  const catLabel = {
    gaseosa: "Gaseosas",
    lena: "Leña",
    general: "Compras generales",
    pollo: "Pollos",
    sunat: "SUNAT / contador",
    gasto: "Otros gastos",
    personal: "Personal",
    local: "Alquiler del local",
  };
  const blank = () => ({
    version: 3,
    created: Date.now(),
    closures: [],
    expenses: [],
    chickens: [],
    purchases: [],
    payments: [],
    sunat: [],
    historical: [],
    legacyDrinkSales: [],
    bankSettings: [],
    bankTransactions: [],
    shoppingLists: [],
    alertSettings: [],
    sales: [],
  });
  let db = blank(),
    page = "panel",
    day = today(),
    month = today().slice(0, 7),
    edit = null,
    storageOk = true,
    noticeTimer = null,
    paidManuallyChanged = false,
    quickOpen = false;
  const plusDays = (d, n) => {
    let x = new Date(d + "T12:00:00Z");
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  let shoppingDay = plusDays(today(), 1),
    shoppingPick = null,
    shoppingGroup = false;
  const shoppingSel = new Set();
  const app = document.querySelector("#app");
  function valid(db0) {
    return (
      db0 &&
      db0.version === 3 &&
      ["closures", "expenses", "chickens", "purchases", "payments", "sunat"].every((k) => Array.isArray(db0[k]))
    );
  }
  function migrateOld(old) {
    if (
      !old ||
      old.version !== 2 ||
      !["closures", "expenses", "chickens", "drinkPurchases", "drinkPayments"].every((k) => Array.isArray(old[k]))
    )
      throw Error("Respaldo anterior no compatible.");
    const out = blank();
    out.closures = old.closures.map((x) => ({ ...x }));
    out.expenses = old.expenses.map((x) => ({ ...x, method: x.method === "cash" ? "cash" : "transfer" }));
    out.chickens = old.chickens.map((x) => ({ ...x, unitCost: 0, paid: false, legacy: true }));
    const names = Object.fromEntries(
      (old.products || []).map((x) => [x.id, `${x.name || "Gaseosa"} ${x.unit || ""}`.trim()]),
    );
    out.purchases = old.drinkPurchases.map((x) => ({
      id: x.id,
      date: x.date,
      type: "gaseosa",
      product: names[x.productId] || "Gaseosa (histórico)",
      qty: x.qty,
      unitCost: N(x.totalCost) / Math.max(1, N(x.qty)),
      total: N(x.totalCost),
      person: x.supplier || "",
      note: "Importada de versión anterior",
      created: x.created || 0,
    }));
    out.payments = old.drinkPayments.map((x) => ({
      id: x.id,
      purchaseId: x.purchaseId,
      date: x.date,
      amount: x.amount,
      method: x.method === "cash" ? "cash" : "transfer",
      person: x.person || "",
      note: x.note || "",
      created: x.created || 0,
    }));
    out.legacyDrinkSales = old.drinkSales || [];
    out.historical = old.historical || out.historical;
    return out;
  }
  function load() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (valid(parsed)) {
          db = { ...blank(), ...parsed };
          return;
        }
      }
      const oldRaw = localStorage.getItem(OLD);
      if (oldRaw) {
        db = migrateOld(JSON.parse(oldRaw));
        save();
      }
    } catch (e) {
      storageOk = false;
    }
  }
  function save() {
    if (window.DChickenCloud?.isActive()) {
      window.DChickenCloud.queueSave(db);
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      storageOk = true;
    } catch (e) {
      storageOk = false;
      toast("No se pudo guardar localmente: haz un respaldo.", true);
    }
  }
  window.DChickenBridge = {
    // La nube pasa por el mismo modelo financiero ya probado en el prototipo.
    getLocal: () => JSON.parse(JSON.stringify(db)),
    setFromCloud: (incoming) => {
      db = { ...blank(), ...incoming };
      edit = null;
      payTarget = null;
      render();
    },
    clear: () => {
      db = blank();
      edit = null;
      payTarget = null;
      render();
    },
    notify: (message, err = false) => toast(message, err),
    getPage: () => page,
    rerender: () => render(),
    alerts: () => notifications(45),
  };
  function toast(msg, isError = false) {
    document.querySelector(".toast")?.remove();
    const e = document.createElement("div");
    e.className = "toast" + (isError ? " error" : "");
    e.role = "status";
    e.textContent = msg;
    document.body.append(e);
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => e.remove(), 4500);
  }
  function field(label, name, value = "", type = "text", extra = "") {
    return `<div class="field"><label for="fld-${name}">${label}</label><input id="fld-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
  }
  function select(label, name, opts, value = "", extra = "") {
    return `<div class="field"><label for="fld-${name}">${label}</label><select id="fld-${name}" name="${name}" ${extra}>${opts.map(([k, v]) => `<option value="${esc(k)}" ${k === value ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>`;
  }
  function card(title, content, desc = "", actions = "") {
    return `<section class="card"><div class="card-head"><div><h2>${title}</h2>${desc ? `<p class="sub">${desc}</p>` : ""}</div>${actions}</div><div class="card-body">${content}</div></section>`;
  }
  function metric(title, value, note = "", cls = "") {
    return `<div class="metric"><div class="k">${title}</div><div class="v ${cls}">${value}</div>${note ? `<div class="hint">${note}</div>` : ""}</div>`;
  }
  function table(head, rows) {
    return rows.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
      : '<div class="empty">Todavía no hay registros.</div>';
  }
  function buttons(type, id) {
    return `<div class="row-actions"><button class="action-link" data-act="edit" data-type="${type}" data-id="${esc(id)}">Editar</button><button class="action-link red" data-act="delete" data-type="${type}" data-id="${esc(id)}">Eliminar</button></div>`;
  }
  const inMonth = (r, m = month) => (r.date || "").slice(0, 7) === m;
  const inDay = (r, d = day) => r.date === d;

  const paymentChoices = [
    { name: "cash_register", method: "cash", cashSource: "register", label: "Efectivo de caja" },
    { name: "cash_personal", method: "personal", cashSource: "personal", label: "Efectivo personal (sin saldo)" },
    { name: "yape", method: "yape", label: "Yape · BCP" },
    { name: "bcp_transfer", method: "bcp_transfer", label: "BCP transferencia" },
    { name: "bbva", method: "bbva", label: "BBVA" },
  ];
  const partMethod = (x) => (x?.method === "cash" && x?.cashSource === "personal" ? "personal" : x?.method);
  const normalizeParts = (entry) => {
    if (Array.isArray(entry?.paymentParts)) return entry.paymentParts.filter((x) => N(x.amount) > 0.005);
    if (Array.isArray(entry?.parts)) return entry.parts.filter((x) => N(x.amount) > 0.005);
    if (entry?.method)
      return [{ method: entry.method, cashSource: entry.cashSource || "register", amount: N(entry.amount) }];
    return [];
  };
  const PAY_UI = {
    cash_register: ["Efectivo de caja", "Entra al cierre"],
    cash_personal: ["Efectivo personal", "No afecta la caja"],
    yape: ["Yape", "Cuenta BCP"],
    bcp_transfer: ["Transferencia BCP", "Cuenta BCP"],
    bbva: ["BBVA", "Cuenta BBVA"],
  };
  function paymentPartsUI(parts = [], prefix = "pay") {
    const values = {};
    for (const p of parts) {
      const key =
        partMethod(p) === "cash"
          ? p.cashSource === "market"
            ? "cash_personal"
            : "cash_register"
          : p.method === "personal"
            ? "cash_personal"
            : p.method;
      values[key] = fix(N(values[key]) + N(p.amount));
    }
    const used = paymentChoices.filter((p) => N(values[p.name]) > 0.005).map((p) => p.name),
      combo = used.length > 1;
    const mark =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    return `<div class="field full paybox" data-paybox data-prefix="${prefix}" data-mode="${combo ? "combo" : "single"}"><div class="paybox-head"><label>¿Cómo se pagó?</label><div class="seg" role="group" aria-label="Forma de pago"><button type="button" data-act="pay-seg" data-v="single" aria-pressed="${!combo}">Un medio</button><button type="button" data-act="pay-seg" data-v="combo" aria-pressed="${combo}">Combinado</button></div><label class="pay-mode" aria-hidden="true"><input type="checkbox" data-pay-mode tabindex="-1" ${combo ? "checked" : ""}></label></div><div class="pay-chips" role="group" aria-label="Medio de pago">${paymentChoices
      .map((p) => {
        const [t, sub] = PAY_UI[p.name] || [p.label, ""];
        const on = used.includes(p.name);
        return `<div class="pay-row"><button type="button" class="pay-chip${on ? " on" : ""}" data-act="pay-chip" data-pay="${p.name}" aria-pressed="${on}"><span class="pc-t"><b>${esc(t)}</b><small>${esc(sub)}</small></span><span class="pc-mark">${mark}</span></button><label class="pay-amount" data-for="${p.name}" ${combo && on ? "" : "hidden"}><span>Monto con ${esc(t)}</span><input type="number" name="${prefix}_${p.name}" min="0" step="0.01" inputmode="decimal" value="${values[p.name] || ""}" placeholder="0.00"></label></div>`;
      })
      .join("")}</div><div class="split-status" data-split-preview></div></div>`;
  }
  function formTotal(form) {
    return form.dataset.form === "purchase"
      ? fix(N(form.elements.qty?.value) * N(form.elements.unitCost?.value))
      : N(form.elements.total?.value ?? form.elements.amount?.value ?? 0);
  }
  function payInput(box, name) {
    return box.querySelector(`.pay-amount[data-for="${name}"] input`);
  }
  function paySync(form) {
    const box = form?.querySelector("[data-paybox]");
    if (!box || box.dataset.mode !== "single") return;
    const total = formTotal(form);
    for (const c of box.querySelectorAll(".pay-chip")) {
      const inp = payInput(box, c.dataset.pay);
      if (inp) inp.value = c.classList.contains("on") && total > 0 ? total.toFixed(2) : "";
    }
  }
  function payChip(btn) {
    const box = btn.closest("[data-paybox]"),
      form = btn.closest("form");
    if (!box) return;
    const name = btn.dataset.pay,
      inp = payInput(box, name),
      combo = box.dataset.mode === "combo";
    if (!combo) {
      for (const c of box.querySelectorAll(".pay-chip")) {
        const on = c === btn;
        c.classList.toggle("on", on);
        c.setAttribute("aria-pressed", on);
      }
      paySync(form);
    } else {
      const on = !btn.classList.contains("on");
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on);
      const lab = inp?.closest(".pay-amount");
      if (lab) lab.hidden = !on;
      if (on && inp) {
        const others = [...box.querySelectorAll(".pay-amount:not([hidden]) input")].filter((x) => x !== inp);
        const rest = fix(formTotal(form) - others.reduce((s, x) => s + N(x.value), 0));
        inp.value = rest > 0 ? rest.toFixed(2) : "";
        setTimeout(() => {
          inp.focus();
          inp.select();
        }, 30);
      }
      if (!on && inp) inp.value = "";
    }
    updateSplitPreview(form);
  }
  function payMode(chk) {
    const box = chk.closest("[data-paybox]"),
      form = chk.closest("form");
    if (!box) return;
    const chips = [...box.querySelectorAll(".pay-chip")];
    if (chk.checked) {
      box.dataset.mode = "combo";
      for (const c of chips) {
        const lab = payInput(box, c.dataset.pay)?.closest(".pay-amount");
        if (lab) lab.hidden = !c.classList.contains("on");
      }
    } else {
      box.dataset.mode = "single";
      const on = chips.filter((c) => c.classList.contains("on"));
      const keep = on.sort(
        (a, b) => N(payInput(box, b.dataset.pay)?.value) - N(payInput(box, a.dataset.pay)?.value),
      )[0];
      for (const c of chips) {
        const k = c === keep;
        c.classList.toggle("on", k);
        c.setAttribute("aria-pressed", k);
        const lab = payInput(box, c.dataset.pay)?.closest(".pay-amount");
        if (lab) lab.hidden = true;
      }
      paySync(form);
    }
    updateSplitPreview(form);
  }

  function splitFrom(fd, total, prefix = "pay", allowZero = false) {
    const parts = [];
    for (const p of paymentChoices) {
      const txt = read(fd, prefix + "_" + p.name);
      const val = txt === "" ? 0 : Number(txt);
      if (!Number.isFinite(val) || val < 0 || Math.abs(fix(val) - val) > 0.001)
        throw Error("Revisa el pago: " + p.label);
      if (val > 0.005) parts.push({ method: p.method, cashSource: p.cashSource || null, amount: fix(val) });
    }
    const paid = sum(parts, (x) => x.amount);
    if (!allowZero && paid <= 0.005 && total > 0.005) throw Error("Elige cómo se pagó.");
    if ((!allowZero || paid > 0.005) && Math.abs(paid - total) > 0.005)
      throw Error("Los pagos suman " + money(paid) + " pero el total es " + money(total) + ". Corrige los importes.");
    if (paid > total + 0.005) throw Error("Los pagos exceden el total.");
    return parts;
  }
  function paymentSummary(parts) {
    return parts.length ? parts.map((x) => payLabel(partMethod(x)) + ": " + money(x.amount)).join(" · ") : "Sin pagar";
  }
  function paymentsOf(id) {
    return db.payments.filter((x) => x.purchaseId === id);
  }
  function paidOf(id) {
    const p = db.purchases.find((x) => x.id === id);
    return fix(
      sum(paymentsOf(id), (x) => x.amount) +
        sum(p?.paymentParts || [], (x) => x.amount) +
        sum(p?.additionalParts || [], (x) => x.amount),
    );
  }
  function dueOf(p) {
    return fix(p.total - paidOf(p.id));
  }
  function purchaseBy(id) {
    return db.purchases.find((x) => x.id === id);
  }
  function closureOf(date = day) {
    return db.closures.find((x) => x.date === date);
  }
  function ledgers() {
    const rows = [];
    const push = (source, id, date, category, detail, person, parts, purchaseId = "") => {
      parts.forEach((part, i) => {
        if (N(part.amount) <= 0) return;
        rows.push({
          source,
          id,
          key: id + "-" + source + "-" + i,
          date: part.date || date,
          category,
          detail,
          person,
          amount: N(part.amount),
          method: part.method,
          cashSource: part.cashSource || "register",
          purchaseId,
        });
      });
    };
    for (const x of db.expenses) push("gasto", x.id, x.date, "gasto", x.concept, x.person || "", normalizeParts(x));
    for (const x of db.purchases) {
      for (const [kind, parts] of [
        ["purchase", x.paymentParts || []],
        ["purchase-extra", x.additionalParts || []],
      ])
        push(kind, x.id, x.date, x.type, x.product, x.person || "", parts, x.id);
    }
    for (const x of db.payments) {
      const p = purchaseBy(x.purchaseId);
      if (!p) continue;
      push("payment", x.id, x.date, p.type, p.product, x.person || p.person || "", normalizeParts(x), p.id);
    }
    for (const x of db.chickens) {
      if (x.paid && N(x.entered) > 0 && N(x.unitCost) > 0)
        push("pollo", x.date, x.date, "pollo", `${x.entered} pollos (registro anterior)`, "Proveedor de pollo", [
          { amount: fix(x.entered * x.unitCost), method: x.method || "transfer" },
        ]);
    }
    for (const x of (db.historical || []).filter((x) => x.module === "personal" || x.module === "local")) {
      if (x.kind === "advance" && x.paymentParts?.length)
        push(
          "obligation",
          x.id,
          x.date,
          x.module,
          x.module === "personal" ? "Adelanto de " + x.person : "Adelanto de alquiler",
          x.person || "",
          x.paymentParts,
        );
      if (x.kind === "settlement" && x.paymentParts?.length)
        push(
          "obligation",
          x.id,
          x.date,
          x.module,
          x.module === "personal" ? "Sueldo de " + x.person : "Alquiler de local",
          x.person || "",
          x.paymentParts,
        );
    }
    for (const x of db.sunat)
      push(
        "sunat",
        x.id,
        x.date,
        "sunat",
        x.kind === "tax" ? "Impuestos SUNAT" : "Contador",
        x.person || "",
        normalizeParts(x),
      );
    return rows;
  }

  // Saldo bancario PROYECTADO: saldo inicial al abrir el día + ingresos de cierres + egresos pagados + movimientos manuales.
  // Se reconstruye, NO se incrementa un contador: editar/anular un cierre recalcula el abono una sola vez.
  const initialFor = (bank) => (db.bankSettings || []).find((x) => x.id === bank);
  const bankEntries = () => {
    const rows = [];
    for (const c of db.closures) {
      if (N(c.yape) > 0)
        rows.push({
          id: "closure-yape-" + c.date,
          date: c.date,
          bank: "bcp",
          amount: fix(c.yape),
          label: "Ventas YAPE / QR · cierre " + nice(c.date),
          origin: "cierre",
        });
      if (N(c.pos) > 0)
        rows.push({
          id: "closure-pos-" + c.date,
          date: c.date,
          bank: "bbva",
          amount: fix(c.pos),
          label: "Ventas POS · cierre " + nice(c.date),
          origin: "cierre",
        });
    }
    for (const x of ledgers()) {
      const bank = bankFor(x);
      if (bank)
        rows.push({
          id: "pay-" + x.source + "-" + (x.key || x.id),
          date: x.date,
          bank,
          amount: fix(-x.amount),
          label: (catLabel[x.category] || "Gasto") + " · " + (x.detail || ""),
          origin: "gasto",
        });
    }
    for (const x of db.bankTransactions || []) {
      if (x.type === "market_fund") {
        rows.push({
          id: x.id + "-fund",
          date: x.date,
          bank: x.bank,
          amount: fix(-x.amount),
          label: "Fondo de compras · retiro a efectivo" + (x.note ? " · " + x.note : ""),
          origin: "manual",
        });
      } else if (x.type === "transfer") {
        rows.push({
          id: x.id + "-out",
          date: x.date,
          bank: x.bank,
          amount: fix(-x.amount),
          label: "Transferencia a " + bankName[x.otherBank] + (x.note ? " · " + x.note : ""),
          origin: "manual",
        });
        rows.push({
          id: x.id + "-in",
          date: x.date,
          bank: x.otherBank,
          amount: fix(x.amount),
          label: "Transferencia desde " + bankName[x.bank] + (x.note ? " · " + x.note : ""),
          origin: "manual",
        });
      } else
        rows.push({
          id: x.id,
          date: x.date,
          bank: x.bank,
          amount: fix(x.amount * (x.type === "deposit" ? 1 : -1)),
          label:
            (x.type === "deposit" ? "Abono" : x.type === "market_fund" ? "Retiro para compras" : "Retiro") +
            (x.note ? " · " + x.note : ""),
          origin: "manual",
        });
    }
    return rows;
  };
  const afterInitial = (x, s) => s && x.date >= s.date;
  const bankBalance = (bank) => {
    const s = initialFor(bank);
    if (!s) return null;
    return fix(
      N(s.amount) +
        sum(
          bankEntries().filter((x) => x.bank === bank && afterInitial(x, s)),
          (x) => x.amount,
        ),
    );
  };
  const bankMovements = (bank) => {
    const s = initialFor(bank);
    return bankEntries()
      .filter((x) => x.bank === bank && (!s || afterInitial(x, s)))
      .sort((a, b) => b.date.localeCompare(a.date));
  };
  const bankCard = (bank) => {
    const v = bankBalance(bank),
      s = initialFor(bank),
      movement = bankMovements(bank);
    return `<div class="bank-account ${bank}"><div class="bank-name"><span class="bank-dot"></span>${bankName[bank]}<span class="bank-tag">${bank === "bcp" ? "YAPE / QR" : "POS / Tarjetas"}</span></div><div class="bank-balance">${v === null ? "Sin saldo inicial" : money(v)}</div><p>${s ? `Desde el ${nice(s.date)} · Saldo inicial ${money(s.amount)}` : "Define un saldo inicial para calcular el disponible."}</p><div class="bank-small">${movement.length} movimientos vinculados</div></div>`;
  };
  function bankPage() {
    const admin = !window.DChickenCloud?.isActive() || window.DChickenCloud.isAdmin();
    const prior = edit?.type === "banktxn" ? (db.bankTransactions || []).find((x) => x.id === edit.id) : null;
    const balances = card(
      "Tus cuentas bancarias",
      `<div class="bank-grid">${bankCard("bcp")}${bankCard("bbva")}</div>`,
      "Los importes son saldos proyectados, no saldos confirmados por el banco.",
    );
    const settings = card(
      "Saldos iniciales",
      `<form data-form="banksettings"><div class="fields">${["bcp", "bbva"]
        .map((bank) => {
          const s = initialFor(bank);
          return `<div class="bank-setting"><h3>${bankName[bank]}</h3>${field("Saldo al INICIO del día S/", "initial_" + bank, s?.amount ?? "", "number", 'step="0.01" min="0" required')}${field("Desde la fecha", "start_" + bank, s?.date || today(), "date", "required")}</div>`;
        })
        .join(
          "",
        )}</div><div class="f-actions"><button class="btn primary" ${admin ? "" : "disabled"} type="submit">Guardar saldos iniciales</button></div></form>`,
      "Indica el saldo REAL que tenía cada cuenta al comenzar la fecha seleccionada. Los movimientos anteriores no se vuelven a sumar. Solo administrador.",
    );
    const manual = card(
      prior ? "Editar movimiento bancario" : "Registrar otro movimiento bancario",
      `<form data-form="banktxn"><div class="fields">${field("Fecha", "date", prior?.date || day, "date", "required")}${select(
        "Cuenta de origen",
        "bank",
        [
          ["bcp", "BCP"],
          ["bbva", "BBVA"],
        ],
        prior?.bank || "bcp",
      )}${select(
        "Tipo de movimiento",
        "type",
        [
          ["deposit", "Abono externo (no es venta de caja)"],
          ["withdrawal", "Retiro no registrado como gasto"],
          ["transfer", "Transferencia entre BCP y BBVA"],
          ["market_fund", "Retirar del banco para efectivo de compras"],
        ],
        prior?.type || "deposit",
      )}${field("Importe S/", "amount", prior?.amount ?? "", "number", 'step="0.01" min="0.01" required')}${select(
        "Cuenta de destino (solo transferencia interna)",
        "otherBank",
        [
          ["bbva", "BBVA"],
          ["bcp", "BCP"],
        ],
        prior?.otherBank || "bbva",
      )}${field("Detalle del movimiento", "note", prior?.note || "", "text", 'maxlength="160"')}</div><p class="tiny">No registres aquí Yape, POS ni pagos ya anotados en Gastos/Compras: esos se calculan automáticamente. Una transferencia interna resta de un banco y suma al otro, sin afectar ventas ni gastos.</p><div class="f-actions"><button class="btn primary" ${admin ? "" : "disabled"}> ${prior ? "Guardar cambios" : "Registrar movimiento"}</button>${prior ? '<button class="btn" type="button" data-act="cancel-edit">Cancelar</button>' : ""}</div></form>`,
      "Anota depósitos ajenos a ventas, retiros no asociados a compras y movimientos entre cuentas. Solo administrador.",
    );
    const entries = bankEntries();
    const bankRows = sort(entries.filter((x) => !initialFor(x.bank) || afterInitial(x, initialFor(x.bank))))
      .slice(0, 120)
      .map(
        (x) =>
          `<tr><td>${nice(x.date)}</td><td>${bankName[x.bank]}</td><td>${esc(x.label)}</td><td class="${x.amount < 0 ? "negative-text" : "positive-text"}"><b>${x.amount > 0 ? "+" : ""}${money(x.amount)}</b></td><td>${x.origin === "manual" ? '<span class="tag">Manual</span>' : '<span class="tag bank">Automático</span>'}</td></tr>`,
      );
    const manualRows = sort(db.bankTransactions || []).map(
      (x) =>
        `<tr><td>${nice(x.date)}</td><td>${bankName[x.bank]}</td><td>${x.type === "transfer" ? "Transferencia a " + bankName[x.otherBank] : x.type === "deposit" ? "Abono" : x.type === "market_fund" ? "Retiro para compras" : "Retiro"} · ${esc(x.note || "")}</td><td>${money(x.amount)}</td><td>${admin ? buttons("banktxn", x.id) : "Solo lectura"}</td></tr>`,
    );
    const missing =
      !initialFor("bcp") || !initialFor("bbva")
        ? '<div class="tabnote warn-bank"><b>Primero registra los saldos iniciales.</b> Así los balances no tomarán movimientos antiguos por duplicado.</div>'
        : "";
    const legacy = ledgers().filter((x) => x.method === "transfer").length;
    return `<div class="tabnote"><b>Cómo funciona:</b> Yape y QR cobrados en el cierre → <b>BCP (+)</b>. POS cobrado en el cierre → <b>BBVA (+)</b>. Los pagos de Gastos, compras, pollos y SUNAT restan de la cuenta escogida. Los pagos en efectivo NO afectan bancos. YAPE siempre usa BCP; el POS del cierre llega a BBVA. Ningún movimiento aparece dos veces.</div>${missing}${legacy ? `<div class="tabnote warn-bank">Hay ${legacy} pagos antiguos registrados como «Transferencia» sin banco identificado. Edítalos en su sección para elegir BCP o BBVA; por seguridad aún NO se descuentan del saldo bancario.</div>` : ""}${balances}<div class="layout-grid"><div>${settings}</div><div>${manual}</div></div>${card("Movimientos bancarios vinculados", table(["Fecha", "Cuenta", "Concepto", "Entrada / salida", "Origen"], bankRows), "Se generan automáticamente desde cierres y pagos, o desde los movimientos manuales.")}${card("Editar o eliminar ajustes manuales", table(["Fecha", "Cuenta", "Detalle", "Importe", "Acción"], manualRows), "Estos ajustes no se consideran gastos operativos del negocio.")}`;
  }
  const expenseDay = (date = day) => ledgers().filter((x) => x.date === date);
  const cashExpenses = (date = day) =>
    expenseDay(date).filter((x) => x.method === "cash" && x.cashSource === "register");
  const expenseMonth = (m = month) => ledgers().filter((x) => inMonth(x, m));
  const cashTotal = (date = day) => sum(cashExpenses(date), (x) => x.amount);
  const closeDiff = (c, date = c?.date) =>
    c ? fix(N(c.cash) + N(c.yape) + N(c.pos) + cashTotal(date) - N(c.system)) : null;
  function status(v, valid = true) {
    if (!valid)
      return `<div class="diff pending"><div class="diff-label">Diferencia de caja</div><div class="diff-number">—</div><span class="stamp wait">Completa los importes</span></div>`;
    const cl = Math.abs(v) < 0.005 ? "neutral" : v > 0 ? "positive" : "negative";
    const label = cl === "neutral" ? "Caja cuadrada" : cl === "positive" ? "Sobrante" : "Faltante";
    return `<div class="diff ${cl}"><div class="diff-label">Diferencia de caja</div><div class="diff-number">${money(v)}</div><span class="stamp ${cl === "neutral" ? "ok" : cl === "positive" ? "up" : "bad"}">${label}</span></div>`;
  }
  function logo() {
    return `<img src="${LOGO}" class="brand-img" alt="Logo D’Chicken Express">`;
  }
  const STAFF_PAGE_OPTIONS = [
    ["panel", "Panel de resumen"],
    ["caja", "Cierre de caja"],
    ["ventas", "Ventas por producto"],
    ["bancos", "Consulta de bancos"],
    ["gastos", "Gastos"],
    ["pollos", "Pollos"],
    ["gaseosa", "Gaseosas"],
    ["lena", "Leña"],
    ["lista", "Lista de compras"],
    ["general", "Compras generales"],
    ["sunat", "SUNAT"],
    ["personal", "Personal"],
    ["local", "Alquiler"],
  ];
  const allowedPage = (p) => window.DChickenCloud?.isPageAllowed?.(p) !== false;
  const haveRealStock = () => db.chickens.some((x) => x.stockInitial !== undefined);
  function notifications(horizon = 3) {
    const out = [],
      now = today(),
      soon = plusDays(now, 3),
      far = plusDays(now, horizon);
    for (const module of ["personal", "local"]) {
      const pays = sort(obligations(module).filter((x) => x.kind === "settlement"));
      const mostRecent = new Map();
      for (const x of pays) {
        const key =
          module === "local"
            ? "local"
            : String(x.person || "")
                .trim()
                .toLowerCase();
        if (!mostRecent.has(key)) mostRecent.set(key, x);
      }
      for (const x of mostRecent.values()) {
        const next = nextPay(x);
        if (!next || next > far) continue;
        out.push({
          type: module,
          date: next,
          title: module === "local" ? "Alquiler del local" : "Pago de " + x.person,
          description: next < now ? "Vencido el " + nice(next) : "Próximo pago: " + nice(next),
        });
      }
    }
    const planned = (db.shoppingLists || []).filter((x) => x.date <= soon && shoppingRemaining(x) > 0.005);
    if (planned.length)
      out.push({
        type: "lista",
        date: planned.map((x) => x.date).sort()[0],
        title: planned.length + " artículo(s) pendientes",
        description: "Lista de compras hasta " + nice(soon),
      });
    const config = (db.alertSettings || []).find((x) => x.id === "main");
    if (haveRealStock() && config && N(config.chickenMin) > 0 && chickenBalance(now) <= N(config.chickenMin))
      out.push({
        type: "pollos",
        date: now,
        title: "Stock de pollos bajo",
        description: int(chickenBalance(now)) + " disponibles · mínimo " + int(config.chickenMin),
      });
    if (horizon === 3 && (!window.DChickenCloud?.isActive() || window.DChickenCloud.isAdmin())) {
      let last = "";
      try {
        last = localStorage.getItem(BACKUP_KEY) || "";
      } catch (e) {}
      if (!last || last < plusDays(now, -7))
        out.push({
          type: "respaldo",
          date: now,
          title: "Descarga el respaldo semanal",
          description: last ? "Último: " + nice(last) + ". Guárdalo fuera del celular (Drive o correo)." : "Aún no descargas ninguno en este dispositivo.",
        });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  const BACKUP_KEY = "dchicken_last_backup_v17";
  function quickExpenseDialog() {
    const html = `<form data-form="quick-expense"><div class="fields">${field("Fecha", "date", today(), "date", "required")}${field("¿En qué gastaste?", "concept", "", "text", 'maxlength="120" placeholder="Ej.: taxi, verduras, reparación" required')}${field("Importe total (S/)", "amount", "", "number", 'min="0.01" step="0.01" required')}${paymentPartsUI([])}${field("Nota (opcional)", "note", "", "text", 'maxlength="140"')}</div><div class="f-actions"><button class="btn primary" type="submit">Guardar gasto</button><button class="btn" data-act="quick-close" type="button">Cancelar</button></div></form>`;
    return `<div class="quick-overlay" role="presentation"><div class="quick-dialog" role="dialog" aria-modal="true" aria-label="Registrar gasto rápido">${card("Gasto rápido", html, "Solo concepto, monto y pago; también puedes combinar medios.")}</div></div>`;
  }
  // Historial de cambios (solo administrador). Lee la auditoría automática de la nube.
  const audit = { rows: null, loading: false, error: "", onlyLate: true };
  const AUDIT_SECTION = {
    closures: "Cierre de caja",
    expenses: "Gasto",
    chickens: "Pollos",
    purchases: "Compra",
    payments: "Pago",
    sunat: "SUNAT",
    historical: "Personal / local",
    bankSettings: "Saldo de banco",
    bankTransactions: "Movimiento de banco",
    shoppingLists: "Lista de compras",
    alertSettings: "Alerta de stock",
    sales: "Ventas por producto",
  };
  const AUDIT_FIELDS = [
    ["system", "Total sistema"],
    ["cash", "Efectivo"],
    ["yape", "Yape"],
    ["pos", "POS"],
    ["amount", "Importe"],
    ["total", "Total"],
    ["qty", "Cantidad"],
    ["concept", "Concepto"],
    ["sold", "Vendidos"],
    ["stockInitial", "Stock inicial"],
    ["date", "Fecha"],
  ];
  function loadAudit() {
    if (audit.loading || !window.DChickenCloud?.auditLog) return;
    audit.loading = true;
    window.DChickenCloud.auditLog()
      .then((rows) => {
        audit.rows = rows;
        audit.error = "";
      })
      .catch((e) => {
        audit.error = e.message || "No se pudo leer el historial.";
      })
      .finally(() => {
        audit.loading = false;
        if (page === "cambios") render();
      });
  }
  function auditPage() {
    if (!window.DChickenCloud?.isActive() || !window.DChickenCloud.isAdmin())
      return card("Historial de cambios", "Inicia sesión como administrador para ver el historial.");
    if (!audit.rows && !audit.error) {
      loadAudit();
      return card("Historial de cambios", '<div class="empty">Cargando el historial…</div>');
    }
    if (audit.error) return card("Historial de cambios", `<div class="alert">${esc(audit.error)}</div>`);
    const limaDay = (iso) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(iso));
    const limaTime = (iso) =>
      new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" }).format(
        new Date(iso),
      );
    const rows = audit.rows.map((r) => {
      const p = r.new_payload || r.old_payload || {};
      const changedOn = limaDay(r.changed_at);
      const late = !!p.date && p.date < plusDays(changedOn, -1);
      const diffs =
        r.action === "UPDATE"
          ? AUDIT_FIELDS.filter(([k]) => JSON.stringify(r.old_payload?.[k]) !== JSON.stringify(r.new_payload?.[k]))
              .map(([k, l]) => `${l}: ${esc(String(r.old_payload?.[k] ?? "—"))} → <b>${esc(String(r.new_payload?.[k] ?? "—"))}</b>`)
              .join("<br>")
          : "";
      return { r, p, changedOn, late, diffs };
    });
    const shown = audit.onlyLate ? rows.filter((x) => x.late || x.r.action === "DELETE") : rows;
    const verb = { INSERT: "Creó", UPDATE: "Cambió", DELETE: "Eliminó" };
    const lines = shown.slice(0, 120).map(({ r, p, changedOn, late, diffs }) => {
      const amt = p.amount ?? p.total ?? p.system;
      const detail = diffs || (amt !== undefined && amt !== "" ? money(amt) : "");
      return `<li class="audit-item${late ? " late" : ""}"><div class="audit-head"><b>${verb[r.action] || r.action} ${esc(AUDIT_SECTION[r.section] || r.section)}${p.date ? ` del ${nice(p.date)}` : ""}</b>${late ? '<span class="pill bad">día anterior</span>' : ""}</div><div class="audit-meta">${esc(r.who || "")} · ${nice(changedOn)} ${limaTime(r.changed_at)}${p.concept || p.product ? " · " + esc(p.concept || p.product) : ""}</div>${detail ? `<div class="audit-detail">${detail}</div>` : ""}</li>`;
    });
    const lateCount = rows.filter((x) => x.late).length;
    const toggle = `<div class="f-actions"><button class="btn${audit.onlyLate ? " primary" : ""}" data-act="audit-filter" data-v="late">Solo cambios a días anteriores y borrados</button><button class="btn${audit.onlyLate ? "" : " primary"}" data-act="audit-filter" data-v="all">Todo</button><button class="btn ghost" data-act="audit-reload">Actualizar</button></div>`;
    return `<div class="tabnote">Cada cambio queda registrado automáticamente en la nube y nadie puede borrarlo desde la app. Revisa sobre todo los cambios hechos a <b>días anteriores</b>: así se tapa un faltante.</div><div class="metrics">${metric("Cambios registrados", String(rows.length), "Últimos 300")}${metric("A días anteriores", String(lateCount), "Revisa estos primero", lateCount ? "negative-text" : "green")}</div>${card("Movimientos", toggle + (lines.length ? `<ul class="audit-list">${lines.join("")}</ul>` : '<div class="empty">No hay cambios para mostrar con este filtro.</div>'))}`;
  }
  function permissionsPage() {
    if (!window.DChickenCloud?.isActive() || !window.DChickenCloud.isAdmin())
      return card("Permisos", "Inicia sesión como administrador para gestionar accesos.");
    const p = window.DChickenCloud.getStaffPermissions();
    const all = p === null;
    return `<div class="tabnote"><b>Permisos reales:</b> los colaboradores solo podrán consultar y modificar las secciones autorizadas. La restricción se aplica también en Supabase; no es solo ocultar botones. Afecta a las cuentas con rol colaborador, no al administrador. Los cierres no cambian.</div>${card("Acceso del personal", `<form data-form="staff-permissions"><div class="permission-list">${STAFF_PAGE_OPTIONS.map(([key, label]) => `<label class="permission-option"><input name="perm_${key}" type="checkbox" ${all || p.includes(key) ? "checked" : ""}>${esc(label)}</label>`).join("")}</div><p class="sub" style="margin-top:12px">Desmarca las secciones que los colaboradores NO deben consultar. Al limitar una sección, también se restringe su información en la base de datos. Para permisos diferentes por persona necesitaríamos crear cuentas y asignaciones individuales.</p><div class="f-actions"><button class="btn primary">Guardar permisos de colaboradores</button></div></form>`, "El administrador conserva el acceso completo. Seguridad por sección.")}`;
  }
  function dashboardInsights() {
    const t = today(),
      c = closureOf(t),
      prev = closureOf(plusDays(t, -7)),
      daily = expenseDay(t),
      expT = sum(daily, (x) => x.amount);
    const fmt2 = (v) => N(v).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const s = saleOf(t),
      ch = db.chickens.find((x) => x.date === t);
    const sold = (s && chickenEq(s.items) > 0) || (ch && ch.sold !== undefined && ch.sold !== "") ? soldOf(t) : null;
    const stock = haveRealStock() ? int(chickenBalance(t)) : null;
    let hero;
    if (c) {
      const sys = N(c.system),
        yape = N(c.yape),
        pos = N(c.pos),
        cash = Math.max(0, fix(sys - yape - pos));
      let trend = "";
      if (prev && N(prev.system) > 0) {
        const p = fix((100 * (sys - N(prev.system))) / N(prev.system));
        trend = `<div class="trend ${p > 0.5 ? "up" : p < -0.5 ? "down" : "flat"}">${p > 0.5 ? "▲" : p < -0.5 ? "▼" : "="} ${Math.abs(p).toLocaleString("es-PE", { maximumFractionDigits: 0 })} % vs. el ${DAYS_ES[new Date(t + "T12:00:00Z").getUTCDay()]} pasado</div>`;
      }
      const mix = [
        ["Efectivo", cash, "var(--ink)"],
        ["Yape", yape, "var(--tint)"],
        ["POS", pos, "var(--warn)"],
      ].filter((x) => x[1] > 0);
      hero = `<div class="lab">Ventas del día</div><div class="today-big"><small>S/</small>${fmt2(sys)}</div>${trend}${sys > 0 && mix.length ? `<div class="mixbar" role="img" aria-label="Reparto de ventas">${mix.map(([, v, col]) => `<i style="flex:${v};background:${col}"></i>`).join("")}</div><div class="mixleg">${mix.map(([l, v, col]) => `<span style="--c:${col}">${l} <b>${fmt2(v)}</b></span>`).join("")}</div>` : ""}`;
    } else {
      hero = `<div class="lab">Ventas del día</div><div class="today-big empty-big">Sin cierre todavía</div>${allowedPage("caja") ? `<div class="hero-actions"><button class="btn primary sm" data-act="page" data-page="caja">Hacer el cierre de caja</button></div>` : ""}`;
    }
    const chev = `<svg class="chev" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m1.5 1.5 5 5-5 5"/></svg>`;
    const row = (page, ico, col, title, sub, right) => {
      const can = page && allowedPage(page);
      return `<${can ? "button" : "div"} class="row" ${can ? `data-act="page" data-page="${page}"` : ""}><span class="ico" style="--c:${col}">${icon(ico)}</span><span class="rt">${title}${sub ? `<small>${sub}</small>` : ""}</span>${right || ""}${can ? chev : ""}</${can ? "button" : "div"}>`;
    };
    let cashPill = '<span class="pill wait">Pendiente</span>',
      cashSub = "Todavía no se cierra la caja";
    if (c) {
      const d = closeDiff(c, t);
      cashPill =
        Math.abs(d) < 0.005
          ? '<span class="pill ok">Cuadra</span>'
          : d > 0
            ? `<span class="pill up">Sobra ${money(d)}</span>`
            : `<span class="pill bad">Falta ${money(-d)}</span>`;
      cashSub = "Cierre del " + shortDate(t);
    }
    const g1 = `<div class="group">${row("caja", "caja", "var(--ok)", "Cuadre de caja", cashSub, cashPill)}${row(s ? "ventas" : "pollos", "pollos", "oklch(0.63 0.16 45)", "Pollos vendidos", stock === null ? (s ? "Según las ventas anotadas" : "Anota las ventas del día") : "Quedan " + stock + " en stock", `<span class="rv${sold === null ? " muted" : ""}">${sold === null ? "—" : int(sold)}</span>`)}${row("gastos", "gastos", "oklch(0.45 0.02 45)", "Gastos de hoy", daily.length ? daily.length + (daily.length === 1 ? " movimiento" : " movimientos") : "Sin gastos registrados", `<span class="rv">${money(expT)}</span>`)}</div>`;
    const notices = notifications();
    const nIcon = {
      personal: ["personal", "oklch(0.55 0.15 300)"],
      local: ["local", "oklch(0.6 0.12 60)"],
      lista: ["lista", "oklch(0.55 0.13 250)"],
      pollos: ["pollos", "oklch(0.63 0.16 45)"],
      sunat: ["sunat", "oklch(0.5 0.02 250)"],
    };
    const g2 = notices.length
      ? `<div class="group">${notices
          .slice(0, 6)
          .map((x) => {
            const [ic, col] = nIcon[x.type] || ["bell", "var(--warn)"];
            if (x.type === "respaldo")
              return `<button class="row" data-act="backup"><span class="ico" style="--c:var(--warn)">${icon("down")}</span><span class="rt">${esc(x.title)}<small>${esc(x.description)}</small></span>${chev}</button>`;
            return row(x.type, ic, col, esc(x.title), esc(x.description), "");
          })
          .join("")}</div>`
      : `<div class="group"><div class="empty-row">Nada pendiente para los próximos 3 días.</div></div>`;
    const canAlert = !window.DChickenCloud?.isActive() || window.DChickenCloud.isAdmin();
    const alertForm = canAlert
      ? `<div class="group-title">Alerta de stock</div><div class="card-body"><form data-form="alert-settings"><div class="fields"><div class="field full"><label for="fld-chickenMin">Avisar cuando queden estos pollos o menos</label><input id="fld-chickenMin" name="chickenMin" type="number" min="0" step="1" inputmode="numeric" placeholder="Ej.: 30" value="${esc((db.alertSettings || []).find((x) => x.id === "main")?.chickenMin ?? "")}"></div></div><div class="f-actions" style="margin-top:14px"><button class="btn sm" type="submit">Guardar mínimo</button></div></form></div>`
      : "";
    return `<section class="today" aria-label="Resumen de hoy"><div><div class="today-hero">${hero}</div><div style="margin-top:22px">${g1}</div></div><div><div class="group-title">Para hacer</div>${g2}${pushBox() ? `<div style="margin-top:12px">${pushBox()}</div>` : ""}${alertForm}</div></section><div class="card-head"><h2>Resumen de ${monthName(month)}</h2></div>`;
  }

  /* ── v15 · iconos, navegación, ventas por producto ── */
  const ICON_PATHS = {
    panel:
      '<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/>',
    caja: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M7 9V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V9"/><path d="M3 14h18"/><path d="M10 17h4"/>',
    ventas: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    bancos: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20.5h18"/>',
    gastos: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
    pollos:
      '<path d="M14.6 4.4a5 5 0 0 1 0 7.07l-2.12 2.12a5 5 0 0 1-7.07-7.07l2.12-2.12a5 5 0 0 1 7.07 0z"/><path d="m12 15 3.5 3.5"/><circle cx="17.5" cy="19.5" r="1.6"/><circle cx="19.5" cy="17.5" r="1.6"/>',
    gaseosa:
      '<path d="M6 4h12l-1.6 16.2a1 1 0 0 1-1 .8H8.6a1 1 0 0 1-1-.8z"/><path d="M6.5 9h11"/><path d="M13 4 15 1.5"/>',
    lena: '<path d="M12 21c4 0 6.5-2.6 6.5-6.2 0-3.4-2.6-5.6-4-8.8-1.6 2.2-2.4 3.4-3.6 3.6C10.3 7.6 9.6 5.7 9.2 3.5 6.6 6 5.5 9.6 5.5 14.8 5.5 18.4 8 21 12 21z"/><path d="M12 21c-1.7 0-3-1.3-3-3.1 0-1.9 1.6-3.1 3-4.9 1.4 1.8 3 3 3 4.9 0 1.8-1.3 3.1-3 3.1z"/>',
    lista:
      '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5"/><path d="m3.5 12 1.2 1.2L7 11"/><path d="m3.5 18 1.2 1.2L7 17"/>',
    general:
      '<circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2.5 3.5h2.6l2.4 12h11.3l2-8.5H6.2"/>',
    sunat:
      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    personal:
      '<circle cx="9" cy="8" r="3.3"/><path d="M2.8 20c.6-3.4 3.2-5.5 6.2-5.5s5.6 2.1 6.2 5.5"/><path d="M15.5 4.9a3.3 3.3 0 0 1 0 6.3"/><path d="M17.5 14.8c2 .7 3.3 2.5 3.7 5.2"/>',
    local: '<path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
    permisos:
      '<path d="M12 3 4.5 6v5.5c0 4.5 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    cambios: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    mas: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    down: '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M4.5 20h15"/>',
    up: '<path d="M12 16V5"/><path d="m7 9.5 5-5 5 5"/><path d="M4.5 20h15"/>',
    cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.7 4.7 0 0 0 7 18.5z"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  };
  const icon = (k) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[k] || ICON_PATHS.panel}</svg>`;
  const NAV_GROUPS = [
    [
      "Día a día",
      [
        ["panel", "Hoy"],
        ["caja", "Cierre de caja"],
        ["ventas", "Ventas"],
        ["gastos", "Gastos"],
        ["lista", "Lista de compras"],
      ],
    ],
    [
      "Compras",
      [
        ["pollos", "Pollos"],
        ["gaseosa", "Gaseosas"],
        ["lena", "Leña"],
        ["general", "Historial compras"],
      ],
    ],
    [
      "Cuentas",
      [
        ["bancos", "Cuentas bancarias"],
        ["personal", "Personal"],
        ["local", "Pago de local"],
        ["sunat", "SUNAT"],
      ],
    ],
    [
      "Administración",
      [
        ["cambios", "Historial de cambios"],
        ["permisos", "Permisos"],
      ],
    ],
  ];
  const SHORT = {
    caja: "Caja",
    bancos: "Bancos",
    lista: "Lista",
    general: "Historial",
    local: "Local",
    ventas: "Ventas",
  };
  const TAB_LABEL = { panel: "Hoy", lista: "Compras" };
  /* color de cada sección (como los íconos de Ajustes) */
  const SYM = {
    panel: "oklch(0.55 0.21 27)",
    caja: "oklch(0.56 0.14 150)",
    ventas: "oklch(0.63 0.16 45)",
    gastos: "oklch(0.45 0.02 45)",
    lista: "oklch(0.55 0.13 250)",
    pollos: "oklch(0.62 0.17 38)",
    gaseosa: "oklch(0.58 0.12 200)",
    lena: "oklch(0.6 0.13 70)",
    general: "oklch(0.5 0.12 280)",
    bancos: "oklch(0.48 0.13 255)",
    personal: "oklch(0.55 0.15 300)",
    local: "oklch(0.55 0.08 60)",
    sunat: "oklch(0.5 0.02 250)",
    permisos: "oklch(0.5 0.1 170)",
    cambios: "oklch(0.52 0.12 25)",
    theme: "oklch(0.45 0.12 280)",
    cloud: "oklch(0.55 0.13 240)",
    report: "oklch(0.56 0.14 150)",
    backup: "oklch(0.5 0.01 50)",
    restore: "oklch(0.5 0.01 50)",
  };
  const DAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MONTHS_ES = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const longDate = (d) => {
    const x = new Date(d + "T12:00:00Z");
    return DAYS_ES[x.getUTCDay()] + " " + x.getUTCDate() + " de " + MONTHS_ES[x.getUTCMonth()];
  };
  const shortDate = (d) => {
    const x = new Date(d + "T12:00:00Z");
    return x.getUTCDate() + " " + MONTHS_ES[x.getUTCMonth()].slice(0, 3);
  };
  const monthName = (m) => {
    const [y, mm] = m.split("-");
    return MONTHS_ES[Number(mm) - 1] + " " + y;
  };
  let moreOpen = false,
    lastPage = null;

  const SALE_ITEMS = [
    ["entero", "Pollo entero", 1],
    ["medio", "½ pollo", 0.5],
    ["cuarto", "¼ pollo", 0.25],
    ["octavo", "⅛ pollo", 0.125],
    ["combo", "Combos y mostritos", 0],
    ["gaseosa", "Gaseosas", 0],
    ["otros", "Otros platos", 0],
  ];
  const SALE_CHANNELS = [
    ["salon", "Salón"],
    ["llevar", "Para llevar"],
    ["delivery", "Delivery"],
  ];
  const saleOf = (d) => (db.sales || []).find((x) => x.date === d);
  const chickenEq = (items) => fix(SALE_ITEMS.reduce((s, [k, , w]) => s + N(items?.[k]) * w, 0));
  const stepper = (name, value) =>
    `<div class="stepper"><button type="button" data-act="sale-step" data-name="${name}" data-d="-1" aria-label="Restar uno">−</button><input type="number" inputmode="numeric" min="0" step="1" name="${name}" value="${value || ""}" placeholder="0" aria-label="Cantidad"><button type="button" data-act="sale-step" data-name="${name}" data-d="1" aria-label="Sumar uno">+</button></div>`;
  function ventasPage() {
    const s = saleOf(day),
      m = day.slice(0, 7),
      monthSales = (db.sales || []).filter((x) => (x.date || "").slice(0, 7) === m);
    const form = `<form data-form="sales"><input type="hidden" name="date" value="${day}"><div class="sale-board">${SALE_ITEMS.map(([k, label, w]) => `<div class="sale-line"><div class="sl-name">${label}${w ? `<small>${w === 1 ? "1 pollo" : w === 0.5 ? "medio pollo" : w === 0.25 ? "un cuarto" : "un octavo"}</small>` : ""}</div>${stepper("i_" + k, s?.items?.[k])}</div>`).join("")}</div><div class="sale-eq"><span class="muted">Equivale a</span><b id="sale-eq">${int(chickenEq(s?.items))} pollos</b></div><hr class="soft-divider"><p class="small muted" style="margin-bottom:6px">Pedidos por canal</p><div class="sale-board">${SALE_CHANNELS.map(([k, label]) => `<div class="sale-line"><div class="sl-name">${label}</div>${stepper("c_" + k, s?.channels?.[k])}</div>`).join("")}</div><div class="fields" style="margin-top:16px"><div class="field full"><label for="fld-sale-note">Nota (opcional)</label><input id="fld-sale-note" name="note" maxlength="140" value="${esc(s?.note || "")}" placeholder="Ej.: promo 2x1 en ¼, lluvia, feriado"></div></div><div class="f-actions"><button class="btn primary" type="submit">${s ? "Actualizar ventas del día" : "Guardar ventas del día"}</button>${s ? `<button class="btn danger" type="button" data-act="sale-delete" data-date="${day}">Borrar día</button>` : ""}</div></form>`;
    const totals = Object.fromEntries(SALE_ITEMS.map(([k]) => [k, sum(monthSales, (x) => x.items?.[k])]));
    const ch = Object.fromEntries(SALE_CHANNELS.map(([k]) => [k, sum(monthSales, (x) => x.channels?.[k])]));
    const chTotal = SALE_CHANNELS.reduce((a, [k]) => a + ch[k], 0);
    const eqMonth = sum(monthSales, (x) => chickenEq(x.items));
    const byWd = [0, 0, 0, 0, 0, 0, 0],
      cntWd = [0, 0, 0, 0, 0, 0, 0];
    for (const x of monthSales) {
      const w = new Date(x.date + "T12:00:00Z").getUTCDay();
      byWd[w] += chickenEq(x.items);
      cntWd[w]++;
    }
    const avgWd = byWd.map((v, i) => (cntWd[i] ? v / cntWd[i] : 0)),
      maxWd = Math.max(...avgWd),
      best = avgWd.indexOf(maxWd);
    const order = [1, 2, 3, 4, 5, 6, 0];
    const ranking = SALE_ITEMS.filter(([k]) => totals[k] > 0).sort((a, b) => totals[b[0]] - totals[a[0]]);
    const soldControl = sum(
      db.chickens.filter((x) => (x.date || "").slice(0, 7) === m),
      (x) => x.sold,
    );
    const insight =
      monthSales.length >= 7 && maxWd > 0
        ? `<div class="alert" style="background:var(--brasa-soft);border-color:transparent"><b>Tu día más fuerte es el ${DAYS_ES[best]}</b> (${fix(maxWd).toLocaleString("es-PE", { maximumFractionDigits: 1 })} pollos en promedio). ${ranking[0] ? "Lo que más sale: <b>" + ranking[0][1] + "</b>. " : ""}Úsalo para decidir en qué días lanzar promociones.</div>`
        : "";
    return `<div class="tabnote">Anota lo que se vendió en el día: cantidades por producto y por canal. Es independiente del <b>cierre de caja</b> (no cambia sus montos) y sirve para saber qué se vende más y qué días conviene hacer promociones. Las equivalencias: entero = 1 pollo, ½ = 0.5, ¼ = 0.25, ⅛ = 0.125.</div>${insight}<div class="layout-grid"><div>${card("Comanda · " + shortDate(day), form, "Toca + y − mientras despachas, o escribe el total al cerrar el día.")}</div><div>${card("Lo más vendido · " + monthName(m), ranking.length ? `<div class="sum-list">${ranking.map(([k, label]) => `<div class="sum-row"><span>${label}</span><b>${int(totals[k])}</b></div>`).join("")}<div class="sum-row total"><span>Pollos vendidos (equivalente)</span><b>${eqMonth.toLocaleString("es-PE", { maximumFractionDigits: 1 })}</b></div></div>${soldControl ? `<p class="tiny">Control de pollos registra ${int(soldControl)} vendidos este mes.</p>` : ""}` : '<div class="empty">Cuando registres las ventas del día, aquí verás el ranking del mes.</div>', monthSales.length + " día(s) registrados")}
 ${card("Pedidos por canal", chTotal ? `<div class="channel-bars">${SALE_CHANNELS.map(([k, label]) => `<div class="channel-bar"><span>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${(100 * ch[k]) / chTotal}%"></div></div><b>${Math.round((100 * ch[k]) / chTotal)}%</b></div>`).join("")}</div>` : '<div class="empty">Anota los pedidos por canal para ver de dónde vienen tus clientes.</div>')}
 ${card("Promedio por día de la semana", maxWd > 0 ? `<div class="weekday-chart">${order.map((i) => `<div class="wd ${i === best ? "best" : ""}"><div class="wd-col" style="height:${Math.max(3, (100 * avgWd[i]) / maxWd)}%"></div><b>${avgWd[i] ? fix(avgWd[i]).toLocaleString("es-PE", { maximumFractionDigits: 1 }) : "–"}</b><span>${DAYS_ES[i].slice(0, 3)}</span></div>`).join("")}</div>` : '<div class="empty">Con algunos días registrados verás qué días vendes más.</div>', "Pollos equivalentes vendidos en promedio.")}</div></div>`;
  }
  function saveSale(fd) {
    const d = date(fd);
    const items = {},
      channels = {};
    for (const [k] of SALE_ITEMS) {
      const v = read(fd, "i_" + k);
      const n = v === "" ? 0 : Number(v);
      if (!Number.isSafeInteger(n) || n < 0 || n > 100000) throw Error("Revisa la cantidad de " + k + ".");
      if (n) items[k] = n;
    }
    for (const [k] of SALE_CHANNELS) {
      const v = read(fd, "c_" + k);
      const n = v === "" ? 0 : Number(v);
      if (!Number.isSafeInteger(n) || n < 0 || n > 100000) throw Error("Revisa los pedidos de " + k + ".");
      if (n) channels[k] = n;
    }
    db.sales = db.sales || [];
    const prev = saleOf(d);
    const rec = {
      id: d,
      date: d,
      items,
      channels,
      note: read(fd, "note").slice(0, 140),
      created: prev?.created || Date.now(),
    };
    if (prev) Object.assign(prev, rec);
    else db.sales.push(rec);
    save();
    render();
    toast("Ventas del " + nice(d) + " guardadas.");
  }
  function updateSaleEq(form) {
    const items = {};
    for (const [k] of SALE_ITEMS) items[k] = N(form.elements["i_" + k]?.value);
    const el = document.getElementById("sale-eq");
    if (el) el.textContent = int(chickenEq(items)) + " pollos";
  }

  function pushBox() {
    const C = window.DChickenCloud;
    if (!C?.isActive()) return "";
    const st = C.pushState?.() || "unsupported";
    if (st === "unsupported")
      return `<div class="push-box"><div><b>Avisos en el celular</b>En iPhone, primero instala la app: Compartir → «Agregar a inicio». Luego abre desde el ícono.</div></div>`;
    if (st === "denied")
      return `<div class="push-box"><div><b>Avisos bloqueados</b>Permite las notificaciones de esta app en los ajustes del teléfono.</div></div>`;
    if (st === "on")
      return `<div class="push-box"><div><b>Avisos activados en este dispositivo</b>Cada mañana a las 8:00 recibirás los pagos y alertas que vencen pronto.</div><button class="btn sm" data-act="push-off">Desactivar</button></div>`;
    return `<div class="push-box"><div><b>Recibe estos avisos con la app cerrada</b>Un resumen diario a las 8:00 a. m. en este dispositivo.</div><button class="btn sm primary" data-act="push-on">${icon("bell")} Activar avisos</button></div>`;
  }

  function navItems() {
    const isAdmin = window.DChickenCloud?.isAdmin();
    return NAV_GROUPS.map(([g, items]) => [
      g,
      items.filter(([k]) => (!["permisos", "cambios"].includes(k) || isAdmin) && (k === "cambios" || allowedPage(k))),
    ]).filter(([, items]) => items.length);
  }
  function sheetHTML() {
    const groups = navItems();
    const it = (k, label, attrs, extra = "") =>
      `<button ${attrs} class="${page === k ? "active" : ""}"><span class="ico" style="--sym:${SYM[k] || "var(--ink-3)"}">${icon(extra || k)}</span><span>${label}</span></button>`;
    return `<div class="sheet-overlay" data-act="more-close"><div class="sheet" role="dialog" aria-modal="true" aria-label="Todas las secciones" data-stop="1"><div class="grab-area" aria-hidden="true"></div>${groups.map(([g, items]) => `<h3>${g}</h3><div class="sheet-grid">${items.map(([k, label]) => it(k, label, `data-act="page" data-page="${k}"`)).join("")}</div>`).join("")}<h3>Herramientas</h3><div class="sheet-grid">${it("theme", theme === "dark" ? "Tema claro" : "Tema noche", 'data-act="theme"', theme === "dark" ? "sun" : "moon")}${it("cloud", "Cuenta y sincronización", 'data-act="cloud"')}${page === "panel" ? it("report", "Reporte del mes", 'data-act="monthly-csv"') : ""}${it("backup", "Descargar respaldo", 'data-act="backup"', "down")}${it("restore", "Restaurar respaldo", 'data-act="restore"', "up")}</div></div></div>`;
  }
  /* Hoja de gasto: importe grande, celdas agrupadas y selector de pago */
  function quickExpenseDialog() {
    return `<div class="quick-overlay" data-act="quick-bg"><div class="quick-dialog" role="dialog" aria-modal="true" aria-label="Nuevo gasto"><div class="grab-area" aria-hidden="true"></div><form data-form="quick-expense"><div class="sheet-bar"><button type="button" data-act="quick-close">Cancelar</button><b>Nuevo gasto</b><span></span></div><div class="amount-hero"><label for="qe-amount">Importe</label><div class="ah-row"><span class="ah-cur">S/</span><input id="qe-amount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required></div></div><div class="form-group"><label class="fg-row"><span>Concepto</span><input name="concept" maxlength="120" placeholder="Gas, taxi, hielo…" autocomplete="off" required></label><label class="fg-row"><span>Fecha</span><input type="date" name="date" value="${today()}" required></label><label class="fg-row"><span>Nota</span><input name="note" maxlength="140" placeholder="Opcional"></label></div>${paymentPartsUI([])}<div class="f-actions"><button class="btn primary block" type="submit">Guardar gasto</button></div></form></div></div>`;
  }
  function menuHTML() {
    return `<details class="menu desk-only"><summary class="btn ghost" aria-label="Más opciones">${icon("mas")}</summary><div class="menu-pop"><button data-act="theme">${icon(theme === "dark" ? "sun" : "moon")}${theme === "dark" ? "Tema claro" : "Tema noche"}</button>${page === "panel" ? `<button data-act="monthly-csv">${icon("report")}Descargar reporte del mes</button>` : ""}<hr><button data-act="backup">${icon("down")}Descargar respaldo</button><button data-act="restore">${icon("up")}Restaurar respaldo</button></div></details>`;
  }
  function syncStatus() {
    const C = window.DChickenCloud;
    if (!C?.isActive()) return { cls: "off", label: "Modo local" };
    const s = C.status?.() || "ok";
    return (
      {
        ok: { cls: "", label: "En línea" },
        busy: { cls: "busy", label: "Guardando…" },
        offline: { cls: "busy", label: "Sin internet · guardado aquí" },
        error: { cls: "problem", label: "Sin guardar" },
      }[s] || { cls: "", label: "En línea" }
    );
  }
  function enhanceNotes(root) {
    root.querySelectorAll(".tabnote").forEach((n) => {
      if (n.getAttribute("style")) {
        n.removeAttribute("style");
        n.className = "alert";
        return;
      }
      const d = document.createElement("details");
      d.className = "explain";
      d.innerHTML = `<summary>¿Cómo funciona esta sección?</summary><div></div>`;
      d.lastChild.innerHTML = n.innerHTML;
      n.replaceWith(d);
    });
  }
  function extraClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) {
      return false;
    }
    const act = b.dataset.act;
    if (act === "more-close") {
      if (e.target.closest(".sheet")) return true;
      closeSheet(() => {
        moreOpen = false;
        render();
      });
      return true;
    }
    if (act === "more-open") {
      moreOpen = true;
      render();
      return true;
    }
    if (b.closest(".sheet") || b.closest(".menu-pop")) {
      moreOpen = false;
      b.closest("details")?.removeAttribute("open");
    }
    if (act === "pay-chip") {
      payChip(b);
      return true;
    }
    if (act === "pay-seg") {
      const box = b.closest("[data-paybox]"),
        chk = box?.querySelector("[data-pay-mode]");
      if (!chk) return true;
      const want = b.dataset.v === "combo";
      if (chk.checked !== want) {
        chk.checked = want;
        payMode(chk);
      }
      for (const x of box.querySelectorAll(".seg button"))
        x.setAttribute("aria-pressed", String((x.dataset.v === "combo") === want));
      return true;
    }
    if (act === "quick-open") {
      if (!allowedPage("gastos")) {
        toast("No tienes acceso a Gastos.", true);
        return true;
      }
      quickOpen = true;
      moreOpen = false;
      render();
      if (matchMedia("(min-width:821px)").matches) setTimeout(() => document.getElementById("qe-amount")?.focus(), 60);
      return true;
    }
    if (act === "quick-close") {
      closeSheet(() => {
        quickOpen = false;
        render();
      });
      return true;
    }
    if (act === "quick-bg") {
      if (e.target.closest(".quick-dialog")) return true;
      closeSheet(() => {
        quickOpen = false;
        render();
      });
      return true;
    }
    if (act === "sale-step") {
      const f = b.closest("form");
      const el = f?.elements[b.dataset.name];
      if (el) {
        el.value = Math.max(0, N(el.value) + Number(b.dataset.d)) || "";
        updateSaleEq(f);
      }
      return true;
    }
    if (act === "sale-delete") {
      if (window.DChickenCloud?.isActive() && !window.DChickenCloud.isAdmin()) {
        toast("Solo un administrador puede borrar ventas registradas.", true);
        return true;
      }
      if (!confirm("¿Borrar las ventas anotadas del " + nice(b.dataset.date) + "?")) return true;
      db.sales = (db.sales || []).filter((x) => x.date !== b.dataset.date);
      save();
      render();
      toast("Ventas del día borradas.");
      return true;
    }
    if (act === "push-on") {
      b.disabled = true;
      window.DChickenCloud?.enablePush()
        .then(() => {
          toast("Avisos activados en este dispositivo.");
          render();
        })
        .catch((err) => {
          toast(err.message || "No se pudieron activar los avisos.", true);
          render();
        });
      return true;
    }
    if (act === "push-off") {
      window.DChickenCloud?.disablePush()
        .then(() => {
          toast("Avisos desactivados en este dispositivo.");
          render();
        })
        .catch((err) => toast(err.message || "No se pudo desactivar.", true));
      return true;
    }
    if (act === "page" || act === "theme") moreOpen = false;
    return false;
  }

  /* ── v16 · comportamiento «nativo» ── */
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function closeSheet(done) {
    const ov = document.querySelector(".quick-overlay,.sheet-overlay");
    if (!ov || reduceMotion()) {
      done();
      return;
    }
    if (ov.classList.contains("closing")) return;
    ov.classList.add("closing");
    document.querySelector(".app")?.classList.remove("sheet-open");
    const panel = ov.firstElementChild;
    let fired = false;
    const fin = () => {
      if (fired) return;
      fired = true;
      done();
    };
    panel?.addEventListener("animationend", fin, { once: true });
    setTimeout(fin, 320);
  }
  /* Arrastrar la hoja hacia abajo para cerrarla: sigue al dedo 1:1, decide por distancia o velocidad */
  function sheetDrag(panel, onClose) {
    if (!panel || panel.dataset.drag) return;
    panel.dataset.drag = "1";
    const zones = panel.querySelectorAll(".grab-area,.sheet-bar");
    let y0 = 0,
      t0 = 0,
      dy = 0,
      active = false,
      pid = null;
    const start = (e) => {
      if (
        e.button > 0 ||
        !matchMedia("(max-width:820px)").matches ||
        e.target.closest("button,input,select,textarea,label")
      )
        return;
      if (panel.scrollTop > 0) return;
      y0 = e.clientY;
      t0 = performance.now();
      dy = 0;
      active = true;
      pid = e.pointerId;
      e.currentTarget.setPointerCapture(pid);
      panel.style.transition = "none";
    };
    const move = (e) => {
      if (!active || e.pointerId !== pid) return;
      const raw = e.clientY - y0;
      dy = raw > 0 ? raw : -(Math.sqrt(-raw) * 2);
      panel.classList.add("dragging");
      panel.style.transform = `translateY(${dy}px)`;
      const ov = panel.parentElement;
      if (ov)
        ov.style.backgroundColor = `oklch(0.12 0.01 40 / ${Math.max(0, 0.38 * (1 - Math.max(0, dy) / panel.offsetHeight))})`;
    };
    const end = (e) => {
      if (!active || e.pointerId !== pid) return;
      active = false;
      const v = Math.max(0, dy) / Math.max(1, performance.now() - t0);
      const ov = panel.parentElement;
      if (dy > panel.offsetHeight * 0.28 || (dy > 24 && v > 0.11)) {
        panel.style.transition = "transform .26s cubic-bezier(.23,1,.32,1)";
        panel.style.transform = "translateY(100%)";
        if (ov) {
          ov.style.transition = "background-color .26s ease";
          ov.style.backgroundColor = "transparent";
        }
        document.querySelector(".app")?.classList.remove("sheet-open");
        setTimeout(onClose, 250);
      } else {
        panel.style.transition = "transform .5s cubic-bezier(.32,.72,0,1)";
        panel.style.transform = "";
        if (ov) {
          ov.style.transition = "background-color .3s ease";
          ov.style.backgroundColor = "";
        }
        setTimeout(() => panel.classList.remove("dragging"), 500);
      }
    };
    for (const z of zones) {
      z.addEventListener("pointerdown", start);
      z.addEventListener("pointermove", move);
      z.addEventListener("pointerup", end);
      z.addEventListener("pointercancel", end);
    }
  }
  let titleObserver = null;
  function nativeEnhance(root) {
    // título grande → aparece en la barra superior al desplazarse
    titleObserver?.disconnect();
    const h1 = root.querySelector(".top h1"),
      bar = root.querySelector(".mobile-logo");
    if (h1 && bar && "IntersectionObserver" in window) {
      titleObserver = new IntersectionObserver(([en]) => bar.classList.toggle("compact", !en.isIntersecting), {
        rootMargin: "-48px 0px 0px 0px",
      });
      titleObserver.observe(h1);
    }
    const amt = root.querySelector("#qe-amount");
    if (amt) {
      const fit = () => {
        amt.style.width = Math.max(1, (amt.value || amt.placeholder).length) + 0.25 + "ch";
      };
      fit();
      amt.addEventListener("input", fit);
    }
    sheetDrag(root.querySelector(".quick-dialog"), () => {
      quickOpen = false;
      render();
    });
    sheetDrag(root.querySelector(".sheet"), () => {
      moreOpen = false;
      render();
    });
  }
  function render() {
    const headings = {
      panel: ["Hoy", "Ventas, caja, gastos y pendientes de un vistazo."],
      ventas: ["Ventas", "Qué se vende, cuánto y por dónde llegan los pedidos."],
      bancos: ["Bancos", "BCP, BBVA y los movimientos que se registran solos desde caja y compras."],
      caja: ["Cierre de caja", "Cuadra las ventas con efectivo, Yape, POS y gastos de caja."],
      gastos: ["Gastos", "Cada pago queda en su categoría y en la cuenta que corresponde."],
      pollos: ["Pollos", "Stock, ingresos, vendidos y pagos al proveedor."],
      gaseosa: ["Gaseosas", "Compras y pagos de bebidas."],
      lena: ["Leña y carbón", "Pedidos y pagos a proveedores."],
      general: ["Compras", "Historial diario por artículo y forma de pago."],
      lista: ["Lista de compras", "Planifica hoy, compra mañana y registra cada pago al instante."],
      sunat: ["SUNAT", "Impuestos y honorarios del contador, por separado."],
      personal: ["Personal", "Adelantos y sueldos sin duplicar gastos."],
      local: ["Local", "Alquiler, adelantos y consumos del propietario."],
      permisos: ["Permisos", "Qué puede ver cada cuenta colaboradora."],
      cambios: ["Historial de cambios", "Quién creó, cambió o borró cada registro, y cuándo."],
    };
    const groups = navItems(),
      flat = groups.flatMap(([, items]) => items);
    if (!flat.some(([k]) => k === page)) page = flat[0]?.[0] || "sinacceso";
    const [title, desc] = headings[page] || ["Sin acceso", "Consulta al administrador."];
    const st = syncStatus(),
      isNew = lastPage !== page;
    lastPage = page;
    const bottomKeys = ["panel", "caja", "ventas", "lista", "gastos", "pollos", "bancos"]
      .filter((k) => flat.some(([x]) => x === k))
      .slice(0, 4);
    const inBottom = bottomKeys.includes(page);
    const label = (k) => TAB_LABEL[k] || SHORT[k] || (flat.find(([x]) => x === k) || [, k])[1];
    const dateCtl =
      page === "panel"
        ? `<label class="date-control"><span class="eyebrow">Mes</span><input type="month" id="app-month" value="${month}"></label>`
        : `<label class="date-control"><span class="eyebrow">Fecha</span><input type="date" id="app-day" value="${day}"></label>`;
    const content =
      page === "sinacceso"
        ? card(
            "Sin permiso",
            "No tienes acceso a las secciones del negocio. Pide al administrador que autorice tu cuenta.",
          )
        : page === "panel"
          ? dashboardInsights() + panelPage()
          : page === "permisos"
            ? permissionsPage()
            : page === "cambios"
              ? auditPage()
            : page === "ventas"
              ? ventasPage()
              : page === "bancos"
                ? bankPage()
                : page === "lista"
                  ? shoppingPage()
                  : page === "caja"
                    ? cashPage()
                    : page === "gastos"
                      ? gastosPage()
                      : page === "pollos"
                        ? pollosPage()
                        : page === "sunat"
                          ? sunatPage()
                          : page === "personal"
                            ? obligationPage("personal")
                            : page === "local"
                              ? obligationPage("local")
                              : purchasesPage(page);
    const sheetOpen = (quickOpen && allowedPage("gastos")) || moreOpen;
    app.innerHTML = `<div class="app ${isNew ? "enter" : ""} ${sheetOpen ? "sheet-open" : ""}"><aside class="side"><div class="logo">${logo()}<div><strong>D’Chicken Express</strong><small>Control · v18</small></div></div>${groups.map(([g, items]) => `<div class="nav-caption">${g}</div><nav class="nav" aria-label="${g}">${items.map(([k, l]) => `<button class="nav-btn ${page === k ? "active" : ""}" data-act="page" data-page="${k}" ${page === k ? 'aria-current="page"' : ""}><span class="symbol" style="--sym:${SYM[k] || "var(--ink-3)"}">${icon(k)}</span>${l}</button>`).join("")}</nav>`).join("")}<div class="side-bottom"><div class="side-status"><span class="sync-dot ${st.cls}"></span>${st.label}</div>${window.DChickenCloud?.isActive() ? "Sincronizado entre tus dispositivos." : "Los datos quedan solo en este navegador."}</div></aside>
 <main class="main"><div class="mobile-logo">${logo()}<b>${title}</b><span class="ml-spacer"></span><button class="btn ghost cloud-pill-btn" data-act="cloud" aria-label="Cuenta y sincronización"><span class="sync-dot ${st.cls}"></span><span id="cloud-pill-m">${st.label}</span></button></div>
 <header class="top"><div><p class="eyebrow">${page === "panel" ? longDate(today()) : monthName(day.slice(0, 7))}</p><h1>${title}</h1><p class="sub">${desc}</p></div><div class="top-controls">${dateCtl}<button class="btn secondary cloud-pill-btn desk-only" data-act="cloud"><span class="sync-dot ${st.cls}"></span><span id="cloud-pill">${st.label}</span></button>${allowedPage("gastos") ? `<button class="btn fast-expense-btn desk-only" data-act="quick-open" type="button">${icon("plus")}Gasto</button>` : ""}${menuHTML()}<input type="file" id="restore-file" accept=".json,application/json" hidden></div></header>
 <div class="content">${content}<p class="footer">D’Chicken Express Control v18. Los saldos bancarios son proyectados: se calculan desde los saldos iniciales, los cierres y los pagos registrados. No son conciliación bancaria ni utilidad neta.</p></div></main>
 <nav class="mobile-bottom" aria-label="Secciones">${bottomKeys.map((k) => `<button class="${page === k ? "active" : ""}" data-act="page" data-page="${k}" ${page === k ? 'aria-current="page"' : ""}><span>${icon(k)}</span>${label(k)}</button>`).join("")}<button class="${!inBottom || moreOpen ? "active" : ""}" data-act="more-open"><span>${icon("mas")}</span>${!inBottom ? label(page) : "Más"}</button></nav>
 ${allowedPage("gastos") && !quickOpen ? `<button class="quick-fab" data-act="quick-open" type="button">${icon("plus")}Gasto</button>` : ""}${quickOpen && allowedPage("gastos") ? quickExpenseDialog() : ""}${moreOpen ? sheetHTML() : ""}</div>`;
    enhanceNotes(app);
    document.querySelectorAll("form [data-paybox]").forEach((b) => updateSplitPreview(b.closest("form")));
    updatePreview();
    updatePurchasePreview();
    nativeEnhance(app);
    window.DChickenCloud?.syncAlerts?.(notifications());
  }

  function panelPage() {
    const closes = db.closures.filter((x) => inMonth(x)),
      exp = expenseMonth();
    const totalSales = sum(closes, (x) => x.system),
      totalExpenses = sum(exp, (x) => x.amount),
      operating = fix(totalSales - totalExpenses),
      cashCount = closes.filter((x) => Math.abs(closeDiff(x, x.date)) < 0.005).length;
    const byCat = ["general", "pollo", "gaseosa", "lena", "gasto", "sunat", "personal", "local"].map((type) => ({
      type,
      amount: sum(
        exp.filter((x) => x.category === type),
        (x) => x.amount,
      ),
    }));
    const days = [...new Set([...closes.map((x) => x.date), ...exp.map((x) => x.date)])].sort().reverse();
    return `${!window.DChickenCloud?.isActive() ? '<div class="tabnote" style="background:#fff5e5;border-color:#eddcb4;color:#8c5b18"><b>Modo de prueba local.</b> Los datos de este navegador no se sincronizan entre teléfonos. Para activar cuentas familiares usa el botón <b>Cuenta</b>.</div>' : ""}<div class="tabnote"><b>Mes: ${month}</b> · Solo aparecen las ventas de días con cierre guardado y los gastos pagados. Si faltan días, el resultado mensual es parcial. El saldo no equivale a utilidad neta ni descuenta impuestos aún no pagados.</div><div class="metrics">${metric("Ventas en sistema", money(totalSales), `${closes.length} día(s) con cierre`, "green")}${metric("Gastos pagados", money(totalExpenses), "Efectivo + Yape + BCP transferencia + BBVA")}${metric("Saldo registrado", money(operating), "Ventas menos pagos registrados", operating < 0 ? "negative-text" : "")}${metric("Cajas cuadradas", `${cashCount} / ${closes.length}`, "Cierres con diferencia cero")}</div><div class="bank-panel-strip"><div><span>BCP · Saldo proyectado</span><strong>${bankBalance("bcp") === null ? "Por configurar" : money(bankBalance("bcp"))}</strong></div><div><span>BBVA · Saldo proyectado</span><strong>${bankBalance("bbva") === null ? "Por configurar" : money(bankBalance("bbva"))}</strong></div><button class="btn primary" data-act="page" data-page="bancos">Ver cuentas bancarias →</button></div><div class="layout-grid"><div>${card("Gastos por sección", byCat.filter((x) => x.amount > 0).length ? `<div class="spending-list">${byCat.map((x) => `<div class="spending-row"><div class="spread"><span>${catLabel[x.type]}</span><b>${money(x.amount)}</b></div><div class="bar-track"><div class="bar-fill" style="width:${totalExpenses ? Math.min(100, (100 * x.amount) / totalExpenses) : 0}%"></div></div></div>`).join("")}</div>` : '<div class="empty">Registra gastos para ver el desglose.</div>', "Suma de pagos reales, no compras pendientes.")}</div><div>${card(
      "Resumen del mes",
      `<div class="sum-list"><div class="sum-row"><span>Ventas registradas</span><b>${money(totalSales)}</b></div><div class="sum-row"><span>Pagos desde efectivo</span><b>${money(
        sum(
          exp.filter((x) => x.method === "cash"),
          (x) => x.amount,
        ),
      )}</b></div><div class="sum-row"><span>Pagos por Yape</span><b>${money(
        sum(
          exp.filter((x) => x.method === "yape"),
          (x) => x.amount,
        ),
      )}</b></div><div class="sum-row"><span>Transferencias</span><b>${money(
        sum(
          exp.filter((x) => ["bcp_transfer", "bbva", "bbva_transfer", "transfer", "plin"].includes(x.method)),
          (x) => x.amount,
        ),
      )}</b></div><div class="sum-row total"><span>Saldo de ventas menos pagos</span><b>${money(operating)}</b></div></div>`,
      "No se incluyen retiros no anotados ni obligaciones futuras.",
    )}</div></div>${card(
      "Movimiento diario del mes",
      table(
        ["Fecha", "Ventas sistema", "Gastos pagados", "Diferencia caja"],
        days.map((d) => {
          const cl = closureOf(d),
            ex = sum(
              exp.filter((x) => x.date === d),
              (x) => x.amount,
            ),
            delta = cl ? closeDiff(cl, d) : null;
          return `<tr><td>${nice(d)}</td><td>${cl ? money(cl.system) : "Sin cierre"}</td><td>${money(ex)}</td><td class="${delta === null ? "" : Math.abs(delta) < 0.005 ? "neutral-text" : delta > 0 ? "positive-text" : "negative-text"}"><b>${delta === null ? "—" : money(delta)}</b></td></tr>`;
        }),
      ),
      "Progreso del mes. Las cifras anteriores de agosto y septiembre no se agregan aquí porque provenían de capturas históricas, no de cierres diarios.",
    )} `;
  }
  function cashPage() {
    const c = closureOf(),
      cash = cashExpenses(),
      total = cashTotal();
    return `<div class="tabnote"><b>Fórmula:</b> Efectivo contado + Yape de ventas + POS de ventas + Gastos en efectivo − Total del sistema = <b>S/ 0.00</b>.<br><span class="small">Yape y transferencias usados para pagar compras no se suman a los gastos de caja. El efectivo es el que quedó físicamente después de pagar gastos.</span></div><div id="cash-mobile" class="mobile-cash-status"></div><div class="layout-grid cash-layout"><div>${card("Cierre del " + nice(day), `<form id="cash-form" data-form="closure"><div class="fields">${field("Sistema · total vendido", "system", c?.system ?? "", "number", 'min="0" step="0.01" required')}${field("Efectivo · contado al final", "cash", c?.cash ?? "", "number", 'min="0" step="0.01" required')}${field("Yape · ventas cobradas", "yape", c?.yape ?? "", "number", 'min="0" step="0.01" required')}${field("POS · tarjetas", "pos", c?.pos ?? "", "number", 'min="0" step="0.01" required')}<div class="field full"><label>Gastos pagados en efectivo · automático</label><input id="cash-auto" readonly value="${money(total)}"></div>${field("Observación (opcional)", "note", c?.note || "", "text", 'maxlength="140"')}</div><div class="f-actions"><button class="btn primary" type="submit">${c ? "Actualizar cierre" : "Guardar cierre"}</button>${c ? `<button type="button" class="btn danger" data-act="delete-closure" data-date="${day}">Eliminar cierre del día</button>` : ""}</div></form>`, "Los gastos se traen de sus respectivas secciones; no hay que escribirlos dos veces.")}${card(
      "Gastos de efectivo incluidos",
      table(
        ["Concepto", "Sección", "Monto", "Acción"],
        cash.map(
          (x) =>
            `<tr><td>${esc(x.detail)}</td><td>${catLabel[x.category]}</td><td><b>${money(x.amount)}</b></td><td><button class="action-link" data-act="goto-item" data-source="${x.source}" data-id="${esc(x.id)}">Ver / editar</button></td></tr>`,
        ),
      ),
      "Si corriges o eliminas un pago en su sección, cambia el cierre inmediatamente.",
    )}</div><div>${card("Resultado del cuadre", `<div id="cash-preview">${status(c ? closeDiff(c) : 0, !!c)}</div><div class="sum-list"><div class="sum-row"><span>Efectivo + Yape + POS</span><b id="cash-summed">${money(N(c?.cash) + N(c?.yape) + N(c?.pos))}</b></div><div class="sum-row"><span>Gastos en efectivo</span><b>${money(total)}</b></div><div class="sum-row total"><span>Total reconstruido</span><b id="cash-rebuilt">${money(N(c?.cash) + N(c?.yape) + N(c?.pos) + total)}</b></div></div>`, "Una diferencia negativa es faltante; positiva, sobrante.")} ${card(
      "Historial de cierres",
      table(
        ["Fecha", "Sistema", "Gastos efectivo", "Diferencia", "Acción"],
        sort(db.closures)
          .slice(0, 15)
          .map((x) => {
            const diff = closeDiff(x, x.date);
            return `<tr><td>${nice(x.date)}</td><td>${money(x.system)}</td><td>${money(cashTotal(x.date))}</td><td class="${diff < -0.005 ? "negative-text" : diff > 0.005 ? "positive-text" : "neutral-text"}"><b>${money(diff)}</b></td><td><div class="row-actions"><button class="action-link" data-act="jump-day" data-date="${x.date}">Abrir</button><button class="action-link red" data-act="delete-closure" data-date="${x.date}">Eliminar</button></div></td></tr>`;
          }),
      ),
      "Eliminar el cierre no elimina gastos ni inventarios.",
    )}</div></div>`;
  }

  function gastosPage() {
    const f = edit?.type === "expense" ? db.expenses.find((x) => x.id === edit.id) : null;
    const ledger = sort(ledgers().filter((x) => x.date === day));
    const cash = sum(
      ledger.filter((x) => x.method === "cash" && x.cashSource === "register"),
      (x) => x.amount,
    );
    const personal = sum(
      ledger.filter((x) => x.method === "personal" || x.cashSource === "personal"),
      (x) => x.amount,
    );
    const form = `<form data-form="expense"><div class="fields">${field("Fecha", "date", f?.date || day, "date", "required")}${field("Concepto", "concept", f?.concept || "", "text", 'maxlength="120" placeholder="Ej.: taxi, reparación" required')}${field("Total del gasto S/", "amount", f?.amount ?? "", "number", 'min="0.01" step="0.01" required')}${paymentPartsUI(f ? normalizeParts(f) : [])}${field("¿A quién pagaste? (opcional)", "person", f?.person || "")}${field("Nota (opcional)", "note", f?.note || "")}</div><div class="f-actions"><button class="btn primary" type="submit">${f ? "Actualizar gasto" : "Guardar gasto"}</button>${f ? '<button class="btn" data-act="cancel-edit" type="button">Cancelar</button>' : ""}</div></form>`;
    return `<div class="tabnote"><b>Registro único:</b> las compras de pollos, gaseosas y mercado aparecen aquí automáticamente. El efectivo personal se cuenta como gasto del negocio, pero <b>NO</b> se suma al cierre de caja.</div><div class="metrics">${metric("Gastos pagados hoy", money(sum(ledger, (x) => x.amount)))}${metric("Efectivo de caja", money(cash), "Incluido en el cierre")}${metric("Efectivo personal", money(personal), "Sin saldo personal")}${metric(
      "BCP / BBVA",
      money(
        sum(
          ledger.filter((x) => !!bankFor(x)),
          (x) => x.amount,
        ),
      ),
      "Descuentos automáticos",
    )}</div>${card(f ? "Editar gasto" : "Registrar otro gasto", form, "Puedes combinar efectivo de caja, personal, Yape, BCP y BBVA.")}${card(
      "Gastos del " + nice(day),
      table(
        ["Origen", "Concepto", "Forma de pago", "Monto", "Acción"],
        ledger.map(
          (x) =>
            `<tr><td>${esc(catLabel[x.category] || x.category)}</td><td>${esc(x.detail)}</td><td>${esc(payLabel(partMethod(x)))}</td><td><b>${money(x.amount)}</b></td><td>${x.source === "gasto" ? buttons("expense", x.id) : `<button class="action-link" data-act="goto-item" data-source="${x.source}" data-id="${esc(x.id)}">Ver origen</button>`}</td></tr>`,
        ),
      ),
      "Una compra combinada muestra cada parte del pago, pero no crea compras ni gastos duplicados.",
    )}`;
  }
  // Stock de pollos: permite una calibración de inventario inicial por fecha;
  // las compras nuevas viven en purchases, con pago integrado y un solo movimiento.
  const chickenPurchases = () => db.purchases.filter((x) => x.type === "pollo");
  // Pollos vendidos: una sola cifra por día. Si hay «Ventas por producto», manda esa;
  // si no, la cifra que se anotó a mano en Pollos.
  function soldOf(date) {
    const s = saleOf(date);
    if (s && chickenEq(s.items) > 0) return chickenEq(s.items);
    return N(db.chickens.find((x) => x.date === date)?.sold);
  }
  const soldFromSales = (date) => {
    const s = saleOf(date);
    return !!(s && chickenEq(s.items) > 0);
  };
  const wasteOf = (date) => fix(sum(db.chickens.find((x) => x.date === date)?.waste || [], (w) => w.qty));
  function chickenDates() {
    return [...new Set([...db.chickens.map((x) => x.date), ...(db.sales || []).map((x) => x.date)])].filter(Boolean);
  }
  function chickenStart(date = day) {
    const latest = [...db.chickens]
      .filter((x) => x.stockInitial !== undefined && x.date <= date)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const from = latest?.date || "0000-01-01";
    const base = latest ? N(latest.stockInitial) : 0;
    const earlier = (x) => x.date >= from && x.date < date;
    const earlierDates = chickenDates().filter((d) => d >= from && d < date);
    return fix(
      base +
        sum(db.chickens.filter(earlier), (x) => N(x.entered)) -
        sum(earlierDates, (d) => soldOf(d) + wasteOf(d)) +
        sum(chickenPurchases().filter(earlier), (x) => x.qty),
    );
  }
  function chickenBalance(date = day) {
    const initial = chickenStart(date),
      x = db.chickens.find((a) => a.date === date);
    return fix(
      initial +
        N(x?.entered) +
        sum(
          chickenPurchases().filter((p) => p.date === date),
          (p) => p.qty,
        ) -
        soldOf(date) -
        wasteOf(date),
    );
  }
  // Lo que debería haber al comenzar el día según los movimientos, sin contar el conteo de ese mismo día.
  function expectedStart(d) {
    const x = db.chickens.find((c) => c.date === d);
    if (!x || x.stockInitial === undefined) return chickenStart(d);
    const keep = x.stockInitial;
    delete x.stockInitial;
    try {
      return chickenStart(d);
    } finally {
      x.stockInitial = keep;
    }
  }
  // Fotografía del stock por día, para bloquear solo los cambios que EMPEORAN un stock negativo
  // (si el stock ya estaba negativo por ventas anotadas sin compras, una compra nueva debe poder guardarse).
  const stockSnapshot = (extra = []) =>
    new Map([...new Set(chickenDates().concat(chickenPurchases().map((p) => p.date), extra))].map((d) => [d, chickenBalance(d)]));
  const stockWorse = (before) =>
    [...new Set([...before.keys(), ...chickenDates(), ...chickenPurchases().map((p) => p.date)])].some((d) => {
      const after = chickenBalance(d);
      return after < -0.005 && after < (before.has(d) ? before.get(d) : 0) - 0.005;
    });
  const WASTE_REASONS = [
    ["quemado", "Quemado o en mal estado"],
    ["caido", "Se cayó o se dañó"],
    ["cortesia", "Cortesía o regalo"],
    ["personal", "Consumo del personal"],
    ["otro", "Otro motivo"],
  ];
  const wasteLabel = (k) => (WASTE_REASONS.find((x) => x[0] === k) || [k, k])[1];
  function pollosPage() {
    const x = db.chickens.find((a) => a.date === day),
      start = chickenStart(),
      received =
        sum(
          chickenPurchases().filter((p) => p.date === day),
          (p) => p.qty,
        ) + N(x?.entered),
      sold = soldOf(day),
      fromSales = soldFromSales(day),
      waste = wasteOf(day),
      left = chickenBalance();
    const locked = staffLocked(day);
    const purchaseEdit = edit?.type === "purchase" ? chickenPurchases().find((p) => p.id === edit.id) : null;
    const formPurchase = `<form data-form="simple-purchase" data-type="pollo"><div class="fields">${field("Fecha", "date", purchaseEdit?.date || day, "date", "required")}${field("Cantidad de pollos comprados", "qty", purchaseEdit?.qty ?? "", "number", 'min="1" step="1" required')}${field("Precio TOTAL pagado S/", "total", purchaseEdit?.total ?? "", "number", 'min="0.01" step="0.01" required')}${paymentPartsUI(purchaseEdit?.paymentParts || [])}${field("Nota (opcional)", "note", purchaseEdit?.note || "")}</div><div class="f-actions"><button class="btn primary" type="submit">${purchaseEdit ? "Actualizar compra" : "Guardar compra de pollos"}</button>${purchaseEdit ? '<button class="btn" type="button" data-act="cancel-edit">Cancelar</button>' : ""}</div></form>`;
    const saleForm = fromSales
      ? `<div class="sum-list"><div class="sum-row total"><span>Vendidos según Ventas por producto</span><b>${fix(sold).toLocaleString("es-PE", { maximumFractionDigits: 2 })}</b></div></div><p class="small muted">Esta cifra sale de lo anotado en Ventas, así no se cuenta dos veces. Para cambiarla, corrige las ventas del día.</p><div class="f-actions"><button class="btn" type="button" data-act="page" data-page="ventas">Ir a Ventas</button></div>`
      : `<form data-form="chicken-sales"><div class="fields">${field("Fecha", "date", day, "date", "required")}${field("Pollos vendidos", "sold", N(x?.sold) || "", "number", 'min="0" step="0.125" required')}</div><div class="f-actions"><button class="btn primary">Guardar ventas del día</button></div></form><p class="small muted">Si anotas las ventas por producto, esta cifra se calcula sola.</p>`;
    const calcStart = expectedStart(day);
    const stockForm = `<form data-form="chicken-stock"><div class="fields">${field("Fecha de inicio", "date", day, "date", "required")}${field("Stock contado al comenzar ese día", "stockInitial", x?.stockInitial ?? "", "number", 'min="0" step="1" required')}${field("Motivo si el conteo no cuadra", "countReason", x?.countReason || "", "text", 'maxlength="140" placeholder="Obligatorio si hay diferencia con lo calculado"')}</div><div class="f-actions"><button class="btn">Guardar stock inicial</button></div></form><p class="small muted">Según la app deberían haber <b>${int(calcStart)}</b> al comenzar el ${nice(day)}. Si cuentas otra cifra, la diferencia queda registrada.</p>`;
    const wasteForm = `<form data-form="chicken-waste"><div class="fields">${field("Fecha", "date", day, "date", "required")}${field("Cantidad de pollos", "qty", "", "number", 'min="0.125" step="0.125" required placeholder="Ej.: 1 o 0.5"')}<div class="field"><label for="fld-waste-reason">Motivo</label><select id="fld-waste-reason" name="reason" required>${WASTE_REASONS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>${field("Detalle (opcional)", "note", "", "text", 'maxlength="140" placeholder="Ej.: se quemó en el horno 2"')}</div><div class="f-actions"><button class="btn primary">Registrar merma</button></div></form>`;
    const wasteRows = sort(db.chickens.filter((c) => (c.waste || []).length || N(c.countDiff)))
      .slice(0, 30)
      .flatMap((c) => [
        ...(c.waste || []).map(
          (w) =>
            `<tr><td>${nice(c.date)}</td><td>${fix(w.qty)}</td><td>${esc(wasteLabel(w.reason))}${w.note ? `<div class="small">${esc(w.note)}</div>` : ""}</td><td>${w.by ? esc(w.by) : ""}</td><td>${locked && c.date === day ? "" : `<button class="action-link red" data-act="waste-delete" data-date="${c.date}" data-id="${esc(w.id)}">Anular</button>`}</td></tr>`,
        ),
        ...(N(c.countDiff)
          ? [
              `<tr><td>${nice(c.date)}</td><td>${N(c.countDiff) > 0 ? "+" : ""}${fix(c.countDiff)}</td><td>Diferencia de conteo${c.countReason ? `<div class="small">${esc(c.countReason)}</div>` : ""}</td><td>${c.countBy ? esc(c.countBy) : ""}</td><td></td></tr>`,
            ]
          : []),
      ]);
    const m = day.slice(0, 7);
    const monthWaste = fix(
      sum(
        db.chickens.filter((c) => (c.date || "").slice(0, 7) === m),
        (c) => wasteOf(c.date) - Math.min(0, N(c.countDiff)),
      ),
    );
    const sales = sort(chickenDates().map((d) => ({ date: d })).filter((p) => soldOf(p.date) > 0 || wasteOf(p.date) > 0 || db.chickens.find((c) => c.date === p.date)?.stockInitial !== undefined))
      .slice(0, 25)
      .map((p) => `<tr><td>${nice(p.date)}</td><td>${fix(soldOf(p.date))}</td><td>${wasteOf(p.date) ? fix(wasteOf(p.date)) : "—"}</td><td>${int(chickenBalance(p.date))}</td></tr>`);
    const buys = sort(chickenPurchases())
      .slice(0, 40)
      .map(
        (p) =>
          `<tr><td>${nice(p.date)}</td><td>${int(p.qty)}</td><td>${money(p.total)}</td><td>${esc(paymentSummary(p.paymentParts || []))}</td><td>${buttons("purchase", p.id)}</td></tr>`,
      );
    return `<div class="tabnote"><b>Así funciona:</b> fija una sola vez el stock al comenzar un día. Cada compra suma pollos; cada venta diaria resta pollos. El importe de compras aparece en Gastos y descuenta bancos/caja según cómo pagaste. Los ingresos antiguos siguen contándose.</div><div class="metrics">${metric("Stock inicial hoy", int(start) + " pollos", "Se arrastra del día anterior")}${metric("Comprados hoy", int(received) + " pollos", "Sumados automáticamente")}${metric("Vendidos hoy", fix(sold) + " pollos", fromSales ? "Desde Ventas por producto" : "Ingresas una sola cifra")}${metric("Merma hoy", fix(waste) + " pollos", "Merma del mes: " + monthWaste, waste > 0 ? "negative-text" : "")}${metric("Disponibles", int(left) + " pollos", "Stock calculado", left < 0 ? "negative-text" : "green")}</div>${locked ? `<div class="alert">Este día ya está cerrado. Solo el administrador puede cambiar registros de días anteriores.</div>` : ""}<div class="layout-grid"><div>${card("Ventas del " + nice(day), saleForm, fromSales ? "" : "Solo indica cuántos pollos se vendieron.")}${card("Merma y cortesías", wasteForm, "Cada pollo que no se vende ni queda en stock: quemado, caído, regalado o comido por el personal.")}${card("Stock inicial", stockForm, "Regístralo al contar los pollos. Si no cuadra con lo calculado, explica por qué.")}</div><div>${card(purchaseEdit ? "Editar compra" : "Compra de pollos", formPurchase, "Solo cantidad, precio total y formas de pago. Esta compra se suma al stock y al gasto automáticamente.")}</div></div>${card("Merma y diferencias de conteo", table(["Fecha", "Pollos", "Motivo", "Registró", "Acción"], wasteRows), "Lo que se pierde, con motivo y responsable.")}${card("Historial de compras", table(["Fecha", "Pollos", "Precio total", "Pago", "Acción"], buys), "Las compras se suman al stock una sola vez.")}${card("Historial de ventas y existencias", table(["Fecha", "Vendidos", "Merma", "Disponible"], sales), "Consulta los movimientos anteriores.")}`;
  }

  // Lista inteligente. Cada compra confirmada genera una sola compra general y un pago vinculado.
  const requestedQty = (item) => Math.max(0, N(item.qty));
  // Una compra puede venir de un solo artículo (shoppingId) o de varios pagados juntos (shoppingItems).
  const shopIdsOf = (p) =>
    p && Array.isArray(p.shoppingItems) ? p.shoppingItems.map((x) => x.id) : p?.shoppingId ? [p.shoppingId] : [];
  const shoppingPurchased = (item) =>
    sum(db.purchases, (p) =>
      Array.isArray(p.shoppingItems)
        ? N(p.shoppingItems.find((x) => x.id === item.id)?.qty)
        : p.shoppingId === item.id
          ? N(p.qty)
          : 0,
    );
  const shoppingRemaining = (item) => Math.max(0, fix(requestedQty(item) - shoppingPurchased(item)));
  const shoppingStatus = (item) => {
    const remaining = shoppingRemaining(item);
    return remaining <= 0.000001 ? "done" : remaining < requestedQty(item) ? "partial" : "pending";
  };
  const marketStart = () => initialFor("market");
  const marketSpendings = () => ledgers().filter((x) => x.method === "cash" && x.cashSource === "market");
  const marketMovements = () => {
    const rows = (db.bankTransactions || [])
      .filter((x) => x.type === "market_fund")
      .map((x) => ({
        id: x.id,
        date: x.date,
        amount: fix(x.amount),
        detail: "Retiro " + bankName[x.bank] + " para compras",
      }));
    for (const x of marketSpendings())
      rows.push({
        id: x.id,
        date: x.date,
        amount: fix(-x.amount),
        detail: x.detail + " · " + (catLabel[x.category] || "Compra"),
      });
    return sort(rows);
  };
  const marketBalance = () => {
    const open = marketStart();
    if (!open) return null;
    return fix(
      N(open.amount) +
        sum(
          marketMovements().filter((x) => x.date >= open.date),
          (x) => x.amount,
        ),
    );
  };
  const parseWhatsApp = (raw) =>
    raw
      .split(/\r?\n/)
      .map((s) => s.replace(/^\s*(?:[-*•✓☑]\s*|\d{1,2}[.)]\s+)/, "").trim())
      .filter(Boolean)
      .slice(0, 100)
      .map((s) => {
        let qty = 1,
          unit = "und",
          product = s;
        let m = s.match(
          /^(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gramos?|lt|l|litros?|galones?|unid(?:ades)?|unds?|paquetes?|bolsas?|atados?|cajas?|botellas?)\s+(?:de\s+)?(.+)$/i,
        );
        if (m) {
          qty = Number(m[1].replace(",", "."));
          unit = m[2];
          product = m[3];
        } else {
          const end = s.match(
            /^(.+?)\s+[-:,]?\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gramos?|lt|l|litros?|galones?|unid(?:ades)?|unds?|paquetes?|bolsas?|atados?|cajas?|botellas?)$/i,
          );
          if (end) {
            product = end[1];
            qty = Number(end[2].replace(",", "."));
            unit = end[3];
          }
        }
        return { product: product.slice(0, 100), qty: qty > 0 ? qty : 1, unit: unit.toLowerCase().slice(0, 20) };
      });
  const groupBarHTML = (n) =>
    `<span><b>${int(n)}</b> ${n === 1 ? "seleccionado" : "seleccionados"}</span><button class="btn sm primary" type="button" data-act="shop-group">Pagar juntos</button>`;
  function shoppingPage() {
    const planned = sort((db.shoppingLists || []).filter((x) => x.date === shoppingDay));
    const pending = planned.filter((x) => shoppingRemaining(x) > 0.000001),
      completed = planned.filter((x) => shoppingRemaining(x) <= 0.000001);
    const selected = planned.find((x) => x.id === shoppingPick),
      bought = sort(db.purchases.filter((x) => shopIdsOf(x).length && x.date === day));
    const paidToday = ledgers().filter(
      (x) => x.date === day && x.purchaseId && shopIdsOf(purchaseBy(x.purchaseId)).length,
    );
    for (const id of [...shoppingSel]) if (!pending.some((x) => x.id === id)) shoppingSel.delete(id);
    if (!shoppingSel.size) shoppingGroup = false;
    const chosen = pending.filter((x) => shoppingSel.has(x.id));
    const cashBought = sum(
        paidToday.filter((x) => x.method === "cash"),
        (x) => x.amount,
      ),
      bcpBought = sum(
        paidToday.filter((x) => bankFor(x) === "bcp"),
        (x) => x.amount,
      ),
      bbvaBought = sum(
        paidToday.filter((x) => bankFor(x) === "bbva"),
        (x) => x.amount,
      );
    const summary = `<div class="metrics">${metric("Por comprar", int(pending.length), "Artículos pendientes")}${metric("Comprado hoy", money(sum(paidToday, (x) => x.amount)), "Pagos registrados")}${metric(
      "Efectivo personal",
      money(
        sum(
          paidToday.filter((x) => x.method === "personal"),
          (x) => x.amount,
        ),
      ),
      "Gastos, sin saldo personal",
    )}${metric("Completados", int(completed.length) + " / " + int(planned.length), "Lista del " + nice(shoppingDay))}</div>`;
    const listRows =
      pending
        .map((x) => {
          const state = shoppingStatus(x);
          return `<div class="shopping-item${shoppingSel.has(x.id) ? " sel" : ""}"><div class="shopping-check"><button class="check-btn${shoppingSel.has(x.id) ? " on" : ""}" type="button" data-act="shop-sel" data-id="${esc(x.id)}" aria-pressed="${shoppingSel.has(x.id)}" aria-label="Seleccionar ${esc(x.product)} para pagar junto con otros">✓</button></div><div class="shopping-info"><b>${esc(x.product)}</b><span>${esc(shoppingRemaining(x))} ${esc(x.unit || "und")} ${state === "partial" ? "<em>· Compra parcial</em>" : ""}${x.note ? ` · ${esc(x.note)}` : ""}</span></div><button class="btn sm primary" data-act="shop-pick" data-id="${esc(x.id)}">Comprar</button><button class="action-link red" data-act="shop-delete" data-id="${esc(x.id)}" title="Quitar pendiente">✕</button></div>`;
        })
        .join("") || '<div class="empty">¡Lista completa! Puedes preparar otra para mañana.</div>';
    const completedRows = completed
      .map(
        (x) =>
          `<div class="shopping-item done"><span class="shopping-done">✓</span><div class="shopping-info"><b>${esc(x.product)}</b><span>${esc(x.qty)} ${esc(x.unit || "und")} · comprado</span></div></div>`,
      )
      .join("");
    const purchaseRows = sort(
      db.purchases.filter((p) => shopIdsOf(p).some((id) => planned.some((x) => x.id === id))),
    ).map(
      (p) =>
        `<tr><td>${nice(p.date)}</td><td>${esc(p.product)}</td><td>${Array.isArray(p.shoppingItems) ? esc(p.shoppingItems.map((i) => i.qty + " " + (i.unit || "und")).join(" · ")) : esc(p.qty) + " " + esc(planned.find((x) => x.id === p.shoppingId)?.unit || "und")}</td><td>${money(p.total)}</td><td>${esc(paymentSummary([...(p.paymentParts || []), ...(p.additionalParts || []), ...paymentsOf(p.id).flatMap(normalizeParts)]))}</td></tr>`,
    );
    const recent = table(["Fecha", "Artículo", "Cantidad", "Importe", "Medio"], purchaseRows);
    const planForm = card(
      "Preparar la lista de WhatsApp",
      `<form data-form="shopping-add"><div class="fields"><div class="field full"><label for="shop-list-raw">Pega los artículos, uno por línea</label><textarea id="shop-list-raw" name="raw" rows="5" placeholder="5 kg tomate&#10;Papa 20 kg&#10;Aceite 2 galones&#10;Bolsas para delivery"></textarea><p class="tiny">Reconoce cantidades al principio o final. Si no indicas cantidad, usará 1 unidad. Revisa las cantidades antes de comprar.</p></div></div><div class="f-actions"><button class="btn primary" type="submit">＋ Agregar a la lista</button></div></form>`,
      "Puedes copiar directamente el mensaje de tus trabajadores.",
    );
    const buyForm = selected
      ? card(
          "Registrar compra · " + esc(selected.product),
          `<form data-form="shopping-buy"><input type="hidden" name="shoppingId" value="${esc(selected.id)}"><div class="fields">${field("Fecha real de compra", "date", today(), "date", "required")}${field("Cantidad comprada (" + esc(selected.unit || "und") + ")", "qty", shoppingRemaining(selected), "number", 'step="0.01" min="0.01" max="' + shoppingRemaining(selected) + '" required')}${field("Costo TOTAL pagado S/", "total", "", "number", 'min="0.01" step="0.01" required')}${paymentPartsUI([])}${field("Proveedor (opcional)", "person", "", "text", 'maxlength="100"')}${field("Nota (opcional)", "note", "", "text", 'maxlength="140"')}</div><div class="callout">✔ Cuando confirmes, registraremos la compra y un pago por el mismo importe. Solo <b>efectivo de caja</b> se incluye en el cierre. Efectivo personal se registra sin saldo. Yape/BCP descuentan BCP; BBVA descuenta BBVA. Si compraste solo una parte, el resto seguirá pendiente.</div><div class="f-actions"><button class="btn primary" type="submit">✓ Confirmar compra y pago</button><button class="btn" type="button" data-act="shop-cancel">Cancelar</button></div></form>`,
          "No se guardará nada hasta pulsar Confirmar.",
        )
      : "";
    const groupForm =
      shoppingGroup && chosen.length
        ? card(
            "Pagar juntos · " + int(chosen.length) + (chosen.length === 1 ? " producto" : " productos"),
            `<form data-form="shopping-buy-group"><input type="hidden" name="ids" value="${esc(chosen.map((x) => x.id).join(","))}"><ul class="group-items">${chosen.map((x) => `<li><b>${esc(x.product)}</b><span>${esc(shoppingRemaining(x))} ${esc(x.unit || "und")}</span></li>`).join("")}</ul><div class="fields">${field("Fecha real de compra", "date", today(), "date", "required")}${field("Costo TOTAL pagado por todos S/", "total", "", "number", 'min="0.01" step="0.01" required inputmode="decimal"')}${paymentPartsUI([])}${field("Proveedor o tienda (opcional)", "person", "", "text", 'maxlength="100"')}${field("Nota (opcional)", "note", "", "text", 'maxlength="140"')}</div><div class="callout">✔ Se registra <b>una sola compra y un solo pago</b> por el total, y estos productos pasan a comprados con la cantidad completa. Si de alguno compraste solo una parte, quítalo de la selección y usa su botón <b>Comprar</b>.</div><div class="f-actions"><button class="btn primary" type="submit">✓ Confirmar compra y pago</button><button class="btn" type="button" data-act="shop-group-cancel">Cancelar</button></div></form>`,
            "No se guardará nada hasta pulsar Confirmar.",
          )
        : "";
    const fundForm = card(
      "Fondo de efectivo para compras",
      `<div class="fund-display"><span>Saldo estimado disponible</span><strong>${marketBalance() === null ? "Configura primero" : money(marketBalance())}</strong></div><form data-form="market-open"><div class="fields">${field("Saldo inicial S/", "amount", marketStart()?.amount ?? "", "number", 'min="0" step="0.01" required')}${field("Fecha del saldo inicial", "date", marketStart()?.date || today(), "date", "required")}</div><p class="tiny">Indica el efectivo disponible al iniciar esa fecha. No se debe sumar otra vez el dinero que ya estaba contado aquí.</p><div class="f-actions"><button class="btn" type="submit">Guardar fondo inicial</button></div></form><hr class="soft-divider"><form data-form="market-fund"><div class="fields">${field("Fecha", "date", today(), "date", "required")}${select(
        "Retirar del banco",
        "bank",
        [
          ["bcp", "BCP"],
          ["bbva", "BBVA"],
        ],
        "bcp",
      )}${field("Retiro para compras S/", "amount", "", "number", 'min="0.01" step="0.01" required')}${field("Observación", "note", "", "text", 'maxlength="140"')}</div><p class="tiny">El retiro baja el banco elegido y aumenta el efectivo de compras, sin contar como gasto. El gasto real se registra cuando pagues los productos.</p><div class="f-actions"><button class="btn primary" type="submit">Transferir al fondo de compras</button></div></form>`,
      "Este fondo es distinto de la caja diaria. Solo un administrador debe modificar saldos.",
    );
    return `<div class="shopping-hero"><div><span class="hero-kicker">OPERACIÓN · ABASTECIMIENTO</span><h2>Tu mercado, bajo control.</h2><p>Planifica por WhatsApp, compra con un toque y controla los saldos sin duplicar gastos.</p></div></div><div class="shopping-daybar"><b>Lista programada para</b><input id="shopping-day" type="date" value="${shoppingDay}"><span class="shopping-status">${pending.length} por comprar</span></div>${summary}<div class="shopping-grid"><div>${card("Pendientes por comprar", `<div class="shopping-list">${listRows}</div><div class="shop-groupbar" id="shop-groupbar"${shoppingSel.size && !shoppingGroup ? "" : " hidden"}>${groupBarHTML(shoppingSel.size)}</div>`, "¿Pagaste varios productos juntos? Marca sus círculos y pon un solo precio. Para uno solo, pulsa Comprar.")}${groupForm}${buyForm}${completed.length ? card("Productos comprados ✓", `<div class="shopping-list">${completedRows}</div>`, "Los productos completados pasan aquí automáticamente.") : ""}${card("Historial de esta lista", recent, "Cada compra genera un único pago; puedes corregirla en Historial compras.")}<div class="shopping-breakdown">${metric("Efectivo (hoy)", money(cashBought))}${metric("BCP (hoy)", money(bcpBought))}${metric("BBVA (hoy)", money(bbvaBought))}</div></div><div>${planForm}${
      marketMovements().length
        ? card(
            "Fondo de compras anterior (histórico)",
            table(
              ["Fecha", "Concepto", "Importe"],
              marketMovements()
                .slice(0, 20)
                .map((x) => `<tr><td>${nice(x.date)}</td><td>${esc(x.detail)}</td><td>${money(x.amount)}</td></tr>`),
            ),
            "Histórico conservado. Las compras nuevas usan únicamente caja, efectivo personal o bancos.",
          )
        : ""
    }</div></div>`;
  }
  function purchHead(type) {
    return { gaseosa: "Compra de gaseosas", lena: "Compra de leña", general: "Compra general" }[type];
  }
  function purchaseName(type) {
    return type === "gaseosa"
      ? "Producto y presentación (ej.: Inca Kola 500 ml)"
      : type === "lena"
        ? "Detalle del pedido (ej.: Leña eucalipto)"
        : "Artículo (ej.: brócoli, tomate, aceite, bolsas, táperes)";
  }

  function purchasesPage(type) {
    if (type === "gaseosa") return simpleSodaPage();
    const f = edit?.type === "purchase" ? db.purchases.find((x) => x.id === edit.id && x.type === type) : null;
    const pset = db.purchases.filter((x) => x.type === type),
      daily = pset.filter((x) => x.date === day),
      bought = sum(daily, (x) => x.total),
      paid = sum(
        ledgers().filter((x) => x.date === day && x.purchaseId && purchaseBy(x.purchaseId)?.type === type),
        (x) => x.amount,
      );
    const legacyEdit =
      edit?.type === "payment"
        ? db.payments.find((x) => x.id === edit.id && purchaseBy(x.purchaseId)?.type === type)
        : null;
    const rows = sort(pset)
      .slice(0, 100)
      .map(
        (p) =>
          `<tr><td>${nice(p.date)}</td><td>${esc(p.product)}</td><td>${int(p.qty)}</td><td>${money(p.total)}</td><td>${money(paidOf(p.id))}</td><td>${money(Math.max(0, dueOf(p)))}</td><td>${buttons("purchase", p.id)} ${dueOf(p) > 0.005 ? `<button class="action-link" data-act="pay-purchase" data-id="${p.id}">Abonar</button>` : ""}</td></tr>`,
      );
    const form = `<form data-form="purchase" data-type="${type}"><div class="fields">${field("Fecha", "date", f?.date || day, "date", "required")}${field(purchaseName(type), "product", f?.product || "", "text", "required")}${field("Cantidad", "qty", f?.qty ?? 1, "number", 'min="0.01" step="0.01" required')}${field("Precio por unidad S/", "unitCost", f?.unitCost ?? "", "number", 'min="0.000001" step="0.000001" required')}<div class="field"><label>Total calculado</label><input id="p-total" readonly value="${money(f?.total || 0)}"></div>${!f || Array.isArray(f.paymentParts) ? paymentPartsUI(f?.paymentParts || []) : '<p class="tiny">La forma de pago de esta compra anterior se modifica en su historial de pagos.</p>'}${field("Proveedor (opcional)", "person", f?.person || "")}${field("Nota", "note", f?.note || "")}</div><div class="f-actions"><button class="btn primary">${f ? "Guardar cambios" : "Registrar compra"}</button>${f ? '<button class="btn" data-act="cancel-edit" type="button">Cancelar</button>' : ""}</div></form>`;
    const target = (payTarget && duePurchases(type).find((p) => p.id === payTarget)) || duePurchases(type)[0];
    const payForm = legacyEdit
      ? `<form data-form="payment"><input type="hidden" name="purchaseId" value="${esc(legacyEdit.purchaseId)}"><div class="fields">${field("Fecha", "date", legacyEdit.date, "date", "required")}${field("Total del abono S/", "amount", legacyEdit.amount, "number", 'min="0.01" step="0.01" required')}${paymentPartsUI(normalizeParts(legacyEdit))}${field("Nota", "note", legacyEdit.note || "")}</div><div class="f-actions"><button class="btn primary">Actualizar abono</button></div></form>`
      : target
        ? `<form data-form="payment"><input type="hidden" name="purchaseId" value="${esc(target.id)}"><div class="fields">${field("Fecha", "date", day, "date", "required")}${field("Total a abonar S/", "amount", dueOf(target), "number", 'min="0.01" step="0.01" required')}${paymentPartsUI([])}${field("Nota", "note", "")}</div><div class="f-actions"><button class="btn primary">Registrar abono</button></div></form>`
        : '<div class="empty">Sin compras pendientes.</div>';
    return `<div class="tabnote"><b>Un único registro.</b> Cada compra se conecta con Gastos, Bancos y Caja. Puedes repartir los pagos entre varios medios sin duplicarlos.</div><div class="metrics">${metric("Comprado hoy", money(bought))}${metric("Pagado hoy", money(paid))}${metric("Por pagar", money(sum(pset, (p) => Math.max(0, dueOf(p)))))}</div>${card(f ? "Editar compra" : purchHead(type), form)}${card("Historial", table(["Fecha", "Artículo", "Cantidad", "Total", "Pagado", "Pendiente", "Acción"], rows))}${card(legacyEdit ? "Editar pago anterior" : "Abonar compra pendiente", payForm)}${card(
      "Pagos anteriores",
      table(
        ["Fecha", "Compra", "Pagado", "Acción"],
        sort(db.payments.filter((x) => purchaseBy(x.purchaseId)?.type === type)).map(
          (x) =>
            `<tr><td>${nice(x.date)}</td><td>${esc(purchaseBy(x.purchaseId)?.product || "")}</td><td>${money(x.amount)}</td><td>${buttons("payment", x.id)}</td></tr>`,
        ),
      ),
      "Los abonos nuevos se guardan dentro de la compra.",
    )}`;
  }
  function simpleSodaPage() {
    const f = edit?.type === "purchase" ? db.purchases.find((x) => x.id === edit.id && x.type === "gaseosa") : null;
    const pset = db.purchases.filter((x) => x.type === "gaseosa");
    const todayBuys = pset.filter((p) => p.date === day);
    const form = `<form data-form="simple-purchase" data-type="gaseosa"><div class="fields">${field("Fecha", "date", f?.date || day, "date", "required")}${field("Gaseosa y presentación", "product", f?.product || "", "text", 'placeholder="Ej.: Inca Kola 500 ml" required')}${field("Cantidad comprada", "qty", f?.qty ?? "", "number", 'min="0.01" step="0.01" required')}${field("Precio TOTAL pagado S/", "total", f?.total ?? "", "number", 'min="0.01" step="0.01" required')}${f && !Array.isArray(f.paymentParts) && paymentsOf(f.id).length ? '<p class="tiny">Compra anterior con abonos separados: conservaremos los pagos existentes.</p>' : paymentPartsUI(f?.paymentParts || [])}${field("Nota (opcional)", "note", f?.note || "")}</div><div class="f-actions"><button class="btn primary">${f ? "Actualizar" : "Guardar compra"}</button>${f ? '<button class="btn" data-act="cancel-edit" type="button">Cancelar</button>' : ""}</div></form>`;
    const rows = sort(pset)
      .slice(0, 100)
      .map(
        (p) =>
          `<tr><td>${nice(p.date)}</td><td>${esc(p.product)}</td><td>${int(p.qty)}</td><td>${money(p.total)}</td><td>${esc(paymentSummary([...(p.paymentParts || []), ...(p.additionalParts || []), ...paymentsOf(p.id).flatMap(normalizeParts)]))}</td><td>${buttons("purchase", p.id)}</td></tr>`,
      );
    return `<div class="tabnote">Solo registra qué gaseosa compraste, cuántas unidades, el precio total y de dónde salió el dinero. <b>Se registra automáticamente como gasto.</b> No hay fases adicionales ni control de ventas.</div><div class="metrics">${metric("Pedidos hoy", int(todayBuys.length))}${metric("Unidades compradas", int(sum(todayBuys, (x) => x.qty)))}${metric("Total comprado", money(sum(todayBuys, (x) => x.total)))}</div>${card(f ? "Editar compra de gaseosas" : "Compra de gaseosas", form)}${card("Compras registradas", table(["Fecha", "Gaseosa", "Cantidad", "Precio total", "Pagos", "Acción"], rows), "Los pagos se reflejan en Gastos, Caja y bancos automáticamente.")}`;
  }

  function duePurchases(type) {
    return sort(db.purchases.filter((p) => p.type === type && dueOf(p) > 0.005));
  }
  let payTarget = null;

  function sunatPage() {
    const f = edit?.type === "sunat" ? db.sunat.find((x) => x.id === edit.id) : null;
    const items = sort(db.sunat),
      monthItems = items.filter((x) => x.date.startsWith(day.slice(0, 7)));
    return `<div class="metrics">${metric(
      "Impuestos pagados",
      money(
        sum(
          monthItems.filter((x) => x.kind === "tax"),
          (x) => x.amount,
        ),
      ),
    )}${metric(
      "Contador pagado",
      money(
        sum(
          monthItems.filter((x) => x.kind === "accountant"),
          (x) => x.amount,
        ),
      ),
    )}</div>${card(
      f ? "Editar pago" : "Registrar SUNAT / contador",
      `<form data-form="sunat"><div class="fields">${field("Fecha", "date", f?.date || day, "date", "required")}${select(
        "Concepto",
        "kind",
        [
          ["tax", "Impuestos SUNAT"],
          ["accountant", "Contador"],
        ],
        f?.kind || "tax",
      )}${field("Total pagado S/", "amount", f?.amount ?? "", "number", 'min="0.01" step="0.01" required')}${paymentPartsUI(f ? normalizeParts(f) : [])}${field("Nota / periodo", "note", f?.note || "")}${field("Pagado a (opcional)", "person", f?.person || "")}</div><div class="f-actions"><button class="btn primary">${f ? "Actualizar" : "Guardar pago"}</button></div></form>`,
      "Solo efectivo de caja se incluye en el cierre.",
    )}${card(
      "Pagos de SUNAT y contador",
      table(
        ["Fecha", "Concepto", "Medios", "Total", "Acción"],
        items.map(
          (x) =>
            `<tr><td>${nice(x.date)}</td><td>${x.kind === "tax" ? "Impuestos" : "Contador"}</td><td>${esc(paymentSummary(normalizeParts(x)))}</td><td>${money(x.amount)}</td><td>${buttons("sunat", x.id)}</td></tr>`,
        ),
      ),
    )}`;
  }

  function updatePreview() {
    if (page !== "caja") return;
    const f = document.querySelector("#cash-form");
    if (!f) return;
    const vals = Object.fromEntries(["system", "cash", "yape", "pos"].map((k) => [k, f.elements[k]?.value ?? ""]));
    const complete = Object.values(vals).every((x) => x !== "");
    const total = fix(N(vals.cash) + N(vals.yape) + N(vals.pos)),
      rebuilt = fix(total + cashTotal());
    const html = status(fix(rebuilt - N(vals.system)), complete);
    for (const id of ["cash-preview", "cash-mobile"]) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    }
    const t = document.getElementById("cash-summed"),
      r = document.getElementById("cash-rebuilt");
    if (t) t.textContent = money(total);
    if (r) r.textContent = money(rebuilt);
  }
  function updatePurchasePreview() {
    if (!["lena", "general"].includes(page)) return;
    const f = document.querySelector('form[data-form="purchase"]');
    if (!f) return;
    const total = fix(N(f.elements.qty.value) * N(f.elements.unitCost.value));
    const el = document.getElementById("p-total");
    if (el) el.value = money(total);
    updateSplitPreview(f);
  }
  function read(fd, key) {
    return String(fd.get(key) ?? "").trim();
  }
  function date(fd) {
    const d = read(fd, "date");
    if (!dateOK(d)) throw Error("Fecha no válida");
    return d;
  }
  function amount(fd, key, zero = false) {
    const s = read(fd, key),
      x = Number(s);
    if (!s || !Number.isFinite(x) || (zero ? x < 0 : x <= 0)) throw Error("Revisa " + key + ": el monto no es válido.");
    return fix(x);
  }
  function qty(fd, key, zero = false, integer = false) {
    const x = amount(fd, key, zero);
    if (integer && !Number.isSafeInteger(x)) throw Error("La cantidad debe ser un número entero.");
    return x;
  }
  function method(fd) {
    const m = read(fd, "method");
    if (!["cash", "personal", "yape", "bcp_transfer", "bbva", "bbva_transfer", "plin", "transfer"].includes(m))
      throw Error("Selecciona un medio de pago válido.");
    return m;
  }
  function upsert(list, obj, type) {
    const previous = edit?.type === type ? list.find((x) => x.id === edit.id) : null;
    if (previous) Object.assign(previous, obj);
    else list.push({ id: uid(), created: Date.now(), ...obj });
    edit = null;
    payTarget = null;
    paidManuallyChanged = false;
    save();
    render();
    toast(previous ? "Cambios guardados." : "Registro guardado.");
    return previous;
  }

  // Personal y alquiler: el anticipo se paga una vez y se descuenta del compromiso final.
  // Los consumos en especie descuentan deuda, pero no crean una salida de caja ni banco.
  function obligations(mod) {
    return (db.historical || []).filter((x) => x.module === mod && ["advance", "settlement"].includes(x.kind));
  }
  function openAdvances(mod, who, dateEnd) {
    return obligations(mod).filter(
      (x) =>
        x.kind === "advance" &&
        !x.settledBy &&
        (mod === "local" || x.person.toLocaleLowerCase() === who.toLocaleLowerCase()) &&
        x.date <= dateEnd,
    );
  }
  function labelObligation(x) {
    return x.module === "local" ? "Propietario" : x.person;
  }
  function nextPay(x) {
    return x.nextDue || (x.cycle === "15" ? plusDays(x.date, 15) : x.cycle === "30" ? plusDays(x.date, 30) : "");
  }
  function obligationPage(mod) {
    const isStaff = mod === "personal",
      advances = sort(obligations(mod).filter((x) => x.kind === "advance")),
      settlements = sort(obligations(mod).filter((x) => x.kind === "settlement"));
    const staff = Array.from(
      new Set(
        obligations("personal")
          .map((x) => x.person)
          .filter(Boolean),
      ),
    ).sort();
    const pending = advances.filter((x) => !x.settledBy),
      pendingTotal = sum(pending, (x) => x.amount);
    const sel = staff.map((x) => `<option value="${esc(x)}"></option>`).join("");
    const latestByPerson = new Map();
    for (const x of settlements) {
      if (!latestByPerson.has(x.person)) latestByPerson.set(x.person, x);
    }
    const notices = [...latestByPerson.values()].filter(
      (x) => isStaff && nextPay(x) && nextPay(x) <= plusDays(today(), 3),
    );
    const notice = notices.length
      ? `<div class="tabnote" style="border-color:#da9d3d"><b>⏰ Pagos próximos o vencidos:</b> ${notices.map((x) => `${esc(x.person)} · ${nice(nextPay(x))}`).join(" · ")}. Recordatorio dentro de la app; no es una notificación push.</div>`
      : "";
    const formAdv = `<form data-form="obligation-advance" data-module="${mod}"><div class="fields">${field("Fecha", "date", day, "date", "required")}${
      isStaff
        ? `${field("Nombre del trabajador", "person", "", "text", 'list="staff-names" required maxlength="90"')}<datalist id="staff-names">${sel}</datalist>${select(
            "Puesto",
            "position",
            [
              ["hornero", "Hornero"],
              ["cocinero", "Cocinero"],
              ["mesera", "Mesera"],
              ["ayudante", "Ayudante"],
            ],
          )}`
        : ""
    }${
      !isStaff
        ? select("Tipo", "advanceType", [
            ["cash", "Adelanto de dinero"],
            ["product", "Consumo de productos (pollo, etc.)"],
          ])
        : select("Tipo", "advanceType", [
            ["cash", "Adelanto"],
            ["expense", "Gasto del trabajador"],
          ])
    }${field("Monto a descontar (S/)", "amount", "", "number", 'min="0.01" step="0.01" required')}${field("Descripción", "note", "", "text", 'maxlength="150"')}${paymentPartsUI([], "pay")}</div><div class="tabnote">Si se trata de un consumo de productos entregados al dueño del local, deja todos los medios de pago en cero. Se descontará del alquiler, pero no saldrá dinero de caja ni banco.</div><button class="btn primary" type="submit">Registrar adelanto</button></form>`;
    const formPay = `<form data-form="obligation-pay" data-module="${mod}"><div class="fields">${field("Fecha del pago", "date", day, "date", "required")}${
      isStaff
        ? `${field("Nombre del trabajador", "person", "", "text", 'list="staff-names" required maxlength="90"')}${select(
            "Puesto",
            "position",
            [
              ["hornero", "Hornero"],
              ["cocinero", "Cocinero"],
              ["mesera", "Mesera"],
              ["ayudante", "Ayudante"],
            ],
          )}`
        : ""
    }${field(isStaff ? "Sueldo correspondiente a este pago (antes de adelantos)" : "Alquiler del mes (antes de adelantos)", "gross", "", "number", 'min="0.01" step="0.01" required')}${
      isStaff
        ? select(
            "Próximo pago / recordatorio",
            "cycle",
            [
              ["15", "En 15 días"],
              ["30", "En 30 días"],
              ["none", "Sin fecha automática"],
            ],
            "15",
          )
        : select(
            "Próximo pago / recordatorio",
            "cycle",
            [
              ["30", "En 30 días"],
              ["none", "Sin fecha automática"],
            ],
            "30",
          )
    }${field("Adelantos pendientes a descontar (automático)", "deduct", "0.00", "number", "readonly")}${field("Importe neto a entregar (automático)", "amount", "0.00", "number", "readonly")}${paymentPartsUI([], "pay")}</div><div class="tabnote">Se aplicarán los adelantos pendientes de este trabajador ${isStaff ? "" : "o del local"} hasta la fecha elegida. Si hay más adelantos que el importe correspondiente, se impedirá el pago; primero revisa los adelantos.</div><button class="btn primary" type="submit">Registrar pago neto</button></form>`;
    const advanceRows = advances.map(
      (x) =>
        `<tr><td>${nice(x.date)}</td><td>${esc(labelObligation(x))}</td><td>${esc(x.note || x.advanceType)}</td><td>${money(x.amount)}</td><td>${x.settledBy ? "✓ Descontado" : "Pendiente"}</td><td>${!x.settledBy ? `<button class="action-link red" data-act="obligation-delete" data-id="${esc(x.id)}">Eliminar</button>` : "—"}</td></tr>`,
    );
    const payRows = settlements.map(
      (x) =>
        `<tr><td>${nice(x.date)}</td><td>${esc(labelObligation(x))}</td><td>${money(x.gross)}</td><td>${money(x.deducted)}</td><td><b>${money(x.amount)}</b></td><td>${esc(paymentSummary(x.paymentParts || []))}${isStaff && nextPay(x) ? `<div class="small">Próximo: ${nice(nextPay(x))}</div>` : ""}</td><td><button class="action-link red" data-act="obligation-delete" data-id="${esc(x.id)}">Anular</button></td></tr>`,
    );
    return `${notice}<div class="metrics">${metric("Adelantos pendientes", money(pendingTotal))}${metric(isStaff ? "Trabajadores" : "Pagos realizados", isStaff ? String(staff.length) : String(settlements.length))}</div><div class="layout-grid"><div>${card(isStaff ? "1. Adelantos y gastos del personal" : "1. Adelantos y consumos del propietario", formAdv, "Se registran por fecha. No se vuelven a cobrar al hacer el pago.")}</div><div>${card(isStaff ? "2. Pago de personal" : "2. Pago mensual del local", formPay, "Ingresa el importe del período; el neto se calcula solo.")}</div></div>${card("Adelantos y descuentos", table(["Fecha", "Persona", "Concepto", "Importe", "Estado", "Acción"], advanceRows))}${card("Historial de pagos", table(["Fecha", "Persona", "Importe base", "Adelantos", "Entregado", "Medios de pago", "Acción"], payRows))}`;
  }
  function refreshObligation(form) {
    if (!form || form.dataset.form !== "obligation-pay") return;
    const mod = form.dataset.module,
      who = String(form.elements.person?.value || "").trim(),
      dateValue = form.elements.date?.value || day,
      gross = N(form.elements.gross?.value);
    const d = dateOK(dateValue) ? dateValue : day;
    const deductions = sum(openAdvances(mod, who, d), (x) => x.amount),
      net = fix(gross - deductions);
    form.elements.deduct.value = deductions.toFixed(2);
    form.elements.amount.value = net >= 0 ? net.toFixed(2) : "0.00";
    updateSplitPreview(form);
  }

  // El personal solo registra o corrige hoy y ayer; lo anterior lo cambia el administrador.
  // (La base de datos aplica la misma regla: dchicken_staff_date_ok.)
  function staffLocked(d) {
    if (!window.DChickenCloud?.isActive() || window.DChickenCloud.isAdmin()) return false;
    return !d || d < plusDays(today(), -1);
  }
  function guardDate(d, what = "este registro") {
    if (staffLocked(d))
      throw Error("Solo el administrador puede cambiar " + what + " de días anteriores (" + nice(d) + ").");
  }
  const whoAmI = () => window.DChickenCloud?.userLabel?.() || "";
  function submit(e) {
    const f = e.target.closest("form[data-form]");
    if (!f) return;
    e.preventDefault();
    if (f.dataset.saving === "yes") return;
    const fd = new FormData(f);
    try {
      if (f.dataset.form === "quick-expense" && !allowedPage("gastos"))
        throw Error("No tienes acceso para registrar gastos.");
      switch (f.dataset.form) {
        case "sales": {
          if (!allowedPage("ventas")) throw Error("No tienes acceso a Ventas.");
          guardDate(date(fd), "las ventas");
          saveSale(fd);
          break;
        }
        case "staff-permissions": {
          if (!window.DChickenCloud?.isActive() || !window.DChickenCloud.isAdmin())
            throw Error("Solo el administrador configura permisos.");
          const allowed = STAFF_PAGE_OPTIONS.filter(([k]) => !!f.elements["perm_" + k]?.checked).map(([k]) => k);
          f.dataset.saving = "yes";
          window.DChickenCloud.saveStaffPermissions(allowed)
            .then(() => {
              render();
              toast("Permisos actualizados.");
            })
            .catch((err) => toast("No se guardaron los permisos: " + (err.message || err), true))
            .finally(() => {
              delete f.dataset.saving;
            });
          break;
        }
        case "alert-settings": {
          if (window.DChickenCloud?.isActive() && !window.DChickenCloud.isAdmin())
            throw Error("Solo el administrador puede definir los límites.");
          const raw = read(fd, "chickenMin"),
            threshold = raw === "" ? 0 : Number(raw);
          if (!Number.isSafeInteger(threshold) || threshold < 0 || threshold > 100000)
            throw Error("Indica una cantidad válida de pollos.");
          const entry = db.alertSettings.find((x) => x.id === "main");
          if (entry) entry.chickenMin = threshold;
          else db.alertSettings.push({ id: "main", chickenMin: threshold, created: Date.now() });
          save();
          render();
          toast("Límite de stock guardado.");
          break;
        }
        case "obligation-advance": {
          const module = f.dataset.module;
          if (!["personal", "local"].includes(module)) throw Error("Apartado inválido.");
          const d = date(fd),
            person = module === "personal" ? read(fd, "person").slice(0, 90) : "Propietario";
          if (!person) throw Error("Indica el nombre del trabajador.");
          const kind = read(fd, "advanceType"),
            total = amount(fd, "amount");
          const product = module === "local" && kind === "product";
          const parts = product ? [] : splitFrom(fd, total);
          db.historical.push({
            id: uid(),
            date: d,
            module,
            kind: "advance",
            advanceType: kind,
            person,
            position: read(fd, "position"),
            note: read(fd, "note").slice(0, 150),
            amount: total,
            paymentParts: parts,
            created: Date.now(),
          });
          save();
          render();
          toast("Adelanto registrado. Se descontará una sola vez.");
          break;
        }
        case "obligation-pay": {
          const module = f.dataset.module;
          if (!["personal", "local"].includes(module)) throw Error("Apartado inválido.");
          const d = date(fd),
            person = module === "personal" ? read(fd, "person").slice(0, 90) : "Propietario";
          if (!person) throw Error("Indica el trabajador.");
          const gross = amount(fd, "gross"),
            pending = openAdvances(module, person, d),
            deducted = sum(pending, (x) => x.amount),
            net = fix(gross - deducted);
          if (net < -0.005) throw Error("Los adelantos superan el importe base. Corrige los importes antes de pagar.");
          const parts = splitFrom(fd, Math.max(0, net), "pay", true);
          if (net > 0 && Math.abs(sum(parts, (x) => x.amount) - net) > 0.005)
            throw Error("Los pagos no coinciden con el importe neto.");
          const recordId = uid();
          db.historical.push({
            id: recordId,
            date: d,
            module,
            kind: "settlement",
            person,
            position: read(fd, "position"),
            gross,
            deducted,
            amount: net,
            paymentParts: parts,
            appliedAdvances: pending.map((x) => x.id),
            cycle: read(fd, "cycle"),
            created: Date.now(),
          });
          pending.forEach((x) => (x.settledBy = recordId));
          save();
          render();
          toast("Pago guardado y adelantos saldados sin duplicar salidas.");
          break;
        }
        case "closure": {
          guardDate(day, "el cierre de caja");
          const obj = {
            date: day,
            system: amount(fd, "system", true),
            cash: amount(fd, "cash", true),
            yape: amount(fd, "yape", true),
            pos: amount(fd, "pos", true),
            note: read(fd, "note").slice(0, 140),
          };
          const prev = closureOf();
          if (prev) Object.assign(prev, obj);
          else db.closures.push({ ...obj, created: Date.now() });
          save();
          render();
          toast("Cierre guardado.");
          break;
        }
        case "shopping-add": {
          const raw = read(fd, "raw");
          if (!raw) throw Error("Pega al menos un artículo.");
          const entries = parseWhatsApp(raw);
          if (!entries.length) throw Error("La lista está vacía.");
          if (entries.length > 100) throw Error("Máximo 100 artículos por vez.");
          for (const x of entries)
            db.shoppingLists.push({
              id: uid(),
              date: shoppingDay,
              product: x.product,
              qty: x.qty,
              unit: x.unit,
              note: "",
              created: Date.now(),
            });
          save();
          render();
          toast(entries.length + " artículos agregados a la lista.");
          break;
        }

        case "shopping-buy": {
          const item = db.shoppingLists.find((x) => x.id === read(fd, "shoppingId"));
          if (!item) throw Error("El producto ya no está en la lista.");
          const count = qty(fd, "qty"),
            remaining = shoppingRemaining(item),
            cost = amount(fd, "total"),
            parts = splitFrom(fd, cost);
          if (count > remaining + 0.000001) throw Error("Solo faltan " + remaining + " " + item.unit + ".");
          const dateBought = date(fd);
          db.purchases.push({
            id: uid(),
            date: dateBought,
            type: "general",
            product: item.product,
            qty: count,
            unitCost: Number((cost / count).toFixed(6)),
            total: cost,
            person: read(fd, "person").slice(0, 100),
            note: read(fd, "note").slice(0, 140),
            shoppingId: item.id,
            paymentParts: parts,
            created: Date.now(),
          });
          shoppingPick = null;
          save();
          render();
          toast("Compra registrada con " + parts.length + " forma(s) de pago.");
          break;
        }

        case "shopping-buy-group": {
          const ids = read(fd, "ids").split(",").filter(Boolean);
          const items = ids
            .map((id) => db.shoppingLists.find((x) => x.id === id))
            .filter((x) => x && shoppingRemaining(x) > 0.000001);
          if (!items.length) throw Error("Selecciona al menos un producto pendiente.");
          if (items.length !== ids.length) throw Error("Algún producto ya se compró o se quitó. Revisa la selección.");
          const cost = amount(fd, "total"),
            parts = splitFrom(fd, cost),
            dateBought = date(fd);
          let product = (items.length > 1 ? items.length + " productos: " : "") + items.map((x) => x.product).join(", ");
          if (product.length > 100) product = product.slice(0, 99) + "…";
          db.purchases.push({
            id: uid(),
            date: dateBought,
            type: "general",
            product,
            qty: 1,
            unitCost: cost,
            total: cost,
            person: read(fd, "person").slice(0, 100),
            note: read(fd, "note").slice(0, 140),
            shoppingItems: items.map((x) => ({
              id: x.id,
              product: x.product,
              qty: shoppingRemaining(x),
              unit: x.unit || "und",
            })),
            paymentParts: parts,
            created: Date.now(),
          });
          shoppingSel.clear();
          shoppingGroup = false;
          shoppingPick = null;
          save();
          render();
          toast(items.length + " productos registrados en una sola compra de " + money(cost) + ".");
          break;
        }

        case "market-open": {
          if (window.DChickenCloud?.isActive() && !window.DChickenCloud.isAdmin())
            throw Error("Solo el administrador cambia el fondo.");
          const v = amount(fd, "amount", true),
            d = date(fd);
          const current = marketStart();
          if (current) {
            current.date = d;
            current.amount = v;
          } else db.bankSettings.push({ id: "market", date: d, amount: v, created: Date.now() });
          save();
          render();
          toast("Saldo inicial del mercado actualizado.");
          break;
        }
        case "market-fund": {
          if (window.DChickenCloud?.isActive() && !window.DChickenCloud.isAdmin())
            throw Error("Solo el administrador mueve fondos.");
          const bank = read(fd, "bank");
          if (!["bcp", "bbva"].includes(bank)) throw Error("Cuenta de origen no válida.");
          const amt = amount(fd, "amount"),
            d = date(fd);
          db.bankTransactions.push({
            id: uid(),
            date: d,
            type: "market_fund",
            bank,
            otherBank: bank === "bcp" ? "bbva" : "bcp",
            amount: amt,
            note: read(fd, "note").slice(0, 140),
            created: Date.now(),
          });
          save();
          render();
          toast("Se transfirió " + money(amt) + " del " + bankName[bank] + " al fondo de compras.");
          break;
        }

        case "quick-expense":
        case "expense": {
          guardDate(date(fd), "gastos");
          if (edit?.type === "expense") guardDate(db.expenses.find((x) => x.id === edit.id)?.date, "gastos");
          const concept = read(fd, "concept").slice(0, 120);
          if (!concept) throw Error("Indica el concepto.");
          const total = amount(fd, "amount");
          const parts = splitFrom(fd, total);
          upsert(
            db.expenses,
            {
              date: date(fd),
              concept,
              person: read(fd, "person").slice(0, 100),
              amount: total,
              paymentParts: parts,
              method: "mixed",
              note: read(fd, "note").slice(0, 140),
            },
            "expense",
          );
          if (f.dataset.form === "quick-expense") {
            quickOpen = false;
            render();
            toast("Gasto rápido guardado.");
          }
          break;
        }
        case "chicken-stock": {
          const d = date(fd),
            stock = qty(fd, "stockInitial", true, true);
          guardDate(d, "el stock");
          let x = db.chickens.find((c) => c.date === d);
          const hasBase = db.chickens.some((c) => c.stockInitial !== undefined && c.date < d) || chickenPurchases().some((p) => p.date < d);
          const expected = expectedStart(d),
            diff = hasBase ? fix(stock - expected) : 0,
            reason = read(fd, "countReason").slice(0, 140);
          if (Math.abs(diff) > 0.005 && !reason)
            throw Error(
              "Contaste " + stock + " pero deberían haber " + fix(expected) + ". Escribe el motivo de la diferencia.",
            );
          const newer = db.chickens.some((c) => c.date > d && c.stockInitial !== undefined);
          if (newer)
            throw Error("Hay un stock inicial registrado en una fecha posterior; corrige primero ese registro.");
          if (!x) {
            x = { date: d, sold: 0, entered: 0, created: Date.now() };
            db.chickens.push(x);
          }
          x.stockInitial = stock;
          if (Math.abs(diff) > 0.005) {
            x.countDiff = diff;
            x.countReason = reason;
            x.countBy = whoAmI();
          } else {
            delete x.countDiff;
            delete x.countReason;
            delete x.countBy;
          }
          save();
          render();
          toast("Stock inicial guardado; se arrastra automáticamente.");
          break;
        }
        case "chicken-sales": {
          const d = date(fd),
            sold = amount(fd, "sold", true);
          guardDate(d, "las ventas de pollos");
          if (soldFromSales(d))
            throw Error("Ese día ya tiene Ventas por producto: los pollos vendidos se calculan desde ahí.");
          let x = db.chickens.find((c) => c.date === d);
          const prevSold = N(x?.sold),
            available = fix(chickenBalance(d) + prevSold);
          if (sold > available + 0.005)
            throw Error(
              "Ventas " +
                sold +
                " superan el stock disponible " +
                available +
                ". Registra las compras o revisa el stock inicial.",
            );
          if (!x) {
            x = { date: d, entered: 0, created: Date.now() };
            db.chickens.push(x);
          }
          const stockBefore = stockSnapshot([d]);
          x.sold = prevSold;
          x.sold = sold;
          if (stockWorse(stockBefore)) {
            x.sold = prevSold;
            throw Error("Esa venta dejaría inventario negativo en un día posterior.");
          }
          save();
          render();
          toast("Ventas guardadas. Stock actualizado.");
          break;
        }
        case "chicken-waste": {
          const d = date(fd),
            n = amount(fd, "qty"),
            reason = read(fd, "reason");
          guardDate(d, "la merma");
          if (!WASTE_REASONS.some(([k]) => k === reason)) throw Error("Elige el motivo de la merma.");
          if (n > chickenBalance(d) + 0.005)
            throw Error("No hay " + n + " pollos disponibles ese día. Revisa el stock o las compras.");
          let x = db.chickens.find((c) => c.date === d);
          if (!x) {
            x = { date: d, entered: 0, created: Date.now() };
            db.chickens.push(x);
          }
          (x.waste ||= []).push({
            id: uid(),
            qty: n,
            reason,
            note: read(fd, "note").slice(0, 140),
            by: whoAmI(),
            created: Date.now(),
          });
          save();
          render();
          toast("Merma registrada: " + n + " pollo(s) · " + wasteLabel(reason) + ".");
          break;
        }
        case "simple-purchase": {
          const type = f.dataset.type;
          if (!["pollo", "gaseosa"].includes(type)) throw Error("Tipo de compra inválido");
          const amountQty = qty(fd, "qty", false, type === "pollo"),
            total = amount(fd, "total"),
            d = date(fd);
          const product = type === "pollo" ? "Pollos a la brasa" : read(fd, "product").slice(0, 100);
          if (!product) throw Error("Indica qué gaseosa compraste.");
          const old = edit?.type === "purchase" ? db.purchases.find((x) => x.id === edit.id && x.type === type) : null;
          const legacyOld = old && !Array.isArray(old.paymentParts) && paymentsOf(old.id).length > 0;
          const parts = legacyOld ? null : splitFrom(fd, total);
          if (legacyOld && total + 0.005 < paidOf(old.id))
            throw Error("El nuevo total es menor que los pagos anteriores.");
          const obj = {
            date: d,
            type,
            product,
            qty: amountQty,
            total,
            unitCost: Number((total / amountQty).toFixed(6)),
            person: "",
            note: read(fd, "note").slice(0, 140),
          };
          if (!legacyOld) obj.paymentParts = parts;
          const oldSnapshot = old ? structuredClone(old) : null;
          const stockBefore = type === "pollo" ? stockSnapshot([d]) : null;
          let newId = null;
          if (old) {
            if (N(sum(old.additionalParts || [], (x) => x.amount)) > 0)
              throw Error("Esta compra tiene abonos adicionales; revisa los pagos antes de cambiarla.");
            Object.assign(old, obj);
          } else {
            newId = uid();
            db.purchases.push({ id: newId, ...obj, created: Date.now() });
          }
          if (
            type === "pollo" &&
            stockWorse(stockBefore)
          ) {
            if (old) Object.assign(old, oldSnapshot);
            else db.purchases = db.purchases.filter((p) => p.id !== newId);
            throw Error("Esta corrección dejaría el stock negativo.");
          }
          edit = null;
          save();
          render();
          toast("Compra guardada y conectada con Gastos y Bancos.");
          break;
        }
        case "purchase": {
          const type = f.dataset.type;
          if (!["lena", "general"].includes(type)) throw Error("Sección no válida");
          const product = read(fd, "product").slice(0, 100);
          if (!product) throw Error("Escribe el producto.");
          const amountQty = qty(fd, "qty"),
            unitCost = amount(fd, "unitCost"),
            total = fix(amountQty * unitCost);
          if (total <= 0) throw Error("El total debe ser mayor a cero.");
          const prior = edit?.type === "purchase" ? db.purchases.find((x) => x.id === edit.id) : null;
          if (prior && total + 0.005 < fix(paidOf(prior.id) - sum(prior.paymentParts || [], (x) => x.amount)))
            throw Error("El total no puede ser menor a abonos anteriores.");
          const obj = {
            date: date(fd),
            type,
            product,
            qty: amountQty,
            unitCost,
            total,
            person: read(fd, "person").slice(0, 100),
            note: read(fd, "note").slice(0, 140),
          };
          if (prior) {
            if (Array.isArray(prior.paymentParts)) obj.paymentParts = splitFrom(fd, total);
            Object.assign(prior, obj);
          } else {
            obj.paymentParts = splitFrom(fd, total);
            db.purchases.push({ id: uid(), created: Date.now(), ...obj });
          }
          edit = null;
          payTarget = null;
          save();
          render();
          toast("Compra y pago guardados.");
          break;
        }
        case "payment": {
          const prior = edit?.type === "payment" ? db.payments.find((x) => x.id === edit.id) : null;
          const purchaseId = prior?.purchaseId || read(fd, "purchaseId"),
            p = purchaseBy(purchaseId);
          if (!p) throw Error("Selecciona una compra válida.");
          const value = amount(fd, "amount"),
            parts = splitFrom(fd, value);
          const available = fix(p.total - paidOf(p.id) + (prior ? prior.amount : 0));
          if (value > available + 0.005) throw Error("El pago supera el saldo disponible: " + money(available));
          if (prior) {
            Object.assign(prior, {
              date: date(fd),
              amount: value,
              method: "mixed",
              parts,
              note: read(fd, "note").slice(0, 140),
            });
          } else {
            const d = date(fd);
            p.additionalParts = [...(p.additionalParts || []), ...parts.map((x) => ({ ...x, date: d }))];
          }
          edit = null;
          payTarget = null;
          save();
          render();
          toast("Abono guardado sin duplicar gastos.");
          break;
        }

        case "banksettings": {
          if (window.DChickenCloud?.isActive() && !window.DChickenCloud.isAdmin())
            throw Error("Solo el administrador puede editar los saldos bancarios.");
          for (const bank of ["bcp", "bbva"]) {
            const d = read(fd, "start_" + bank),
              value = amount(fd, "initial_" + bank, true);
            if (!dateOK(d)) throw Error("Fecha inicial inválida.");
            let x = initialFor(bank);
            if (x) {
              x.date = d;
              x.amount = value;
            } else db.bankSettings.push({ id: bank, date: d, amount: value, created: Date.now() });
          }
          save();
          render();
          toast("Saldos iniciales guardados en la nube.");
          break;
        }
        case "banktxn": {
          if (window.DChickenCloud?.isActive() && !window.DChickenCloud.isAdmin())
            throw Error("Solo el administrador puede editar cuentas bancarias.");
          const type = read(fd, "type"),
            bank = read(fd, "bank"),
            otherBank = read(fd, "otherBank");
          if (
            !["deposit", "withdrawal", "transfer", "market_fund"].includes(type) ||
            !["bcp", "bbva"].includes(bank) ||
            !["bcp", "bbva"].includes(otherBank)
          )
            throw Error("Revisa las cuentas y tipo de movimiento.");
          if (type === "transfer" && bank === otherBank)
            throw Error("La cuenta destino debe ser diferente a la cuenta origen.");
          upsert(
            db.bankTransactions,
            {
              date: date(fd),
              type,
              bank,
              otherBank,
              amount: amount(fd, "amount"),
              note: read(fd, "note").slice(0, 160),
            },
            "banktxn",
          );
          break;
        }
        case "sunat": {
          const kind = read(fd, "kind");
          if (!["tax", "accountant"].includes(kind)) throw Error("Concepto no válido");
          const total = amount(fd, "amount");
          upsert(
            db.sunat,
            {
              date: date(fd),
              kind,
              amount: total,
              method: "mixed",
              paymentParts: splitFrom(fd, total),
              person: read(fd, "person").slice(0, 100),
              note: read(fd, "note").slice(0, 140),
            },
            "sunat",
          );
          break;
        }
      }
    } catch (err) {
      toast(err.message || "No se pudo guardar", true);
    }
  }
  function getTable(type) {
    return {
      expense: "expenses",
      purchase: "purchases",
      payment: "payments",
      sunat: "sunat",
      banktxn: "bankTransactions",
    }[type];
  }
  function pageForItem(source, id) {
    if (source === "obligation") {
      const rec = (db.historical || []).find((x) => x.id === id);
      return { page: rec?.module || "gastos" };
    }
    if (source === "gasto") return { page: "gastos", edit: { type: "expense", id } };
    if (source === "pollo") return { page: "pollos", date: id };
    if (source === "sunat") return { page: "sunat", edit: { type: "sunat", id } };
    if (source === "payment") {
      const p = purchaseBy(db.payments.find((x) => x.id === id)?.purchaseId);
      return { page: p?.type || "gastos", edit: { type: "payment", id } };
    }
    if (source === "purchase" || source === "purchase-extra") {
      const p = purchaseBy(id);
      return { page: p?.type || "general", edit: { type: "purchase", id } };
    }
    return { page: "gastos" };
  }
  function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    switch (act) {
      case "theme":
        theme = theme === "dark" ? "light" : "dark";
        localStorage.setItem(THEME_KEY, theme);
        document.documentElement.dataset.theme = theme;
        paintTheme();
        render();
        toast("Tema " + (theme === "dark" ? "oscuro" : "claro") + " activado.");
        break;
      case "obligation-delete": {
        const id = b.dataset.id,
          r = (db.historical || []).find((x) => x.id === id && ["personal", "local"].includes(x.module));
        if (!r) return;
        if (window.DChickenCloud?.isActive() && !window.DChickenCloud.isAdmin())
          return toast("Solo el administrador puede anular pagos o adelantos.", true);
        if (r.kind === "advance" && r.settledBy) return toast("Primero anula el pago que utilizó este adelanto.", true);
        if (!confirm("¿Anular este registro? Los saldos y descuentos se recalcularán.")) return;
        if (r.kind === "settlement")
          (r.appliedAdvances || []).forEach((key) => {
            const x = db.historical.find((a) => a.id === key);
            if (x && x.settledBy === r.id) delete x.settledBy;
          });
        db.historical = db.historical.filter((x) => x.id !== id);
        save();
        render();
        toast("Registro anulado.");
        break;
      }
      case "pay-fill": {
        const form = b.closest("form");
        if (!form) return;
        const total =
          form.dataset.form === "purchase"
            ? fix(N(form.elements.qty?.value) * N(form.elements.unitCost?.value))
            : N(form.elements.total?.value ?? form.elements.amount?.value ?? 0);
        if (total <= 0) {
          toast("Primero escribe el total.", true);
          return;
        }
        for (const p of paymentChoices) {
          const el = form.elements["pay_" + p.name];
          if (el) el.value = p.name === "cash_register" ? total.toFixed(2) : "";
        }
        updateSplitPreview(form);
        break;
      }
      case "shop-sel": {
        const id = b.dataset.id;
        if (shoppingSel.has(id)) shoppingSel.delete(id);
        else shoppingSel.add(id);
        if (shoppingGroup) {
          if (!shoppingSel.size) shoppingGroup = false;
          render();
          break;
        }
        const on = shoppingSel.has(id);
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
        b.closest(".shopping-item")?.classList.toggle("sel", on);
        const bar = document.getElementById("shop-groupbar");
        if (bar) {
          bar.hidden = !shoppingSel.size;
          bar.innerHTML = groupBarHTML(shoppingSel.size);
        }
        break;
      }
      case "shop-group":
        if (!shoppingSel.size) return toast("Marca primero los productos que pagaste juntos.", true);
        shoppingGroup = true;
        shoppingPick = null;
        render();
        document
          .querySelector('form[data-form="shopping-buy-group"]')
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
        break;
      case "shop-group-cancel":
        shoppingGroup = false;
        render();
        break;
      case "shop-pick":
        shoppingPick = b.dataset.id;
        shoppingGroup = false;
        render();
        document
          .querySelector('form[data-form="shopping-buy"]')
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
        break;
      case "shop-cancel":
        shoppingPick = null;
        render();
        break;
      case "shop-delete": {
        const id = b.dataset.id;
        const item = db.shoppingLists.find((x) => x.id === id);
        if (!item) return;
        if (shoppingPurchased(item) > 0)
          return toast("Este artículo tiene compras registradas. Para corregirlas, revisa Historial compras.", true);
        if (!confirm("Quitar " + item.product + " de la lista de compras?")) return;
        db.shoppingLists = db.shoppingLists.filter((x) => x.id !== id);
        shoppingSel.delete(id);
        shoppingPick = null;
        save();
        render();
        toast("Artículo eliminado de la lista.");
        break;
      }
      case "quick-open":
        if (!allowedPage("gastos")) return toast("No tienes acceso a Gastos.", true);
        quickOpen = true;
        render();
        setTimeout(() => document.querySelector(".quick-dialog input[name=concept]")?.focus(), 40);
        break;
      case "quick-close":
        quickOpen = false;
        render();
        break;
      case "page":
        if (!allowedPage(b.dataset.page)) return toast("No tienes permiso para abrir esta sección.", true);
        quickOpen = false;
        page = b.dataset.page;
        edit = null;
        payTarget = null;
        render();
        window.scrollTo(0, 0);
        break;
      case "jump-day":
        day = b.dataset.date;
        page = page === "panel" ? "caja" : page;
        edit = null;
        render();
        window.scrollTo(0, 0);
        break;
      case "pay-purchase":
        payTarget = b.dataset.id;
        edit = null;
        render();
        document.querySelector('form[data-form="payment"]')?.scrollIntoView({ block: "center" });
        break;
      case "cancel-edit":
        edit = null;
        payTarget = null;
        render();
        break;
      case "goto-item": {
        const info = pageForItem(b.dataset.source, b.dataset.id);
        page = info.page;
        edit = info.edit || null;
        if (info.date) day = info.date;
        const rec = edit && db[getTable(edit.type)]?.find((x) => x.id === edit.id);
        if (rec?.date) day = rec.date;
        render();
        window.scrollTo(0, 0);
        break;
      }
      case "edit": {
        const recPre = db[getTable(b.dataset.type)]?.find((x) => x.id === b.dataset.id);
        if (b.dataset.type === "expense" && staffLocked(recPre?.date))
          return toast("Solo el administrador puede cambiar gastos de días anteriores.", true);
        edit = { type: b.dataset.type, id: b.dataset.id };
        const rec = db[getTable(edit.type)]?.find((x) => x.id === edit.id);
        if (edit.type === "banktxn") page = "bancos";
        if (edit.type === "expense") page = "gastos";
        if (edit.type === "sunat") page = "sunat";
        if (edit.type === "purchase") page = rec?.type || "general";
        if (edit.type === "payment") page = purchaseBy(rec?.purchaseId)?.type || "general";
        if (rec?.date) day = rec.date;
        render();
        window.scrollTo(0, 0);
        break;
      }
      case "audit-filter":
        audit.onlyLate = b.dataset.v === "late";
        render();
        break;
      case "audit-reload":
        audit.rows = null;
        audit.error = "";
        render();
        break;
      case "waste-delete": {
        const c = db.chickens.find((x) => x.date === b.dataset.date);
        if (!c?.waste) return;
        if (staffLocked(c.date)) return toast("Solo el administrador puede anular merma de días anteriores.", true);
        if (!confirm("¿Anular este registro de merma?")) return;
        c.waste = c.waste.filter((w) => w.id !== b.dataset.id);
        if (!c.waste.length) delete c.waste;
        save();
        render();
        toast("Merma anulada.");
        break;
      }
      case "delete": {
        if (window.DChickenCloud?.isActive() && !window.DChickenCloud?.isAdmin())
          return toast("Solo un administrador puede eliminar registros compartidos.", true);
        const type = b.dataset.type,
          id = b.dataset.id,
          tab = getTable(type);
        if (!tab) return;
        if (type === "banktxn" && window.DChickenCloud?.isActive() && !window.DChickenCloud?.isAdmin())
          return toast("Solo administrador puede anular movimientos bancarios.", true);
        if (type === "purchase" && db.payments.some((x) => x.purchaseId === id))
          return toast("Esta compra tiene pagos anteriores: elimínalos primero.", true);
        if (
          type === "purchase" &&
          db.purchases.find((x) => x.id === id)?.type === "pollo" &&
          db.chickens
            .filter((x) => x.date >= db.purchases.find((p) => p.id === id)?.date)
            .some((x) => chickenBalance(x.date) - N(db.purchases.find((p) => p.id === id)?.qty) < -0.005)
        )
          return toast("Eliminar esta compra dejaría el stock de pollos negativo.", true);
        if (!confirm("¿Eliminar este registro? Se actualizarán los gastos y la caja.")) return;
        db[tab] = db[tab].filter((x) => x.id !== id);
        edit = null;
        save();
        render();
        toast("Registro eliminado.");
        break;
      }
      case "delete-closure": {
        if (window.DChickenCloud?.isActive() && !window.DChickenCloud?.isAdmin())
          return toast("Solo un administrador puede eliminar cierres compartidos.", true);
        const date = b.dataset.date;
        if (!confirm("¿Eliminar cierre del " + nice(date) + "? Se conservarán gastos, pollos y compras.")) return;
        db.closures = db.closures.filter((x) => x.date !== date);
        day = date;
        page = "caja";
        save();
        render();
        toast("Cierre eliminado. Los gastos continúan guardados.");
        break;
      }
      case "delete-chicken": {
        if (window.DChickenCloud?.isActive() && !window.DChickenCloud?.isAdmin())
          return toast("Solo un administrador puede eliminar inventarios compartidos.", true);
        if (!confirm("¿Eliminar ingreso, venta y pago de pollos del " + nice(b.dataset.date) + "?")) return;
        db.chickens = db.chickens.filter((x) => x.date !== b.dataset.date);
        save();
        render();
        toast("Registro de pollos eliminado.");
        break;
      }
      case "cloud":
        window.DChickenCloud?.open();
        break;
      case "monthly-csv":
        exportMonth();
        break;
      case "backup":
        backup();
        break;
      case "restore":
        document.getElementById("restore-file")?.click();
        break;
    }
  }
  function download(name, data, mime) {
    const blob = new Blob([data], { type: mime }),
      u = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = u;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1500);
  }
  function exportMonth() {
    const csvRow = (xs) =>
      xs
        .map((x) => {
          let s = String(x ?? "");
          if (/^[\s]*[=+@\-]/.test(s)) s = "'" + s;
          return '"' + s.replaceAll('"', '""') + '"';
        })
        .join(";");
    const cl = sort(db.closures.filter((x) => inMonth(x))).map((x) => [
      x.date,
      "Venta del sistema",
      "Caja",
      "",
      x.system,
      "",
      closeDiff(x, x.date),
    ]);
    const led = sort(expenseMonth()).map((x) => [
      x.date,
      "Pago " + (catLabel[x.category] || x.category),
      payLabel(x.method),
      x.detail,
      x.amount,
      x.person || "",
      "",
    ]);
    const bank = bankEntries()
      .filter((x) => inMonth(x))
      .map((x) => [x.date, "Movimiento " + bankName[x.bank], x.origin, x.label, x.amount, "", ""]);
    const rows = [
      ["Fecha", "Tipo", "Medio", "Detalle", "Monto S/", "Destinatario", "Diferencia caja S/"],
      ...cl,
      ...led,
      ...bank,
    ];
    const txt = "\ufeff" + rows.map(csvRow).join("\r\n");
    download("dchicken-reporte-" + month + ".csv", txt, "text/csv;charset=utf-8");
    toast("Reporte CSV del mes descargado.");
  }
  function backup() {
    download(
      "dchicken-express-respaldo-" + today() + ".json",
      JSON.stringify(db, null, 2),
      "application/json;charset=utf-8",
    );
    try {
      localStorage.setItem(BACKUP_KEY, today());
    } catch (e) {}
    toast("Respaldo descargado. Súbelo a Drive o envíatelo por correo.");
    render();
  }
  function onChange(e) {
    if (e.target.closest('form[data-form="obligation-pay"]')) {
      refreshObligation(e.target.closest("form"));
      return;
    }
    if (e.target.id === "shopping-day") {
      shoppingDay = e.target.value || plusDays(today(), 1);
      shoppingPick = null;
      shoppingGroup = false;
      shoppingSel.clear();
      render();
      return;
    }
    if (e.target.id === "app-day") {
      day = e.target.value || today();
      edit = null;
      render();
      return;
    }
    if (e.target.id === "app-month") {
      month = e.target.value || today().slice(0, 7);
      render();
      return;
    }
    if (e.target.id === "restore-file") {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) return toast("El respaldo es demasiado grande (máximo 10 MB).", true);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const d = JSON.parse(reader.result);
          const incoming = valid(d) ? d : migrateOld(d);
          if (window.DChickenCloud?.isActive() && !window.DChickenCloud.isAdmin()) {
            toast("Solo un administrador puede restaurar en el negocio compartido.", true);
            return;
          }
          if (
            !confirm(
              window.DChickenCloud?.isActive()
                ? "¡ATENCIÓN! Restaurar este respaldo en la nube reemplazará todos los registros actuales del negocio, incluso los de otros usuarios. ¿Continuar?"
                : "Restaurar reemplazará todos los datos de esta versión guardados en este navegador. ¿Continuar?",
            )
          )
            return;
          db = { ...blank(), ...incoming };
          edit = null;
          save();
          render();
          toast("Respaldo restaurado.");
        } catch (err) {
          toast("Respaldo no compatible o dañado.", true);
        }
      };
      reader.readAsText(f);
    }
  }
  function updateSplitPreview(form) {
    if (!form) return;
    paySync(form);
    const inputs = paymentChoices.map((p) => form.elements["pay_" + p.name]).filter(Boolean);
    if (!inputs.length) return;
    const total = formTotal(form);
    const box = form.querySelector("[data-paybox]"),
      single = box?.dataset.mode === "single",
      picked = box?.querySelector(".pay-chip.on");
    const paid = fix(inputs.reduce((s, x) => s + N(x.value), 0)),
      delta = fix(total - paid);
    const target = form.querySelector("[data-split-preview]");
    if (target) {
      const ok = total > 0 && Math.abs(delta) < 0.005;
      target.textContent =
        total <= 0
          ? "Primero escribe el total."
          : !picked
            ? single
              ? "Toca cómo se pagó."
              : "Toca los medios que se usaron."
            : ok
              ? single
                ? "✓ " + money(total) + " con " + (PAY_UI[picked.dataset.pay] || [""])[0]
                : "✓ Pago completo: " + money(total)
              : "Repartido " + money(paid) + " · " + (delta > 0 ? "falta " + money(delta) : "sobra " + money(-delta));
      target.className = "split-status" + (ok ? " ok" : total > 0 && picked ? " bad" : "");
    }
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (quickOpen || moreOpen)) {
      quickOpen = false;
      moreOpen = false;
      render();
    }
  });
  app.addEventListener("click", (e) => {
    if (extraClick(e)) return;
    onClick(e);
  });
  document.addEventListener("click", (e) => {
    for (const d of document.querySelectorAll("details.menu[open]"))
      if (!d.contains(e.target)) d.removeAttribute("open");
  });
  app.addEventListener("change", (e) => {
    if (e.target.matches?.("[data-pay-mode]")) {
      payMode(e.target);
      return;
    }
    onChange(e);
  });
  app.addEventListener("submit", submit);
  app.addEventListener("input", (e) => {
    if (e.target.closest("#cash-form")) updatePreview();
    if (e.target.closest('form[data-form="purchase"]')) updatePurchasePreview();
    const f = e.target.closest("form[data-form]");
    if (f) {
      if (f.dataset.form === "obligation-pay") refreshObligation(f);
      else if (f.dataset.form === "sales") updateSaleEq(f);
      else updateSplitPreview(f);
    }
  });
  load();
  try {
    const q = new URLSearchParams(location.search).get("page");
    if (q) page = q;
  } catch (e) {}
  render();
  window.dispatchEvent(new Event("dchicken:ready"));
})();
