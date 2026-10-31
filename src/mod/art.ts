// Vector art for the extra weapons, drawn in the same flat cel-shaded style as the original
// (gunmetal greys, the ninja's navy and gold trim, dark outlines). Units are stage pixels.
// The gun points left (-x), which is the direction the ninja's artwork faces.

const OUTLINE = '#0b0d12';
const GOLD = '#e0b030';
const GOLD_DARK = '#9a6f12';

function poly(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fillStroke(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, lw = 0.6) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function vgrad(ctx: CanvasRenderingContext2D, y0: number, y1: number, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

/** Muzzle position relative to the grip origin. */
export const MUZZLE = { x: -27, y: -3.5 };
/** Where spent casings leave the receiver. */
export const EJECT = { x: -3, y: -6 };

/**
 * Compact machine gun ("small rifle"), origin = where the hand grips it.
 * `recoil` slides it back a little on each shot.
 */
export function drawGun(ctx: CanvasRenderingContext2D, recoil = 0, withHand = true) {
  ctx.save();
  ctx.translate(recoil, 0);
  ctx.lineJoin = 'round';

  // Skeleton stock (with a cut-out).
  ctx.beginPath();
  ctx.moveTo(2, -5.2);
  ctx.lineTo(9.8, -4.4);
  ctx.lineTo(11, -3.9);
  ctx.lineTo(11, 1.8);
  ctx.lineTo(9.6, 2.3);
  ctx.lineTo(6.4, -0.4);
  ctx.lineTo(2, -1.4);
  ctx.closePath();
  ctx.moveTo(4.6, -3.4);
  ctx.lineTo(8.9, -3.0);
  ctx.lineTo(8.9, -0.2);
  ctx.lineTo(6.2, -1.9);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, -5, 2, '#4a505b', '#1f2228');
  ctx.fill('evenodd');
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  rrect(ctx, 10.2, -4.1, 1.6, 6.2, 0.6); // butt pad
  fillStroke(ctx, '#15171b', 0.5);

  // Curved magazine.
  ctx.beginPath();
  ctx.moveTo(-7.2, -0.8);
  ctx.quadraticCurveTo(-8.4, 4, -10.6, 8.2);
  ctx.lineTo(-6.6, 9.4);
  ctx.quadraticCurveTo(-4.5, 4.6, -3.4, -0.8);
  ctx.closePath();
  fillStroke(ctx, vgrad(ctx, -1, 9, '#353941', '#1b1d22'));
  ctx.beginPath(); // gold band at the base
  ctx.moveTo(-10.1, 7.1);
  ctx.lineTo(-6.2, 8.2);
  ctx.lineTo(-6.6, 9.4);
  ctx.lineTo(-10.6, 8.2);
  ctx.closePath();
  fillStroke(ctx, GOLD, 0.45);

  // Pistol grip (wrapped).
  poly(ctx, [-0.6, -1, 3, -1, 4.4, 6.6, 1.0, 7.2]);
  fillStroke(ctx, vgrad(ctx, -1, 7, '#2a2522', '#121012'));
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 0.5;
  for (let y = 1; y < 6.5; y += 1.6) {
    ctx.beginPath();
    ctx.moveTo(0.2 + y * 0.18, y);
    ctx.lineTo(3.1 + y * 0.18, y - 0.4);
    ctx.stroke();
  }

  // Trigger guard.
  ctx.beginPath();
  ctx.moveTo(-3, -0.8);
  ctx.quadraticCurveTo(-3.2, 2.6, -0.4, 2.4);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = '#1a1c21';
  ctx.stroke();

  // Barrel, then the muzzle brake.
  rrect(ctx, -24, -4.5, 8, 2.0, 0.5);
  fillStroke(ctx, vgrad(ctx, -4.5, -2.5, '#7b8390', '#353a42'), 0.5);
  rrect(ctx, MUZZLE.x, -5.3, 4.2, 3.6, 0.7);
  fillStroke(ctx, vgrad(ctx, -5.3, -1.7, '#555c67', '#1d2026'), 0.55);
  ctx.fillStyle = '#0a0b0e';
  ctx.fillRect(-25.6, -4.9, 0.7, 1.0);
  ctx.fillRect(-24.3, -4.9, 0.7, 1.0);

  // Handguard with vents.
  rrect(ctx, -17.4, -6, 8.8, 5.4, 1.2);
  fillStroke(ctx, vgrad(ctx, -6, -0.6, '#4b515c', '#23262d'));
  ctx.fillStyle = '#121418';
  for (const x of [-16, -13.4, -10.8]) {
    ctx.beginPath();
    ctx.roundRect(x, -4.6, 1.3, 2.4, 0.6);
    ctx.fill();
  }

  // Receiver.
  rrect(ctx, -9.4, -6.6, 12.6, 6.2, 1.4);
  fillStroke(ctx, vgrad(ctx, -6.6, -0.4, '#6c7482', '#2a2e36'));
  // Top highlight.
  ctx.beginPath();
  ctx.moveTo(-8.4, -6.0);
  ctx.lineTo(2.2, -6.0);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = 'rgba(200,210,225,0.55)';
  ctx.stroke();
  // Gold trim stripe + emblem, like the ninja's armour.
  ctx.beginPath();
  ctx.moveTo(-9, -2.6);
  ctx.lineTo(2.8, -2.6);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-5.2, -4.3, 1.05, 0, Math.PI * 2);
  fillStroke(ctx, GOLD, 0.4);
  // Ejection port.
  ctx.fillStyle = '#111317';
  ctx.fillRect(-2.6, -5.6, 3.2, 1.3);

  // Rail + sights.
  rrect(ctx, -8, -8.2, 8.6, 1.8, 0.4);
  fillStroke(ctx, '#2c3037', 0.45);
  ctx.fillStyle = '#4c535e';
  for (let x = -7.3; x < 0; x += 1.5) ctx.fillRect(x, -8.0, 0.7, 0.7);
  poly(ctx, [0.2, -6.4, 0.6, -9.4, 2.0, -9.4, 2.4, -6.4]);
  fillStroke(ctx, '#2c3037', 0.45);
  poly(ctx, [-16.6, -5.8, -16.3, -8.6, -15.3, -8.6, -15.0, -5.8]);
  fillStroke(ctx, '#2c3037', 0.45);

  if (withHand) drawGlove(ctx);
  ctx.restore();
}

/** The ninja's glove wrapped around the grip (matches the original dark-grey gloves). */
function drawGlove(ctx: CanvasRenderingContext2D) {
  // Back of the hand / thumb over the top of the grip.
  ctx.beginPath();
  ctx.ellipse(1.6, -0.6, 3.0, 2.2, -0.2, 0, Math.PI * 2);
  fillStroke(ctx, vgrad(ctx, -2.8, 1.6, '#5d5f63', '#2b2c2f'), 0.55);
  // Fingers curled round the front of the grip.
  const fingers = [
    [-1.6, 0.6],
    [-1.2, 2.4],
    [-0.7, 4.2],
  ];
  for (const [x, y] of fingers) {
    rrect(ctx, x, y, 4.0, 1.9, 0.9);
    fillStroke(ctx, vgrad(ctx, y, y + 1.9, '#55575b', '#232427'), 0.5);
    ctx.fillStyle = 'rgba(190,195,205,0.35)';
    ctx.fillRect(x + 0.6, y + 0.35, 1.2, 0.5);
  }
  // Cuff of the navy sleeve.
  rrect(ctx, 3.2, -2.6, 3.0, 4.4, 1);
  fillStroke(ctx, vgrad(ctx, -2.6, 1.8, '#2b3592', '#141a55'), 0.5);
  ctx.fillStyle = GOLD;
  ctx.fillRect(3.4, -2.3, 0.7, 3.8);
}

/** Muzzle flash; `seed` (0..1) varies its shape from shot to shot. */
export function drawMuzzleFlash(ctx: CanvasRenderingContext2D, seed: number, strength: number) {
  const { x, y } = MUZZLE;
  ctx.save();
  ctx.translate(x - 0.5, y);
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
  glow.addColorStop(0, `rgba(255,230,150,${0.65 * strength})`);
  glow.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(-3, 0, 12, 0, Math.PI * 2);
  ctx.fill();

  const spikes = 7;
  ctx.beginPath();
  for (let i = 0; i <= spikes * 2; i++) {
    const a = Math.PI + ((i / (spikes * 2)) * 2 - 1) * Math.PI * 0.62 + (seed - 0.5) * 0.3;
    const forward = Math.abs(a - Math.PI) < 0.3;
    const len = i % 2 === 0 ? (forward ? 11 + seed * 6 : 4 + ((seed * 7 + i) % 3)) * strength : 1.8;
    const px = Math.cos(a) * len;
    const py = Math.sin(a) * len * 0.75;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(-1, 0, 0, -3, 0, 13);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, '#fff2a8');
  g.addColorStop(0.6, '#ffb733');
  g.addColorStop(1, 'rgba(255,90,20,0.0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(-1.5, 0, 2.6, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Tracer round heading in direction (dx, dy) (unit vector). */
export function drawTracer(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, len: number) {
  const tx = x - dx * len;
  const ty = y - dy * len;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const glow = ctx.createLinearGradient(tx, ty, x, y);
  glow.addColorStop(0, 'rgba(255,120,30,0)');
  glow.addColorStop(1, 'rgba(255,170,60,0.45)');
  ctx.strokeStyle = glow;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(x, y);
  ctx.stroke();
  const core = ctx.createLinearGradient(tx, ty, x, y);
  core.addColorStop(0, 'rgba(255,200,80,0)');
  core.addColorStop(0.7, 'rgba(255,235,150,0.9)');
  core.addColorStop(1, '#ffffff');
  ctx.strokeStyle = core;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.restore();
}

export function drawCasing(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  rrect(ctx, -1.5, -0.7, 3, 1.4, 0.5);
  fillStroke(ctx, vgrad(ctx, -0.7, 0.7, '#ffe08a', '#b47c1a'), 0.35);
  ctx.fillStyle = GOLD_DARK;
  ctx.fillRect(1.0, -0.7, 0.5, 1.4);
  ctx.restore();
}

/** Small katana icon for the HUD (fits roughly a 36x24 box centred on 0,0). */
export function drawSwordIcon(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.rotate(-0.55);
  ctx.lineJoin = 'round';
  // Blade with a slight curve.
  ctx.beginPath();
  ctx.moveTo(-4, -1.3);
  ctx.quadraticCurveTo(6, -2.6, 16.5, -1.4);
  ctx.lineTo(13, 1.0);
  ctx.quadraticCurveTo(5, 0.6, -4, 1.3);
  ctx.closePath();
  fillStroke(ctx, vgrad(ctx, -2.6, 1.3, '#f4f8fc', '#8c98a8'), 0.6);
  ctx.beginPath();
  ctx.moveTo(-3, -0.6);
  ctx.quadraticCurveTo(6, -1.7, 15, -1.0);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // Tsuba.
  ctx.beginPath();
  ctx.ellipse(-4.6, 0, 1.3, 3.4, 0, 0, Math.PI * 2);
  fillStroke(ctx, GOLD, 0.6);
  // Wrapped handle.
  rrect(ctx, -14, -1.5, 9, 3, 1);
  fillStroke(ctx, '#1b2266', 0.6);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 0.6;
  for (let x = -13; x < -6; x += 2) {
    ctx.beginPath();
    ctx.moveTo(x, -1.4);
    ctx.lineTo(x + 1.2, 1.4);
    ctx.moveTo(x + 1.2, -1.4);
    ctx.lineTo(x, 1.4);
    ctx.stroke();
  }
  ctx.restore();
}

/** Floating text in the HUD's lettering style (bold italic serif, white with a black edge). */
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill = '#ffffff', align: CanvasTextAlign = 'center') {
  ctx.save();
  ctx.font = `italic bold ${size}px "swf-font-395", "Times New Roman", serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.28);
  ctx.strokeStyle = '#000000';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}
