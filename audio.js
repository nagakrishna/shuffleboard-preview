'use strict';

const sound = (() => {
  let context, master, music, timer;
  let muted = false;
  let blocked = false;
  let beat = 0;
  let nextBeat = 0;
  const chords = [
    { root: 45, keys: [57, 60, 64, 67] },
    { root: 41, keys: [57, 60, 64, 65] },
    { root: 48, keys: [55, 59, 62, 64] },
    { root: 43, keys: [55, 57, 62, 65] }
  ];
  const phrase = [76, 0, 72, 0, 0, 69, 0, 0, 72, 0, 0, 76, 74, 0, 0, 0,
    79, 0, 76, 0, 74, 0, 0, 71, 0, 74, 0, 72, 0, 69, 0, 0];
  const hz = note => 440 * 2 ** ((note - 69) / 12);

  function tone(output, frequency, volume, duration, type, time, end = frequency) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
    gain.gain.setValueAtTime(.001, time);
    gain.gain.linearRampToValueAtTime(volume, time + .009);
    gain.gain.exponentialRampToValueAtTime(.001, time + duration);
    oscillator.connect(gain).connect(output);
    oscillator.start(time);
    oscillator.stop(time + duration);
  }

  function schedule() {
    if (context.state !== 'running' || muted || blocked) return;
    nextBeat = Math.max(nextBeat, context.currentTime + .02);
    while (nextBeat < context.currentTime + .12) {
      const slot = beat % 8;
      const chord = chords[Math.floor(beat / 8) % chords.length];
      const time = nextBeat + (slot % 2 ? .038 : 0);
      if (slot === 0 || slot === 5) {
        tone(music, hz(chord.root - (slot === 5 ? 5 : 0)), .19, .42, 'sine', time);
      }
      if (slot === 0 || slot === 3 || slot === 6) {
        chord.keys.forEach((note, index) =>
          tone(music, hz(note), .037, .64, 'sine', time + index * .018));
      }
      const note = phrase[beat % phrase.length];
      if (note) {
        tone(music, hz(note), .062, .33, 'sine', time);
        tone(music, hz(note + 12), .012, .095, 'sine', time);
      }
      if (slot === 0 || slot === 4) tone(music, 86, .16, .17, 'sine', time, 39);
      if (slot === 2 || slot === 6) tone(music, 185, .035, .09, 'triangle', time, 73);
      nextBeat += .34;
      beat++;
    }
  }

  function mix() {
    if (!context) return;
    master.gain.setTargetAtTime(muted || blocked ? 0 : .48, context.currentTime, .015);
    if (muted || blocked) {
      clearInterval(timer);
      timer = undefined;
    } else if (!timer) {
      nextBeat = context.currentTime;
      timer = setInterval(schedule, 45);
    }
  }

  function unlock() {
    if (!context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      context = new Audio();
      master = context.createGain();
      music = context.createGain();
      music.gain.value = .55;
      music.connect(master).connect(context.destination);
    }
    if (context.state !== 'running') context.resume().catch(() => {});
    mix();
  }

  return {
    unlock,
    toggle() {
      muted = !muted;
      if (!muted) unlock();
      mix();
      return !muted;
    },
    block(value) { blocked = value; mix(); },
    effect(name, strength = 1) {
      if (!context || muted || blocked || context.state !== 'running') return;
      const time = context.currentTime;
      if (name === 'shot') tone(master, 360, .15, .19, 'triangle', time, 95);
      if (name === 'hit') {
        tone(master, 850, .22 * strength, .07, 'triangle', time, 240);
        tone(master, 145, .16 * strength, .10, 'sine', time, 62);
      }
      if (name === 'drop') tone(master, 115, .22, .24, 'triangle', time, 32);
      if (name === 'score') {
        [72, 76, 79, 84].forEach((note, index) =>
          tone(master, hz(note), .12, .28, 'sine', time + index * .085));
      }
    }
  };
})();
