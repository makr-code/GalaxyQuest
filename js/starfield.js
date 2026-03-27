/**
 * Animated starfield canvas background
 */
(function () {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, stars = [];
  const STAR_COUNT = 150;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function initStars() {
    stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x:       Math.random() * W,
        y:       Math.random() * H,
        r:       Math.random() * 0.9 + 0.15,
        speed:   Math.random() * 0.06 + 0.02,
        opacity: Math.random() * 0.32 + 0.12,
        drift:   (Math.random() - 0.5) * 0.035,
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const s of stars) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,220,255,${s.opacity})`;
      ctx.fill();

      // Slow drift downward + lateral
      s.y += s.speed;
      s.x += s.drift;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
      if (s.x < 0) s.x = W;
      if (s.x > W) s.x = 0;
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); initStars(); });
  resize();
  initStars();
  draw();
})();
