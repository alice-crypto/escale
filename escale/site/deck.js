// Présentation en diapositives : un coup de molette, un glissement du doigt ou une flèche
// fait passer à la diapositive suivante. Un engin de voyage traverse l'écran et dévoile
// la nouvelle diapositive derrière lui, comme une transition PowerPoint.
(() => {
  const slides = [...document.querySelectorAll(".slide")];
  const dotsNav = document.querySelector(".dots");
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DURATION = 1500;
  const EASE = "cubic-bezier(.62, 0, .32, 1)";
  const $v = (sel) => document.querySelector(`.tx-overlay ${sel}`);

  let index = 0;
  let busy = false;
  let lastMove = 0;

  // ---- Formes de dévoilement (clip-path) : le bord suit l'engin ----
  const steps = (from, to, make, n = 12) =>
    Array.from({ length: n + 1 }, (_, k) => ({ clipPath: make(from + ((to - from) * k) / n) }));
  const wipes = {
    ltr: () => steps(-2, 118, (x) => `polygon(0% 0%, ${x}% 0%, ${x - 16}% 100%, 0% 100%)`),
    rtl: () => steps(102, -18, (x) => `polygon(${x}% 0%, 100% 0%, 100% 100%, ${x + 16}% 100%)`),
    ttb: () => steps(-2, 114, (y) => `polygon(0% 0%, 100% 0%, 100% ${y}%, 0% ${y - 12}%)`),
    btt: () => steps(112, -12, (y) => `polygon(0% ${y}%, 100% ${y - 10}%, 100% 100%, 0% 100%)`),
    sea: () => steps(103, -3, (y) => `polygon(0% ${y}%, 100% ${y}%, 100% 100%, 0% 100%)`),
    // Cercle qui s'ouvre depuis un point (le verre, l'assiette), après un temps d'attente
    circle: (at, startAt) => [
      { clipPath: `circle(0vmax at ${at})`, offset: 0 },
      { clipPath: `circle(0vmax at ${at})`, offset: startAt, easing: "cubic-bezier(.55, 0, .25, 1)" },
      { clipPath: `circle(150vmax at ${at})`, offset: 1 },
    ],
    // La mer : elle monte, recule un peu (ressac), puis recouvre tout
    surf: () => {
      const flat = (y) => `polygon(0% ${y}%, 100% ${y}%, 100% 100%, 0% 100%)`;
      return [
        { clipPath: flat(104), offset: 0, easing: "cubic-bezier(.3, 0, .3, 1)" },
        { clipPath: flat(40), offset: 0.42, easing: "ease-in-out" },
        { clipPath: flat(54), offset: 0.6, easing: "cubic-bezier(.5, 0, .3, 1)" },
        { clipPath: flat(-12), offset: 1 },
      ];
    },
  };

  // ---- Chaque transition : une forme de dévoilement + des engins et leurs trajectoires ----
  const transitions = {
    plane: {
      wipe: "ltr",
      horizontal: true,
      vehicles: [
        [".v-plane", [
          { transform: "translate(-62vw, 70vh) rotate(-8deg)" },
          { transform: "translate(112vw, 0vh) rotate(-16deg)" },
        ]],
      ],
    },
    wine: {
      // Le vin : la bouteille arrive, verse lentement, une goutte tombe, des ondes s'élargissent
      duration: 3200,
      easing: "linear",
      wipe: () => wipes.circle("50% 72%", 0.6),
      horizontal: false,
      vehicles: [
        [".v-bottle", [
          { transform: "translate(26vw, -46vh) rotate(24deg)", opacity: 0, offset: 0, easing: "cubic-bezier(.2, .7, .3, 1)" },
          { transform: "translate(0, 0) rotate(0deg)", opacity: 1, offset: 0.18 },
          { transform: "translate(0, 0) rotate(0deg)", opacity: 1, offset: 0.5, easing: "cubic-bezier(.5, 0, .7, .4)" },
          { transform: "translate(22vw, -50vh) rotate(-10deg)", opacity: 0, offset: 0.68 },
          { transform: "translate(22vw, -50vh) rotate(-10deg)", opacity: 0, offset: 1 },
        ]],
        [".v-stream", [
          { clipPath: "inset(0 0 100% 0)", offset: 0 },
          { clipPath: "inset(0 0 100% 0)", offset: 0.17, easing: "ease-in" },
          { clipPath: "inset(0 0 0% 0)", offset: 0.24 },
          { clipPath: "inset(0 0 0% 0)", offset: 0.47, easing: "ease-in" },
          { clipPath: "inset(100% 0 0 0)", offset: 0.53 },
          { clipPath: "inset(100% 0 0 0)", offset: 1 },
        ]],
        [".v-drop", [
          { transform: "translateY(0) scale(0)", opacity: 0, offset: 0 },
          { transform: "translateY(0) scale(0)", opacity: 0, offset: 0.52 },
          { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.54, easing: "cubic-bezier(.55, 0, 1, .45)" },
          { transform: "translateY(40vh) scale(1)", opacity: 1, offset: 0.6 },
          { transform: "translateY(40vh) scale(0)", opacity: 0, offset: 0.61 },
          { transform: "translateY(40vh) scale(0)", opacity: 0, offset: 1 },
        ]],
        [".v-glass", [
          { transform: "translateY(18vh)", opacity: 0, offset: 0, easing: "cubic-bezier(.2, .7, .3, 1)" },
          { transform: "translateY(0)", opacity: 1, offset: 0.14 },
          { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.78, easing: "ease-in" },
          { transform: "translateY(2vh) scale(.94)", opacity: 0, offset: 0.95 },
          { transform: "translateY(2vh) scale(.94)", opacity: 0, offset: 1 },
        ]],
        [".v-glass .wine-fill", [
          { transform: "scaleY(0)", offset: 0 },
          { transform: "scaleY(0)", offset: 0.22, easing: "cubic-bezier(.3, 0, .4, 1)" },
          { transform: "scaleY(.62)", offset: 0.5 },
          { transform: "scaleY(.62)", offset: 1 },
        ]],
        [".v-ripple.r1", [
          { transform: "scale(0)", opacity: 1, offset: 0 },
          { transform: "scale(0)", opacity: 1, offset: 0.6, easing: "cubic-bezier(.55, 0, .25, 1)" },
          { transform: "scale(3)", opacity: 1, offset: 1 },
        ]],
        [".v-ripple.r2", [
          { transform: "scale(0)", opacity: 1, offset: 0 },
          { transform: "scale(0)", opacity: 1, offset: 0.66, easing: "cubic-bezier(.4, 0, .3, 1)" },
          { transform: "scale(1.6)", opacity: 0, offset: 1 },
        ]],
        [".v-ripple.r3", [
          { transform: "scale(0)", opacity: 1, offset: 0 },
          { transform: "scale(0)", opacity: 1, offset: 0.72, easing: "cubic-bezier(.4, 0, .3, 1)" },
          { transform: "scale(0.9)", opacity: 0, offset: 1 },
        ]],
      ],
    },
    dinner: {
      // Le dîner : l'assiette glisse sous sa cloche, la cloche se lève dans un halo, la page s'ouvre
      duration: 3000,
      easing: "linear",
      wipe: () => wipes.circle("50% 60%", 0.46),
      horizontal: false,
      vehicles: [
        [".v-plate.fruit", [
          { transform: "translateX(60vw) rotate(4deg)", opacity: 0, offset: 0 },
          { transform: "translateX(60vw) rotate(4deg)", opacity: 0, offset: 0.06, easing: "cubic-bezier(.2, .7, .3, 1)" },
          { transform: "translateX(0) rotate(0deg)", opacity: 1, offset: 0.34 },
          { transform: "translateX(0) rotate(0deg)", opacity: 1, offset: 0.7, easing: "ease-in" },
          { transform: "translateX(0) scale(.92)", opacity: 0, offset: 0.86 },
          { transform: "translateX(0) scale(.92)", opacity: 0, offset: 1 },
        ]],
        [".v-plate.steak", [
          { transform: "translateX(-80vw) rotate(-3deg)", offset: 0, easing: "cubic-bezier(.2, .7, .3, 1)" },
          { transform: "translateX(0) rotate(0deg)", opacity: 1, offset: 0.32 },
          { transform: "translateX(0) scale(1)", opacity: 1, offset: 0.76, easing: "ease-in" },
          { transform: "translateX(0) scale(.94)", opacity: 0, offset: 0.92 },
          { transform: "translateX(0) scale(.94)", opacity: 0, offset: 1 },
        ]],
        [".v-cloche", [
          { transform: "translate(-80vw, 0) rotate(-3deg)", opacity: 1, offset: 0, easing: "cubic-bezier(.2, .7, .3, 1)" },
          { transform: "translate(0, 0) rotate(0deg)", opacity: 1, offset: 0.32 },
          { transform: "translate(0, -1.5vh) rotate(0deg)", opacity: 1, offset: 0.38, easing: "ease-out" },
          { transform: "translate(0, 0) rotate(0deg)", opacity: 1, offset: 0.4, easing: "cubic-bezier(.5, 0, .6, 1)" },
          { transform: "translate(6vw, -52vh) rotate(10deg)", opacity: 0, offset: 0.62 },
          { transform: "translate(6vw, -52vh) rotate(10deg)", opacity: 0, offset: 1 },
        ]],
        [".v-glow", [
          { transform: "scale(.2)", opacity: 0, offset: 0 },
          { transform: "scale(.2)", opacity: 0, offset: 0.4, easing: "ease-out" },
          { transform: "scale(1)", opacity: 1, offset: 0.52, easing: "ease-in" },
          { transform: "scale(1.6)", opacity: 0, offset: 0.8 },
          { transform: "scale(1.6)", opacity: 0, offset: 1 },
        ]],
        [".v-ring", [
          { transform: "scale(0)", opacity: 1, offset: 0 },
          { transform: "scale(0)", opacity: 1, offset: 0.46, easing: "cubic-bezier(.55, 0, .25, 1)" },
          { transform: "scale(3)", opacity: 1, offset: 1 },
        ]],
      ],
    },
    beach: {
      // La plage : la mer monte, reflue un peu, puis recouvre l'écran
      duration: 3000,
      easing: "linear",
      wipe: () => wipes.surf(),
      horizontal: false,
      vehicles: [
        [".v-surf", [
          { transform: "translateY(calc(104vh - 34px))", offset: 0, easing: "cubic-bezier(.3, 0, .3, 1)" },
          { transform: "translateY(calc(40vh - 34px))", offset: 0.42, easing: "ease-in-out" },
          { transform: "translateY(calc(54vh - 34px))", offset: 0.6, easing: "cubic-bezier(.5, 0, .3, 1)" },
          { transform: "translateY(calc(-12vh - 34px))", offset: 1 },
        ]],
        [".v-starfish", [
          { transform: "translate(16vw, calc(104vh - 60px)) rotate(0deg)", offset: 0, easing: "cubic-bezier(.3, 0, .3, 1)" },
          { transform: "translate(34vw, calc(40vh - 60px)) rotate(90deg)", offset: 0.42, easing: "ease-in-out" },
          { transform: "translate(40vw, calc(54vh - 60px)) rotate(70deg)", offset: 0.6, easing: "cubic-bezier(.5, 0, .3, 1)" },
          { transform: "translate(70vw, calc(-12vh - 60px)) rotate(260deg)", offset: 1 },
        ]],
      ],
    },
    balloon: {
      wipe: "btt",
      horizontal: false,
      vehicles: [
        [".v-balloon.b1", [{ transform: "translate(12vw, 104vh) rotate(-3deg)" }, { transform: "translate(16vw, -42vh) rotate(3deg)" }]],
        [".v-balloon.b2", [{ transform: "translate(52vw, 118vh) rotate(3deg)" }, { transform: "translate(48vw, -30vh) rotate(-3deg)" }]],
        [".v-balloon.b3", [{ transform: "translate(76vw, 110vh) rotate(2deg)" }, { transform: "translate(80vw, -36vh) rotate(-2deg)" }]],
      ],
    },
    yacht: {
      wipe: "sea",
      horizontal: true,
      vehicles: [
        [".v-waves", [{ transform: "translate(0, calc(103vh - 27px))" }, { transform: "translate(120px, calc(-3vh - 27px))" }]],
        [".v-yacht", [{ transform: "translate(-30vw, calc(103vh - 88%)) rotate(-3deg)" }, { transform: "translate(72vw, calc(-3vh - 88%)) rotate(3deg)" }]],
      ],
    },
  };

  // ---- Points de navigation ----
  slides.forEach((slide, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", slide.dataset.title || `Diapositive ${i + 1}`);
    b.addEventListener("click", () => goTo(i));
    dotsNav.appendChild(b);
  });

  function refreshUI() {
    [...dotsNav.children].forEach((b, i) => b.classList.toggle("on", i === index));
    root.style.setProperty("--page", (index / (slides.length - 1)).toFixed(3));
  }

  async function goTo(target) {
    if (busy || target === index || target < 0 || target >= slides.length) return;
    const forward = target > index;
    const current = slides[index];
    const next = slides[target];
    // En avançant, on joue la transition d'entrée de la diapositive suivante ;
    // en reculant, on rejoue celle de la diapositive qu'on quitte, à l'envers.
    const tx = transitions[(forward ? next : current).dataset.tx];

    busy = true;
    next.scrollTop = 0;

    if (reduced || !tx) {
      current.classList.remove("active");
      next.classList.add("active");
      index = target;
      refreshUI();
      busy = false;
      lastMove = Date.now();
      return;
    }

    const options = {
      duration: tx.duration || DURATION,
      easing: tx.easing || EASE,
      fill: "both",
      direction: forward ? "normal" : "reverse",
    };
    const animations = [];
    const shown = [];
    try {
      const wipeFrames = typeof tx.wipe === "function" ? tx.wipe() : wipes[tx.wipe]();
      if (forward) {
        next.classList.add("incoming");
        animations.push(next.animate(wipeFrames, options));
      } else {
        next.classList.add("under");
        current.classList.add("leaving");
        animations.push(current.animate(wipeFrames, options));
      }
      for (const [sel, frames] of tx.vehicles) {
        const el = $v(sel);
        if (!el) continue;
        el.classList.add("show");
        el.classList.toggle("flip", !forward && tx.horizontal);
        shown.push(el);
        animations.push(el.animate(frames, options)); // même rythme que le dévoilement
      }
      // Sécurité : si le téléphone n'arrive pas à finir l'animation, on passe quand même.
      const timeout = new Promise((r) => setTimeout(r, options.duration + 1200));
      await Promise.race([Promise.all(animations.map((a) => a.finished.catch(() => {}))), timeout]);
    } catch (err) {
      console.warn("Transition interrompue", err);
    }

    current.classList.remove("active", "leaving");
    next.classList.remove("incoming", "under");
    next.classList.add("active");
    animations.forEach((a) => a.cancel());
    shown.forEach((el) => el.classList.remove("show", "flip"));
    index = target;
    refreshUI();
    busy = false;
    lastMove = Date.now();
  }

  // Le contenu (diapositive trop longue, conversation) peut-il encore défiler dans ce sens ?
  function canScrollInside(el, dir) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight + 2) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== "auto" && oy !== "scroll") continue;
      if (dir > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 2) return true;
      if (dir < 0 && el.scrollTop > 2) return true;
    }
    return false;
  }

  // ---- Molette / pavé tactile ----
  let wheelAccum = 0;
  let lastWheel = 0;
  window.addEventListener(
    "wheel",
    (e) => {
      const dir = Math.sign(e.deltaY);
      if (!dir) return;
      const now = Date.now();
      const gap = now - lastWheel;
      lastWheel = now;
      if (busy) return e.preventDefault();
      if (canScrollInside(e.target, dir)) return; // on laisse défiler le contenu
      e.preventDefault();
      // Après une transition, on ignore l'élan restant du pavé tactile (événements rapprochés).
      if (now - lastMove < 1200 && gap < 180) return;
      if (gap > 180) wheelAccum = 0;
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) < 30) return;
      wheelAccum = 0;
      goTo(index + dir);
    },
    { passive: false },
  );

  // ---- Glissement du doigt ----
  let touchY = null;
  let touchTarget = null;
  let touchStartScroll = 0;
  window.addEventListener("touchstart", (e) => {
    touchY = e.touches[0].clientY;
    touchTarget = e.target;
    touchStartScroll = slides[index].scrollTop;
  }, { passive: true });
  window.addEventListener("touchend", (e) => {
    if (touchY === null) return;
    const dy = touchY - e.changedTouches[0].clientY;
    const dir = Math.sign(dy);
    const scrolled = Math.abs(slides[index].scrollTop - touchStartScroll) > 4;
    touchY = null;
    if (Math.abs(dy) < 60 || scrolled || canScrollInside(touchTarget, dir)) return;
    goTo(index + dir);
  }, { passive: true });

  // ---- Clavier ----
  window.addEventListener("keydown", (e) => {
    if (e.target.closest("textarea, input, [contenteditable]")) return;
    const next = ["ArrowDown", "PageDown", " "].includes(e.key);
    const prev = ["ArrowUp", "PageUp"].includes(e.key);
    if (next || prev) {
      const dir = next ? 1 : -1;
      if (canScrollInside(slides[index], dir)) return;
      e.preventDefault();
      goTo(index + dir);
    } else if (e.key === "Home") goTo(0);
    else if (e.key === "End") goTo(slides.length - 1);
  });

  // ---- Liens internes ----
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-goto], [data-next]");
    if (!link) return;
    e.preventDefault();
    if (link.hasAttribute("data-next")) return goTo(index + 1);
    goTo(slides.findIndex((s) => s.id === link.dataset.goto));
  });

  window.deckGoTo = (id) => goTo(slides.findIndex((s) => s.id === id));
  refreshUI();
})();
