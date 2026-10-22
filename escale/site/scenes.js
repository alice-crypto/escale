// Animations liées au défilement : chaque scène reçoit sa progression (--p, de 0 à 1)
// et les engins de voyage se déplacent en fonction.
(() => {
  const scenes = [...document.querySelectorAll("[data-scene]")];
  const parallax = [...document.querySelectorAll("[data-parallax]")];
  const nav = document.querySelector(".nav");
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Apparition douce des blocs de contenu.
  const revealTargets = document.querySelectorAll(".steps li, .perk, .dest, .chat-card, .ext-card, .stay-grid > div, .villa, h2");
  revealTargets.forEach((el) => el.classList.add("reveal"));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))),
      { threshold: 0.15 },
    );
    revealTargets.forEach((el) => io.observe(el));
  } else {
    revealTargets.forEach((el) => el.classList.add("in"));
  }

  let ticking = false;
  function update() {
    ticking = false;
    const vh = window.innerHeight;
    for (const scene of scenes) {
      const r = scene.getBoundingClientRect();
      // 0 quand la scène entre par le bas, 1 quand elle sort par le haut.
      let p = (vh - r.top) / (vh + r.height);
      // Le hero est déjà visible au chargement : sa progression part de son haut.
      if (scene.classList.contains("hero")) p = -r.top / r.height + 0.15;
      scene.style.setProperty("--p", Math.min(1, Math.max(0, p)).toFixed(4));
    }
    const y = window.scrollY;
    for (const el of parallax) el.style.transform = `translateX(${(y * Number(el.dataset.parallax)).toFixed(1)}px)`;
    const max = document.documentElement.scrollHeight - vh;
    root.style.setProperty("--page", max > 0 ? (y / max).toFixed(4) : 0);
    nav.classList.toggle("solid", y > 40);
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }

  if (!reduced) {
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  } else {
    window.addEventListener("scroll", () => nav.classList.toggle("solid", window.scrollY > 40), { passive: true });
  }
  update();
})();
