# Samurai Sam: can it be recreated?

**Yes, very faithfully.** The original game files still exist, and the data is easy to read.

## What survives
| Piece | Status | Where |
|---|---|---|
| Game file `samuraisam.swf` (Miniclip, about 2006, by Adam Searle) | ✅ Complete, 3.1 MB | Wayback Machine (Internet Archive) |
| Level 1, `forest.xml` (118 enemies) | ✅ Complete (2009 copy) | Wayback Machine |
| Level 2, `beach.xml` (beach + ship, 65 enemies) | ✅ Complete | Wayback Machine |
| Code | ✅ ActionScript 2 (Flash 8), which decompiles almost perfectly | inside the SWF |
| Art | ✅ 570 animated objects, about 650 shapes, about 270 images | inside the SWF |
| Audio | ✅ 27 sound effects plus music | inside the SWF |

## What's inside (checked)
- Stage 640×360, 25 fps.
- Moves: `strike1-4` combo, `uppercut`, `power_slash`, `bladed_fury`, `dragon_fire`, `deadly_dive`, `windmill`, throwing `stars`, `defend` / `deflect`, plus air versions of the moves.
- Enemies: `karate`, `axe`, `tonfa`, `shogun`. Their AI hunts the player, jumps gaps and follows waypoint routes.
- Level pieces: solid blocks, platforms, ladders, doors, switches, checkpoints, thorns.
- Physics values exist by name: `gravity`, `runSpeed`, `walkSpeed`, `airFriction`, `jumpCount`, `comboDamage`.

## About `rea`
rea **cannot open Flash/SWF files**. It has no SWF support. It can still help in two places: screenshot-comparing the original (running in Ruffle, a Flash emulator) against the remake in Chrome, and analysing the remake's JavaScript. The main extraction tool will be **JPEXS FFDec**, a free SWF decompiler.

## Verdict
About **95% recoverable**: the code, art, sound and both levels. The `urban` stage and a third map (`test.xml`) were never released, so they can't be recovered.

⚠️ The art and code belong to Miniclip and Adam Searle. A personal remake is fine; ask permission before publishing it publicly.

Next steps are in `game.md`.
