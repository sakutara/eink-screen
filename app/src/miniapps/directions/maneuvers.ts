import type { Ctx2D } from '../../render/canvas';

export type ManeuverShape =
  | { kind: 'bend'; angle: number }
  | { kind: 'uturn'; dir: 1 | -1 }
  | { kind: 'roundabout'; angle: number }
  | { kind: 'arrive' };

/** Maps Routes API `Maneuver` enum values to a drawable shape. Angles: 0 = up, + = right, degrees. */
export function maneuverShape(maneuver: string): ManeuverShape {
  switch (maneuver) {
    case 'ARRIVE': return { kind: 'arrive' };
    case 'TURN_LEFT': return { kind: 'bend', angle: -90 };
    case 'TURN_RIGHT': return { kind: 'bend', angle: 90 };
    case 'TURN_SLIGHT_LEFT': return { kind: 'bend', angle: -45 };
    case 'TURN_SLIGHT_RIGHT': return { kind: 'bend', angle: 45 };
    case 'TURN_SHARP_LEFT': return { kind: 'bend', angle: -135 };
    case 'TURN_SHARP_RIGHT': return { kind: 'bend', angle: 135 };
    case 'UTURN_LEFT': return { kind: 'uturn', dir: -1 };
    case 'UTURN_RIGHT': return { kind: 'uturn', dir: 1 };
    case 'ROUNDABOUT_LEFT': return { kind: 'roundabout', angle: -90 };
    case 'ROUNDABOUT_RIGHT': return { kind: 'roundabout', angle: 90 };
    case 'FORK_LEFT':
    case 'RAMP_LEFT': return { kind: 'bend', angle: -30 };
    case 'FORK_RIGHT':
    case 'RAMP_RIGHT': return { kind: 'bend', angle: 30 };
    // STRAIGHT, MERGE, DEPART, NAME_CHANGE, FERRY*, MANEUVER_UNSPECIFIED, unknown
    default: return { kind: 'bend', angle: 0 };
  }
}

function arrowHead(ctx: Ctx2D, tipX: number, tipY: number, dx: number, dy: number): void {
  const px = -dy, py = dx;
  const baseX = tipX - dx * 0.5, baseY = tipY - dy * 0.5;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + px * 0.42, baseY + py * 0.42);
  ctx.lineTo(baseX - px * 0.42, baseY - py * 0.42);
  ctx.closePath();
  ctx.fill();
}

/** Draws the maneuver centred at (cx, cy) inside a `size` x `size` box. */
export function drawManeuver(ctx: Ctx2D, maneuver: string, cx: number, cy: number, size: number, color: string): void {
  const shape = maneuverShape(maneuver);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / 2, size / 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.26;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';

  switch (shape.kind) {
    case 'bend': {
      const t = (shape.angle * Math.PI) / 180;
      const dx = Math.sin(t), dy = -Math.cos(t);
      const len = 0.85;
      const ex = dx * len, ey = dy * len;
      ctx.beginPath();
      ctx.moveTo(0, 0.95);
      ctx.lineTo(0, 0);
      ctx.lineTo(ex - dx * 0.4, ey - dy * 0.4);
      ctx.stroke();
      arrowHead(ctx, ex + dx * 0.1, ey + dy * 0.1, dx, dy);
      break;
    }
    case 'uturn': {
      ctx.scale(shape.dir === 1 ? -1 : 1, 1); // drawn as a left U-turn, mirrored for right
      ctx.beginPath();
      ctx.moveTo(0.42, 0.95);
      ctx.lineTo(0.42, -0.25);
      ctx.arc(0, -0.25, 0.42, 0, Math.PI, true);
      ctx.lineTo(-0.42, 0.2);
      ctx.stroke();
      arrowHead(ctx, -0.42, 0.72, 0, 1);
      break;
    }
    case 'roundabout': {
      const ringY = -0.1, r = 0.46;
      ctx.lineWidth = 0.17;
      ctx.beginPath();
      ctx.arc(0, ringY, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.moveTo(0, 0.95);
      ctx.lineTo(0, ringY + r);
      ctx.stroke();
      const t = (shape.angle * Math.PI) / 180;
      const dx = Math.sin(t), dy = -Math.cos(t);
      const sx = dx * r, sy = ringY + dy * r;
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + dx * 0.3, sy + dy * 0.3);
      ctx.stroke();
      arrowHead(ctx, sx + dx * 0.8, sy + dy * 0.8, dx, dy);
      break;
    }
    case 'arrive': {
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(-0.45, 0.95);
      ctx.lineTo(-0.45, -0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.45, -0.9);
      ctx.lineTo(0.8, -0.5);
      ctx.lineTo(-0.45, -0.05);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
