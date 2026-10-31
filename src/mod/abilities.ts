// Extra abilities:
//  - B: toggles a transparent bubble shield. While it is up, enemy strikes from any side are
//    blocked (they bounce off with a ripple and get shoved back).
//  - Triple jump: each Space press in the air jumps higher than the last; the third is a flip.
import type { MovieClip } from '../flash/display';
import { multiply } from '../flash/matrix';
import type { Player } from '../flash/player';
import type { Matrix } from '../flash/types';
import type { WeaponSfx } from './sfx';

const KEY_B = 66;
const BUBBLE_R = 46;
const BLOCK_PUSH = 12; // shove given to an enemy whose strike bounced off
/** Jump strength for the 1st (original), 2nd and 3rd jump. Gravity is 2.6/frame. */
const JUMP_POWER = [24, 31, 38];
const FLIP_FRAMES = 17;

interface Ripple {
  angle: number;
  life: number;
}
interface Puff {
  x: number;
  y: number;
  life: number;
  max: number;
  big: boolean;
}

export class Abilities {
  bubbleOn = false;
  private player: Player;
  private sfx: WeaponSfx;
  private bWasDown = false;
  private bubbleAge = 0; // frames since it went up
  private bubbleFade = 0; // frames of the pop-away animation left
  private hitFlash = 0;
  private ripples: Ripple[] = [];
  private jumpsDone = 0;
  private flip: { t: number; anim: MovieClip; base: Matrix } | null = null;
  private puffs: Puff[] = [];
  private frame = 0;

  constructor(player: Player, sfx: WeaponSfx) {
    this.player = player;
    this.sfx = sfx;
  }

  private get root(): any {
    return this.player.root;
  }

  private pan(x: number): number {
    const sx = this.root.game?.xScreenPos ?? 0;
    return Math.max(-1, Math.min(1, ((x - sx) / 640) * 2 - 1));
  }

  // ------------------------------------------------------------------ hooks
  /** Wraps _root.jumpPressed: extra 3rd jump, higher each time, flip on the 3rd. */
  wrapJump(orig: (...a: any[]) => any) {
    const ab = this;
    return function (this: any, ...args: any[]) {
      const n = ab.root.ninja;
      if (!n?.clip) return orig.apply(this, args);
      if ((n.onGround && n.yMove >= 0) || n.onLadder) ab.jumpsDone = 0;
      const canPress = n.jumpDelay == 0 && !n.preventJump && n.jumpKeyReleased && !n.inHurting;
      if (!canPress) return orig.apply(this, args);
      if (n.jumpCount <= 0) {
        // Out of normal jumps: grant the extra one(s), up to three jumps in the air.
        if (ab.jumpsDone >= 3 || n.onGround) return orig.apply(this, args);
        n.jumpCount = 1;
      }
      const which = Math.min(ab.jumpsDone + 1, 3);
      const before = n.jumpCount;
      n.jumpAmount = JUMP_POWER[which - 1];
      try {
        return orig.apply(this, args);
      } finally {
        n.jumpAmount = JUMP_POWER[0];
        if (n.jumpCount < before) {
          ab.jumpsDone = which;
          ab.onJump(which);
        }
      }
    };
  }

  /** Wraps _root.enemyAttackCollision: with the bubble up, nothing can touch the ninja. */
  wrapEnemyAttack(orig: (...a: any[]) => any) {
    const ab = this;
    return function (this: any, ...args: any[]) {
      const r = ab.root;
      const real = r.ninja;
      if (!ab.bubbleOn || !real?.clip) return orig.apply(this, args);
      ab.bounceStrikes();
      // Stand-in whose body hit zone is not a display object, so every hitTest misses.
      const body = { gotoAndPlay() {} };
      const over: Record<string | symbol, any> = { clip: { nin_anim: { hitzone_body1: body }, _xscale: real.clip._xscale } };
      const standIn = new Proxy(real, {
        get: (t, k) => (k in over ? over[k] : t[k]),
        set: (t, k, v) => {
          if (k in over) over[k] = v;
          else t[k] = v;
          return true;
        },
      });
      r.ninja = standIn;
      try {
        return orig.apply(this, args);
      } finally {
        r.ninja = real;
      }
    };
  }

  // ------------------------------------------------------------------ per game frame
  update(busy: boolean) {
    const r = this.root;
    const n = r.ninja;
    this.frame++;
    const b = this.player.input.isDown(KEY_B);
    if (b && !this.bWasDown && n.alive) this.toggleBubble();
    this.bWasDown = b;
    if (this.bubbleOn && !n.alive) this.toggleBubble();
    if (this.bubbleOn) this.bubbleAge++;
    if (this.bubbleFade > 0) this.bubbleFade--;
    if (this.hitFlash > 0) this.hitFlash--;
    this.ripples = this.ripples.filter((rp) => --rp.life > 0);
    this.puffs = this.puffs.filter((p) => --p.life > 0);

    if ((n.onGround && n.yMove >= 0) || n.onLadder) this.jumpsDone = 0;
    this.updateFlip(busy);
  }

  /** Drops everything tied to the old level (called when a new level starts). */
  reset() {
    this.flip = null;
    this.puffs = [];
    this.ripples = [];
    this.jumpsDone = 0;
  }

  private toggleBubble() {
    const n = this.root.ninja;
    this.bubbleOn = !this.bubbleOn;
    const pan = this.pan(n.xPos);
    if (this.bubbleOn) {
      this.bubbleAge = 0;
      this.sfx.bubbleOn(pan);
    } else {
      this.bubbleFade = 8;
      this.sfx.bubbleOff(pan);
    }
  }

  /** Enemy strikes reaching the bubble are spent, rippled and pushed back. */
  private bounceStrikes() {
    const r = this.root;
    const g = r.game;
    const n = r.ninja;
    const chars = g?.path?.chars as MovieClip | undefined;
    if (!chars) return;
    const cx = n.clip._x;
    const cy = n.clip._y;
    for (const id in g.currentlyAttackingList) {
      const e = r.enemies?.[id];
      const hz = e?.clip?.hitzone_attack1;
      if (!e?.alive || !hz || e.attackAvailable !== true) continue;
      const bb = hz.$boundsIn(chars);
      if (!bb) continue;
      const px = Math.max(bb[0], Math.min(cx, bb[2]));
      const py = Math.max(bb[1], Math.min(cy, bb[3]));
      if (Math.hypot(px - cx, py - cy) > BUBBLE_R + 4) continue;
      e.attackAvailable = false;
      const ex = e.xPos + e.width / 2;
      const ey = (bb[1] + bb[3]) / 2;
      this.ripples.push({ angle: Math.atan2(ey - cy, ex - cx), life: 14 });
      this.hitFlash = 6;
      e.xMoveRequest = (Math.sign(ex - cx) || 1) * BLOCK_PUSH;
      this.sfx.bubbleHit(this.pan(ex));
    }
  }

  private onJump(which: number) {
    const n = this.root.ninja;
    const pan = this.pan(n.xPos);
    if (which >= 2) {
      this.puffs.push({ x: n.xPos + n.width / 2, y: n.yPos + n.height - 2, life: 12, max: 12, big: which === 3 });
      this.sfx.airJump(pan, which === 3);
    }
    if (which === 3) {
      const anim = n.clip.nin_anim as MovieClip | undefined;
      if (!anim) return;
      this.endFlip();
      this.flip = { t: 0, anim, base: [...anim.$matrix] as Matrix };
      this.sfx.flipWhoosh(pan);
    }
  }

  /** Forward somersault: rotates the ninja's animation about his centre. */
  private updateFlip(busy: boolean) {
    const f = this.flip;
    if (!f) return;
    const n = this.root.ninja;
    if (f.anim.$removed || f.anim !== n.clip.nin_anim) {
      this.flip = null;
      return;
    }
    f.t++;
    if (f.t >= FLIP_FRAMES || n.onGround || n.onLadder || n.inHurting || !n.alive || n.currentAttack || busy) {
      this.endFlip();
      return;
    }
    const a = this.flipAngle();
    const c = Math.cos(a);
    const s = Math.sin(a);
    f.anim.$setMatrix(multiply([c, s, -s, c, 0, 0], f.base));
  }

  private flipAngle() {
    const p = Math.min(1, (this.flip?.t ?? 0) / FLIP_FRAMES);
    const e = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
    return -Math.PI * 2 * e; // art faces left: negative = head goes forward first
  }

  private endFlip() {
    if (this.flip && !this.flip.anim.$removed) this.flip.anim.$setMatrix(this.flip.base);
    this.flip = null;
  }

  // ------------------------------------------------------------------ drawing (level coordinates)
  drawFx(ctx: CanvasRenderingContext2D) {
    const n = this.root.ninja;
    if (!n?.clip) return;
    for (const p of this.puffs) this.drawPuff(ctx, p);
    if (this.flip) this.drawFlipTrail(ctx, n);
    if (this.bubbleOn || this.bubbleFade > 0) this.drawBubble(ctx, n.clip._x, n.clip._y);
  }

  private drawPuff(ctx: CanvasRenderingContext2D, p: Puff) {
    const t = p.life / p.max;
    const k = p.big ? 1.4 : 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, 0.32);
    ctx.lineWidth = 3 * t + 0.5;
    ctx.strokeStyle = `rgba(255,255,255,${0.75 * t})`;
    ctx.beginPath();
    ctx.arc(0, 0, (8 + (1 - t) * 26) * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(190,225,255,${0.5 * t})`;
    ctx.beginPath();
    ctx.arc(0, 0, (4 + (1 - t) * 15) * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // Speed lines shooting down from the feet.
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${0.55 * t})`;
    ctx.lineWidth = 1.2;
    for (const dx of [-10, -3, 4, 11]) {
      ctx.beginPath();
      ctx.moveTo(p.x + dx * k, p.y + 2 + (1 - t) * 8);
      ctx.lineTo(p.x + dx * k * 1.1, p.y + 2 + (1 - t) * 8 + 10 * k * t);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** White arc swooshing behind the head while flipping. */
  private drawFlipTrail(ctx: CanvasRenderingContext2D, n: any) {
    const clip = n.clip as MovieClip;
    const fx = clip.$matrix[0] >= 0 ? 1 : -1;
    const a = this.flipAngle();
    const head = Math.atan2(-Math.cos(a), fx * Math.sin(a));
    const cx = clip.$matrix[4];
    const cy = clip.$matrix[5];
    const behind = fx; // trail extends opposite to the spin direction
    ctx.save();
    ctx.lineCap = 'round';
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const a0 = head + behind * (i / segs) * 1.9;
      const a1 = head + behind * ((i + 1) / segs) * 1.9;
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * (1 - i / segs)})`;
      ctx.lineWidth = 4 * (1 - i / segs) + 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 33, Math.min(a0, a1), Math.max(a0, a1));
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBubble(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    let scale = 1;
    let alpha = 1;
    if (this.bubbleOn) {
      const t = Math.min(1, this.bubbleAge / 9);
      scale = 1 + Math.sin(t * Math.PI) * 0.12 - (1 - t) * 0.4; // pops in with a little overshoot
    } else {
      const t = this.bubbleFade / 8;
      scale = 1 + (1 - t) * 0.25;
      alpha = t;
    }
    const wobble = 1 + Math.sin(this.frame * 0.18) * 0.015;
    const R = BUBBLE_R * scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha *= alpha;
    ctx.scale(wobble, 2 - wobble);

    // Body: clear in the middle, tinted towards the rim.
    const body = ctx.createRadialGradient(-R * 0.25, -R * 0.3, R * 0.1, 0, 0, R);
    body.addColorStop(0, 'rgba(255,255,255,0.06)');
    body.addColorStop(0.62, 'rgba(150,220,255,0.06)');
    body.addColorStop(0.88, 'rgba(120,205,255,0.2)');
    body.addColorStop(1, 'rgba(210,245,255,0.5)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    // Soap-film sheen along the rim.
    const sheen = ctx.createLinearGradient(-R, -R, R, R);
    sheen.addColorStop(0, 'rgba(255,140,220,0.35)');
    sheen.addColorStop(0.5, 'rgba(140,255,230,0.25)');
    sheen.addColorStop(1, 'rgba(130,160,255,0.35)');
    ctx.strokeStyle = sheen;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, R - 2.5, 0, Math.PI * 2);
    ctx.stroke();

    // Rim.
    const flash = this.hitFlash / 6;
    ctx.strokeStyle = `rgba(${220 + 35 * flash},${245 + 10 * flash},255,${0.7 + 0.3 * flash})`;
    ctx.lineWidth = 1.4 + flash * 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();

    // Slowly turning shimmer arcs.
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    const spin = this.frame * 0.045;
    for (const [off, len, rr] of [[0, 0.55, 0.9], [2.4, 0.35, 0.82], [4.1, 0.25, 0.93]]) {
      ctx.beginPath();
      ctx.arc(0, 0, R * rr, spin + off, spin + off + len);
      ctx.stroke();
    }

    // Specular highlights.
    ctx.save();
    ctx.translate(-R * 0.4, -R * 0.45);
    ctx.rotate(-0.7);
    const hl = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.24);
    hl.addColorStop(0, 'rgba(255,255,255,0.8)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.24, R * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(R * 0.45, R * 0.42, 2, 0, Math.PI * 2);
    ctx.fill();

    // Ripples where strikes bounced off.
    for (const rp of this.ripples) {
      const t = rp.life / 14;
      const px = Math.cos(rp.angle) * R;
      const py = Math.sin(rp.angle) * R;
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, R + 1, 0, Math.PI * 2);
      ctx.clip();
      for (const k of [1, 0.6]) {
        ctx.strokeStyle = `rgba(200,240,255,${0.8 * t * k})`;
        ctx.lineWidth = 2 * t + 0.5;
        ctx.beginPath();
        ctx.arc(px, py, (4 + (1 - t) * 26) * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = `rgba(255,255,255,${t})`;
      ctx.lineWidth = 3 * t + 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, R, rp.angle - 0.45, rp.angle + 0.45);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** HUD slot: bubble icon + "B" key cap (lit while the shield is up). */
  drawHudSlot(ctx: CanvasRenderingContext2D, x: number, y: number, h: number) {
    const on = this.bubbleOn;
    const cx = x + 13;
    const cy = y + h / 2;
    ctx.save();
    ctx.globalAlpha = on ? 1 : 0.45;
    if (on) {
      ctx.shadowColor = 'rgba(150,230,255,0.9)';
      ctx.shadowBlur = 8;
    }
    const g = ctx.createRadialGradient(cx - 3, cy - 4, 1, cx, cy, 11);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.7, 'rgba(120,200,255,0.25)');
    g.addColorStop(1, 'rgba(210,245,255,0.8)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(225,248,255,0.95)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(cx - 4, cy - 5, 3, 1.6, -0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Key cap.
    const kx = x + 28;
    const ky = y + h / 2 - 10;
    ctx.beginPath();
    ctx.roundRect(kx, ky, 20, 20, 4);
    ctx.fillStyle = on ? '#bfefff' : '#e9ecf2';
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
    ctx.fillText('B', kx + 10, ky + 9);
    ctx.restore();
  }
}
