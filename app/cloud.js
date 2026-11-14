/* D'Chicken Express - acceso privado y sincronización por fila con Supabase v2.
   El usuario configura una clave PUBLISHABLE (nunca service_role). */
(() => {
  "use strict";
  const CONFIG_KEY = "dchicken_cloud_public_config_v1";
  const TABLES = [
    "closures",
    "expenses",
    "chickens",
    "purchases",
    "payments",
    "sunat",
    "historical",
    "bankSettings",
    "bankTransactions",
    "shoppingLists",
    "alertSettings",
    "sales",
  ];
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
  const qs = (sel) => document.querySelector(sel);
  const escapeHTML = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  let client = null,
    user = null,
    business = null,
    role = "",
    shadow = new Map(),
    desired = null,
    syncing = false,
    errorState = "",
    active = false,
    poll = null,
    initializing = false,
    recovery = false,
    staffPermissions = null,
    offline = false,
    offlineNotified = false,
    alertSig = "",
    alertTimer = null;
  const LAST_KEY = "dchicken_last_business_v15",
    CACHE_PREFIX = "dchicken_cache_v15_",
    PUSH_PREFIX = "dchicken_push_v15_",
    VAPID_PUBLIC = "BD5M44tTL3dLJvG3Cpz51N8tQznoAPZRKy-PsqnK1uyrrB-ob6auDJdGzIpC-OJynjRKj0zO7Y8XcB6tVFQARIk";
  const isNetErr = (e) =>
    !navigator.onLine || /fetch|network|load failed|timed? ?out|abort/i.test(String(e?.message || e));
  function readCache(id) {
    try {
      return JSON.parse(localStorage.getItem(CACHE_PREFIX + id) || "null");
    } catch (e) {
      return null;
    }
  }
  function readLast() {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) || "null");
    } catch (e) {
      return null;
    }
  }
  function persist() {
    if (!business || !user) return;
    try {
      localStorage.setItem(
        CACHE_PREFIX + business.id,
        JSON.stringify({
          user: user.id,
          role,
          name: business.name,
          perms: staffPermissions,
          db: window.DChickenBridge.getLocal(),
          shadow: [...shadow.values()],
          pending: !!(desired || errorState),
          saved: Date.now(),
        }),
      );
    } catch (e) {}
  }
  function forget(id) {
    try {
      localStorage.removeItem(CACHE_PREFIX + id);
      localStorage.removeItem(LAST_KEY);
    } catch (e) {}
  }
  function syncState() {
    if (!active) return "local";
    if (errorState) return "error";
    if (offline) return "offline";
    if (syncing || desired) return "busy";
    return "ok";
  }
  const overlay = () => qs("#cloud-overlay");
  function message(s, error = false) {
    const target = qs("#cloud-msg");
    if (target) {
      target.className = "cloud-message" + (error ? " error" : "");
      target.textContent = s;
    } else window.DChickenBridge?.notify(s, error);
  }
  function ui(inner) {
    const el = overlay();
    if (!el) return;
    el.hidden = false;
    el.innerHTML = `<div class="cloud-box" role="dialog" aria-modal="true" aria-label="Cuenta D’Chicken Express"><div class="cloud-brand"><img src="./logo.webp" alt="Logo D’Chicken Express"><div><h2>D’Chicken Express</h2><p style="margin:3px 0 0">Control privado del negocio</p></div></div>${inner}<div id="cloud-msg" aria-live="polite"></div></div>`;
  }
  function hide() {
    if (overlay()) {
      overlay().hidden = true;
      overlay().innerHTML = "";
    }
  }
  function localButton() {
    return `<button class="btn" data-cloud="local">Continuar en modo local (pruebas)</button>`;
  }
  function getConfig() {
    const bundled = window.DCHICKEN_CONFIG || {};
    if (bundled.supabaseUrl && bundled.publishableKey) return { url: bundled.supabaseUrl, key: bundled.publishableKey };
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY)) || null;
    } catch {
      return null;
    }
  }
  function configuration() {
    const c = getConfig() || {};
    ui(
      `<h3>Conectar el negocio</h3><p>Para sincronizar los celulares necesitas un proyecto Supabase preparado con el archivo <b>BASE_DE_DATOS.sql</b>. Sin configurarlo puedes probar el sistema localmente.</p><form id="cloud-config-form"><label>URL de Supabase</label><input name="url" type="url" placeholder="https://tu-proyecto.supabase.co" value="${escapeHTML(c.url || "")}" required><label>Clave pública (publishable / anon)</label><input name="key" autocomplete="off" value="${escapeHTML(c.key || "")}" placeholder="sb_publishable_..." required><div class="cloud-actions"><button class="btn primary" type="submit">Conectar</button>${localButton()}</div></form><p class="cloud-caption"><b>Nunca introduzcas una clave service_role o secret aquí.</b> La clave pública no sustituye las reglas de seguridad de la base de datos.</p>`,
    );
  }
  async function start(config) {
    if (initializing) return;
    initializing = true;
    try {
      if (!/^https:\/\/[\w.-]+\/?$/.test(config.url || "")) throw Error("La URL debe empezar con https://");
      if (!(config.key || "").trim()) throw Error("Falta la clave pública.");
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.10/+esm");
      client = createClient(config.url.replace(/\/$/, ""), config.key, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
      });
      client.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
          recovery = true;
          passwordScreen();
        }
      });
      const { data } = await client.auth.getSession();
      if (data?.session?.user) {
        user = data.session.user;
        if (!recovery) {
          const last = readLast();
          if (last && last.user === user.id && last.id) await enterBusiness(last.id, last.role, last.name);
          else await chooseBusiness();
        }
      } else loginScreen();
    } catch (e) {
      const last = readLast(),
        cache = last && readCache(last.id);
      if (isNetErr(e) && cache?.db && cache.user === last.user) {
        user = { id: last.user };
        business = { id: last.id, name: last.name };
        role = cache.role || last.role;
        staffPermissions = cache.perms || null;
        shadow = new Map((cache.shadow || []).map((r) => [`${r.section}:${r.record_id}`, r]));
        desired = cache.pending ? cache.db : null;
        active = true;
        offline = true;
        window.DChickenBridge.setFromCloud(cache.db);
        hide();
        refreshButton();
        window.addEventListener("online", () => location.reload(), { once: true });
        window.DChickenBridge.notify("Sin internet: usando los datos guardados en este dispositivo.");
      } else {
        message(e.message || "No se pudo conectar con Supabase.", true);
        if (!qs("#cloud-config-form")) configuration();
      }
    } finally {
      initializing = false;
    }
  }
  function loginScreen() {
    active = false;
    business = null;
    role = "";
    ui(
      `<h3>Iniciar sesión</h3><p>Ingresa con tu correo y contraseña. Para invitar a tus familiares, primero crea tu negocio con tu propia cuenta.</p><form id="cloud-login-form"><label>Correo electrónico</label><input name="email" type="email" autocomplete="username" required><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" minlength="6" required><div class="cloud-actions"><button class="btn primary" type="submit">Entrar</button><button class="btn" type="button" data-cloud="register">Crear cuenta</button></div></form><div class="cloud-actions"><button class="cloud-inline-link" data-cloud="forgot">¿Olvidaste tu contraseña?</button><button class="cloud-inline-link" data-cloud="config">Cambiar conexión</button>${localButton()}</div>`,
    );
  }
  function passwordScreen() {
    ui(
      `<h3>Crear nueva contraseña</h3><p>El enlace de recuperación ha sido aceptado. Escribe tu contraseña nueva.</p><form id="cloud-password-form"><label>Contraseña nueva (mínimo 8 caracteres)</label><input type="password" name="password" minlength="8" required autocomplete="new-password"><div class="cloud-actions"><button class="btn primary" type="submit">Guardar contraseña</button></div></form>`,
    );
  }
  function registerScreen() {
    ui(
      `<h3>Crear cuenta privada</h3><p>Registra tu correo. Puede que debas confirmar el correo antes de iniciar sesión.</p><form id="cloud-register-form"><label>Correo electrónico</label><input type="email" name="email" required autocomplete="email"><label>Contraseña (mínimo 8 caracteres)</label><input type="password" name="password" minlength="8" required autocomplete="new-password"><div class="cloud-actions"><button class="btn primary" type="submit">Registrarme</button><button type="button" class="btn" data-cloud="login">Volver</button></div></form>`,
    );
  }
  async function chooseBusiness() {
    active = false;
    try {
      const r = await client.from("business_members").select("business_id,role").eq("user_id", user.id);
      if (r.error) throw r.error;
      if (!r.data?.length) {
        companyScreen();
        return;
      }
      const ids = r.data.map((x) => x.business_id),
        names = await client.from("businesses").select("id,name").in("id", ids);
      if (names.error) throw names.error;
      const options = r.data
        .map((x) => {
          const name = names.data.find((y) => y.id === x.business_id)?.name || "Pollería";
          return `<button class="btn block" data-cloud="choose" data-id="${escapeHTML(x.business_id)}" data-role="${escapeHTML(x.role)}" data-name="${escapeHTML(name)}">${escapeHTML(name)} · ${x.role === "admin" ? "Administrador" : "Colaborador"}</button>`;
        })
        .join("");
      ui(
        `<h3>Selecciona tu negocio</h3><p>Conectado como ${escapeHTML(user.email || "usuario")}.</p><div class="cloud-actions" style="display:grid">${options}</div><hr><div class="cloud-actions"><button class="btn" data-cloud="othercompany">Unirme a otro negocio</button><button class="btn" data-cloud="logout">Cerrar sesión</button></div>`,
      );
    } catch (e) {
      ui(
        `<h3>No se pudo cargar el negocio</h3><p>${escapeHTML(e.message)}</p><div class="cloud-actions"><button class="btn" data-cloud="retry">Reintentar</button><button class="btn" data-cloud="logout">Salir</button></div>`,
      );
    }
  }
  function companyScreen() {
    ui(
      `<h3>Configura D’Chicken Express</h3><p>Si eres el administrador, crea el negocio. Si tu familiar ya lo creó, introduce el código de invitación que te dio.</p><form id="cloud-create-form"><label>Nombre de la pollería</label><input name="name" value="D’Chicken Express" required maxlength="90"><div class="cloud-actions"><button class="btn primary" type="submit">Crear mi negocio</button></div></form><hr><form id="cloud-join-form"><label>Código de invitación</label><input name="code" placeholder="Código compartido por el administrador" required><div class="cloud-actions"><button class="btn" type="submit">Unirme al negocio</button><button class="btn" type="button" data-cloud="logout">Cerrar sesión</button></div></form>`,
    );
  }
  function inviteScreen(code, kind) {
    ui(
      `<h3>${kind === "created" ? "¡Negocio creado!" : "Código de invitación"}</h3><p>Comparte este código solo con las personas de confianza que trabajarán en la pollería. Los nuevos integrantes entrarán como <b>colaboradores</b>.</p><code class="cloud-invite">${escapeHTML(code)}</code><div class="cloud-actions"><button class="btn" data-cloud="copyinvite" data-code="${escapeHTML(code)}">Copiar código</button><button class="btn primary" data-cloud="enterbusiness">Entrar al panel</button></div><p class="cloud-caption">Guárdalo en un lugar seguro. Si lo pierdes, el administrador puede emitir otro y anular el anterior.</p>`,
    );
  }
  async function readStaffPermissions() {
    if (!active) return;
    const result = await client
      .from("business_staff_permissions")
      .select("allowed_pages")
      .eq("business_id", business.id)
      .maybeSingle();
    if (result.error) throw result.error;
    staffPermissions = result.data?.allowed_pages || null;
  }
  async function auditLog() {
    if (!active || role !== "admin") throw Error("Solo el administrador ve el historial.");
    const r = await client
      .from("record_audit")
      .select("section,record_id,action,old_payload,new_payload,changed_by,changed_at")
      .eq("business_id", business.id)
      .order("changed_at", { ascending: false })
      .limit(300);
    if (r.error) throw r.error;
    const roles = new Map();
    const m = await client.from("business_members").select("user_id,role").eq("business_id", business.id);
    for (const x of m.data || []) roles.set(x.user_id, x.role);
    return (r.data || []).map((x) => ({
      ...x,
      who:
        x.changed_by === user?.id
          ? "Tú"
          : roles.get(x.changed_by) === "admin"
            ? "Administrador"
            : roles.get(x.changed_by) === "staff"
              ? "Personal"
              : "Sistema",
    }));
  }
  async function storeStaffPermissions(allowed) {
    if (!active || role !== "admin") throw Error("Solo el administrador puede definir permisos.");
    if (!Array.isArray(allowed)) throw Error("Permisos inválidos.");
    const result = await client
      .from("business_staff_permissions")
      .upsert({ business_id: business.id, allowed_pages: allowed }, { onConflict: "business_id" });
    if (result.error) throw result.error;
    staffPermissions = allowed;
    window.DChickenBridge.notify("Permisos guardados para las cuentas colaboradoras.");
  }
  function pageAllowed(p) {
    return !active || role === "admin" || (p !== "permisos" && (!staffPermissions || staffPermissions.includes(p)));
  }
  async function enterBusiness(id, assignedRole, name) {
    business = { id, name };
    role = assignedRole;
    active = true;
    errorState = "";
    offline = false;
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ id, name, role: assignedRole, user: user?.id }));
    } catch (e) {}
    const cache = readCache(id);
    let fromCache = false;
    if (cache && cache.user === user?.id && cache.db) {
      shadow = new Map((cache.shadow || []).map((r) => [`${r.section}:${r.record_id}`, r]));
      staffPermissions = cache.perms || null;
      if (cache.role) role = cache.role;
      desired = cache.pending ? cache.db : null;
      window.DChickenBridge.setFromCloud(cache.db);
      hide();
      fromCache = true;
    } else ui("<h3>Sincronizando…</h3><p>Cargando los movimientos del negocio.</p>");
    try {
      const m = await client
        .from("business_members")
        .select("role")
        .eq("business_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (m.error) throw m.error;
      if (!m.data) {
        forget(id);
        active = false;
        business = null;
        await chooseBusiness();
        return;
      }
      role = m.data.role;
      await readStaffPermissions();
      if (desired) {
        await runSync();
        if (!errorState && !offline) await loadRemote();
      } else await loadRemote();
      offline = false;
      offlineNotified = false;
      hide();
    } catch (e) {
      if (fromCache && isNetErr(e)) {
        offline = true;
        window.DChickenBridge.notify("Sin internet: estás usando los datos guardados en este dispositivo.");
      } else {
        active = false;
        message("No se pudo leer la base de datos: " + (e.message || e), true);
      }
    }
    persist();
    refreshButton();
    window.DChickenBridge.rerender?.();
    if (poll) clearInterval(poll);
    poll = setInterval(() => {
      if (!active || !navigator.onLine || syncing) return;
      if (offline || (desired && !errorState)) {
        offline = false;
        runSync()
          .then(() => {
            if (!errorState && !offline) return refresh();
          })
          .catch(() => {});
        return;
      }
      if (!desired && !errorState && !qs("#cloud-overlay:not([hidden])") && !editingForm())
        refresh().catch((e) => {
          if (isNetErr(e)) {
            offline = true;
            refreshButton();
          }
        });
    }, 18000);
  }

  function editingForm() {
    const e = document.activeElement;
    return e && !!e.closest?.("form[data-form]");
  }
  async function fetchRows() {
    let rows = [],
      from = 0;
    while (true) {
      const r = await client
        .from("business_records")
        .select("section,record_id,payload,revision")
        .eq("business_id", business.id)
        .range(from, from + 499);
      if (r.error) throw r.error;
      rows.push(...r.data);
      if (r.data.length < 500) break;
      from += 500;
      if (from >= 20000) throw Error("Demasiados registros: contactar al administrador.");
    }
    return rows;
  }
  function snapshot(rows) {
    const obj = blank(),
      m = new Map();
    for (const r of rows) {
      if (!TABLES.includes(r.section)) continue;
      obj[r.section].push(r.payload);
      m.set(`${r.section}:${r.record_id}`, {
        section: r.section,
        record_id: r.record_id,
        payload: r.payload,
        revision: r.revision,
      });
    }
    return { obj, m };
  }
  function idOf(section, r) {
    return String(
      r.id ||
        (section === "closures" || section === "chickens"
          ? r.date
          : section === "historical"
            ? r.month
            : section === "bankSettings"
              ? r.id
              : "") ||
        "",
    );
  }
  function records(db) {
    const map = new Map();
    for (const section of TABLES)
      for (const r of db[section] || []) {
        const id = idOf(section, r);
        if (!id) continue;
        const key = `${section}:${id}`;
        map.set(key, { section, record_id: id, payload: structuredClone(r) });
      }
    return map;
  }
  function equals(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  async function loadRemote() {
    const rows = await fetchRows();
    const res = snapshot(rows);
    shadow = res.m;
    desired = null;
    window.DChickenBridge.setFromCloud(res.obj);
    persist();
    refreshButton();
  }
  async function refresh() {
    if (!active || syncing || desired || errorState) return;
    const permissionsBefore = JSON.stringify(staffPermissions);
    await readStaffPermissions();
    const rows = await fetchRows();
    if (editingForm()) return;
    const res = snapshot(rows),
      a = JSON.stringify([...shadow.values()].map((x) => [x.section, x.record_id, x.revision]).sort()),
      b = JSON.stringify([...res.m.values()].map((x) => [x.section, x.record_id, x.revision]).sort());
    if (a !== b || permissionsBefore !== JSON.stringify(staffPermissions)) {
      shadow = res.m;
      window.DChickenBridge.setFromCloud(res.obj);
      persist();
      window.DChickenBridge.notify("Datos actualizados desde la nube.");
    }
    offline = false;
    refreshButton();
  }
  function refreshButton() {
    const st = syncState();
    const [cls, label] = {
      local: ["off", "Modo local"],
      ok: ["", "En línea"],
      busy: ["busy", "Guardando…"],
      offline: ["busy", "Sin internet · guardado aquí"],
      error: ["problem", "Sin guardar"],
    }[st];
    for (const p of document.querySelectorAll("#cloud-pill,#cloud-pill-m")) p.textContent = label;
    for (const d of document.querySelectorAll(".cloud-pill-btn .sync-dot,.side-status .sync-dot"))
      d.className = "sync-dot " + cls;
    const ss = document.querySelector(".side-status");
    if (ss && ss.lastChild) ss.lastChild.textContent = label;
  }
  function queueSave(db) {
    if (!active) return;
    desired = structuredClone(db);
    persist();
    refreshButton();
    if (!syncing && !offline) runSync();
    else if (offline && !offlineNotified) {
      offlineNotified = true;
      window.DChickenBridge.notify(
        "Sin internet: lo guardé en este dispositivo. Se subirá solo cuando vuelva la señal.",
      );
    }
  }
  // Errores por registro: si un registro falla, los demás se guardan igual y solo ese queda pendiente.
  const failed = new Map();
  const SECTION_LABEL = {
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
  function describe(r) {
    const p = r.payload || {};
    const bits = [SECTION_LABEL[r.section] || r.section];
    if (p.date) bits.push(p.date.split("-").reverse().join("/"));
    const what = p.concept || p.product || p.person || "";
    if (what) bits.push(String(what).slice(0, 40));
    const amt = p.amount ?? p.total ?? p.system;
    if (amt !== undefined && amt !== "") bits.push("S/ " + Number(amt).toFixed(2));
    return bits.join(" · ");
  }
  function friendly(e) {
    const msg = String(e?.message || e || "");
    if (e?.code === "42501" || /row-level security/i.test(msg))
      return "No tienes permiso para guardar este cambio. Los días anteriores solo los cambia el administrador.";
    if (e?.code === "23514" || /check constraint/i.test(msg))
      return "La nube no acepta este tipo de registro. Avisa al administrador.";
    return msg || "Fallo de sincronización";
  }
  function setFailure(k, r, why) {
    const isNew = !failed.has(k) || failed.get(k).why !== why;
    failed.set(k, { section: r.section, record_id: r.record_id, label: describe(r), why });
    return isNew;
  }
  async function runSync() {
    if (syncing) return;
    syncing = true;
    refreshButton();
    let count = 0,
      fresh = 0;
    try {
      while (desired) {
        const target = records(desired);
        desired = null;
        // Un fallo que el usuario ya corrigió en su dispositivo deja de contarse.
        for (const k of [...failed.keys()]) {
          const t = target.get(k),
            s = shadow.get(k);
          if ((!t && !s) || (t && s && equals(s.payload, t.payload))) failed.delete(k);
        }
        const deletes = [...shadow.keys()].filter((k) => !target.has(k));
        const modified = [...target.entries()].filter(
          ([k, r]) => !shadow.has(k) || !equals(shadow.get(k).payload, r.payload),
        );
        for (const k of deletes) {
          const old = shadow.get(k);
          if (!old) continue;
          try {
            const r = await client
              .from("business_records")
              .delete()
              .eq("business_id", business.id)
              .eq("section", old.section)
              .eq("record_id", old.record_id)
              .eq("revision", old.revision)
              .select("revision");
            if (r.error) throw r.error;
            if (r.data.length !== 1)
              throw Error("No se pudo eliminar: alguien lo cambió desde otro dispositivo o no tienes permiso.");
            shadow.delete(k);
            failed.delete(k);
            count++;
          } catch (e) {
            if (isNetErr(e)) throw e;
            if (setFailure(k, old, "Eliminar: " + friendly(e))) fresh++;
          }
        }
        for (const [k, r] of modified) {
          const old = shadow.get(k);
          try {
            let res;
            if (old) {
              res = await client
                .from("business_records")
                .update({ payload: r.payload })
                .eq("business_id", business.id)
                .eq("section", r.section)
                .eq("record_id", r.record_id)
                .eq("revision", old.revision)
                .select("revision");
            } else {
              res = await client
                .from("business_records")
                .insert({ business_id: business.id, ...r, payload: r.payload })
                .select("revision");
            }
            if (res.error) throw res.error;
            if (res.data.length !== 1)
              throw Error(
                "No se pudo actualizar: alguien lo cambió desde otro dispositivo o no tienes permiso para modificarlo.",
              );
            shadow.set(k, { ...r, revision: res.data[0].revision });
            failed.delete(k);
            count++;
          } catch (e) {
            if (isNetErr(e)) throw e;
            if (setFailure(k, r, friendly(e))) fresh++;
          }
        }
      }
      const wasOffline = offline;
      offline = false;
      offlineNotified = false;
      if (failed.size) {
        errorState = failed.size === 1 ? "1 registro no se guardó" : failed.size + " registros no se guardaron";
        if (fresh)
          window.DChickenBridge.notify(
            "No se guardó en la nube: " + [...failed.values()][failed.size - 1].why + " Abre «Cuenta» para ver cuál.",
            true,
          );
        else if (count) window.DChickenBridge.notify("Guardado en la nube. Pendiente: " + errorState + ".");
      } else {
        errorState = "";
        if (count)
          window.DChickenBridge.notify(
            wasOffline ? "Conexión recuperada: tus cambios ya están en la nube." : "Guardado en la nube.",
          );
      }
    } catch (e) {
      // Sin internet u otro fallo general: los cambios quedan en el dispositivo hasta subirlos.
      desired = window.DChickenBridge.getLocal();
      if (isNetErr(e)) {
        offline = true;
        if (!offlineNotified) {
          offlineNotified = true;
          window.DChickenBridge.notify(
            "Sin internet: lo guardé en este dispositivo. Se subirá solo cuando vuelva la señal.",
          );
        }
      } else {
        errorState = friendly(e);
        window.DChickenBridge.notify("No se guardó en la nube: " + errorState, true);
      }
    } finally {
      syncing = false;
      persist();
      refreshButton();
    }
  }
  // Descarta solo el cambio que falló: el registro vuelve a como está en la nube.
  async function discardOne(k) {
    const f = failed.get(k);
    if (!f) return;
    const local = window.DChickenBridge.getLocal();
    const list = (local[f.section] ||= []);
    const i = list.findIndex((r) => idOf(f.section, r) === f.record_id);
    const cloudCopy = shadow.get(k);
    if (cloudCopy) {
      if (i >= 0) list[i] = structuredClone(cloudCopy.payload);
      else list.push(structuredClone(cloudCopy.payload));
    } else if (i >= 0) list.splice(i, 1);
    failed.delete(k);
    window.DChickenBridge.setFromCloud(local);
    desired = local;
    if (!failed.size) errorState = "";
    await runSync();
    if (!failed.size && !errorState) await refresh();
  }
  function open() {
    if (!client) {
      configuration();
      return;
    }
    if (!user) {
      loginScreen();
      return;
    }
    if (!active) {
      chooseBusiness();
      return;
    }
    const failList = [...failed.entries()]
      .map(
        ([k, f]) =>
          `<li class="fail-item"><div><b>${escapeHTML(f.label)}</b><small>${escapeHTML(f.why)}</small></div><button class="btn" data-cloud="discardone" data-key="${escapeHTML(k)}">Descartar este cambio</button></li>`,
      )
      .join("");
    const pending = errorState
      ? `<div class="cloud-message error">Cambios sin guardar: ${escapeHTML(errorState)}.${failList ? " El resto de tus registros sí se guardó." : " Descarga un respaldo antes de descartarlos."}</div>${failList ? `<ul class="fail-list">${failList}</ul>` : ""}<div class="cloud-actions"><button class="btn danger" data-cloud="discard">Descartar todos mis cambios y cargar la nube</button></div>`
      : offline
        ? `<div class="cloud-message">Sin internet. Tus cambios están guardados en este dispositivo y se subirán solos.</div>`
        : "";
    ui(
      `<h3>Cuenta del negocio</h3><div class="cloud-meta"><span class="cloud-chip">${escapeHTML(business.name)}</span><span class="cloud-chip">${role === "admin" ? "Administrador" : "Colaborador"}</span></div><p>${escapeHTML(user.email || "")}</p><p><span class="sync-dot ${errorState ? "problem" : ""}"></span>${errorState ? "Hay cambios sin sincronizar" : offline ? "Esperando conexión" : syncing || desired ? "Guardando cambios…" : "Registros sincronizados"}</p>${pending}<div class="cloud-actions"><button class="btn primary" data-cloud="syncnow">${errorState ? "Reintentar guardar" : "Actualizar desde la nube"}</button><button class="btn" data-cloud="chooseorg">Cambiar negocio</button></div>${role === "admin" ? '<hr><h3>Mi familia</h3><p>Genera un código para que tus familiares o tu personal entren con sus propias cuentas. Cada código sirve para una sola persona: al usarse, deja de funcionar.</p><div class="cloud-actions"><button class="btn" data-cloud="invite">Generar código de acceso</button></div>' : ""}<hr><div class="cloud-actions"><button class="btn" data-cloud="close">Volver al panel</button><button class="btn danger" data-cloud="logout">Cerrar sesión</button></div><p class="cloud-caption">Tu información se guarda en Supabase. Para preservar una copia extra, pulsa «Respaldo» en el panel.</p>`,
    );
  }
  async function action(name, b) {
    try {
      switch (name) {
        case "config":
          configuration();
          break;
        case "login":
          loginScreen();
          break;
        case "register":
          registerScreen();
          break;
        case "forgot":
          ui(
            `<h3>Recuperar contraseña</h3><p>Recibirás un correo para establecer una contraseña nueva.</p><form id="cloud-forgot-form"><label>Correo electrónico</label><input name="email" type="email" required><div class="cloud-actions"><button class="btn primary" type="submit">Enviar enlace</button><button class="btn" data-cloud="login">Volver</button></div></form>`,
          );
          break;
        case "local":
          active = false;
          business = null;
          errorState = "";
          hide();
          refreshButton();
          window.DChickenBridge.notify("Modo local de pruebas. No se compartirá entre dispositivos.");
          break;
        case "retry":
          await chooseBusiness();
          break;
        case "close":
          hide();
          break;
        case "logout": {
          if (syncing || errorState || desired) {
            if (
              !confirm("Hay cambios aún no guardados en la nube. Descarga primero un respaldo. ¿Salir de todos modos?")
            )
              return;
          }
          if (poll) clearInterval(poll);
          active = false;
          business = null;
          role = "";
          staffPermissions = null;
          if (business) forget(business.id);
          try {
            localStorage.removeItem(LAST_KEY);
          } catch (e) {}
          await client.auth.signOut();
          user = null;
          shadow.clear();
          desired = null;
          errorState = "";
          window.DChickenBridge.clear();
          loginScreen();
          refreshButton();
          break;
        }
        case "choose":
          await enterBusiness(b.dataset.id, b.dataset.role, b.dataset.name);
          break;
        case "chooseorg":
          try {
            localStorage.removeItem(LAST_KEY);
          } catch (e) {}
          active = false;
          business = null;
          role = "";
          staffPermissions = null;
          desired = null;
          await chooseBusiness();
          break;
        case "othercompany":
          companyScreen();
          break;
        case "enterbusiness":
          await chooseBusiness();
          break;
        case "copyinvite":
          await navigator.clipboard.writeText(b.dataset.code);
          message("Código copiado.");
          break;
        case "invite": {
          const r = await client.rpc("rotate_business_invite", { p_business: business.id });
          if (r.error) throw r.error;
          inviteScreen(r.data, "code");
          break;
        }
        case "discard": {
          if (!confirm("Se perderán los cambios que no llegaron a la nube. ¿Continuar?")) return;
          desired = null;
          errorState = "";
          failed.clear();
          await loadRemote();
          open();
          window.DChickenBridge.notify("Datos recargados desde la nube.");
          break;
        }
        case "discardone": {
          await discardOne(b.dataset.key);
          open();
          window.DChickenBridge.notify(failed.size ? "Cambio descartado." : "Cambio descartado. Todo está guardado en la nube.");
          break;
        }
        case "syncnow":
          if (errorState) {
            errorState = "";
            desired = window.DChickenBridge.getLocal();
            await runSync();
            if (errorState) open();
            else {
              await refresh();
              open();
            }
          } else {
            await refresh();
            open();
          }
          break;
      }
    } catch (e) {
      message(e.message || "No se pudo completar la operación.", true);
    }
  }
  async function forms(e) {
    const form = e.target.closest('form[id^="cloud-"]');
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    const get = (x) => String(fd.get(x) || "").trim();
    const name = form.id;
    try {
      if (name === "cloud-config-form") {
        const cfg = { url: get("url"), key: get("key") };
        if (/service_role|sb_secret_/i.test(cfg.key)) throw Error("¡No uses claves secretas o service_role!");
        localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
        message("Conectando…");
        await start(cfg);
        return;
      }
      if (!client) throw Error("Primero debes configurar Supabase.");
      if (name === "cloud-login-form") {
        message("Comprobando credenciales…");
        const r = await client.auth.signInWithPassword({ email: get("email"), password: get("password") });
        if (r.error) throw r.error;
        user = r.data.user;
        await chooseBusiness();
        return;
      }
      if (name === "cloud-register-form") {
        message("Creando cuenta…");
        const r = await client.auth.signUp({ email: get("email"), password: get("password") });
        if (r.error) throw r.error;
        if (r.data.session) {
          user = r.data.user;
          await chooseBusiness();
        } else {
          loginScreen();
          message("Revisa tu correo y confirma tu cuenta antes de entrar.");
        }
        return;
      }
      if (name === "cloud-password-form") {
        const r = await client.auth.updateUser({ password: get("password") });
        if (r.error) throw r.error;
        recovery = false;
        message("Contraseña actualizada.");
        await chooseBusiness();
        return;
      }
      if (name === "cloud-forgot-form") {
        const r = await client.auth.resetPasswordForEmail(get("email"), {
          redirectTo: location.origin + location.pathname,
        });
        if (r.error) throw r.error;
        message("Revisa tu correo para recuperar la contraseña.");
        return;
      }
      if (name === "cloud-create-form") {
        const r = await client.rpc("create_business", { p_name: get("name") });
        if (r.error) throw r.error;
        inviteScreen(r.data.invite_code, "created");
        return;
      }
      if (name === "cloud-join-form") {
        const r = await client.rpc("join_business", { p_code: get("code") });
        if (r.error) throw r.error;
        await chooseBusiness();
        message("Ya formas parte del negocio.");
        return;
      }
    } catch (e) {
      message(e.message || "Error al guardar.", true);
    }
  }
  function setup() {
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cloud]");
      if (b) {
        e.preventDefault();
        action(b.dataset.cloud, b);
      }
    });
    document.addEventListener("submit", forms);
    const c = getConfig();
    if (c?.url && c.key) {
      ui("<h3>Conectando…</h3><p>Comprobando sesión privada.</p>");
      start(c);
    } else {
      hide();
      refreshButton();
    }
    window.addEventListener("online", () => {
      if (!active) return;
      if (offline || (desired && !errorState)) {
        offline = false;
        runSync()
          .then(() => {
            if (!errorState && !offline) return refresh();
          })
          .catch(() => {});
      } else if (errorState)
        window.DChickenBridge.notify("Internet restablecido. Abre «Cuenta» para reintentar el guardado.");
    });
    window.addEventListener("offline", () => {
      if (active) {
        offline = true;
        refreshButton();
      }
    });
  }

  function b64ToBytes(s) {
    const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const b = atob(p);
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  }
  function pushState() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
      return "unsupported";
    if (Notification.permission === "denied") return "denied";
    return business && localStorage.getItem(PUSH_PREFIX + business.id) === "on" && Notification.permission === "granted"
      ? "on"
      : "off";
  }
  async function enablePush() {
    if (!active) throw Error("Primero entra con tu cuenta.");
    if (pushState() === "unsupported")
      throw Error("Este navegador no permite avisos. En iPhone instala la app en la pantalla de inicio.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw Error("No se dio permiso para mostrar notificaciones.");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub)
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
    const j = sub.toJSON();
    const r = await client
      .from("push_subscriptions")
      .upsert(
        { endpoint: j.endpoint, business_id: business.id, user_id: user.id, p256dh: j.keys.p256dh, auth: j.keys.auth },
        { onConflict: "endpoint" },
      );
    if (r.error) throw r.error;
    localStorage.setItem(PUSH_PREFIX + business.id, "on");
    alertSig = "";
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await client.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    if (business) localStorage.removeItem(PUSH_PREFIX + business.id);
  }
  function syncAlerts() {
    if (!active || offline || role !== "admin") return;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(async () => {
      try {
        const list = (window.DChickenBridge.alerts?.() || []).map((x) => ({
          key: x.type + ":" + x.title,
          kind: x.type,
          due: x.date,
          title: x.title,
          body: x.description,
        }));
        const sig = business.id + JSON.stringify(list);
        if (sig === alertSig) return;
        const r = await client.rpc("replace_business_alerts", { p_business: business.id, p_alerts: list });
        if (!r.error) alertSig = sig;
      } catch (e) {}
    }, 3000);
  }
  window.DChickenCloud = {
    isActive: () => active,
    isAdmin: () => role === "admin",
    isPageAllowed: pageAllowed,
    getStaffPermissions: () => staffPermissions,
    saveStaffPermissions: storeStaffPermissions,
    queueSave,
    open,
    status: syncState,
    pushState,
    enablePush,
    disablePush,
    syncAlerts,
    userLabel: () => String(user?.email || "").split("@")[0],
    auditLog,
  };
  window.addEventListener("dchicken:ready", setup, { once: true });
})();
