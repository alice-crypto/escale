// Transitions plein écran : pendant qu'on défile, chaque engin traverse l'écran
// et dévoile la section suivante. On calcule ici la progression (--t) de chaque transition.
(() => {
  const transitions = [...document.querySelectorAll("[data-tx]")];
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
    for (const tx of transitions) {
      const r = tx.getBoundingClientRect();
      // 0 quand l'écran se fige, 1 quand il repart : l'engin fait toute sa traversée entre les deux.
      const t = clamp(-r.top / (r.height - vh));
      const fade = clamp(1 - Math.abs(t - 0.45) * 2.6);
      tx.style.setProperty("--t", t.toFixed(4));
      tx.style.setProperty("--fade", fade.toFixed(3));
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
