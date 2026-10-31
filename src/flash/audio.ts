// Web Audio implementation of Flash event sounds. Volume/pan are per "owner" (the clip a
// Sound object targets), matching how AS2 Sound objects control the sounds of a clip.
import type { FrameSound } from './types';

interface Channel {
  gain: GainNode;
  pan: StereoPannerNode;
  volume: number;
  panValue: number;
}

interface Instance {
  source: AudioBufferSourceNode;
  owner: object;
  soundId: number;
  startedAt: number;
  offset: number;
  onComplete?: () => void;
  stopped: boolean;
}

export class AudioEngine {
  ctx: AudioContext;
  private master: GainNode;
  private buffers = new Map<number, AudioBuffer>();
  private channels = new WeakMap<object, Channel>();
  private instances = new Set<Instance>();
  readonly globalOwner = {};
  muted = false;

  constructor(private enqueue: (fn: () => void) => void) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  async load(id: number, data: ArrayBuffer) {
    try {
      this.buffers.set(id, await this.ctx.decodeAudioData(data));
    } catch (e) {
      console.warn('Could not load sound', id, e);
    }
  }

  /** Master output (honours mute); extra synthesized sounds connect here. */
  get output(): AudioNode {
    return this.master;
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.master.gain.value = m ? 0 : 1;
  }

  channel(owner: object): Channel {
    let ch = this.channels.get(owner);
    if (!ch) {
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      gain.connect(pan);
      pan.connect(this.master);
      ch = { gain, pan, volume: 100, panValue: 0 };
      this.channels.set(owner, ch);
    }
    return ch;
  }

  setVolume(owner: object, v: number) {
    const ch = this.channel(owner);
    ch.volume = v;
    ch.gain.gain.value = Math.max(0, v / 100);
  }

  setPan(owner: object, p: number) {
    const ch = this.channel(owner);
    ch.panValue = p;
    ch.pan.pan.value = Math.max(-1, Math.min(1, p / 100));
  }

  duration(id: number) {
    const b = this.buffers.get(id);
    return b ? b.duration * 1000 : 0;
  }

  position(owner: object, id: number) {
    for (const inst of this.instances) {
      if (inst.owner === owner && inst.soundId === id) {
        const b = this.buffers.get(id);
        const t = (this.ctx.currentTime - inst.startedAt + inst.offset) * 1000;
        return b ? t % (b.duration * 1000) : t;
      }
    }
    return 0;
  }

  play(id: number, owner: object, offsetSec = 0, loops = 1, onComplete?: () => void) {
    const buffer = this.buffers.get(id);
    if (!buffer) {
      if (onComplete) this.enqueue(onComplete);
      return;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const offset = Math.max(0, Math.min(offsetSec, buffer.duration));
    const ch = this.channel(owner);
    source.connect(ch.gain);
    const count = Math.max(1, Math.floor(loops) || 1);
    const inst: Instance = { source, owner, soundId: id, startedAt: this.ctx.currentTime, offset, onComplete, stopped: false };
    if (count > 1) {
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.start(0, offset, buffer.duration * count - offset);
    } else source.start(0, offset);
    source.onended = () => {
      this.instances.delete(inst);
      if (!inst.stopped && inst.onComplete) this.enqueue(inst.onComplete);
    };
    this.instances.add(inst);
  }

  isPlaying(id: number) {
    for (const i of this.instances) if (i.soundId === id) return true;
    return false;
  }

  stopSound(id: number) {
    for (const i of [...this.instances]) if (i.soundId === id) this.stopInstance(i);
  }

  stopOwner(owner: object, id?: number) {
    for (const i of [...this.instances]) if (i.owner === owner && (id === undefined || i.soundId === id)) this.stopInstance(i);
  }

  stopAll() {
    for (const i of [...this.instances]) this.stopInstance(i);
  }

  private stopInstance(i: Instance) {
    i.stopped = true;
    this.instances.delete(i);
    try {
      i.source.stop();
    } catch {
      /* already stopped */
    }
  }

  playFrameSounds(sounds: FrameSound[], owner: object) {
    for (const s of sounds) {
      if (s.stop) {
        this.stopSound(s.id);
        continue;
      }
      if (s.noMultiple && this.isPlaying(s.id)) continue;
      this.play(s.id, this.globalOwner, 0, s.loops || 1);
      void owner;
    }
  }
}
