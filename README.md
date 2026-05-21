# ATOMIK SELECTIONS · Coming Soon

Single-page cosmic landing for **Atomik Selections** — interstellar genetics.

A retro-futuristic mission-control HUD wrapped around a giant animated atom
with cannabis-leaf electrons orbiting a glowing nucleus, drifting nebulae,
star-field parallax, shooting stars, repelling cursor dust and a grainy
psychedelic atmosphere.

## Stack

- Plain **HTML + CSS + vanilla JS** — no build step, no framework.
- Fonts: **Monoton** (display), **Fraunces** (serif italic), **JetBrains Mono** (HUD/mono) via Google Fonts.
- SVG inline (atom, planets, leaves), `<canvas>` for cursor-repelling particles.
- CSS `offset-path` for elliptical electron orbits.
- Mouse parallax via lerped CSS custom properties.

## Run locally

It's static, so just open `index.html`. For a proper local server:

```bash
python3 -m http.server 8080
# or
npx serve .
```

Then visit <http://localhost:8080>.

## Files

```
.
├── index.html        # Structure + inline SVG defs
├── styles.css        # Everything visual
├── script.js         # Stars, parallax, particles, cursor, clock, form
├── assets/
│   └── logo.png      # White-on-transparent (converted from source)
└── README.md
```

## Notes

- The logo file in `assets/` is a white-on-transparent PNG converted from the
  original black-on-white artwork. The source artwork lives one directory up.
- `prefers-reduced-motion` is respected — animations and the particle loop
  shut down for visitors who request it.
- The HUD clock ticks in UTC; the rest of the readouts are decorative.
- Form submit is currently a fake transmit (no backend wired). When we plug
  in a real subscriber endpoint, the handler in `script.js` is the single
  place to update.

## License

Proprietary · © Atomik Selections
