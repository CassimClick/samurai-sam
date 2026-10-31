// Synthesized sound effects for the extra weapons (Web Audio, no sample files needed).
// Everything runs through the game's master output, so the mute button covers it too.
import type { AudioEngine } from '../flash/audio';

export class WeaponSfx {
  private ctx: AudioContext;
  private out: GainNode;
  private echo: GainNode;
  private verb: GainNode;
  private gritCurve: Float32Array;
  private noise: AudioBuffer;
  private shotCount = 0;

  constructor(audio: AudioEngine) {
    const ctx = (this.ctx = audio.ctx);
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    // Glue compressor: overlapping full-auto rifle shots stay loud without clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.out.connect(comp);
    comp.connect(audio.output);

    // Outdoor reverb (generated impulse: early reflections + 1.6 s decaying tail).
    this.verb = ctx.createGain();
    this.verb.gain.value = 1;
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.4) * (t < 0.012 ? t / 0.012 : 1);
      }
      for (const [at, amp] of [[0.031, 0.7], [0.057, 0.5], [0.083, 0.45], [0.121, 0.3]]) {
        const i = Math.floor((at + ch * 0.004) * ctx.sampleRate);
        d[i] += amp * (ch ? -1 : 1);
      }
    }
    conv.buffer = ir;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.42;
    this.verb.connect(conv);
    conv.connect(verbOut);
    verbOut.connect(this.out);

    // Short slap-back echo: gives the gun a punchy "outdoor" tail.
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.32;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.085;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2000;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    this.echo.connect(delay);
    delay.connect(tone);
    tone.connect(this.out);
    tone.connect(feedback);
    feedback.connect(delay);

    // Soft clipper for grit on the gunshot.
    const curve = (this.gritCurve = new Float32Array(1024));
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Output bus for one sound: volume + stereo pan, with echo and reverb sends. */
  private bus(pan: number, volume: number, echo = 0, verb = 0) {
    const g = this.ctx.createGain();
    g.gain.value = volume;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(this.out);
    for (const [amount, dest] of [[echo, this.echo], [verb, this.verb]] as const) {
      if (amount <= 0) continue;
      const s = this.ctx.createGain();
      s.gain.value = amount;
      p.connect(s);
      s.connect(dest);
    }
    return g;
  }

  private env(t: number, peak: number, attack: number, decay: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private noiseBurst(dest: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number, rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const e = this.env(t, peak, attack, decay);
    src.connect(f);
    f.connect(e);
    e.connect(dest);
    src.start(t, Math.random() * 0.8, attack + decay + 0.02);
    return f;
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    const e = this.env(t, peak, attack, decay);
    o.connect(e);
    e.connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.02);
  }

  private get live() {
    return this.ctx.state === 'running';
  }

  /**
   * One rifle round (full-auto assault rifle): supersonic crack, muzzle blast, chest-thump
   * boom, the bolt cycling, then an outdoor echo/reverb tail. Varies slightly every shot.
   */
  gunShot(pan: number) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const r = 0.95 + Math.random() * 0.1;
    const b = this.bus(pan, 0.5, 0.35, 0.55);
    const dirty = this.ctx.createGain();
    dirty.gain.value = 1;
    const grit = this.ctx.createWaveShaper();
    grit.curve = this.gritCurve;
    dirty.connect(grit);
    grit.connect(b);
    // Supersonic crack: a very short, very bright snap.
    this.noiseBurst(dirty, t, 'highpass', 2600 * r, 0.6, 1.7, 0.0005, 0.014, r);
    // Muzzle blast: broadband burst with a fast decay.
    this.noiseBurst(dirty, t, 'lowpass', 2000 * r, 0.7, 1.4, 0.001, 0.16, r);
    // Body of the report.
    this.noiseBurst(dirty, t + 0.002, 'bandpass', 280 * r, 0.9, 1.7, 0.002, 0.2, r);
    // Low boom and sub thump (clean, not distorted).
    this.tone(b, t, 'sine', 100 * r, 38, 1.3, 0.002, 0.28);
    this.tone(b, t, 'triangle', 58, 30, 0.6, 0.003, 0.34);
    // Bolt carrier cycling.
    this.noiseBurst(b, t + 0.045, 'bandpass', 2300 * r, 3, 0.32, 0.001, 0.02);
    this.noiseBurst(b, t + 0.075, 'bandpass', 1300 * r, 2.5, 0.28, 0.001, 0.025);
    // Brass casing hitting the ground every other round.
    if (this.shotCount++ % 2 === 0) {
      const c = this.bus(pan, 0.05);
      const tc = t + 0.22 + Math.random() * 0.12;
      this.tone(c, tc, 'sine', 3500 + Math.random() * 400, 3400, 1, 0.001, 0.07);
      this.tone(c, tc, 'sine', 5300 + Math.random() * 500, 5200, 0.6, 0.001, 0.05);
    }
  }

  /** Charging handle racked: weapon selected. */
  gunCock(pan = 0) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const b = this.bus(pan, 0.5, 0.25);
    this.noiseBurst(b, t, 'bandpass', 3200, 3, 0.7, 0.001, 0.02);
    this.noiseBurst(b, t + 0.012, 'bandpass', 1400, 2, 0.4, 0.002, 0.04);
    this.noiseBurst(b, t + 0.13, 'bandpass', 1800, 2.2, 1.0, 0.001, 0.035);
    this.tone(b, t + 0.13, 'sine', 230, 90, 0.5, 0.002, 0.06);
    this.noiseBurst(b, t + 0.175, 'bandpass', 2700, 3, 0.5, 0.001, 0.02);
  }

  /** Metallic "shing": throwing stars selected. */
  starSelect(pan = 0) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const b = this.bus(pan, 0.16, 0.3);
    this.noiseBurst(b, t, 'highpass', 5000, 0.7, 0.6, 0.01, 0.14);
    for (const [f, a] of [[2350, 1], [3720, 0.7], [5150, 0.45]] as const) this.tone(b, t + 0.02, 'sine', f, f * 0.995, a, 0.003, 0.4);
  }

  /** Airy swish of a spinning star leaving the hand. */
  starThrow(pan: number) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const b = this.bus(pan, 0.5);
    const f = this.noiseBurst(b, t, 'bandpass', 2800, 1.6, 0.9, 0.03, 0.16);
    f.frequency.setValueAtTime(2800, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.19);
  }

  /** Star sticking into wood/stone. */
  starClink(pan: number) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const b = this.bus(pan, 0.14, 0.2);
    this.noiseBurst(b, t, 'bandpass', 2400, 1.5, 1, 0.001, 0.03);
    for (const [f, a] of [[2900, 1], [4350, 0.6], [6100, 0.35]] as const) this.tone(b, t, 'sine', f, f, a, 0.001, 0.13);
  }

  /** Bullet hitting a wall: a tick and sometimes a ricochet whine. */
  bulletImpact(pan: number) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const b = this.bus(pan, 0.12);
    this.noiseBurst(b, t, 'bandpass', 2600, 1.2, 1, 0.001, 0.035);
    if (Math.random() < 0.3) this.tone(b, t + 0.01, 'sine', 2600 + Math.random() * 600, 1200, 0.45, 0.005, 0.2);
  }

  /** Bubble shield forming: rising shimmer. */
  bubbleOn(pan = 0) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const b = this.bus(pan, 0.22, 0, 0.5);
    this.tone(b, t, 'sine', 180, 720, 1, 0.02, 0.36);
    this.tone(b, t, 'sine', 270, 1080, 0.45, 0.02, 0.34);
    this.noiseBurst(b, t + 0.05, 'highpass', 6000, 0.7, 0.35, 0.05, 0.3);
    for (const [f, d] of [[1760, 0.12], [2640, 0.2]]) this.tone(b, t + d, 'sine', f, f, 0.25, 0.005, 0.3);
  }

  /** Bubble shield popping away. */
  bubbleOff(pan = 0) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const b = this.bus(pan, 0.22, 0, 0.3);
    this.tone(b, t, 'sine', 700, 160, 0.9, 0.01, 0.28);
    this.noiseBurst(b, t, 'bandpass', 1800, 1.5, 0.8, 0.001, 0.04);
  }

  /** An enemy strike bouncing off the bubble. */
  bubbleHit(pan: number) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const b = this.bus(pan, 0.3, 0, 0.45);
    this.tone(b, t, 'sine', 560, 190, 1, 0.003, 0.2);
    this.tone(b, t, 'triangle', 1120, 400, 0.4, 0.003, 0.16);
    this.noiseBurst(b, t, 'bandpass', 1500, 1.2, 0.6, 0.001, 0.05);
  }

  /** Small air burst under the feet for the 2nd/3rd jump. */
  airJump(pan: number, big: boolean) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const b = this.bus(pan, big ? 0.4 : 0.28);
    this.noiseBurst(b, t, 'lowpass', 900, 0.7, 1, 0.005, big ? 0.18 : 0.12);
    this.tone(b, t, 'sine', 140, 70, 0.5, 0.004, 0.1);
  }

  /** Spinning whoosh for the flip. */
  flipWhoosh(pan: number) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const b = this.bus(pan, 0.45);
    const f = this.noiseBurst(b, t, 'bandpass', 600, 1.8, 0.9, 0.12, 0.3);
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.2);
    f.frequency.exponentialRampToValueAtTime(800, t + 0.42);
  }
}
