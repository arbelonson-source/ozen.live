// The scroll story: a 3D phone (and, in one chapter, a laptop) that turns
// and moves as the chapters scroll past, with the phone's screen drawn live
// from what Ozen really shows. Purely decorative: every chapter's text is
// in the page, and the canvas is hidden from screen readers.

import * as THREE from '../vendor/three.module.min.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

const stage = document.querySelector('.stage');
const canvas = stage ? stage.querySelector('canvas') : null;
const story = document.querySelector('.story');
const chapters = Array.from(document.querySelectorAll('.chapter[data-scene]'));
const toggle = document.querySelector('.motion-toggle');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const BODY = '"Atkinson Hyperlegible", system-ui, sans-serif';
const DISPLAY = '"Rubik", system-ui, sans-serif';
const C = {
  text: '#ffffff',
  old: '#9aa3af',
  yellow: '#ffe033',
  ink: '#1a1500',
  amber: '#ffb547',
  chrome: '#1d2129',
  chromeText: '#e9edf3',
  muted: '#aab3c0',
  green: '#4cd964',
};

const PHONE = { w: 1.43, h: 2.95, d: 0.12, r: 0.22 };
const SCREEN = { w: 1.33, h: 2.85, r: 0.18 };
const CW = 720;
const CH = Math.round(CW * SCREEN.h / SCREEN.w);

// ---------------------------------------------------------------------------
// Small helpers

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// ShapeGeometry's UVs are in shape units; a canvas texture needs 0..1.
function normaliseUVs(geo) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - min.x) / (max.x - min.x), (pos.getY(i) - min.y) / (max.y - min.y));
  }
  uv.needsUpdate = true;
  return geo;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// A made-up code pattern for the pairing scene. It decodes to nothing.
function codeMatrix(n = 25, seed = 11) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const m = Array.from({ length: n }, () => Array(n).fill(false));
  const reserved = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!reserved(r, c)) m[r][c] = rnd() > 0.52;
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      m[r0 + r][c0 + c] = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  return m;
}
const CODE = codeMatrix();

function drawCode(g, x, y, size) {
  const n = CODE.length, quiet = 2;
  const cell = size / (n + quiet * 2);
  g.fillStyle = '#ffffff';
  g.fillRect(x, y, size, size);
  g.fillStyle = '#000000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (CODE[r][c]) g.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
  }
}

// ---------------------------------------------------------------------------
// The phone's screen: a 2D canvas redrawn as the scene plays

const screenCanvas = document.createElement('canvas');
screenCanvas.width = CW;
screenCanvas.height = CH;
const g = screenCanvas.getContext('2d');

function clearScreen(colour = '#000000') {
  g.fillStyle = colour;
  g.fillRect(0, 0, CW, CH);
}

function statusBar(airplane = false, light = false) {
  const ink = light ? '#000000' : '#ffffff';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = ink;
  g.font = `700 30px ${BODY}`;
  g.fillText('10:24', 70, 62);
  g.fillStyle = '#050505';
  roundRect(g, CW / 2 - 104, 32, 208, 60, 30);
  g.fill();
  const x = CW - 66;
  g.strokeStyle = ink;
  g.lineWidth = 3;
  roundRect(g, x - 52, 50, 46, 24, 7);
  g.stroke();
  g.fillStyle = ink;
  roundRect(g, x - 48, 54, 30, 16, 4);
  g.fill();
  g.fillRect(x - 4, 57, 4, 10);
  if (airplane) {
    g.save();
    g.translate(x - 96, 62);
    g.rotate(-Math.PI / 4);
    g.beginPath();
    g.moveTo(0, -17); g.lineTo(3, -4); g.lineTo(15, 3); g.lineTo(15, 7); g.lineTo(3, 3);
    g.lineTo(2, 12); g.lineTo(6, 15); g.lineTo(6, 18); g.lineTo(0, 16); g.lineTo(-6, 18);
    g.lineTo(-6, 15); g.lineTo(-2, 12); g.lineTo(-3, 3); g.lineTo(-15, 7); g.lineTo(-15, 3);
    g.lineTo(-3, -4); g.closePath();
    g.fill();
    g.restore();
  } else {
    for (let i = 0; i < 4; i++) g.fillRect(x - 124 + i * 12, 72 - (i + 1) * 6, 8, (i + 1) * 6);
  }
}

function iconButton(x, y, kind) {
  g.fillStyle = C.chrome;
  g.beginPath();
  g.arc(x, y, 46, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.chromeText;
  g.fillStyle = C.chromeText;
  g.lineWidth = 4;
  g.lineCap = 'round';
  if (kind === 'mic') {
    roundRect(g, x - 9, y - 24, 18, 30, 9);
    g.stroke();
    g.beginPath();
    g.arc(x, y - 4, 17, 0.1 * Math.PI, 0.9 * Math.PI);
    g.stroke();
    g.beginPath();
    g.moveTo(x, y + 13); g.lineTo(x, y + 22);
    g.stroke();
  } else if (kind === 'say') {
    roundRect(g, x - 22, y - 18, 44, 30, 9);
    g.stroke();
    g.beginPath();
    g.moveTo(x - 8, y + 12); g.lineTo(x - 14, y + 22); g.lineTo(x + 2, y + 12);
    g.stroke();
    g.beginPath();
    g.moveTo(x - 12, y - 6); g.lineTo(x + 12, y - 6);
    g.moveTo(x - 12, y + 2); g.lineTo(x + 4, y + 2);
    g.stroke();
  } else {
    g.beginPath();
    g.arc(x, y, 11, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15);
      g.lineTo(x + Math.cos(a) * 22, y + Math.sin(a) * 22);
      g.stroke();
    }
  }
}

// The row of buttons along the bottom of the caption screen.
function controls() {
  const y = CH - 120;
  iconButton(84, y, 'mic');
  g.fillStyle = C.chrome;
  roundRect(g, 146, y - 50, 330, 100, 50);
  g.fill();
  g.fillStyle = C.green;
  g.beginPath();
  g.arc(192, y, 11, 0, Math.PI * 2);
  g.fill();
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = C.text;
  g.font = `700 32px ${BODY}`;
  g.fillText('Listening', 218, y - 14);
  g.fillStyle = C.muted;
  g.font = `400 24px ${BODY}`;
  g.fillText('Tap to pause', 218, y + 20);
  iconButton(548, y, 'say');
  iconButton(648, y, 'gear');
}

function layoutWords(text, maxW) {
  const words = text.split(' ').filter(Boolean);
  const space = g.measureText(' ').width;
  const rows = [];
  let row = [];
  let width = 0;
  for (const word of words) {
    const w = g.measureText(word).width;
    if (row.length && width + space + w > maxW) {
      rows.push(row);
      row = [];
      width = 0;
    }
    width += (row.length ? space : 0) + w;
    row.push({ word, w });
  }
  if (row.length) rows.push(row);
  return rows;
}

// Caption lines, newest at the bottom, the way Ozen lays them out: numbers
// in yellow, the reader's own name in a yellow highlight, older lines dimmer.
function captionBlock(entries, bottom, top, size = 54) {
  const lh = Math.round(size * 1.3);
  const maxW = CW - 112;
  g.font = `700 ${size}px ${BODY}`;
  const space = g.measureText(' ').width;
  const placed = [];
  let y = bottom;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    g.font = `700 ${size}px ${BODY}`;
    const rows = layoutWords(e.text, maxW);
    const h = rows.length * lh + (e.speaker ? 44 : 0);
    y -= h;
    if (y < top) break;
    placed.push({ e, rows, y });
    y -= 26;
  }
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  for (const { e, rows, y: y0 } of placed) {
    let ry = y0;
    if (e.speaker) {
      g.font = `700 32px ${BODY}`;
      g.fillStyle = e.colour;
      g.fillText(e.speaker, 56, ry + 18);
      ry += 44;
    }
    g.font = `700 ${size}px ${BODY}`;
    for (const row of rows) {
      let x = 56;
      const cy = ry + lh / 2;
      for (const { word, w } of row) {
        const m = /^(.*?)([,.!?]*)$/.exec(word);
        const core = m[1];
        const punct = m[2];
        if (e.name && core === e.name) {
          const cw = g.measureText(core).width;
          g.fillStyle = C.yellow;
          roundRect(g, x - 8, cy - size * 0.62, cw + 16, size * 1.24, 14);
          g.fill();
          g.fillStyle = C.ink;
          g.fillText(core, x, cy);
          g.fillStyle = e.dim ? C.old : C.text;
          g.fillText(punct, x + cw, cy);
        } else {
          g.fillStyle = /\d/.test(word) ? C.yellow : (e.dim ? C.old : C.text);
          g.fillText(word, x, cy);
        }
        x += w + space;
      }
      ry += lh;
    }
  }
}

// Types `lines` out one after another at `cps` characters a second, then
// holds and starts again; `history` stays above as older, dimmer lines.
function transcript(history, lines, t, { cps = 26, gap = 0.9, hold = 2.6, start = 0.3 } = {}) {
  const durations = lines.map((l) => l.text.length / cps + gap);
  const period = start + durations.reduce((a, b) => a + b, 0) + hold;
  let left = (t % period) - start;
  const out = history.map((h) => ({ ...h }));
  for (let i = 0; i < lines.length && left > 0; i++) {
    const n = Math.min(lines[i].text.length, Math.floor(left * cps));
    out.push({ ...lines[i], text: lines[i].text.slice(0, n) });
    left -= durations[i];
  }
  const keepBright = 2;
  out.forEach((e, i) => { e.dim = i < out.length - keepBright; });
  return out;
}
const transcriptPeriod = (lines, { cps = 26, gap = 0.9, hold = 2.6, start = 0.3 } = {}) =>
  start + lines.reduce((a, l) => a + l.text.length / cps + gap, 0) + hold;

function pill(text, y, fill, ink, size = 34) {
  g.font = `700 ${size}px ${BODY}`;
  const w = g.measureText(text).width + 56;
  g.fillStyle = fill;
  roundRect(g, (CW - w) / 2, y, w, size + 34, (size + 34) / 2);
  g.fill();
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, CW / 2, y + (size + 34) / 2);
}

function wrapCentered(text, y, size, colour, weight = 400, family = BODY, maxW = CW - 120) {
  g.font = `${weight} ${size}px ${family}`;
  g.fillStyle = colour;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rows = layoutWords(text, maxW);
  rows.forEach((row, i) => g.fillText(row.map((r) => r.word).join(' '), CW / 2, y + i * size * 1.3));
}

// ---------------------------------------------------------------------------
// Scenes: what the phone shows, where it stands, and the light around it

const HERO_HISTORY = [{ text: 'Hi Grandma, we brought you lunch.' }];
const HERO_LINES = [
  { text: 'Good morning! Did you sleep well?' },
  { text: 'The pharmacy closes early on Friday.' },
  { text: "Let's go tomorrow at 10." },
  { text: 'Do you want me to drive you there?' },
];
const HERO_PERIOD = transcriptPeriod(HERO_LINES);

const SPEAKER_LINES = [
  { speaker: 'Noa', colour: '#c9a2ff', text: 'Are you coming on Saturday?' },
  { speaker: 'Dad', colour: '#7ee2a8', text: "We'll be there by 12." },
  { speaker: 'Noa', colour: '#c9a2ff', text: 'Great! Bring the cake.' },
];
const SPEAKER_PERIOD = transcriptPeriod(SPEAKER_LINES);

function drawCaptionScreen(t, { airplane = false, lines = HERO_LINES, history = HERO_HISTORY } = {}) {
  clearScreen();
  statusBar(airplane);
  captionBlock(transcript(history, lines, t), CH - 236, 150);
  controls();
}

const CALLED_PERIOD = 5.6;
const NAME_LINE = { text: 'Grandma, do you want some tea?', name: 'Grandma' };

function drawCalled(t) {
  const tt = t % CALLED_PERIOD;
  clearScreen();
  statusBar();
  const entries = [
    { text: 'The pharmacy closes early on Friday.', dim: true },
    { text: "Let's go tomorrow at 10.", dim: false },
  ];
  const n = clamp(Math.floor((tt - 0.4) * 26), 0, NAME_LINE.text.length);
  if (n > 0) entries.push({ ...NAME_LINE, text: NAME_LINE.text.slice(0, n) });
  captionBlock(entries, CH - 236, 150);
  if (tt > 0.72 && tt < 4.9) {
    g.globalAlpha = smooth(0.72, 0.95, tt) * (1 - smooth(4.5, 4.9, tt));
    pill('Said: Grandma', 132, C.yellow, C.ink);
    g.globalAlpha = 1;
  }
  controls();
}

const HOUSE_PERIOD = 5.6;

function drawHouse(t) {
  const tt = t % HOUSE_PERIOD;
  clearScreen();
  statusBar();
  captionBlock([
    { text: 'Do you want some tea?', dim: true },
    { text: 'Yes please, with lemon.', dim: false },
  ], CH - 236, 150);
  controls();
  const lit = (tt > 0.5 && tt < 0.9) || (tt > 1.3 && tt < 1.7);
  if (lit) {
    g.fillStyle = 'rgba(255, 181, 71, 0.2)';
    g.fillRect(0, 0, CW, CH);
    g.strokeStyle = C.amber;
    g.lineWidth = 30;
    roundRect(g, 15, 15, CW - 30, CH - 30, 60);
    g.stroke();
  }
  if (tt > 0.5 && tt < 4.9) {
    const k = smooth(0.5, 0.85, tt) * (1 - smooth(4.5, 4.9, tt));
    const y = -170 + k * 300;
    g.fillStyle = C.amber;
    roundRect(g, 36, y, CW - 72, 140, 34);
    g.fill();
    g.fillStyle = C.ink;
    g.strokeStyle = C.ink;
    g.lineWidth = 5;
    const bx = 108, by = y + 70;
    g.beginPath();
    g.moveTo(bx - 26, by + 18);
    g.quadraticCurveTo(bx - 22, by - 32, bx, by - 32);
    g.quadraticCurveTo(bx + 22, by - 32, bx + 26, by + 18);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(bx, by + 24, 7, 0, Math.PI * 2);
    g.fill();
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = `800 46px ${DISPLAY}`;
    g.fillText('Doorbell', 160, y + 52);
    g.font = `400 28px ${BODY}`;
    g.fillText('Heard just now', 160, y + 98);
  }
}

const REPLY_TEXT = 'Could you speak a little slower, please?';
const REPLY_PERIOD = 6.8;

function drawReply(t, clock) {
  const tt = t % REPLY_PERIOD;
  clearScreen();
  statusBar();
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = C.text;
  g.font = `800 66px ${DISPLAY}`;
  g.fillText('Say', 54, 196);
  g.fillStyle = C.chrome;
  roundRect(g, 40, 236, CW - 80, 330, 36);
  g.fill();
  const n = clamp(Math.floor((tt - 0.3) * 22), 0, REPLY_TEXT.length);
  const typed = REPLY_TEXT.slice(0, n);
  g.font = `700 48px ${BODY}`;
  g.textBaseline = 'middle';
  const rows = layoutWords(typed, CW - 160);
  let endX = 80, endY = 300;
  rows.forEach((row, i) => {
    const line = row.map((r) => r.word).join(' ');
    g.fillStyle = C.text;
    g.fillText(line, 80, 300 + i * 64);
    endX = 80 + g.measureText(line).width + 6;
    endY = 300 + i * 64;
  });
  if (n < REPLY_TEXT.length && Math.floor(clock * 2.2) % 2 === 0) {
    g.fillStyle = C.yellow;
    g.fillRect(endX, endY - 28, 5, 56);
  }
  const speaking = tt > 2.6 && tt < 5.7;
  g.fillStyle = C.yellow;
  roundRect(g, 40, 604, CW - 80, 124, 62);
  g.fill();
  g.fillStyle = C.ink;
  g.font = `800 46px ${DISPLAY}`;
  g.textAlign = 'center';
  g.fillText(speaking ? 'Stop' : 'Play', CW / 2 + (speaking ? 40 : 0), 666);
  if (speaking) {
    for (let i = 0; i < 5; i++) {
      const h = 18 + Math.abs(Math.sin(clock * 9 + i * 1.3)) * 44;
      g.fillRect(CW / 2 - 120 + i * 18, 666 - h / 2, 10, h);
    }
  }
  g.textAlign = 'left';
  g.fillStyle = C.muted;
  g.font = `700 30px ${BODY}`;
  g.fillText('Quick phrases', 54, 800);
  let x = 40, y = 840;
  for (const phrase of ['Please say that again', 'Thank you', 'One moment, please', 'I am hard of hearing']) {
    g.font = `700 32px ${BODY}`;
    const w = g.measureText(phrase).width + 48;
    if (x + w > CW - 40) { x = 40; y += 96; }
    g.fillStyle = C.chrome;
    roundRect(g, x, y, w, 76, 38);
    g.fill();
    g.fillStyle = C.chromeText;
    g.fillText(phrase, x + 24, y + 39);
    x += w + 16;
  }
}

const LETTERS_TEXT = 'Tomorrow at 10';

function drawLetters(t) {
  clearScreen();
  statusBar();
  const n = clamp(Math.floor((t - 0.3) * 9), 0, LETTERS_TEXT.length);
  const text = LETTERS_TEXT.slice(0, n);
  g.font = `800 112px ${DISPLAY}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const rows = layoutWords(text, CW - 100);
  const top = CH / 2 - (rows.length * 132) / 2 - 80;
  rows.forEach((row, i) => {
    let x = 50;
    for (const { word, w } of row) {
      g.fillStyle = /\d/.test(word) ? C.yellow : C.text;
      g.fillText(word, x, top + i * 132);
      x += w + g.measureText(' ').width;
    }
  });
  let x = 40;
  const y = CH - 170;
  for (const label of ['Clear', 'Flip', 'Speak', 'Close']) {
    g.font = `700 32px ${BODY}`;
    const w = (CW - 80 - 3 * 14) / 4;
    g.fillStyle = C.chrome;
    roundRect(g, x, y, w, 96, 30);
    g.fill();
    g.fillStyle = C.chromeText;
    g.textAlign = 'center';
    g.fillText(label, x + w / 2, y + 49);
    x += w + 14;
  }
}

const HOME_PERIOD = 6.6;

function drawHome(t) {
  const tt = t % HOME_PERIOD;
  if (tt < 2.7) {
    const grad = g.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, '#1d2230');
    grad.addColorStop(1, '#2d3442');
    g.fillStyle = grad;
    g.fillRect(0, 0, CW, CH);
    statusBar();
    const size = 330;
    const cx = CW / 2, cy = 640;
    drawCode(g, cx - size / 2, cy - size / 2, size);
    const k = 1.35 - 0.35 * smooth(0.2, 1.5, tt);
    const half = (size / 2 + 34) * k;
    g.strokeStyle = C.yellow;
    g.lineWidth = 10;
    g.lineCap = 'round';
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      g.beginPath();
      g.moveTo(cx + sx * half, cy + sy * (half - 60));
      g.lineTo(cx + sx * half, cy + sy * half);
      g.lineTo(cx + sx * (half - 60), cy + sy * half);
      g.stroke();
    }
    wrapCentered('Point the camera at the code on the computer', CH - 330, 38, C.text, 700);
  } else {
    clearScreen();
    statusBar();
    g.globalAlpha = smooth(2.7, 3.1, tt);
    g.fillStyle = C.green;
    g.beginPath();
    g.arc(CW / 2, 560, 96, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 16;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(CW / 2 - 42, 562);
    g.lineTo(CW / 2 - 10, 594);
    g.lineTo(CW / 2 + 46, 530);
    g.stroke();
    wrapCentered('Connected', 740, 64, C.text, 800, DISPLAY);
    wrapCentered('Captions now use your home computer.', 830, 36, C.muted);
    g.globalAlpha = 1;
  }
}

function drawPrivate(t) {
  drawCaptionScreen(t, { airplane: true });
  g.globalAlpha = 0.96;
  g.fillStyle = C.chrome;
  roundRect(g, 120, 128, CW - 240, 80, 40);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = C.green;
  g.beginPath();
  g.arc(170, 168, 18, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#06210d';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(161, 168); g.lineTo(168, 175); g.lineTo(180, 160);
  g.stroke();
  g.fillStyle = C.text;
  g.font = `700 30px ${BODY}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('No internet needed', 204, 169);
}

// Poses: x and y in fractions of half the visible width and height, angles
// in radians, s = the phone's height as a fraction of the visible height.
const SCENES = {
  captions: {
    desk: [0.5, 0.0, -0.06, -0.42, 0.04, 0.72], mob: [0, 0.42, -0.04, -0.28, 0.02, 0.42],
    glow: '#3d6bff', rings: 'voices', settle: HERO_PERIOD - 1.4,
    draw: (t) => drawCaptionScreen(t),
  },
  called: {
    desk: [0.47, 0.02, 0.02, -0.2, -0.03, 0.74], mob: [0, 0.42, 0.02, -0.16, -0.02, 0.43],
    glow: '#ffd23d', rings: null, settle: 2.6,
    draw: drawCalled,
    buzz: (t) => { const k = (t % CALLED_PERIOD) - 0.72; return k >= 0 && k < 0.7 ? 1 - k / 0.7 : 0; },
  },
  house: {
    desk: [0.52, 0.0, -0.05, -0.52, 0.03, 0.68], mob: [0.08, 0.42, -0.04, -0.34, 0.02, 0.41],
    glow: '#ff9d2e', rings: 'doorbell', settle: 2.2,
    draw: drawHouse,
  },
  reply: {
    desk: [0.47, -0.02, 0.1, -0.18, 0.0, 0.72], mob: [0, 0.42, 0.06, -0.12, 0, 0.42],
    glow: '#6f9bff', rings: 'speaker', settle: 2.5,
    draw: drawReply,
  },
  letters: {
    desk: [0.5, -0.08, -1.12, 0.0, 0.0, 0.66], mob: [0, 0.36, -1.0, 0, 0, 0.45],
    glow: '#e8ecff', rings: null, settle: 3.0,
    draw: (t) => drawLetters(t),
    spin: (t) => {
      if (t < 3.2) return 0;
      const k = (t - 3.2) % 6;
      return (smooth(0, 0.8, k) - smooth(3, 3.8, k)) * Math.PI;
    },
  },
  speakers: {
    desk: [0.48, 0.0, -0.04, -0.32, 0.03, 0.72], mob: [0, 0.42, -0.03, -0.22, 0.02, 0.42],
    glow: '#b48cff', rings: 'voices', settle: SPEAKER_PERIOD - 1.4,
    draw: (t) => drawCaptionScreen(t, { lines: SPEAKER_LINES, history: [] }),
  },
  private: {
    desk: [0.5, 0.0, -0.06, -0.3, 0.0, 0.68], mob: [0, 0.42, -0.04, -0.2, 0, 0.42],
    glow: '#2fd39a', rings: 'inward', settle: HERO_PERIOD - 1.4,
    draw: drawPrivate,
    turn: (p) => smooth(0.12, 0.88, p) * Math.PI * 2,
  },
  home: {
    desk: [0.8, 0.06, -0.02, -0.55, 0.0, 0.5], mob: [0.5, 0.44, -0.02, -0.4, 0, 0.33],
    glow: '#6f9bff', rings: null, settle: 4.2,
    draw: drawHome, laptop: true,
  },
  get: {
    desk: [0.5, 0.0, -0.05, -0.36, 0.03, 0.72], mob: [0, 0.42, -0.04, -0.26, 0.02, 0.42],
    glow: '#ffd23d', rings: 'voices', settle: HERO_PERIOD - 1.4,
    draw: (t) => drawCaptionScreen(t),
  },
};

// ---------------------------------------------------------------------------
// The 3D scene

function buildPhone(screenTexture) {
  const rig = new THREE.Group();
  const body = new THREE.Group();
  rig.add(body);

  const frame = new THREE.MeshStandardMaterial({ color: 0x3b4558, metalness: 1, roughness: 0.32 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x030405, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 });
  const back = new THREE.MeshPhysicalMaterial({ color: 0x1f3a66, roughness: 0.42, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.25 });

  const bevel = 0.03;
  const shell = new THREE.ExtrudeGeometry(roundedRectShape(PHONE.w - bevel * 2, PHONE.h - bevel * 2, PHONE.r - bevel), {
    depth: PHONE.d, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 8, curveSegments: 36,
  });
  shell.translate(0, 0, -PHONE.d / 2);
  body.add(new THREE.Mesh(shell, [glass, frame]));
  const front = PHONE.d / 2 + bevel;

  const screen = new THREE.Mesh(
    normaliseUVs(new THREE.ShapeGeometry(roundedRectShape(SCREEN.w, SCREEN.h, SCREEN.r), 36)),
    new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false }),
  );
  screen.position.z = front + 0.002;
  body.add(screen);

  const plate = new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(PHONE.w - 0.08, PHONE.h - 0.08, PHONE.r - 0.04), 36), back);
  plate.rotation.y = Math.PI;
  plate.position.z = -front - 0.002;
  body.add(plate);

  const bump = new THREE.Mesh(new RoundedBoxGeometry(0.64, 0.64, 0.05, 4, 0.14), back);
  bump.position.set(PHONE.w / 2 - 0.42, PHONE.h / 2 - 0.42, -front - 0.025);
  body.add(bump);
  const ring = new THREE.MeshStandardMaterial({ color: 0x8892a6, metalness: 1, roughness: 0.25 });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x05070c, roughness: 0.05, clearcoat: 1 });
  for (const [lx, ly] of [[-0.14, 0.14], [-0.14, -0.14], [0.14, 0]]) {
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 40), ring);
    outer.rotation.x = Math.PI / 2;
    outer.position.set(bump.position.x + lx, bump.position.y + ly, -front - 0.06);
    body.add(outer);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.052, 40), lens);
    inner.rotation.x = Math.PI / 2;
    inner.position.copy(outer.position);
    inner.position.z -= 0.004;
    body.add(inner);
  }

  const button = (x, y, h) => {
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.035, h, 0.07, 2, 0.014), frame);
    b.position.set(x, y, 0);
    body.add(b);
  };
  button(-PHONE.w / 2 - 0.006, 0.98, 0.16);
  button(-PHONE.w / 2 - 0.006, 0.62, 0.3);
  button(-PHONE.w / 2 - 0.006, 0.24, 0.3);
  button(PHONE.w / 2 + 0.006, 0.6, 0.46);

  return { rig, body };
}

function buildLaptop(texture) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xaab3c2, metalness: 0.9, roughness: 0.34 });
  group.add(new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.08, 1.75, 4, 0.03), metal));
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.92), new THREE.MeshStandardMaterial({ color: 0x1b202a, roughness: 0.85 }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0, 0.042, -0.22);
  group.add(deck);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.52), new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.6, roughness: 0.45 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.042, 0.5);
  group.add(pad);
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.04, -0.86);
  hinge.rotation.x = -0.24;
  group.add(hinge);
  const lid = new THREE.Mesh(new RoundedBoxGeometry(2.6, 1.7, 0.05, 4, 0.02), metal);
  lid.position.set(0, 0.85, 0);
  hinge.add(lid);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(2.42, 1.52), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  display.position.set(0, 0.85, 0.027);
  hinge.add(display);
  return group;
}

const laptopCanvas = document.createElement('canvas');
laptopCanvas.width = 1024;
laptopCanvas.height = 640;

function drawLaptop(connected) {
  const l = laptopCanvas.getContext('2d');
  const grad = l.createLinearGradient(0, 0, 1024, 640);
  grad.addColorStop(0, '#1b3560');
  grad.addColorStop(1, '#0d1729');
  l.fillStyle = grad;
  l.fillRect(0, 0, 1024, 640);
  l.fillStyle = '#f6f3ec';
  roundRect(l, 232, 54, 560, 532, 26);
  l.fill();
  l.fillStyle = '#0f1e33';
  l.textAlign = 'center';
  l.textBaseline = 'middle';
  l.font = `700 34px ${DISPLAY}`;
  l.fillText('Ozen home computer', 512, 108);
  l.font = `400 24px ${BODY}`;
  l.fillStyle = '#3a475c';
  l.fillText('Scan this with the phone camera', 512, 150);
  drawCode(l, 512 - 150, 180, 300);
  l.font = `700 26px ${BODY}`;
  l.fillStyle = connected ? '#1f8a3d' : '#3a475c';
  l.fillText(connected ? 'Phone connected' : 'Waiting for a phone', 512, 532);
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.32)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

async function fontsReady() {
  if (!document.fonts || !document.fonts.load) return;
  const wanted = [
    `700 40px ${BODY}`, `400 40px ${BODY}`, `800 40px ${DISPLAY}`, `700 40px ${DISPLAY}`,
  ].map((f) => document.fonts.load(f));
  await Promise.race([Promise.all(wanted), new Promise((r) => setTimeout(r, 2500))]);
}

async function start() {
  if (!stage || !canvas || !story || chapters.length === 0) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    document.documentElement.classList.add('no-webgl');
    return;
  }
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    document.documentElement.classList.add('no-webgl');
  });

  await fontsReady();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(4, 6, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6f9bff, 2.2);
  rim.position.set(-6, 2, -4);
  scene.add(rim);

  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  screenTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const { rig, body } = buildPhone(screenTexture);
  scene.add(rig);

  const laptopTexture = new THREE.CanvasTexture(laptopCanvas);
  laptopTexture.colorSpace = THREE.SRGBColorSpace;
  laptopTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  drawLaptop(false);
  let laptopConnected = false;
  const laptop = buildLaptop(laptopTexture);
  laptop.visible = false;
  scene.add(laptop);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial({ map: makeGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }),
  );
  glow.position.z = -3;
  scene.add(glow);

  let clock = 0;

  const ringGeo = new THREE.RingGeometry(0.94, 1, 96);
  const rings = Array.from({ length: 14 }, () => {
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, born: -10, life: 1.6, inward: false, origin: new THREE.Vector3(), reach: 1, strength: 0.5 };
  });
  let nextRing = 0;
  let ringTimer = 0;
  function emit(origin, colour, { inward = false, life = 1.6, reach = 1.6, strength = 0.5 } = {}) {
    const r = rings[nextRing];
    nextRing = (nextRing + 1) % rings.length;
    r.born = clock;
    r.life = life;
    r.inward = inward;
    r.reach = reach;
    r.strength = strength;
    r.origin.copy(origin);
    r.mesh.material.color.set(colour);
    r.mesh.visible = true;
  }

  let visible = true;
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (toggle) toggle.hidden = !visible;
  }).observe(story);

  let paused = reduceMotion.matches;
  const syncToggle = () => {
    if (toggle) toggle.textContent = paused ? 'Play animation' : 'Pause animation';
  };
  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener('click', () => { paused = !paused; syncToggle(); });
  }
  reduceMotion.addEventListener('change', (e) => { paused = e.matches; syncToggle(); });
  syncToggle();

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  let width = 0, height = 0;
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function activeChapter() {
    const mid = window.innerHeight * 0.5;
    let best = chapters[0], progress = 0;
    for (const el of chapters) {
      const r = el.getBoundingClientRect();
      if (r.top <= mid) {
        best = el;
        progress = clamp((mid - r.top) / Math.max(r.height, 1), 0, 1);
      }
    }
    return { id: best.dataset.scene, progress };
  }

  const pose = { x: 0, y: 0, rx: 0, ry: 0, rz: 0, s: 1 };
  let poseReady = false;
  let laptopShow = 0;
  const glowColour = new THREE.Color(SCENES.captions.glow);
  const targetColour = new THREE.Color();
  const tmp = new THREE.Vector3();

  let last = performance.now();
  let current = null;
  let sceneStart = 0;
  let lastDraw = -1;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible || document.hidden) return;
    resize();
    if (!paused) clock += dt;

    const { id, progress } = activeChapter();
    const def = SCENES[id] || SCENES.captions;
    if (id !== current) {
      current = id;
      sceneStart = clock;
      lastDraw = -1;
    }
    const t = paused ? def.settle : clock - sceneStart;

    if (lastDraw < 0 || clock - lastDraw > 1 / 30 || paused) {
      def.draw(t, clock);
      screenTexture.needsUpdate = true;
      lastDraw = clock;
    }

    const narrow = width < 896 || width / height < 0.9;
    const [px, py, prx, pry, prz, ps] = narrow ? def.mob : def.desk;
    const hh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const hw = hh * camera.aspect;

    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    const idle = paused ? 0 : 1;
    const target = {
      x: px * hw,
      y: py * hh + Math.sin(clock * 0.9) * 0.03 * idle,
      rx: prx + (narrow ? 0 : pointer.y * 0.08),
      ry: pry + (def.turn ? def.turn(progress) : 0) + Math.sin(clock * 0.55) * 0.05 * idle + (narrow ? 0 : pointer.x * 0.14),
      rz: prz + (def.spin ? def.spin(t) : 0),
      s: (ps * 2 * hh) / PHONE.h,
    };
    const k = poseReady ? (paused ? 0.35 : 1 - Math.exp(-dt * 4.5)) : 1;
    poseReady = true;
    pose.x += (target.x - pose.x) * k;
    pose.y += (target.y - pose.y) * k;
    pose.s += (target.s - pose.s) * k;
    pose.rx += wrapPi(target.rx - pose.rx) * k;
    pose.ry += wrapPi(target.ry - pose.ry) * k;
    pose.rz += wrapPi(target.rz - pose.rz) * k;
    rig.position.set(pose.x, pose.y, 0);
    rig.rotation.set(pose.rx, pose.ry, pose.rz, 'YXZ');
    rig.scale.setScalar(pose.s);

    const buzz = !paused && def.buzz ? def.buzz(t) : 0;
    body.position.x = Math.sin(clock * 95) * 0.035 * buzz;
    body.rotation.z = Math.sin(clock * 81) * 0.025 * buzz;

    laptopShow += ((def.laptop ? 1 : 0) - laptopShow) * (paused ? 0.35 : 1 - Math.exp(-dt * (def.laptop ? 4 : 9)));
    if (!def.laptop && laptopShow < 0.15) laptopShow = 0;
    laptop.visible = laptopShow > 0;
    if (laptop.visible) {
      laptop.scale.setScalar((narrow ? 0.42 : 0.78) * laptopShow);
      laptop.position.set(narrow ? -0.32 * hw : 0.32 * hw, narrow ? 0.34 * hh : -0.22 * hh, narrow ? 0 : -0.4);
      laptop.rotation.set(0.36, narrow ? 0.35 : 0.5, 0);
      const connected = Boolean(def.laptop) && t % HOME_PERIOD >= 2.7;
      if (connected !== laptopConnected) {
        laptopConnected = connected;
        drawLaptop(connected);
        laptopTexture.needsUpdate = true;
      }
    }

    targetColour.set(def.glow);
    glowColour.lerp(targetColour, paused ? 0.35 : 1 - Math.exp(-dt * 3));
    glow.material.color.copy(glowColour);
    glow.position.x = pose.x;
    glow.position.y = pose.y;
    glow.scale.setScalar(narrow ? 0.6 : 1);

    if (!paused && def.rings) {
      ringTimer -= dt;
      if (ringTimer <= 0) {
        if (def.rings === 'voices') {
          emit(tmp.set(pose.x - (narrow ? 0.9 : 2.2), pose.y + 0.5, -0.6), '#8db4ff', { reach: 1.4, life: 2.2, strength: 0.28 });
          ringTimer = 0.9;
        } else if (def.rings === 'doorbell') {
          const tt = t % HOUSE_PERIOD;
          if (tt > 0.25 && tt < 2.0) {
            emit(tmp.set(pose.x - (narrow ? 0.8 : 2.4), pose.y + (narrow ? 0.9 : 1.1), -0.4), '#ffb547', { reach: 1.9, life: 1.3, strength: 0.75 });
          }
          ringTimer = 0.28;
        } else if (def.rings === 'speaker') {
          const tr = t % REPLY_PERIOD;
          if (tr > 2.6 && tr < 5.7) {
            rig.localToWorld(tmp.set(0, -PHONE.h / 2 + 0.12, 0.1));
            emit(tmp, '#ffe033', { reach: 1.1, life: 1.2, strength: 0.6 });
          }
          ringTimer = 0.3;
        } else if (def.rings === 'inward') {
          emit(tmp.set(pose.x, pose.y, -0.3), '#2fd39a', { inward: true, reach: 2.6, life: 2.0, strength: 0.45 });
          ringTimer = 0.7;
        }
      }
    }
    for (const r of rings) {
      if (!r.mesh.visible) continue;
      const age = (clock - r.born) / r.life;
      if (age >= 1 || age < 0 || paused) { r.mesh.visible = false; continue; }
      const radius = r.inward ? r.reach * (1 - age) + 0.15 : 0.15 + age * r.reach;
      r.mesh.position.copy(r.origin);
      r.mesh.scale.setScalar(radius * (narrow ? 0.7 : 1));
      r.mesh.material.opacity = r.strength * (r.inward ? Math.sin(age * Math.PI) : 1 - age);
    }

    renderer.render(scene, camera);
  }

  resize();
  requestAnimationFrame((now) => {
    last = now;
    frame(now);
    stage.classList.add('ready');
  });
}

start().catch(() => document.documentElement.classList.add('no-webgl'));
