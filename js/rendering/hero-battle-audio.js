export class HeroBattleAudio {
  constructor(context, { scale, getSettings = () => ({ masterVolume: 1, sfxVolume: 0.8 }) }) {
    if (!context || !Number.isFinite(scale) || scale <= 0) throw new TypeError('Invalid hero audio scene');
    this.context = context;
    this.scale = scale;
    this.getSettings = getSettings;
    this.voices = new Set();
    this.played = 0;
    this.skipped = 0;
    this.disposed = false;
  }

  play(kind, worldPosition, camera, origin, impact = false) {
    const settings = this.getSettings();
    if (this.disposed || this.context.state !== 'running' || settings.masterMuted || settings.sfxMuted
      || this.voices.size >= 8) { this.skipped++; return false; }
    const volume = Math.max(0, Math.min(1, settings.masterVolume ?? 1))
      * Math.max(0, Math.min(1, settings.sfxVolume ?? 0.8)) * 0.045;
    if (!volume) { this.skipped++; return false; }
    const context = this.context;
    const nodes = [];
    let voice;
    let release;
    let started = false;
    try {
      const oscillator = context.createOscillator();
      nodes.push(oscillator);
      const gain = context.createGain();
      nodes.push(gain);
      const panner = context.createPanner();
      nodes.push(panner);
      const local = worldPosition.clone().sub(origin).sub(camera.position)
        .applyQuaternion(camera.quaternion.clone().invert()).divideScalar(this.scale);
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 5;
      panner.maxDistance = 1000;
      panner.rolloffFactor = 0.7;
      panner.positionX.value = local.x;
      panner.positionY.value = local.y;
      panner.positionZ.value = local.z;
      const frequency = impact ? 140 : ({ laser: 850, ballistic: 180, railgun: 420, photon: 660, plasma: 270, missile: 100 }[kind]);
      if (!Number.isFinite(frequency)) throw new TypeError('Unknown hero audio weapon');
      oscillator.type = impact || kind === 'missile' ? 'sawtooth' : 'triangle';
      const time = context.currentTime;
      const duration = impact ? 0.3 : 0.14;
      oscillator.frequency.setValueAtTime(frequency, time);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.4, time + duration);
      gain.gain.setValueAtTime(volume, time);
      gain.gain.exponentialRampToValueAtTime(0.00001, time + duration);
      voice = { oscillator, gain, panner };
      release = () => {
        this.voices.delete(voice);
        oscillator.removeEventListener('ended', release);
        const errors = [];
        for (const node of nodes) { try { node.disconnect(); } catch (error) { errors.push(error); } }
        if (errors.length) throw new AggregateError(errors, 'Hero audio voice cleanup failed');
      };
      voice.release = release;
      this.voices.add(voice);
      oscillator.connect(gain);
      gain.connect(panner);
      panner.connect(context.destination);
      oscillator.addEventListener('ended', release);
      oscillator.start(time);
      started = true;
      oscillator.stop(time + duration);
    } catch (error) {
      const errors = [error];
      if (started) { try { voice.oscillator.stop(); } catch (cleanupError) { errors.push(cleanupError); } }
      if (release) { try { release(); } catch (cleanupError) { errors.push(cleanupError); } }
      else for (const node of nodes) { try { node.disconnect(); } catch (cleanupError) { errors.push(cleanupError); } }
      if (errors.length > 1) throw new AggregateError(errors, 'Hero audio startup failed');
      throw error;
    }
    this.played++;
    return true;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const errors = [];
    for (const voice of [...this.voices]) {
      try { voice.oscillator.stop(); } catch (error) { errors.push(error); }
      try { voice.release(); } catch (error) { errors.push(error); }
    }
    try { await this.context.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Hero audio disposal failed');
  }
}
