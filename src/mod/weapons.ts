// Weapon switching mod: Sword (original) -> Throwing stars -> Machine gun, cycled with Q.
//
// It hooks two of the game's own ActionScript functions on _root:
//  - attackPressed: with stars/gun selected, a plain attack press throws/fires instead of the
//    sword combo. Direction + attack specials (uppercut, windmill, power slash...) still work.
//  - ninjaAttackCollision: runs once per game frame, so projectiles, effects and the weapon
//    state advance in step with the game (and stop when it is paused).
// Projectile hits are applied by the game's own ninjaAttackCollision, called with a stand-in
// "ninja" at the projectile, so damage, knockback, blood, sparks, sounds and score are original.
import type { MovieClip } from '../flash/display';
import { apply, multiply } from '../flash/matrix';
import type { Player } from '../flash/player';
import type { Matrix } from '../flash/types';
import { EJECT, MUZZLE, drawCasing, drawGun, drawLabel, drawMuzzleFlash, drawSwordIcon, drawTracer } from './art';
import { Abilities } from './abilities';
import { attachDrawSprite, type DrawSprite } from './draw-sprite';
import { WeaponSfx } from './sfx';

const KEY_Q = 81;
const SWORD = 0;
const STARS = 1;
const GUN = 2;
const NAMES = ['SWORD', 'NINJA STARS', 'MACHINE GUN'];

/** Original nin_star vector shape (the unused throwing star art from the SWF). */
const STAR_SHAPE = 158;

// Tuning (game runs at 25 frames per second).
const STAR_DAMAGE = 25; // sword combo hit = 20, enemies have ~100 health
const STAR_SPEED = 17;
const BULLET_DAMAGE = 7;
const BULLET_SPEED = 30;
const FIRE_INTERVAL = 3; // frames between rounds (~8 rounds/s)
const GUN_RELEASE_FRAMES = 6; // how long the aim pose holds after letting go

// ninja_mc animation frames (labels: stars 8, stars_start 11, stars_end 21, air_stars 29 ...).
const STAR_SEQ_GROUND = [9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26];
const STAR_RELEASE_GROUND = 14;
const STAR_REPEAT_GROUND = 1; // index to jump back to for a quick follow-up throw
const STAR_SEQ_AIR = [29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 41, 42];
const STAR_RELEASE_AIR = 32;
const STAR_REPEAT_AIR = 1;
const GUN_POSE_GROUND = 17; // arm straight out, no star drawn in the hand
const GUN_POSE_AIR = 36;
// Hand position (ninja clip space, facing left) in those poses.
const HAND_GROUND = { x: -19, y: -1 };
const HAND_AIR = { x: -15, y: -1 };
const STAR_HAND_GROUND = { x: -26, y: -9 };
const STAR_HAND_AIR = { x: -27, y: -6 };

const FX_DEPTH = 23500; // in the level's "chars" layer: above enemies (20001+) and the ninja (23000)
const GUN_DEPTH = 500; // inside the ninja clip, above its animation
const HUD_DEPTH = 2_000_000; // on _root, above everything

interface Projectile {
  kind: 'star' | 'bullet';
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  life: number;
  stuck: number; // >0: star embedded in a wall, frames left
}

interface Particle {
  kind: 'casing' | 'spark' | 'smoke' | 'text';
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  max: number;
  text?: string;
}

interface Action {
  kind: 'stars' | 'gun';
  air: boolean;
  index: number; // stars: position in sequence
  again: boolean; // stars: another throw requested
  cooldown: number; // gun: frames to next round
  release: number; // gun: frames since the key was let go
  frame: number; // animation frame we set last
}

const WRAPPED = Symbol('weaponModWrapped');

export class WeaponMod {
  weapon = SWORD;
  private player: Player;
  private sfx: WeaponSfx;
  readonly abilities: Abilities;
  private action: Action | null = null;
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private qWasDown = false;
  private origCollision: ((...a: any[]) => any) | null = null;
  private fx: DrawSprite | null = null;
  private fxParent: MovieClip | null = null;
  private gun: DrawSprite | null = null;
  private hud: DrawSprite | null = null;
  private hudFlash = 0;
  private muzzle = 0;
  private muzzleSeed = 0;
  private recoil = 0;
  private frame = 0;

  constructor(player: Player) {
    this.player = player;
    this.sfx = new WeaponSfx(player.audio);
    this.abilities = new Abilities(player, this.sfx);
    player.tickHooks.push(() => this.install());
  }

  // ------------------------------------------------------------------ setup
  private get root(): any {
    return this.player.root;
  }

  private inLevel(): boolean {
    const r = this.root;
    const n = r.ninja;
    const chars = r.game?.path?.chars;
    return !!(n && n.clip && !n.clip.$removed && chars && !chars.$removed && n.clip.$parent === chars);
  }

  /** (Re)wraps the game functions; the game redefines them whenever a level loads. */
  private install() {
    const r = this.root;
    const mod = this;
    const collide = r.ninjaAttackCollision;
    if (typeof collide === 'function' && !collide[WRAPPED]) {
      this.origCollision = collide;
      const wrapped = function (this: any, ...args: any[]) {
        const res = collide.apply(this, args);
        mod.update();
        return res;
      };
      (wrapped as any)[WRAPPED] = true;
      r.ninjaAttackCollision = wrapped;
    }
    const pressed = r.attackPressed;
    if (typeof pressed === 'function' && !pressed[WRAPPED]) {
      const wrapped = function (this: any, ...args: any[]) {
        if (mod.weapon === SWORD || !mod.inLevel() || mod.isSpecialInput()) {
          if (mod.action) return; // no specials mid-throw / mid-burst
          return pressed.apply(this, args);
        }
        mod.rangedPressed();
        const kt = r.keyTracker;
        if (kt?.[0]) {
          kt[0].key = '';
          kt[0].timer = 0;
        }
      };
      (wrapped as any)[WRAPPED] = true;
      r.attackPressed = wrapped;
    }
    for (const [name, wrap] of [
      ['jumpPressed', (f: any) => this.abilities.wrapJump(f)],
      ['enemyAttackCollision', (f: any) => this.abilities.wrapEnemyAttack(f)],
    ] as const) {
      const f = r[name];
      if (typeof f === 'function' && !f[WRAPPED]) {
        const w = wrap(f);
        (w as any)[WRAPPED] = true;
        r[name] = w;
      }
    }
    if (!this.hud || this.hud.$removed || this.hud.$parent !== this.player.root) {
      this.hud = attachDrawSprite(this.player, this.player.root, HUD_DEPTH, (ctx, w) => this.drawHud(ctx, w), [0, 0, 640, 360]);
    }
  }

  /** Same conditions attackPressed uses to pick a special move instead of the combo. */
  private isSpecialInput(): boolean {
    const r = this.root;
    const kt = r.keyTracker;
    const n = r.ninja;
    if (!kt?.[0] || !kt[1]) return false;
    const fwd = (kt[0].key === 'left' && n.clip._xscale > 0) || (kt[0].key === 'right' && n.clip._xscale < 0);
    if (kt[0].timer > 0 && kt[1].timer > 0 && fwd && (kt[1].key === 'down' || kt[1].key === 'up')) return true;
    if (kt[0].key === 'up' && kt[0].timer >= 0) return true;
    if (kt[0].key === 'down' && kt[0].timer > 0) return true;
    return false;
  }

  // ------------------------------------------------------------------ per game frame
  private update() {
    if (!this.inLevel()) return;
    const r = this.root;
    const n = r.ninja;
    const chars = r.game.path.chars as MovieClip;
    this.frame++;

    if (this.fxParent !== chars || !this.fx || this.fx.$removed) {
      this.projectiles = [];
      this.particles = [];
      this.action = null;
      this.abilities.reset();
      this.fxParent = chars;
      this.fx = attachDrawSprite(this.player, chars, FX_DEPTH, (ctx, w) => this.drawFx(ctx, w), [-1e5, -1e5, 1e5, 1e5]);
    }
    if (!this.gun || this.gun.$removed || this.gun.$parent !== n.clip) {
      this.gun = attachDrawSprite(this.player, n.clip, GUN_DEPTH, (ctx) => this.drawHeldGun(ctx), [-30, -12, 14, 12]);
      this.gun.$visible = false;
    }

    const q = this.player.input.isDown(KEY_Q);
    if (q && !this.qWasDown && n.alive) this.cycleWeapon();
    this.qWasDown = q;

    this.updateAction();
    this.abilities.update(!!this.action);
    this.updateProjectiles();
    this.updateParticles();
    if (this.hudFlash > 0) this.hudFlash--;
    if (this.muzzle > 0) this.muzzle--;
    this.recoil *= 0.4;
    this.gun.$visible = this.action?.kind === 'gun';
  }

  private cycleWeapon() {
    if (this.action) this.endAction(true);
    this.weapon = (this.weapon + 1) % 3;
    this.hudFlash = 14;
    const n = this.root.ninja;
    const pan = this.pan(n.xPos);
    if (this.weapon === GUN) this.sfx.gunCock(pan);
    else if (this.weapon === STARS) this.sfx.starSelect(pan);
    else this.root.createSoundEffect?.('ninjah_sheath1', 70, pan * 100);
    this.particles.push({
      kind: 'text', text: NAMES[this.weapon], x: n.xPos + n.width / 2, y: n.yPos - 14,
      vx: 0, vy: -0.8, rot: 0, vr: 0, life: 30, max: 30,
    });
  }

  // ------------------------------------------------------------------ actions
  private rangedPressed() {
    const n = this.root.ninja;
    if (this.action) {
      if (this.action.kind === 'stars') this.action.again = true;
      return;
    }
    if (!n.alive || n.onLadder || n.inRoll || n.inHurting || n.inDefend) return;
    if (n.preventComboAttack || n.preventSpecialAttack || n.comboLocked) return;
    const air = !n.onGround;
    n.preventLadder = true;
    n.preventSpecialAttack = true;
    n.preventComboAttack = true;
    n.preventDefend = true;
    n.preventJump = true;
    n.preventRoll = true;
    n.currentAttack = false; // keep the sword's hit zone out of it
    n.comboCount = 0;
    n.xLock = true;
    if (air) this.hover(n, this.weapon === GUN ? 0.3 : 0.15);
    this.action = {
      kind: this.weapon === GUN ? 'gun' : 'stars', air, index: 0, again: false, cooldown: 0, release: 0, frame: 0,
    };
    n.clip.nin_anim?.coded_head?.head?.gotoAndStop?.('attack');
    n.clip.nin_anim?.head?.gotoAndStop?.('attack');
    this.updateAction(true);
  }

  /** Air attack physics like the original's air moves: hang briefly, drift down slowly. */
  private hover(n: any, factor: number) {
    n.yLock = true;
    n.yMove = 0;
    n.yIncrementalMovementRequest = 0;
    n.yMovementRequest = 0;
    n.yMovementFactor = factor;
    n.xMovementFactor = 0;
  }

  private updateAction(first = false) {
    const a = this.action;
    if (!a) return;
    const n = this.root.ninja;
    const anim = n.clip.nin_anim as MovieClip | undefined;
    if (!n.alive || n.inHurting) {
      this.action = null; // the hurt/death code already reset the ninja's state
      return;
    }
    if (!anim || n.inRoll || n.onLadder || n.inDefend) return this.endAction(true);

    if (a.kind === 'stars') {
      if (!first) a.index++;
      const seq = a.air ? STAR_SEQ_AIR : STAR_SEQ_GROUND;
      if (a.air && n.onGround) return this.endAction(); // landed mid-throw
      const releaseFrame = a.air ? STAR_RELEASE_AIR : STAR_RELEASE_GROUND;
      const releaseIdx = seq.indexOf(releaseFrame);
      if (a.again && a.index > releaseIdx + 2) {
        a.again = false;
        a.index = a.air ? STAR_REPEAT_AIR : STAR_REPEAT_GROUND;
        if (a.air) this.hover(n, 0.15);
      }
      if (a.index >= seq.length) return this.endAction();
      a.frame = seq[a.index];
      anim.gotoAndStop(a.frame);
      if (a.frame === releaseFrame) this.throwStar(a.air);
      return;
    }

    // Machine gun: hold the aim pose, fire while the attack key is held.
    if (a.air && n.onGround) {
      a.air = false;
      n.yLock = false;
      n.yMovementFactor = 1;
      n.xMovementFactor = 1;
    }
    a.frame = a.air ? GUN_POSE_AIR : GUN_POSE_GROUND;
    anim.gotoAndStop(a.frame);
    const held = this.player.input.isDown(+n.attackKey);
    if (a.cooldown > 0) a.cooldown--;
    if (held) {
      a.release = 0;
      if (a.cooldown <= 0) {
        this.fireRound(a.air);
        a.cooldown = FIRE_INTERVAL;
      }
    } else if (++a.release > GUN_RELEASE_FRAMES) {
      this.endAction();
    }
  }

  private endAction(interrupted = false) {
    const n = this.root.ninja;
    this.action = null;
    if (this.gun) this.gun.$visible = false;
    if (!n?.alive) return;
    if (interrupted && (n.inRoll || n.onLadder || n.inDefend)) {
      // Something else took over the animation: only release what we locked.
      n.xLock = false;
      n.yLock = false;
      n.preventJump = false;
      n.preventRoll = false;
      n.preventLadder = false;
      n.preventSpecialAttack = false;
      n.preventComboAttack = false;
      n.preventDefend = false;
      n.xMovementFactor = 1;
      n.yMovementFactor = 1;
      return;
    }
    // Same clean-up the original special moves use (back to "still" or "drop").
    this.root.ninjaAnimationUpdate?.('exitSpecialMove');
  }

  // ------------------------------------------------------------------ spawning
  /** Ninja clip-local point -> level coordinates. */
  private fromNinja(x: number, y: number): [number, number] {
    const clip = this.root.ninja.clip as MovieClip;
    return apply(clip.$matrix, x, y);
  }

  private facing(): number {
    // Art faces left; a mirrored clip (negative x scale) faces right.
    return (this.root.ninja.clip as MovieClip).$matrix[0] >= 0 ? -1 : 1;
  }

  private throwStar(air: boolean) {
    const hand = air ? STAR_HAND_AIR : STAR_HAND_GROUND;
    const [x, y] = this.fromNinja(hand.x, hand.y);
    const dir = this.facing();
    // In the air the star is thrown diagonally down, so it can reach enemies on the ground.
    const vy = air ? STAR_SPEED * 0.42 : 0.6;
    this.projectiles.push({ kind: 'star', x, y, vx: dir * STAR_SPEED, vy, rot: 0, life: 45, stuck: 0 });
    this.sfx.starThrow(this.pan(x));
  }

  private fireRound(air: boolean) {
    const hand = air ? HAND_AIR : HAND_GROUND;
    const dir = this.facing();
    const [mx, my] = this.fromNinja(hand.x + MUZZLE.x, hand.y + MUZZLE.y);
    const spread = (Math.random() - 0.5) * 1.4;
    this.projectiles.push({ kind: 'bullet', x: mx, y: my, vx: dir * BULLET_SPEED, vy: spread, rot: 0, life: 22, stuck: 0 });
    this.muzzle = 3;
    this.muzzleSeed = Math.random();
    this.recoil = 2.2;
    this.sfx.gunShot(this.pan(mx));
    // Spent casing flips out of the ejection port, backwards and up.
    const [ex, ey] = this.fromNinja(hand.x + EJECT.x, hand.y + EJECT.y);
    this.particles.push({
      kind: 'casing', x: ex, y: ey, vx: -dir * (1.5 + Math.random() * 2), vy: -4 - Math.random() * 2,
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 1.4, life: 18, max: 18,
    });
    this.particles.push({
      kind: 'smoke', x: mx + dir * 2, y: my, vx: dir * 0.6, vy: -0.5, rot: 0, vr: 0, life: 10, max: 10,
    });
  }

  // ------------------------------------------------------------------ projectiles
  private update_targets() {
    const r = this.root;
    const chars = r.game.path.chars as MovieClip;
    const list: { id: string; e: any; b: [number, number, number, number] }[] = [];
    for (const id in r.game.enemyVisible) {
      const e = r.enemies?.[id];
      const hz = e?.clip?.hitzone_body1;
      if (!e?.alive || !hz || hz.$removed) continue;
      const b = hz.$boundsIn(chars);
      if (b) list.push({ id, e, b });
    }
    return list;
  }

  private solidAt(x: number, y: number): boolean {
    const g = this.root.game;
    for (const k in g.objectSolidVisible) {
      if (x >= g.objectXLeftPos[k] && x <= g.objectXRightPos[k] && y >= g.objectYTopPos[k] && y <= g.objectYBottomPos[k]) return true;
    }
    return false;
  }

  private updateProjectiles() {
    if (!this.projectiles.length) return;
    const g = this.root.game;
    const targets = this.update_targets();
    const viewX = (g.xScreenPos ?? 0) + 320;
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      if (p.stuck > 0) {
        if (--p.stuck > 0) keep.push(p);
        continue;
      }
      if (p.kind === 'star') p.rot += 0.75;
      let alive = true;
      const speed = Math.hypot(p.vx, p.vy);
      const steps = Math.max(1, Math.ceil(speed / 6));
      for (let s = 0; s < steps && alive; s++) {
        p.x += p.vx / steps;
        p.y += p.vy / steps;
        const hit = targets.find((t) => p.x >= t.b[0] && p.x <= t.b[2] && p.y >= t.b[1] && p.y <= t.b[3]);
        if (hit) {
          if (this.applyHit(hit.id, p)) {
            alive = false;
            this.sparks(p.x, p.y, p.kind === 'bullet' ? 4 : 6, -Math.sign(p.vx));
          }
          continue;
        }
        if (this.solidAt(p.x, p.y)) {
          alive = false;
          const pan = this.pan(p.x);
          if (p.kind === 'star') {
            this.sfx.starClink(pan);
            p.stuck = 30; // stays stuck in the wall for a moment
            p.x -= p.vx / steps;
            keep.push(p);
          } else {
            this.sfx.bulletImpact(pan);
          }
          this.sparks(p.x, p.y, p.kind === 'bullet' ? 5 : 4, -Math.sign(p.vx));
        }
      }
      if (alive && --p.life > 0 && Math.abs(p.x - viewX) < 560) keep.push(p);
    }
    this.projectiles = keep;
  }

  /**
   * Lets the game's own hit code resolve a projectile hit: _root.ninja is briefly replaced by
   * a stand-in located at the projectile whose attack zone touches only the target enemy.
   */
  private applyHit(id: string, p: Projectile): boolean {
    const r = this.root;
    const collide = this.origCollision;
    const real = r.ninja;
    const target = r.enemies[id];
    if (!collide || !real || !target) return false;
    const hz = target.clip.hitzone_body1;
    const hitzone = { hitTest: (o: unknown) => o === hz, gotoAndPlay() {} };
    // Knockback goes away from where the shot came from.
    const fromX = p.vx > 0 ? Math.min(p.x, target.xPos - 1) : Math.max(p.x, target.xPos + 1);
    const over: Record<string | symbol, any> = {
      xPos: fromX,
      width: 0,
      currentAttack: p.kind === 'star' ? 'combo' : 'windmill',
      currentComboCount: 1,
      onGround: true,
      clip: { nin_anim: { hitzone_attack1: hitzone }, _xscale: p.vx < 0 ? 100 : -100 },
      enemiesHit: {},
    };
    const standIn = new Proxy(real, {
      get: (t, k) => (k in over ? over[k] : t[k]),
      set: (t, k, v) => {
        if (k in over) over[k] = v;
        else t[k] = v; // e.g. score for a kill goes to the real ninja
        return true;
      },
    });
    const realAttack = r.attack;
    r.attack = {
      ...realAttack,
      comboDamage: STAR_DAMAGE,
      comboXPush: 3,
      comboYPush: 0,
      windmillDamage: BULLET_DAMAGE,
      windmillXPush: 1.5,
      windmillYPush: 0,
    };
    r.ninja = standIn;
    try {
      collide.call(r);
    } finally {
      r.ninja = real;
      r.attack = realAttack;
    }
    return over.enemiesHit[id] === true;
  }

  private sparks(x: number, y: number, count: number, dir: number) {
    for (let i = 0; i < count; i++) {
      const a = (Math.random() - 0.5) * 2.2 + (dir < 0 ? Math.PI : 0);
      const s = 2 + Math.random() * 4;
      this.particles.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, rot: 0, vr: 0, life: 6, max: 6 });
    }
  }

  private updateParticles() {
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.kind === 'casing') p.vy += 0.9;
      else if (p.kind === 'spark') p.vy += 0.6;
      else if (p.kind === 'smoke') {
        p.vx *= 0.85;
        p.vy *= 0.9;
      }
      if (--p.life > 0) keep.push(p);
    }
    this.particles = keep;
  }

  private pan(x: number): number {
    const sx = this.root.game?.xScreenPos ?? 0;
    return Math.max(-1, Math.min(1, ((x - sx) / 640) * 2 - 1));
  }

  // ------------------------------------------------------------------ drawing
  private drawHeldGun(ctx: CanvasRenderingContext2D) {
    const a = this.action;
    if (!a || a.kind !== 'gun') return;
    const hand = a.air ? HAND_AIR : HAND_GROUND;
    ctx.translate(hand.x, hand.y);
    drawGun(ctx, this.recoil);
    if (this.muzzle > 0) drawMuzzleFlash(ctx, this.muzzleSeed, this.muzzle >= 2 ? 1 : 0.6);
  }

  /** Projectiles and particles, drawn in level coordinates inside the "chars" layer. */
  private drawFx(ctx: CanvasRenderingContext2D, world: Matrix) {
    for (const p of this.particles) {
      const t = p.life / p.max;
      if (p.kind === 'casing') drawCasing(ctx, p.x, p.y, p.rot);
      else if (p.kind === 'smoke') {
        ctx.fillStyle = `rgba(215,215,220,${0.22 * t})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 + (1 - t) * 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255,${200 + Math.floor(55 * t)},120,${t})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.8, p.y - p.vy * 0.8);
        ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'text') {
        ctx.save();
        ctx.globalAlpha *= Math.min(1, t * 3);
        drawLabel(ctx, p.text!, p.x, p.y, 13, p.text === NAMES[GUN] ? '#ffd24a' : '#ffffff');
        ctx.restore();
      }
    }
    for (const p of this.projectiles) {
      if (p.kind === 'bullet') {
        const len = Math.hypot(p.vx, p.vy);
        drawTracer(ctx, p.x, p.y, p.vx / len, p.vy / len, 20);
      } else {
        // Motion-blur ghosts, then the original star art itself.
        const dir = Math.sign(p.vx) || 1;
        if (!p.stuck) {
          for (const [off, alpha] of [[10, 0.18], [5, 0.35]] as const) this.renderStar(world, p.x - dir * off, p.y, p.rot - off * 0.08, alpha);
        }
        this.renderStar(world, p.x, p.y, p.rot, p.stuck ? Math.min(1, p.stuck / 10) : 1);
      }
    }
    this.abilities.drawFx(ctx);
  }

  private renderStar(world: Matrix, x: number, y: number, rot: number, alpha: number) {
    const c = Math.cos(rot) * 0.9;
    const s = Math.sin(rot) * 0.9;
    const m = multiply(world, [c, s, -s, c, x, y]);
    const ctx = this.player.ctx;
    ctx.save(); // the shape renderer sets its own transform
    this.player.shapes.render(STAR_SHAPE, m, alpha < 1 ? [1, 1, 1, alpha, 0, 0, 0, 0] : null);
    ctx.restore();
  }

  /** Weapon selector (top-left): navy panel with gold trim, like the ninja's outfit. */
  private drawHud(ctx: CanvasRenderingContext2D, world: Matrix) {
    if (!this.inLevel()) return;
    const x0 = 8, y0 = 8, slotW = 40, slotH = 30, gap = 4;
    const w = 3 * slotW + 2 * gap + 12 + 26 + 58, h = slotH + 12;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, 7);
    ctx.fillStyle = 'rgba(12,16,52,0.78)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#e0b030';
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(x0 + 2, y0 + 2, w - 4, h - 4, 5);
    ctx.stroke();

    for (let i = 0; i < 3; i++) {
      const sx = x0 + 6 + i * (slotW + gap);
      const sy = y0 + 6;
      const on = i === this.weapon;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(sx, sy, slotW, slotH, 5);
      if (on) {
        const g = ctx.createLinearGradient(0, sy, 0, sy + slotH);
        g.addColorStop(0, '#3a46b8');
        g.addColorStop(1, '#1a2170');
        ctx.fillStyle = g;
        ctx.shadowColor = 'rgba(255,210,80,0.9)';
        ctx.shadowBlur = 6 + this.hudFlash;
      } else ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = on ? 1.5 : 0.8;
      ctx.strokeStyle = on ? '#ffd24a' : 'rgba(224,176,48,0.35)';
      ctx.stroke();
      ctx.globalAlpha = on ? 1 : 0.42;
      const cx = sx + slotW / 2;
      const cy = sy + slotH / 2;
      const pop = on && this.hudFlash > 0 ? 1 + this.hudFlash * 0.025 : 1;
      if (i === SWORD) {
        ctx.translate(cx, cy);
        ctx.scale(pop, pop);
        drawSwordIcon(ctx);
      } else if (i === STARS) {
        const k = 1.45 * pop;
        const rot = on ? this.frame * 0.08 : 0;
        const m = multiply(world, [Math.cos(rot) * k, Math.sin(rot) * k, -Math.sin(rot) * k, Math.cos(rot) * k, cx, cy]);
        this.player.shapes.render(STAR_SHAPE, m, on ? null : [1, 1, 1, 0.42, 0, 0, 0, 0]);
      } else {
        ctx.translate(cx + 7, cy + 1);
        ctx.scale(0.95 * pop, 0.95 * pop);
        drawGun(ctx, 0, false);
      }
      ctx.restore();
    }

    // "Q" key cap.
    const kx = x0 + 6 + 3 * (slotW + gap) + 2;
    const ky = y0 + 10;
    ctx.beginPath();
    ctx.roundRect(kx, ky, 20, 20, 4);
    ctx.fillStyle = '#e9ecf2';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.fillStyle = '#b9bfcc';
    ctx.fillRect(kx + 1, ky + 16, 18, 3);
    ctx.fillStyle = '#10144a';
    ctx.font = 'bold 13px "swf-font-1565", Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Q', kx + 10, ky + 9);
    // Divider, then the bubble shield slot.
    ctx.strokeStyle = 'rgba(224,176,48,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(kx + 28, y0 + 8);
    ctx.lineTo(kx + 28, y0 + h - 8);
    ctx.stroke();
    ctx.restore();
    this.abilities.drawHudSlot(ctx, kx + 34, y0 + 6, slotH);

    drawLabel(ctx, NAMES[this.weapon], x0 + 6, y0 + h + 9, 12, this.weapon === GUN ? '#ffd24a' : '#ffffff', 'left');
  }
}
