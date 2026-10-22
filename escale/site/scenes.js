// Coutures entre sections : pendant qu'on défile, chaque engin traverse la frontière
// entre deux sections et la couleur suivante le suit. On calcule ici leur progression (--t).
(() => {
  const seams = [...document.querySelectorAll("[data-seam]")];
  const parallax = [...document.querySelectorAll("[data-parallax]")];
  const nav = document.querySelector(".nav");
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v) => Math.min(1, Math.max(0, v));

  // Apparition douce des blocs de contenu.
  const revealTargets = document.querySelectorAll(".steps li, .perk, .dest, .chat-card, .ext-card, .stay-grid > div, .villa, section h2");
  revealTargets.forEach((el) => el.classList.add("reveal"));
  if ("IntersectionObserver" in window && !reduced) {
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
    const remaining = root.scrollHeight - vh - window.scrollY; // ce qu'il reste à défiler
    for (const seam of seams) {
      // 0 quand la frontière entre deux sections apparaît en bas de l'écran,
      // 1 quand elle atteint le haut : l'engin traverse pendant ce temps.
      // Près du bas de page, la traversée se termine quand on arrive tout en bas.
      const y = seam.getBoundingClientRect().top;
      const start = vh * 0.95;
      const span = Math.max(1, Math.min(vh * 0.8, start - (y - remaining)));
      const t = clamp((start - y) / span);
      seam.style.setProperty("--t", t.toFixed(4));
    }
    const y = window.scrollY;
    for (const el of parallax) el.style.transform = `translateX(${(y * Number(el.dataset.parallax)).toFixed(1)}px)`;
    const max = root.scrollHeight - vh;
    root.style.setProperty("--page", max > 0 ? (y / max).toFixed(4) : 0);
    nav.classList.toggle("solid", y > 40);
  }

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
})();
