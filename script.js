/* ============================================================
   ATOMIK SELECTIONS · Coming Soon · interactivity
   vanilla JS, no deps
   ============================================================ */

(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouch = window.matchMedia("(pointer: coarse), (hover: none)").matches;

  /* ------------------------------------------------------------
     1. STAR FIELDS — generate radial-gradient backgrounds
     ------------------------------------------------------------ */
  function makeStarField({ count, tile, sizeRange, colors }) {
    const stars = [];
    for (let i = 0; i < count; i++) {
      const x = Math.random() * tile;
      const y = Math.random() * tile;
      const r = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
      const c = colors[Math.floor(Math.random() * colors.length)];
      const a = 0.5 + Math.random() * 0.5;
      stars.push(
        `radial-gradient(${r.toFixed(2)}px ${r.toFixed(2)}px at ${x.toFixed(1)}px ${y.toFixed(1)}px, rgba(${c},${a.toFixed(2)}) 0%, rgba(${c},0) 100%)`
      );
    }
    return stars.join(", ");
  }

  const starPalette = [
    "255,255,255",
    "255,220,250",
    "200,220,255",
    "220,200,255",
    "180,255,250",
  ];

  const $ = (sel) => document.querySelector(sel);

  const farField = makeStarField({ count: 40, tile: 380, sizeRange: [0.4, 1.0], colors: starPalette });
  const midField = makeStarField({ count: 28, tile: 260, sizeRange: [0.6, 1.4], colors: starPalette });
  const nearField = makeStarField({ count: 18, tile: 180, sizeRange: [0.9, 2.0], colors: starPalette });

  $("#stars-far").style.backgroundImage  = farField;
  $("#stars-mid").style.backgroundImage  = midField;
  $("#stars-near").style.backgroundImage = nearField;

  /* ------------------------------------------------------------
     2. SHOOTING STARS — random crossings
     ------------------------------------------------------------ */
  function spawnShootingStar() {
    if (reduceMotion) return;
    const layer = $("#shooting-stars");
    if (!layer) return;
    const el = document.createElement("div");
    el.className = "shoot";
    // start anywhere on top edge or right edge
    const startSide = Math.random() < 0.5 ? "top" : "right";
    let x, y;
    if (startSide === "top") {
      x = Math.random() * window.innerWidth;
      y = -40;
    } else {
      x = window.innerWidth + 40;
      y = Math.random() * (window.innerHeight * 0.6);
    }
    const angle = 20 + Math.random() * 30; // degrees down-left
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.transform = `rotate(${180 + angle}deg)`;
    el.style.animation = `shoot ${1.1 + Math.random() * 0.8}s cubic-bezier(.4,.1,.2,1) forwards`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  function shootingLoop() {
    spawnShootingStar();
    const next = 3500 + Math.random() * 6000;
    setTimeout(shootingLoop, next);
  }
  setTimeout(shootingLoop, 1800);

  /* ------------------------------------------------------------
     3. MOUSE PARALLAX — lerped CSS vars --mx, --my
     ------------------------------------------------------------ */
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };

  if (!isTouch) {
    window.addEventListener("pointermove", (e) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      target.x = (e.clientX - cx) / cx; // -1 .. 1
      target.y = (e.clientY - cy) / cy;
    }, { passive: true });
  } else {
    // gentle device orientation parallax on touch
    window.addEventListener("deviceorientation", (e) => {
      const beta = e.beta || 0;
      const gamma = e.gamma || 0;
      target.x = Math.max(-1, Math.min(1, gamma / 30));
      target.y = Math.max(-1, Math.min(1, (beta - 30) / 40));
    }, { passive: true });
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function parallaxTick() {
    current.x = lerp(current.x, target.x, 0.06);
    current.y = lerp(current.y, target.y, 0.06);
    document.documentElement.style.setProperty("--mx", current.x.toFixed(3));
    document.documentElement.style.setProperty("--my", current.y.toFixed(3));
    requestAnimationFrame(parallaxTick);
  }
  if (!reduceMotion) parallaxTick();

  /* ------------------------------------------------------------
     4. CUSTOM CURSOR
     ------------------------------------------------------------ */
  const cursor = $(".cursor");
  if (cursor && !isTouch) {
    const cTarget = { x: 0, y: 0 };
    const cPos = { x: 0, y: 0 };

    window.addEventListener("pointermove", (e) => {
      cTarget.x = e.clientX;
      cTarget.y = e.clientY;
    }, { passive: true });

    function cursorTick() {
      cPos.x = lerp(cPos.x, cTarget.x, 0.22);
      cPos.y = lerp(cPos.y, cTarget.y, 0.22);
      cursor.style.transform = `translate3d(${cPos.x}px, ${cPos.y}px, 0)`;
      requestAnimationFrame(cursorTick);
    }
    cursorTick();

    document.addEventListener("mousedown", () => cursor.classList.add("is-press"));
    document.addEventListener("mouseup",   () => cursor.classList.remove("is-press"));

    // hover-hot on interactive elements
    document.querySelectorAll("a, button, input, [data-hot]").forEach((el) => {
      el.addEventListener("pointerenter", () => cursor.classList.add("is-hot"));
      el.addEventListener("pointerleave", () => cursor.classList.remove("is-hot"));
    });
  }

  /* ------------------------------------------------------------
     5. PARTICLE CANVAS — drifting cosmic dust that repels from cursor
     ------------------------------------------------------------ */
  const canvas = $("#particles");
  const ctx = canvas.getContext("2d");
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;
  let particles = [];
  const mouse = { x: -9999, y: -9999, active: false };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // re-seed particles
    const target = Math.min(120, Math.floor((W * H) / 14000));
    particles = [];
    for (let i = 0; i < target; i++) particles.push(spawnParticle());
  }

  function spawnParticle(near) {
    const tint = Math.random();
    let color;
    if (tint < 0.45)      color = "168,117,255"; // violet
    else if (tint < 0.75) color = "255,122,217"; // pink
    else if (tint < 0.92) color = "117,240,255"; // cyan
    else                  color = "255,255,255"; // white
    return {
      x: near ? near.x : Math.random() * W,
      y: near ? near.y : Math.random() * H,
      vx: (Math.random() - 0.5) * 0.18,
      vy: -0.05 - Math.random() * 0.25, // drift up
      r:  0.5 + Math.random() * 1.6,
      base: 0.4 + Math.random() * 0.5,
      a: 0,
      life: 0,
      maxLife: 600 + Math.random() * 600,
      color,
    };
  }

  if (!isTouch) {
    window.addEventListener("pointermove", (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    }, { passive: true });
    window.addEventListener("pointerleave", () => { mouse.active = false; });
  }

  function step() {
    ctx.clearRect(0, 0, W, H);

    const RADIUS = 130;
    const RAD2 = RADIUS * RADIUS;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // repel from cursor
      if (mouse.active) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < RAD2 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const f = (1 - d / RADIUS) * 1.6;
          p.vx += (dx / d) * f * 0.6;
          p.vy += (dy / d) * f * 0.6;
        }
      }

      // gentle gravity toward center horizontally
      p.vx *= 0.985;
      p.vy *= 0.99;
      p.vy -= 0.002; // slight upward drift

      p.x += p.vx;
      p.y += p.vy;

      p.life++;
      // fade in then out
      const t = p.life / p.maxLife;
      p.a = (t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1) * p.base;

      // wrap / respawn
      if (
        p.x < -20 || p.x > W + 20 ||
        p.y < -20 || p.y > H + 20 ||
        p.life > p.maxLife
      ) {
        particles[i] = spawnParticle();
        continue;
      }

      // draw with glow
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.color},${p.a})`;
      ctx.shadowColor = `rgba(${p.color},${p.a * 0.8})`;
      ctx.shadowBlur = 8;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    requestAnimationFrame(step);
  }

  resize();
  window.addEventListener("resize", resize);
  if (!reduceMotion) step();

  /* ------------------------------------------------------------
     6. HUD CLOCK — UTC ticking
     ------------------------------------------------------------ */
  const timeEl = $("#time-readout");
  function tickClock() {
    if (!timeEl) return;
    const d = new Date();
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    timeEl.textContent = `UTC ${hh}:${mm}:${ss}`;
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ------------------------------------------------------------
     7. SIGNAL FORM — POST to /api/subscribe with typed ack
     ------------------------------------------------------------ */
  const form = $("#signal");
  const ack = $("#signal-ack");
  const btn = $("#signal-btn");

  const MESSAGES = {
    sending:  { text: "◌ TRANSMITTING SIGNAL ···",                  color: "var(--cyan)"     },
    invalid:  { text: "✕ FREQUENCY INVALID · CHECK SIGNAL",         color: "var(--pink-hot)" },
    new:      { text: "◉ SIGNAL LOCKED · TRANSMISSION QUEUED",      color: "var(--cyan)"     },
    already:  { text: "◉ ALREADY IN OUR ARCHIVES · STAY TUNED",     color: "var(--violet-hot)" },
    rate:     { text: "✕ TOO MANY ATTEMPTS · WAIT A FEW MINUTES",   color: "var(--pink-hot)" },
    bot:      { text: "✕ INTERFERENCE DETECTED · TRY AGAIN",        color: "var(--pink-hot)" },
    error:    { text: "✕ TRANSMISSION FAILED · TRY AGAIN LATER",    color: "var(--pink-hot)" },
  };

  if (form && ack) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = form.querySelector("input[name=email]");
      const honey = form.querySelector("input[name=h_orbit]");
      const email = (input.value || "").trim();
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);

      if (!valid) {
        typeOut(ack, MESSAGES.invalid.text, MESSAGES.invalid.color);
        return;
      }

      btn?.setAttribute("data-loading", "true");
      typeOut(ack, MESSAGES.sending.text, MESSAGES.sending.color);

      try {
        const r = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            h_orbit: honey?.value || "",
          }),
        });

        const data = await r.json().catch(() => ({}));
        const status = data?.status || "error";

        if (status === "new") {
          input.value = "";
          typeOut(ack, MESSAGES.new.text, MESSAGES.new.color);
        } else if (status === "already") {
          input.value = "";
          typeOut(ack, MESSAGES.already.text, MESSAGES.already.color);
        } else if (status === "invalid") {
          typeOut(ack, MESSAGES.invalid.text, MESSAGES.invalid.color);
        } else if (status === "blocked" && data?.reason === "rate_limit") {
          typeOut(ack, MESSAGES.rate.text, MESSAGES.rate.color);
        } else if (status === "blocked") {
          typeOut(ack, MESSAGES.bot.text, MESSAGES.bot.color);
        } else {
          typeOut(ack, MESSAGES.error.text, MESSAGES.error.color);
        }
      } catch {
        typeOut(ack, MESSAGES.error.text, MESSAGES.error.color);
      } finally {
        btn?.removeAttribute("data-loading");
      }
    });
  }

  function typeOut(el, text, color) {
    el.style.color = color;
    el.textContent = "";
    let i = 0;
    const tick = () => {
      if (i <= text.length) {
        el.textContent = text.slice(0, i) + (i < text.length ? "▍" : "");
        i++;
        setTimeout(tick, 28);
      }
    };
    tick();
  }

  /* ------------------------------------------------------------
     8. PAGE LOAD REVEAL
     ------------------------------------------------------------ */
  window.addEventListener("load", () => {
    requestAnimationFrame(() => {
      document.body.classList.remove("is-loading");
    });
  });

  // safety: if 'load' is missed
  setTimeout(() => document.body.classList.remove("is-loading"), 1200);

})();
