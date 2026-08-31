/* ============================================================
   ATOMIK SELECTIONS · Finalist B "Chrome Sunset Poster" · vanilla JS, no deps
   1. pointer parallax  → ONE lerped CSS custom property (--par: "x y") on .rig; loop sleeps when settled
   2. launch-list form  → POST /api/subscribe {email, h_orbit}   (contract frozen; flow ported from CURRENT-script.js)
   3. success reward    → the starburst sticker flips to "DISCOUNT RESERVED ✓" (transform/opacity only)
   ============================================================ */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer  = window.matchMedia("(pointer: fine) and (hover: hover)").matches;
  const $ = (sel) => document.querySelector(sel);

  /* ------------------------------------------------------------
     1. PARALLAX — the only per-frame style write on the page: a single custom property
     ------------------------------------------------------------ */
  const rig = $(".rig");
  if (!reduceMotion && finePointer && rig) {
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let raf = 0;

    const tick = () => {
      cur.x += (target.x - cur.x) * 0.08;
      cur.y += (target.y - cur.y) * 0.08;
      rig.style.setProperty("--par", `${(cur.x * -16).toFixed(2)}px ${(cur.y * -10).toFixed(2)}px`);
      const settled = Math.abs(target.x - cur.x) < 0.002 && Math.abs(target.y - cur.y) < 0.002;
      raf = settled ? 0 : requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", (e) => {
      target.x = (e.clientX / window.innerWidth) * 2 - 1;   // -1 .. 1
      target.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
  }

  /* ------------------------------------------------------------
     2. LAUNCH-LIST FORM
     ------------------------------------------------------------ */
  const form  = $("#signal");
  const ack   = $("#signal-ack");
  const btn   = $("#signal-btn");
  const burst = $("#burst");
  const offer = $("#offer");

  const MESSAGES = {
    sending: "Sending…",
    invalid: "That email doesn't look right. Check it and try again.",
    new:     "You're on the list. Your launch discount lands in your inbox first.",
    already: "Already on the list — you're covered. Watch your inbox at liftoff.",
    rate:    "Too many tries. Wait a few minutes and try again.",
    bot:     "That didn't go through. Refresh the page and try again.",
    error:   "Couldn't send right now. Check your connection and try again.",
  };

  function say(state) {
    ack.setAttribute("data-state", state);
    ack.textContent = MESSAGES[state] || MESSAGES.error;
    ack.classList.remove("is-pop");
    void ack.offsetWidth;            // restart the pop (one layout read, only on submit)
    ack.classList.add("is-pop");
  }

  function reward() {
    for (const el of [burst, offer]) {
      if (!el) continue;
      el.classList.remove("is-won");
      void el.offsetWidth;
      el.classList.add("is-won");
    }
  }

  if (form && ack) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = form.querySelector("input[name=email]");
      const honey = form.querySelector("input[name=h_orbit]");
      const email = (input.value || "").trim();
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);

      if (!valid) {
        say("invalid");
        input.focus();
        return;
      }

      btn?.setAttribute("data-loading", "true");
      btn?.setAttribute("aria-busy", "true");
      say("sending");

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
          say("new");
          reward();
        } else if (status === "already") {
          input.value = "";
          say("already");
          reward();
        } else if (status === "invalid") {
          say("invalid");
        } else if (status === "blocked" && data?.reason === "rate_limit") {
          say("rate");
        } else if (status === "blocked") {
          say("bot");
        } else {
          say("error");
        }
      } catch {
        say("error");
      } finally {
        btn?.removeAttribute("data-loading");
        btn?.removeAttribute("aria-busy");
      }
    });
  }
})();
