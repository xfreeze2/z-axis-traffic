# Z-Axis Traffic 🚗💨

> "Traffic is a bit heavy in the Z-axis today."

A 3D browser arcade game inspired by @dereknee's viral post of a Tesla FSD visualization full of flying Teslas, and the Roadster reveal (Oct 16, 2026) with cold-gas thrusters: *"So yes, it can fly."*

**Play:** https://xfreeze2.github.io/z-axis-traffic/

You drive a white Roadster through a city grid drawn in the Tesla FSD style. The ground jams up, so hit **THRUST** to lift into the Z-axis. The sky is full of tumbling, thruster-powered Teslas (Model Ys, Cybertrucks, Roadsters) leaving smoke trails. Dodge them, chain near-misses for combo multipliers, grab charging-pressure orbs to refill the cold-gas tank, pull barrel rolls and kickflips, and land back in a lane for a bonus.

The speed limit is 35. On the ground you get a ticket for going over it. There is no speed limit in the Z-axis.

## Controls
| Action | Keyboard | Touch |
|---|---|---|
| Steer / throttle | WASD / arrow keys | Virtual joystick |
| Thrust (lift off) | Space | THRUST |
| Boost (surge, burns cold gas) | Shift | BOOST |
| Barrel roll | Q / E | ROLL |
| Kickflip | F | FLIP |

## Scoring
- Distance, with more points in the air
- Near miss: 50 × combo multiplier (combo times out after 3 s)
- Barrel roll 250 and kickflip 350, × multiplier. Land while still mid-trick and you crash.
- Landing: 100 plus airtime. Landing on a lane centre ("LANE PERFECT") adds 300 and is multiplied.
- Charge orb: refills 35% of the gas and gives 100 × multiplier
- Speeding ticket on the ground: −50

Your best score is saved in localStorage.

## Tech
The game is a static `index.html`, `main.js` and `style.css`, with three.js 0.170 loaded from the jsDelivr CDN through an importmap. There's no build step.
- Every car is built procedurally in code, with no model files. Bodies are lofted cross-sections (smooth shading, hard creases, cut-in wheel arches) topped by a teardrop glass canopy. Each vertex carries its own colour, roughness, metalness and clearcoat, so paint, glass, rubber and chrome share one draw call. Traffic is drawn with `InstancedMesh`. The player's 2026 Roadster is a higher-detail build with clearcoat paint, a slim front light bar, a red rear light bar, the RDSTR plate, rear cold-gas nozzles and fan vents, and spoked aero wheels that spin.
- Lighting uses a procedural studio environment (prefiltered with PMREM) for paint reflections, ACES tone mapping with sRGB output, a sun shadow that follows the player, contact shadows, a gradient night sky, a distant skyline, street lamps and asphalt.
- Thruster jets are a single instanced additive shader with soft edges and flicker, plus nozzle glow sprites, lit up with UnrealBloomPass. The Roadster's rear nozzles fire while boosting.
- Smoke trails are GPU particles: a ring buffer of points whose motion and fade are computed in the shader, with a capped particle count.
- Sound is all WebAudio: thruster hiss, whoosh, chime, ticket beep and crash.
- Quality is adaptive. Tier 3 is desktop: DPR 2, 4× MSAA, bloom and a 1024 shadow map. Phones start at tier 2 (DPR 1.5 with MSAA). The game drops a tier whenever FPS stays under 45, down to tier 0 (DPR 1, no post-processing), and steps up once if it holds 57+ FPS. Append `?q=0` to `?q=3` to force a tier.
