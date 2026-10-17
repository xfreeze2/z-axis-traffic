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
- Every car is built procedurally from primitives and merged into one geometry per model, with vertex colours. Traffic is drawn with `InstancedMesh`, so 3 models cost about 6 draw calls.
- Thruster jets are a single instanced additive shader, lit up with UnrealBloomPass.
- Smoke trails are GPU particles: a ring buffer of points whose motion and fade are computed in the shader, with a capped particle count.
- Sound is all WebAudio: thruster hiss, whoosh, chime, ticket beep and crash.
- Pixel ratio drops automatically when the frame rate falls.
