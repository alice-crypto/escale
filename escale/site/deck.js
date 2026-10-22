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
    train: {
      wipe: "rtl",
      horizontal: true,
      vehicles: [
        [".v-rail", [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]],
        [".v-train", [{ transform: "translateX(100vw)" }, { transform: "translateX(calc(-100% - 10vw))" }]],
      ],
    },
    heli: {
      wipe: "ttb",
      horizontal: true,
      vehicles: [
        [".v-heli", [
          { transform: "translate(72vw, -40vh) rotate(-4deg)" },
          { transform: "translate(40vw, 30vh) rotate(4deg)", offset: 0.5 },
          { transform: "translate(6vw, 108vh) rotate(-4deg)" },
        ]],
      ],
    },
    city: {
      wipe: "ltr",
      horizontal: true,
      vehicles: [
        [".v-tram", [{ transform: "translateX(108vw)" }, { transform: "translateX(-40vw)" }]],
        [".v-bus", [{ transform: "translateX(-46vw)" }, { transform: "translateX(112vw)" }]],
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

    const options = { duration: DURATION, easing: EASE, fill: "both", direction: forward ? "normal" : "reverse" };
    const animations = [];
    if (forward) {
      next.classList.add("incoming");
      animations.push(next.animate(wipes[tx.wipe](), options));
    } else {
      next.classList.add("under");
      current.classList.add("leaving");
      animations.push(current.animate(wipes[tx.wipe](), options));
    }
    const shown = [];
    for (const [sel, frames] of tx.vehicles) {
      const el = $v(sel);
      el.classList.add("show");
      el.classList.toggle("flip", !forward && tx.horizontal);
      shown.push(el);
      animations.push(el.animate(frames, options)); // même rythme que le dévoilement
    }

    await Promise.all(animations.map((a) => a.finished.catch(() => {})));

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
