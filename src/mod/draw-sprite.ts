// A display object drawn by code (canvas 2D) that lives inside the Flash display list, so it
// scrolls, flips and layers exactly like the original artwork around it.
import { DisplayObject, hideInternals, type MovieClip } from '../flash/display';
import { concatCx, multiply } from '../flash/matrix';
import type { Player } from '../flash/player';
import type { ColorTransform, Matrix, Rect } from '../flash/types';

/** `world` maps this sprite's local units to canvas pixels (already applied to ctx). */
export type DrawFn = (ctx: CanvasRenderingContext2D, world: Matrix) => void;

export class DrawSprite extends DisplayObject {
  $draw: DrawFn;
  $bounds: Rect;

  constructor(player: Player, draw: DrawFn, bounds: Rect = [-40, -40, 40, 40]) {
    super(player);
    this.$draw = draw;
    this.$bounds = bounds;
  }

  $localBounds(): Rect | null {
    return this.$bounds;
  }

  $hitLocal() {
    return false;
  }

  $render(world: Matrix, cx: ColorTransform | null) {
    if (!this.$visible) return;
    const w = multiply(world, this.$matrix);
    const c = concatCx(cx, this.$cx);
    const ctx = this.$player.ctx;
    ctx.save();
    ctx.setTransform(w[0], w[1], w[2], w[3], w[4], w[5]);
    if (c) ctx.globalAlpha = Math.max(0, Math.min(1, c[3]));
    try {
      this.$draw(ctx, w);
    } finally {
      ctx.restore();
    }
  }
}

/** Creates a DrawSprite and inserts it into `parent` at a script depth (kept across gotos). */
export function attachDrawSprite(player: Player, parent: MovieClip, depth: number, draw: DrawFn, bounds?: Rect) {
  const old = parent.$childAtDepth(depth);
  if (old) parent.$removeChild(old);
  const s = new DrawSprite(player, draw, bounds);
  hideInternals(s); // keep engine fields out of ActionScript for..in loops
  s.$depth = depth;
  parent.$insertChild(s);
  return s;
}
