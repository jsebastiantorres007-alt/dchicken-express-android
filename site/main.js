// D’Chicken Express · interacciones ligeras (sin librerías).
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top = document.querySelector(".top");
  const hero = document.querySelector(".hero");
  const heroImg = document.querySelector("[data-depth]");
  const dock = document.querySelector(".dock");
  const visit = document.getElementById("visitanos");

  // WhatsApp siempre en una pestaña nueva (en el celular abre la app).
  for (const a of document.querySelectorAll("a[data-wa]")) {
    a.target = "_blank";
    a.rel = "noopener";
  }

  // Cabecera sólida al bajar + profundidad moderada en la foto principal.
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      top.classList.toggle("scrolled", y > 24);
      if (heroImg && !reduce && y < window.innerHeight * 1.2) {
        heroImg.style.setProperty("--py", (y * 0.22).toFixed(1) + "px");
      }
      ticking = false;
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (!("IntersectionObserver" in window)) {
    for (const el of document.querySelectorAll(".reveal")) el.classList.add("in");
    dock?.classList.add("show");
    return;
  }

  // Apariciones al entrar en pantalla (una sola vez).
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  for (const el of document.querySelectorAll(".reveal")) {
    if (!el.closest(".wing-rail")) io.observe(el);
  }
  // Las alitas en celular están en un carrusel horizontal: aparecen todas juntas.
  const railIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const w of e.target.querySelectorAll(".reveal")) w.classList.add("in");
        railIO.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  for (const rail of document.querySelectorAll(".wing-rail")) railIO.observe(rail);

  // Barra de pedido en celular: aparece después de la portada y se oculta en Contacto.
  let heroIn = true,
    visitIn = false;
  const dockState = () => dock?.classList.toggle("show", !heroIn && !visitIn);
  new IntersectionObserver(([e]) => {
    heroIn = e.isIntersecting;
    dockState();
  }, { threshold: 0.08 }).observe(hero);
  if (visit)
    new IntersectionObserver(([e]) => {
      visitIn = e.isIntersecting;
      dockState();
    }).observe(visit);

  // Sección activa en el menú.
  const links = new Map([...document.querySelectorAll(".nav a")].map((a) => [a.hash.slice(1), a]));
  const spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const a = links.get(e.target.id);
        if (a && e.isIntersecting) {
          for (const l of links.values()) l.classList.toggle("on", l === a);
        }
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  for (const id of links.keys()) {
    const s = document.getElementById(id);
    if (s) spy.observe(s);
  }
})();
