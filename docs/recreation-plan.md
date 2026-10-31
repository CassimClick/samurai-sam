# Samurai Sam: recreation instructions

> **Status: done.** The game is rebuilt. See `README.md` (play with `dist/index.html`).
> In the end, instead of re-implementing the game in Phaser, the original ActionScript, timelines and
> art run on a small custom Flash-compatible TypeScript engine (`src/flash/`). That gives exact visuals and
> identical moves and timings. The plan below is kept for reference.

Goal: an HTML5 remake that plays like the 2006 Miniclip original, built from the original's own code, art and level data.

---

## 1. Get the original files

Put them in `original/`. Treat them as reference input; nothing from this folder is executed directly.

```bash
mkdir -p original && cd original
WB=https://web.archive.org/web
curl -L -o samuraisam.swf "$WB/20081122080742id_/http://www.miniclip.com/games/samurai-sam/cn/samuraisam.swf"
curl -L -o forest.xml     "$WB/20090311044809id_/http://www.miniclip.com/samuraisam/forest.xml"
curl -L -o beach.xml      "$WB/20081010145305id_/http://www.miniclip.com/samuraisam/beach.xml"
# optional: 2006 build, for comparison
curl -L -o samuraisam_2006.swf "$WB/20060411154926id_/http://www.miniclip.com:80/samuraisam/samuraisam.swf"
```

Check: the SWF starts with `CWS` and is version 8, 3,116,534 bytes, SHA-1 `badffbd6fd11a918f7a9eab92ae0034488dc4bd7`.
⚠️ Use the **2009** `forest.xml`. The 2008 capture is cut off partway through `<route>`.

## 2. Tools

| Tool | Use |
|---|---|
| **JPEXS FFDec** (github.com/jindrapetrik/jpexs-decompiler, needs Java) | Decompile AS2, export sprites, shapes, sounds and fonts |
| **Ruffle** (ruffle.rs, desktop build) | Play the original as the "ground truth" reference |
| **rea** (`npm i -g rea-agents`) | Browser screenshot/capture comparison of original vs remake, and JS analysis of the remake. It **cannot read SWF**. |
| **Phaser 3 + TypeScript + Vite** | Remake engine (recommended) |
| free-tex-packer / TexturePacker | Pack the exported frames into sprite atlases |

## 3. Extract everything

```bash
ffdec -export script        extract/scripts  original/samuraisam.swf   # AS2 source
ffdec -format sprite:png -export sprite extract/sprites original/samuraisam.swf  # animation frames
ffdec -format shape:svg  -export shape  extract/shapes  original/samuraisam.swf  # vector tiles
ffdec -export image,sound,font,text     extract/misc    original/samuraisam.swf
```

Then:
- Read `extract/scripts`. Key names to search for: `gravity`, `runSpeed`, `walkSpeed`, `airFriction`, `jumpCount`, `jumpDelayDefault`, `comboCount`, `comboDamage`, `comboXPush/YPush`, `ballistaDamage`, `longAttackSpeed`, `applyGravity`, `hitTest`, `endOfMap`, `mapOrder`, `cumulativeScore`.
- Copy every numeric constant into `docs/constants.md`. These are what make the game *feel* the same.
- The player sprite is exported as `ninja`. Each animation is a frame label inside it: `run`, `jump1/2`, `strike1-4`, `uppercut`, `power_slash`, `bladed_fury`, `dragon_fire`, `deadly_dive`, `windmill`, `stars`, `defend`, `deflect`, `injured`, `dead`, plus `air_*` variants. Export each label as its own animation.
- Enemies: `karate`, `axe`, `tonfa`, `shogun`. FX: `hurt_blood_*`, `sparkHit_*`, `shockwaveDefendHit`. Sounds: `ninjah_*`, `enemy_*`, `thud_impact`, `windmill`, etc.

## 4. Level format (from forest.xml / beach.xml)

```
<file>
  <type>Map</type>
  <objects>  <o id ty="bg|solid|platform|ladder|door|switch|hurt|cloud|checkpoint"
                ti="spriteName,x,y,spriteName,x,y…"  s="w,h"/>   ← tile definitions
  <map>             placements of the objects                 ← level layout
  <movablegroups>   moving platforms / doors
  <enemies>  <e id iid xy="x,y" p="type,health,?"/>          ← enemy spawns
  <lockoffgroups>   arena locks (doors close until enemies die)
  <waypoints>       AI navigation nodes
  <route>    <r rA="from,to,next"/>                          ← precomputed AI path table
</file>
```

These meanings are inferred from the data. Confirm them against the decompiled map loader before relying on them. Write a converter (`tools/xml2json.ts`) that turns each XML file into a JSON level the remake loads. Order: forest → beach (the beach level includes the ship section).

## 5. Build order

1. **Scaffold**: Vite + Phaser 3 + TS, 640×360 canvas scaled up, fixed 25 fps logic tick (the original's rate).
2. **Level renderer**: load the JSON, draw the tiles from the atlases, camera follows the player.
3. **Player movement**: run, double jump, ladders, collision with `solid`/`platform`, `hurt` tiles. Use the extracted constants.
4. **Combat**: the 4-hit `strike` combo, defend/deflect, throwing stars, specials, hitboxes, knockback (`comboXPush/YPush`).
5. **Enemies**: port the AS2 AI (hunt, gap/obstacle jumping, `longAttackJump`, waypoint `route` table).
6. **Game systems**: health/lives HUD, checkpoints, switches and doors, lock-off arenas, score, level end.
7. **Menus**: title (PLAY / INSTRUCTIONS / HIGH SCORES / CONTROLS), rebindable keys (default ← → ↑ ↓, Space jump, Z attack, X defend), game over, local high scores.
8. **Audio**: hook sounds to the matching animation frames, as the original did.

## 6. Verify against the original

- Run the original in Ruffle with the XML files served locally. It requests `http://www.miniclip.com/samuraisam/*.xml`, so either patch that URL in FFDec or serve the files from a local server.
- Use rea to compare the two in Chrome:
  `rea inspect-web-page`, `rea capture-web-screenshot`, `rea compare-web-screenshots` (same level, same position).
- Feel test: measure jump height/distance, run speed and combo timing in both. Match within a few pixels and frames.

## 7. Known gaps
- `urban` stage and `test.xml` were never released. Recreate them yourself or leave them out.
- Miniclip's high-score service (`highscore.swf`) is gone. Use localStorage instead.
- Copyright: keep the remake private, or get permission from Miniclip and Adam Searle before publishing it.
