# LeoZOps Character Presence

Status: production component contract.

Character Presence represents LeoZOps as the Realm Archmage: a restrained,
medieval visual metaphor for an evidence-bound CEO advisor. It is not a safety
seal, execution indicator, human identity, or claim of autonomy.

## Composition

The component is one responsive stage assembled from independent assets:

| Layer | Runtime asset | Purpose |
|---|---|---|
| Observatory | `/cockpit/assets/observatory.webp` | dark environmental depth and negative space |
| Archmage | `/cockpit/assets/archmage-presence.webp` | consistent character identity across every state |
| Arcane orb | `/cockpit/assets/arcane-orb.webp` | evidence/voice activity focus |
| Runes and veil | CSS only | state color, contrast, and low-cost motion |
| State title/copy/chip | semantic HTML | the authoritative status; never inferred from art |

High-fidelity source PNGs live in `docs/design-system/assets`. Runtime WebP
derivatives live in `assets/cockpit`, are same-origin, and are safe for the
data-free service-worker shell. Never put tenant data into these assets.

## State contract

| State | Trigger | Visual token | Required text meaning |
|---|---|---|---|
| `dormant` | no in-memory read credential | muted steel | connect to awaken the advisor |
| `observing` | loading or accepted fresh evidence | malachite | reading tenant evidence; advisory only |
| `listening` | current Realtime lifecycle is listening | arcane teal | microphone active; audio is not retained |
| `thinking` | current Realtime lifecycle is thinking | restrained gold | grounding the turn in accepted evidence |
| `speaking` | current Realtime lifecycle is speaking | pale malachite | delivering a validated answer; interruption allowed |
| `warning` | stale, future-dated, offline, interrupted, or unavailable | ember amber | evidence risk; no action is permitted |

Voice state temporarily overrides snapshot presentation. Ending Talking Mode
must restore the state derived from network and snapshot freshness. Decorative
green must never convert unknown, stale, future-dated, or unavailable evidence
into `observing`.

## Motion and accessibility

- State is always exposed as title, explanatory copy, and a text-labelled chip.
- The asset stage is decorative and `aria-hidden`; dynamic text carries meaning.
- Listening breathes, thinking rotates two rune rings, and speaking pulses the
  aura. Animation uses only opacity and transform.
- `prefers-reduced-motion` collapses all animation to a single frame.
- High contrast strengthens the component border and body copy.
- At 760px and below, copy occupies the top region while the archmage and orb
  move to the lower stage; no horizontal scrolling is allowed at 390px.

## Asset direction and provenance

The master direction is a cinematic obsidian observatory, aged brass celestial
instruments, teal-and-gold evidence orb, black embroidered robe, warm candle
light, and realistic painterly detail. Exclude sci-fi panels, cyberpunk neon,
modern uniforms, weapons, brand text, and embedded UI labels.

The production pack was generated with ImageGen from the Realm Archmage master:

1. Empty observatory: preserve the architecture and lighting, remove the person,
   table, and central orb, keep 16:9 negative space.
2. Arcane orb: isolate the teal-and-gold astrolabe orb on real alpha, square,
   centered, with clean edges and no text.
3. Archmage: preserve identity, pose, costume, and embroidery on a flat chroma
   field, then perform deterministic alpha matting and WebP encoding.

Do not generate one face per state. State variants are composed from the one
canonical character plus tokens, runes, motion, and truthful status copy; this
prevents identity drift and reduces payload cost.
