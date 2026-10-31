import { AudioEngine } from './flash/audio';
import { Player } from './flash/player';
import type { ShapeLibraryData, SwfData } from './flash/types';
import { WeaponMod } from './mod/weapons';
import './style.css';

interface GameData {
  swf: SwfData;
  shapes: ShapeLibraryData;
  maps: Record<string, string>;
  sounds: Record<string, string>;
  fonts: Record<string, string>;
}

declare global {
  interface Window {
    SAMURAI_DATA?: GameData;
    SAMURAI_SCRIPTS?: (rt: Record<string, unknown>) => Record<string, ($: any) => void>;
    samurai?: Player;
    samuraiWeapons?: WeaponMod;
  }
}

const status = document.getElementById('status')!;
const splash = document.getElementById('splash')!;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const stageEl = document.getElementById('stage')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const about = document.getElementById('about')!;

function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = src;
  });
}

async function boot() {
  const data = window.SAMURAI_DATA;
  if (!data || !window.SAMURAI_SCRIPTS) throw new Error('game data missing (run "npm run build:data")');
  const { swf, shapes } = data;

  status.textContent = 'Loading artwork…';
  const bitmapKeys = new Set<string>();
  for (const items of Object.values(shapes)) for (const it of items) if (it.f && it.f[0] === 'b') bitmapKeys.add(it.f[1]);
  const bitmaps = new Map<string, HTMLImageElement>();
  await Promise.all([...bitmapKeys].map(async (k) => bitmaps.set(k, await loadImage(`assets/bitmaps/${k}`))));

  const fontsLoaded = new Set<number>();
  await Promise.all(
    Object.entries(data.fonts).map(async ([id, b64]) => {
      try {
        const face = new FontFace(`swf-font-${id}`, base64ToBuffer(b64));
        document.fonts.add(await face.load());
        fontsLoaded.add(+id);
      } catch {
        /* falls back to a device font */
      }
    }),
  );

  status.textContent = 'Loading sounds…';
  let player: Player | undefined;
  const audio = new AudioEngine((fn) => player?.enqueue(fn));
  await Promise.all(Object.entries(data.sounds).map(([id, b64]) => audio.load(+id, base64ToBuffer(b64))));

  player = new Player({
    canvas,
    data: swf,
    shapes,
    bitmaps,
    scriptFactory: window.SAMURAI_SCRIPTS,
    audio,
    fontsLoaded,
    // The game asked miniclip.com for its levels; serve the bundled copies instead.
    loadText: async (url) => {
      const file = url.split('?')[0].split('/').pop() || url;
      const text = data.maps[file];
      if (text === undefined) throw new Error('missing ' + file);
      return text;
    },
  });
  window.samurai = player;
  window.samuraiWeapons = new WeaponMod(player); // Q: sword / ninja stars / machine gun

  const fit = () => {
    const ar = swf.width / swf.height;
    let w = window.innerWidth;
    let h = w / ar;
    if (h > window.innerHeight) {
      h = window.innerHeight;
      w = h * ar;
    }
    player!.resize(Math.floor(w), Math.floor(h));
  };
  window.addEventListener('resize', fit);
  fit();

  status.textContent = '';
  startBtn.hidden = false;
  startBtn.focus();
  await new Promise<void>((resolve) => startBtn.addEventListener('click', () => resolve(), { once: true }));
  audio.resume();
  splash.remove();
  stageEl.classList.add('ready');
  player.start();

  const muteBtn = document.getElementById('mute') as HTMLButtonElement;
  muteBtn.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    muteBtn.textContent = audio.muted ? '🔇' : '🔊';
    muteBtn.blur();
  });
  const fsBtn = document.getElementById('fullscreen') as HTMLButtonElement;
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
    fsBtn.blur();
  });

  // About panel: pauses the game while the original creators' credits are shown.
  const aboutBtn = document.getElementById('aboutBtn') as HTMLButtonElement;
  const setAbout = (open: boolean) => {
    about.hidden = !open;
    player!.paused = open;
    player!.input.clear();
    if (open) audio.ctx.suspend();
    else audio.resume();
  };
  aboutBtn.addEventListener('click', () => {
    setAbout(about.hidden);
    aboutBtn.blur();
  });
  document.getElementById('aboutClose')!.addEventListener('click', () => setAbout(false));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !about.hidden) setAbout(false);
  });
  for (const b of [muteBtn, fsBtn, aboutBtn]) b.hidden = false;
}

boot().catch((e) => {
  console.error(e);
  status.textContent = 'Failed to start: ' + (e as Error).message;
});
