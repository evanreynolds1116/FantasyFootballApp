/**
 * The draft's sounds and vibrations (FR-20), synthesized with Web Audio so
 * there are no sound files to ship. Browsers only allow audio after the
 * person has tapped or typed on the page; `unlockAudio` runs on the first
 * such gesture. Vibration works on Android; iPhones ignore it.
 */
export type Cue = "turn" | "warning" | "reveal" | "won";

export type AlertPrefs = { sound: boolean; vibrate: boolean };

const PREFS_KEY = "draft-app:alerts";
const DEFAULT_PREFS: AlertPrefs = { sound: true, vibrate: true };

export function loadPrefs(): AlertPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<AlertPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: AlertPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or storage blocked: the setting just won't stick.
  }
}

export const canVibrate = (): boolean => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Notes as [frequency Hz, start offset s, length s]. */
const TUNES: Record<Cue, [number, number, number][]> = {
  // Rising two-note chime: your turn.
  turn: [
    [659, 0, 0.18],
    [880, 0.16, 0.32],
  ],
  // Three quick high ticks: 10 seconds left.
  warning: [
    [1175, 0, 0.07],
    [1175, 0.14, 0.07],
    [1175, 0.28, 0.07],
  ],
  // One soft bell: bids revealed.
  reveal: [
    [523, 0, 0.4],
    [784, 0, 0.4],
  ],
  // Little arpeggio: you won the player.
  won: [
    [523, 0, 0.14],
    [659, 0.12, 0.14],
    [784, 0.24, 0.14],
    [1047, 0.36, 0.4],
  ],
};

const BUZZ: Record<Cue, number[]> = {
  turn: [200, 100, 200],
  warning: [80, 70, 80, 70, 80],
  reveal: [60],
  won: [80, 60, 80, 60, 220],
};

function play(cue: Cue): void {
  if (!ctx || ctx.state !== "running") return;
  const start = ctx.currentTime + 0.01;
  for (const [freq, offset, length] of TUNES[cue]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // Quick attack, exponential fade so notes don't click.
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + offset);
    osc.stop(start + offset + length + 0.05);
  }
}

export function fireCue(cue: Cue, prefs: AlertPrefs): void {
  if (prefs.sound) play(cue);
  if (prefs.vibrate && canVibrate()) navigator.vibrate(BUZZ[cue]);
}
