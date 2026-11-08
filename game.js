'use strict';

const canvas = document.querySelector('#table');
const ctx = canvas.getContext('2d');
const pauseButton = document.querySelector('#pause');
let view = { width: 0, height: 0, scale: 1, left: 0, top: 0 };
let cameraZoom = 1;
let cameraY = 0;
let particles = [];
let impacts = [];
let trails = [];
let trailClock = 0;
let shake = 0;
const grain = Array.from({length: 260}, (_, i) => {
  const x = 47 + (i * 47.73) % 206;
  const y = 35 + (i * 37.41) % 473;
  return { x, y, length: Math.min(525 - y, 4 + i % 24), light: i % 2 };
});
let started = false;
let paused = false;
let resuming = false;
let ready = false;
const status = document.querySelector('#status');
const tieBanner = document.querySelector('#tie-banner');
const matchState = document.querySelector('#match-state');
const resetButton = document.querySelector('#reset');
const scores = [document.querySelector('#you'), document.querySelector('#bot')];
const colors = ['#9fcaff', '#ed4540'];
const radius = 12;
const friction = 145;
const start = { x: 150, y: 481 };
const surface = { left: 46, right: 254, top: 34, bottom: 526 };
// Regulation plank: 248 × 20 inches. The camera stretches the cross-axis for touch.
const inch = (surface.bottom - surface.top) / 248;
const threeLine = surface.top + 6 * inch;
const twoLine = surface.top + 12 * inch;
const foulLine = surface.top + 72 * inch;
const releaseLine = surface.bottom - foulLine + surface.top;
const scoringRadius = 2.3125 / 2 * inch;
const puckTrays = [document.querySelector('#you-pucks'), document.querySelector('#bot-pucks')];
const result = document.querySelector('#result');
const resultTitle = document.querySelector('#result-title');
const resultYou = document.querySelector('#result-you');
const resultBot = document.querySelector('#result-bot');
const rematchButton = document.querySelector('#rematch');
const step = 1 / 120;
const openingShots = 8;
let currentShot;
let pucks, turn, phase, shots, shotLimit, delay, drag, angle, speed, message;

function reset() {
  cameraZoom = 1;
  cameraY = 0;
  pucks = [];
  particles = [];
  impacts = [];
  trails = [];
  shots = 0;
  currentShot = null;
  shotLimit = openingShots;
  turn = 0;
  result.hidden = true;
  prepareShot();
}

function prepareShot() {
  drag = null;
  angle = 0;
  speed = 335;
  phase = turn ? 'bot' : 'aim';
  delay = 0.6;
  updateStatus();
}

function updateScore() {
  const live = roundScore(pucks);
  scores.forEach((score, team) => {
    const label = String(live[team]);
    if (score.textContent !== label) score.textContent = label;
  });
}

function updateStatus() {
  updateScore();
  puckTrays.forEach((tray, team) => {
    const available = shotLimit / 2 - pucks.filter(puck => puck.team === team).length;
    const slots = shotLimit > openingShots ? 1 : 4;
    tray.textContent = '●'.repeat(Math.min(slots, Math.max(0, available)));
    tray.dataset && (tray.dataset.used = '●'.repeat(Math.min(slots, Math.max(0, slots - available))));
    tray.setAttribute?.('aria-label', available + ' pucks remaining');
  });
  tieBanner.hidden = phase !== 'tie';
  matchState.textContent = shotLimit > openingShots ? 'TIEBREAK' : 'SINGLES';
  status.className = phase === 'done' ? 'result' : '';
  const overtime = shotLimit > openingShots ? 'Tiebreak · ' : '';
  const text = {
    aim: overtime + (shots ? 'Your shot' : 'Press the blue puck and flick it forward'),
    bot: overtime + 'Opponent’s shot',
    moving: turn ? 'Opponent’s puck in play' : 'Your puck in play',
    tie: message,
    done: message
  };
  status.textContent = text[phase];
}

function shoot(direction, power, origin = start) {
  currentShot = {
    ...origin, launchY: origin.y, team: turn, vx: Math.sin(direction) * power,
    vy: -Math.cos(direction) * power, out: false, launchAge: 0, crossedLine: false
  };
  pucks.push(currentShot);
  sound.effect('shot');
  phase = 'moving';
  shots++;
  updateStatus();
}

function botShot() {
  const target = 100 + Math.random() * 100;
  const distance = 325 + Math.random() * 106;
  shoot(Math.atan2(target - start.x, distance), Math.sqrt(2 * friction * distance));
}

function collide(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius * 2 || distance === 0) return;
  const nx = dx / distance;
  const ny = dy / distance;
  const push = (radius * 2 - distance) / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (closing <= 0) return;
  if (closing > 35) {
    sound.effect('hit', Math.min(1, closing / 200));
    burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffe5a9', 9);
    impacts.push({ ...project((a.x + b.x) / 2, (a.y + b.y) / 2), age: 0 });
    shake = Math.min(1.8, closing / 120);
  }
  const impulse = closing * 0.60;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
}

function tick() {
  if (phase === 'bot' || phase === 'tie') {
    delay -= step;
    if (delay <= 0) {
      if (phase === 'bot') botShot();
      else prepareShot();
    }
    return;
  }
  if (phase !== 'moving') return;
  const active = pucks.filter(puck => !puck.out);
  for (const puck of active) {
    const velocity = Math.hypot(puck.vx, puck.vy);
    if (!velocity) continue;
    const factor = Math.max(0, 1 - friction * step / velocity);
    puck.x += puck.vx * (1 + factor) * step / 2;
    puck.y += puck.vy * (1 + factor) * step / 2;
    puck.vx *= factor;
    puck.vy *= factor;
  }
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) collide(active[i], active[j]);
  }
  for (const puck of active) {
    if (puck === currentShot && puck.y + scoringRadius < releaseLine &&
        puck.x >= surface.left && puck.x <= surface.right) puck.crossedLine = true;
    puck.out = puck.x < surface.left || puck.x > surface.right ||
      puck.y < surface.top || puck.y > surface.bottom;
    if (puck.out) {
      puck.fall = {
        age: 0,
        x: puck.y < surface.top || puck.y > surface.bottom
          ? Math.max(surface.left, Math.min(surface.right, puck.x))
          : puck.x < surface.left ? 36 : 264,
        y: Math.max(25, Math.min(536, puck.y))
      };
      if (puck.y < surface.top) puck.fall.y = 2;
      if (puck.y > surface.bottom) puck.fall.y = 536;
      sound.effect('drop');
      burst(puck.x, puck.y, colors[puck.team], 8);
    }
  }
  if (active.some(puck => !puck.out && (puck.vx || puck.vy))) return;
  if (currentShot && !currentShot.crossedLine) {
    pucks.pop();
    currentShot = null;
    shots--;
    prepareShot();
    if (turn === 0) status.textContent = 'Push past the line to complete your shot. Try again.';
    return;
  }
  currentShot = null;
  if (shots === shotLimit) finishRound();
  else {
    turn = 1 - turn;
    prepareShot();
  }
}

function value(puck) {
  const back = puck.y + scoringRadius;
  if (puck.out || puck.y < surface.top || back >= foulLine) return 0;
  if (puck.y - scoringRadius < surface.top) return 4;
  if (back < threeLine) return 3;
  if (back < twoLine) return 2;
  return 1;
}

function roundScore(board) {
  const totals = [0, 0];
  for (const puck of board) totals[puck.team] += value(puck);
  return totals;
}

function finishRound() {
  const [you, bot] = roundScore(pucks);
  if (you === bot) {
    shotLimit += 2;
    turn = 1 - turn;
    phase = 'tie';
    delay = 1.8;
    message = 'Tie game. One extra puck each.';
  } else {
    const winner = Number(bot > you);
    const leader = pucks.reduce((best, puck) =>
      !puck.out && puck.team === winner && (!best || puck.y < best.y) ? puck : best, null);
    burst(leader.x, leader.y, colors[winner], 24);
    sound.effect('score');
    platform.stop();
    phase = 'done';
    message = (winner ? 'Bot wins' : 'You win') + ' ' + Math.max(you, bot) +
      '–' + Math.min(you, bot);
    resultTitle.textContent = winner ? 'Opponent wins' : 'Victory';
    resultYou.textContent = String(you);
    resultBot.textContent = String(bot);
    result.className = winner ? 'result-panel opponent' : 'result-panel';
    result.hidden = false;
    rematchButton.focus?.();
  }
  updateStatus();
}

function project(x, y) {
  // Open up the far-end zones in the camera view while retaining their scoring coordinates.
  const distance = Math.max(0, y - surface.top);
  const scoringDepth = twoLine - surface.top;
  const baseY = 20 + y * (.69 + .00043 * y);
  const extraDepth = 14;
  const blendLength = 32;
  const pastZones = Math.max(0, distance - scoringDepth);
  const taper = Math.max(0, 1 - (pastZones / (surface.bottom - twoLine)) ** 2);
  const slope = extraDepth / scoringDepth - .00043 * scoringDepth;
  const expansion = (extraDepth + slope * blendLength * (1 - Math.exp(-pastZones / blendLength))) * taper;
  const screenY = y >= surface.top && y <= twoLine
    ? 20 + surface.top * (.69 + .00043 * surface.top) +
      distance * (.69 + .00043 * (surface.top + twoLine) + extraDepth / scoringDepth)
    : baseY + (y > twoLine ? expansion : 0);
  return {
    x: 150 + (x - 150) * (.39 + .00156 * screenY),
    y: screenY
  };
}

function strip(left, top, right, bottom, fill) {
  const corners = [project(left, top), project(right, top),
    project(right, bottom), project(left, bottom)];
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (const point of corners) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fill();
}

function roundedTable(left, top, right, bottom, radius, fill, depth = 0) {
  const corners = [[right, top, -1, 1], [right, bottom, -1, -1],
    [left, bottom, 1, -1], [left, top, 1, 1]];
  ctx.beginPath();
  corners.forEach(([x, y, sx, sy], index) => {
    const alongX = index % 2 === 0;
    const before = project(x + (alongX ? sx * radius : 0), y + (alongX ? 0 : sy * radius));
    const corner = project(x, y);
    const after = project(x + (alongX ? 0 : sx * radius), y + (alongX ? sy * radius : 0));
    if (index === 0) ctx.moveTo(before.x, before.y + depth);
    else ctx.lineTo(before.x, before.y + depth);
    ctx.quadraticCurveTo(corner.x, corner.y + depth, after.x, after.y + depth);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

const gutterDepth = 9;

function gutterWall(x1, y1, x2, y2, paint) {
  const a = project(x1, y1);
  const b = project(x2, y2);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(b.x, b.y + gutterDepth);
  ctx.lineTo(a.x, a.y + gutterDepth);
  ctx.closePath();
  ctx.fillStyle = paint;
  ctx.fill();
}

function ellipse(x, y, rx, ry, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function puckArt(x, y, team, drop = 0) {
  const point = project(x, y);
  point.y += drop * gutterDepth;
  const size = (1 - drop * .12) * radius * (.39 + .00156 * project(x, y).y);
  ellipse(point.x + 2, point.y + 4, size + 2, size * .68, '#24110f88');
  if (drop) {
    ctx.save();
    ctx.filter = 'brightness(' + (1 - drop * .25) + ')';
  }
  const steel = ctx.createLinearGradient(point.x - size, 0, point.x + size, 0);
  steel.addColorStop(0, '#443c38');
  steel.addColorStop(.25, '#adaba4');
  steel.addColorStop(.53, '#f2e8d1');
  steel.addColorStop(.81, '#858785');
  steel.addColorStop(1, '#343938');
  ellipse(point.x, point.y + 2, size, size * .76, steel);
  const gloss = ctx.createLinearGradient(0, point.y - size, 0, point.y + size);
  gloss.addColorStop(0, '#fff7df');
  gloss.addColorStop(.38, colors[team]);
  gloss.addColorStop(1, team ? '#8e211d' : '#3561a5');
  ellipse(point.x, point.y - 2, size, size * .69, gloss);
  ellipse(point.x, point.y - 3, size * .56, size * .38, team ? '#c8322d' : '#608dce');
  ellipse(point.x - size * .18, point.y - 5, size * .28, size * .12, '#ffffff90');
  if (drop) ctx.restore();
}

function resizeView() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const wide = rect.width > rect.height * 1.35;
  const scale = Math.min(rect.width / (wide ? 420 : 300), rect.height / 570);
  view = { width: rect.width, height: rect.height, scale, ratio,
    left: (rect.width - 300 * scale) / 2, top: (rect.height - 570 * scale) / 2 };
}

function burst(x, y, color, count) {
  const point = project(x, y);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 18 + Math.random() * 76;
    particles.push({ ...point, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed,
      life: .25 + Math.random() * .4, color });
  }
}

function animateEffects(delta) {
  for (const puck of pucks) {
    if (puck.launchAge < .22) puck.launchAge += delta;
    if (puck.fall) puck.fall.age = Math.min(1, puck.fall.age + delta / .32);
  }
  for (const impact of impacts) impact.age += delta;
  impacts = impacts.filter(impact => impact.age < .36);
  shake = Math.max(0, shake - delta * 12);
  for (const spark of particles) {
    spark.x += spark.dx * delta;
    spark.y += spark.dy * delta;
    spark.dy += 55 * delta;
    spark.life -= delta;
  }
  particles = particles.filter(spark => spark.life > 0);
  for (const trail of trails) trail.life -= delta;
  trails = trails.filter(trail => trail.life > 0);
  trailClock += delta;
  if (trailClock < .025 || phase !== 'moving') return;
  trailClock = 0;
  for (const puck of pucks) {
    if (!puck.out && Math.hypot(puck.vx, puck.vy) > 95) {
      trails.push({ ...project(puck.x, puck.y), color: colors[puck.team], life: .18 });
    }
  }
}

function gradient(top, bottom, colors) {
  const paint = ctx.createLinearGradient(0, top, 0, bottom);
  colors.forEach((color, index) => paint.addColorStop(index / (colors.length - 1), color));
  return paint;
}

function panel(x, y, width, height, radius, paint) {
  ctx.fillStyle = paint;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

function room(width, height) {
  ctx.save();
  const unit = height / 570;
  ctx.translate(width / 2, 0);
  ctx.scale(unit, unit);
  const edge = width / unit / 2;
  ctx.fillStyle = gradient(0, 210, ['#131b16', '#354036', '#242722']);
  ctx.fillRect(-edge, 0, edge * 2, 220);
  for (let x = -Math.ceil(edge / 48) * 48; x < edge; x += 48) {
    ctx.fillStyle = '#ffffff09';
    ctx.fillRect(x, 0, 1, 157);
    ctx.fillStyle = '#00000028';
    ctx.fillRect(x + 1, 0, 3, 157);
  }
  ctx.fillStyle = gradient(154, 570, ['#514150', '#302736', '#1a1723']);
  ctx.fillRect(-edge, 154, edge * 2, 416);
  ctx.strokeStyle = '#edc0a41b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -Math.ceil(edge / 36) * 36; x <= edge + 36; x += 36) {
    ctx.moveTo(x * .55, 154);
    ctx.lineTo(x * 2.3, 570);
  }
  for (let i = 0; i < 11; i++) {
    const y = 154 + 416 * (i / 10) ** 1.8;
    ctx.moveTo(-edge, y);
    ctx.lineTo(edge, y);
  }
  ctx.stroke();
  panel(-edge, 145, edge * 2, 9, 0, '#211c29');
  panel(-edge, 145, edge * 2, 2, 0, '#bd856553');

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    // Framed wall art and a brass pendant above the booth.
    panel(89, 20, 58, 76, 4, '#131620');
    panel(93, 24, 50, 68, 2, '#c89760');
    panel(95, 26, 46, 64, 1, gradient(26, 90, ['#263e54', '#6a5763', '#d4946d']));
    ellipse(120, 48, 12, 12, '#f6c880');
    for (let i = 0; i < 4; i++) panel(99, 66 + i * 5, 38, 1, 0, '#f0d6a68c');
    const lamp = ctx.createRadialGradient(152, 98, 2, 152, 98, 83);
    lamp.addColorStop(0, '#ffc17465');
    lamp.addColorStop(1, '#ffc17400');
    ctx.fillStyle = lamp;
    ctx.fillRect(67, 15, 170, 170);
    panel(151, 0, 2, 57, 0, '#ad7e60');
    panel(137, 53, 30, 15, 6, gradient(53, 68, ['#594257', '#af7755', '#ffc381']));
    ellipse(152, 68, 11, 2, '#fff0b5');

    ellipse(147, 209, 49, 14, '#100f19a0');
    panel(100, 108, 91, 87, 12, gradient(108, 195, ['#55634b', '#2f4839', '#1f3027']));
    for (let x = 110; x < 187; x += 12) panel(x, 117, 1, 48, 0, '#d8d5a34d');
    panel(96, 164, 99, 23, 8, gradient(164, 187, ['#697959', '#34483a']));
    panel(106, 184, 6, 19, 2, '#2b2332');
    panel(177, 184, 6, 19, 2, '#2b2332');

    ellipse(123, 240, 38, 9, '#100f1980');
    panel(120, 197, 6, 42, 2, '#292432');
    ellipse(123, 197, 36, 9, '#3a2934');
    ellipse(123, 194, 36, 9, '#90614d');
    ellipse(123, 192, 33, 7, '#ba8763');
    panel(130, 178, 7, 13, 2, '#dfb377');
    panel(131, 179, 5, 3, 1, '#fff0b0');
    ctx.restore();
  }
  ctx.restore();
}

function draw() {
  const { width, height, scale, ratio, left, top } = view;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  room(width, height);
  ctx.setTransform(ratio * scale * cameraZoom, 0, 0, ratio * scale * cameraZoom,
    ratio * (left + Math.sin(shake * 14) * shake - 150 * scale * (cameraZoom - 1)),
    ratio * (top + cameraY * scale));
  ellipse(150, 512, 143, 31, '#090b12a0');
  const walnut = gradient(35, 529, ['#4a2819', '#885032', '#49261b', '#a46539']);
  const brass = gradient(36, 528, ['#74502f', '#ecc386', '#88613a', '#e6b879']);
  roundedTable(10, -6, 290, 550, 33, '#21120e', 24);
  roundedTable(10, -6, 290, 550, 33,
    gradient(43, 560, ['#412219', '#633924', '#371d16']), 15);
  roundedTable(10, -6, 290, 550, 33, walnut);
  roundedTable(13, -3, 287, 547, 31, brass);
  roundedTable(15, -1, 285, 545, 29, walnut);
  // Draw the cavity below its rim, then cap the raised maple slab above it.
  roundedTable(21, -9, 279, 541, 24, '#342419');
  roundedTable(23, -7, 277, 539, 22,
    gradient(42, 530, ['#5b584e', '#777468', '#504b42']), gutterDepth);
  gutterWall(23, 30, 23, 524, '#a4835e');
  gutterWall(277, 30, 277, 524, '#785b42');
  gutterWall(34, -7, 266, -7, '#987653');
  gutterWall(46, 34, 46, 526, '#6a492d');
  gutterWall(254, 34, 254, 526, '#513620');
  gutterWall(46, 526, 254, 526, '#80603c');
  strip(24, 45, 25, 514, '#ead3a367');
  strip(275, 45, 276, 514, '#ead3a367');

  const wood = gradient(47, 504, ['#aa784c', '#e9c18a', '#d3a36b', '#b58150']);
  strip(46, 34, 254, 526, wood);
  for (let x = 49; x < 253; x += 5) {
    strip(x, 34, x + (x % 3 === 0 ? 1 : .4), 526, x % 3 === 0 ? '#fff1bf39' : '#793b202b');
  }
  for (const line of grain) {
    strip(line.x, line.y, line.x + .36, line.y + line.length,
      line.light ? '#ffe5ad43' : '#7640224d');
  }
  // Long soft reflections from the overhead fixtures follow the lane.
  const sheen = gradient(40, 500, ['#fff2bd08', '#fff2bd45', '#fff2bd00']);
  strip(65, 34, 82, 526, sheen);
  strip(219, 34, 231, 526, sheen);
  strip(46, 34, 47.4, 526, '#fff0bb90');
  strip(252.6, 34, 254, 526, '#f4d3a185');
  strip(46, 524.5, 254, 526, '#ffe1a287');
  ctx.textAlign = 'center';
  for (const [y, label] of [[releaseLine, ''], [threeLine, '3'], [twoLine, '2'], [foulLine, '1']]) {
    const leftEdge = project(surface.left, y);
    const rightEdge = project(surface.right, y);
    ctx.fillStyle = '#6a3d2b';
    ctx.fillRect(leftEdge.x, leftEdge.y, rightEdge.x - leftEdge.x, 2);
    if (!label) continue;
    const upper = label === '3' ? surface.top : label === '2' ? threeLine : twoLine;
    const center = (project(150, upper).y + project(150, y).y) / 2;
    ctx.save();
    ctx.translate(150, center);
    ctx.scale(1, .72);
    ctx.textBaseline = 'middle';
    ctx.font = label === '1' ? '800 32px Georgia' : '800 18px Georgia';
    ctx.fillStyle = '#ffe9b660';
    ctx.fillText(label, 0, 1.1);
    ctx.fillStyle = '#654128';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  ctx.font = '800 9px system-ui';
  ctx.fillStyle = '#ffd69d';
  ctx.fillText(shotLimit > openingShots ? 'TIEBREAK' : '4 PUCKS EACH', 150, 536);
  for (const trail of trails) {
    ctx.globalAlpha = trail.life * 2;
    ellipse(trail.x, trail.y, 7, 3, trail.color);
  }
  ctx.globalAlpha = 1;
  for (const puck of pucks) {
    if (puck.fall) {
      const progress = 1 - (1 - puck.fall.age) ** 2;
      puckArt(puck.x + (puck.fall.x - puck.x) * progress,
        puck.y + (puck.fall.y - puck.y) * progress, puck.team, progress);
    } else if (!puck.out) {
      const speed = Math.hypot(puck.vx, puck.vy);
      if (speed > 18) {
        const head = project(puck.x, puck.y);
        const tail = project(puck.x - puck.vx * .15, puck.y - puck.vy * .15);
        const wake = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
        wake.addColorStop(0, colors[puck.team] + '00');
        wake.addColorStop(1, colors[puck.team]);
        ctx.save();
        ctx.globalAlpha = Math.min(.65, (speed - 18) / 300);
        ctx.strokeStyle = wake;
        ctx.lineWidth = 2 + Math.min(5, speed / 55);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        ctx.restore();
      }
      if (puck.launchAge < .22) {
        const point = project(puck.x, puck.y);
        const progress = puck.launchAge / .22;
        ctx.save();
        ctx.globalAlpha = .6 * (1 - progress);
        ctx.strokeStyle = colors[puck.team];
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(point.x, point.y, 12 + progress * 12, 7 + progress * 8, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      puckArt(puck.x, puck.y, puck.team);
    }
  }
  if (phase === 'aim' || phase === 'bot') puckArt(drag?.puck.x ?? start.x, drag?.puck.y ?? start.y, turn);
  for (const impact of impacts) {
    const progress = impact.age / .36;
    ctx.globalAlpha = (1 - progress) * .8;
    ctx.strokeStyle = '#fff0c7';
    ctx.lineWidth = 2 - progress;
    ctx.beginPath();
    ctx.ellipse(impact.x, impact.y, 4 + progress * 26, 2 + progress * 15, 0, 0, Math.PI * 2);
    ctx.stroke();
    ellipse(impact.x, impact.y, 5 * (1 - progress), 3 * (1 - progress), '#fff8df');
  }
  for (const spark of particles) {
    ctx.globalAlpha = Math.min(1, spark.life * 2.5);
    ellipse(spark.x, spark.y, 1.9, 1.9, spark.color);
  }
  ctx.globalAlpha = 1;
}

function position(event) {
  const rect = canvas.getBoundingClientRect();
  const origin = project(start.x, start.y);
  const puckY = view.top + (origin.y * cameraZoom + cameraY) * view.scale;
  const puckX = view.left + 150 * view.scale;
  // Measure the push in screen space so zoom does not change shot power.
  return { x: start.x + (event.clientX - rect.left - puckX) / view.scale,
    y: start.y + (event.clientY - rect.top - puckY) / view.scale };
}

function aim(event) {
  const point = position(event);
  const dx = point.x - drag.origin.x;
  const dy = drag.origin.y - point.y;
  const startScreen = project(start.x, start.y);
  const targetY = startScreen.y - dy / cameraZoom;
  let near = surface.bottom - scoringRadius;
  let far = releaseLine + scoringRadius;
  // Invert the perspective so the puck follows the pointer up to the painted line.
  for (let i = 0; i < 16; i++) {
    const middle = (near + far) / 2;
    if (project(start.x, middle).y < targetY) far = middle;
    else near = middle;
  }
  const y = (near + far) / 2;
  const widthScale = project(start.x + 1, y).x - project(start.x, y).x;
  const x = start.x + dx / (cameraZoom * widthScale);
  drag.puck = {
    x: Math.max(surface.left + radius, Math.min(surface.right - radius, x)),
    y
  };
  // Sideways positioning before the forward push sets the launch position, not its direction.
  if (dy < 7) {
    drag.pushStart = drag.puck;
    speed = 0;
    return;
  }
  const pushStart = drag.pushStart ?? start;
  const travelX = drag.puck.x - pushStart.x;
  const travelY = pushStart.y - drag.puck.y;
  angle = Math.max(-.55, Math.min(.55, Math.atan2(travelX, travelY)));
  const power = Math.min(1, (dy - 7) / 120);
  speed = 220 + 170 * power;
}

canvas.addEventListener('pointerdown', event => {
  if (!ready || paused || resuming || phase !== 'aim' || drag || event.button !== 0) return;
  const origin = position(event);
  if (Math.hypot(origin.x - start.x, origin.y - start.y) > 48) return;
  event.preventDefault();
  beginPlay();
  drag = { id: event.pointerId, origin, puck: start };
  speed = 0;
  angle = 0;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (drag?.id === event.pointerId) aim(event);
});
canvas.addEventListener('pointerup', event => {
  if (drag?.id !== event.pointerId) return;
  // A lift can report a shifted touch centroid. Use the last tracked puck
  // position once a push is armed, so the puck never jumps at release.
  if (speed < 25) aim(event);
  const origin = drag.puck;
  drag = null;
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (speed >= 25) shoot(angle, speed, origin);
});
for (const type of ['pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(type, event => {
    if (drag?.id === event.pointerId) drag = null;
  });
}
canvas.addEventListener('keydown', event => {
  if (!ready || paused || resuming || phase !== 'aim' || drag) return;
  switch (event.key) {
    case 'ArrowLeft': angle = Math.max(-.55, angle - .035); break;
    case 'ArrowRight': angle = Math.min(.55, angle + .035); break;
    case 'ArrowUp': speed = Math.min(390, speed + 5); break;
    case 'ArrowDown': speed = Math.max(25, speed - 5); break;
    case ' ': if (speed >= 25) { beginPlay(); shoot(angle, speed); } break;
    default: return;
  }
  event.preventDefault();
});
function beginPlay() {
  sound.unlock();
  started = true;
  platform.start();
}

function pause() {
  if (!ready || paused || resuming || phase === 'done') return;
  paused = true;
  sound.block(true);
  drag = null;
  platform.stop();
  setPauseControl(true);
  status.textContent = 'Paused';
}

async function continuePlay(restart = false) {
  if (!ready || resuming) return;
  const replay = started || phase === 'done';
  resuming = true;
  drag = null;
  platform.stop();
  sound.block(true);
  if (replay) await platform.commercialBreak();
  sound.block(false);
  if (restart) reset();
  paused = false;
  resuming = false;
  setPauseControl(false);
  if (replay) beginPlay();
  updateStatus();
}

function setPauseControl(isPaused) {
  const label = isPaused ? 'Resume' : 'Pause';
  pauseButton.className = isPaused ? 'is-alternate' : '';
  pauseButton.title = label;
  pauseButton.setAttribute('aria-label', label);
}

pauseButton.addEventListener('click', () => paused ? continuePlay() : pause());
const soundButton = document.querySelector('#sound');
soundButton.addEventListener('click', () => {
  const enabled = sound.toggle();
  soundButton.className = enabled ? '' : 'is-alternate';
  soundButton.setAttribute('aria-pressed', String(enabled));
});
resetButton.addEventListener('click', () => continuePlay(true));
rematchButton.addEventListener('click', async () => {
  await continuePlay(true);
  canvas.focus();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.repeat) return;
  if (paused) continuePlay();
  else pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && started) pause();
  sound.block(document.hidden || paused || resuming);
});
new ResizeObserver(resizeView).observe(canvas);

function updateCamera(delta) {
  if (drag || paused || resuming) return;
  const puck = pucks.at(-1);
  let zoom = 1;
  let offset = 0;
  if ((phase === 'moving' || puck?.fall?.age < 1) && puck) {
    const progress = Math.max(0, Math.min(1, ((puck.launchY ?? start.y) - puck.y) / 400));
    zoom += .35 * progress;
    offset = 24 * progress;
  } else if (phase === 'done' || phase === 'tie') {
    zoom = 1.44;
    offset = 95;
  }
  const easing = 1 - Math.exp(-delta * 9);
  cameraZoom += (zoom - cameraZoom) * easing;
  cameraY += (offset - cameraY) * easing;
}

let previous = 0;
let elapsed = 0;
function frame(now) {
  const frameTime = (now - previous) / 1000;
  const delta = Math.min(.05, frameTime);
  if (ready && !paused && !resuming) {
    // Catch up on ordinary dropped frames without simulating a long tab suspension.
    elapsed += Math.min(.25, frameTime);
    animateEffects(delta);
  }
  previous = now;
  while (elapsed >= step) {
    tick();
    elapsed -= step;
  }
  updateCamera(delta);
  updateScore();
  draw();
  requestAnimationFrame(frame);
}
reset();
resizeView();
status.textContent = 'Getting the table ready…';
platform.ready.then(() => {
  ready = true;
  draw();
  platform.loaded();
  updateStatus();
});
requestAnimationFrame(frame);
