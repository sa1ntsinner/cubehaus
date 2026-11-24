// The judge's calls during inspection, at 8 and 12 seconds (A3b3, A3b4).
// "tick" is one short burst of noise for 8 and two for 12: no pitch, so it
// reads as a mechanical click, not a chime. "voice" says the official words
// in the interface language. On a phone the call also vibrates. Nothing
// sounds before the person has touched or pressed something (browsers
// require it), and a failure to play is ignored: a call is never worth an
// error.

import { vibrate } from "./phone-app";

export type CallMode = "off" | "tick" | "voice";

export interface CallOutputs {
  // Play `count` bursts of noise, each `ms` long, `gapMs` apart.
  noise?(count: number, ms: number, gapMs: number): void;
  speak?(words: string, language: "en" | "ru"): void;
  vibrate?(pattern: number[]): void;
}

export function createCaller(
  settings: () => {
    mode: CallMode;
    language: "en" | "ru";
    words: Record<8 | 12, string>;
  },
  outputs: CallOutputs,
) {
  return {
    call(seconds: 8 | 12) {
      const { mode, language, words } = settings();
      if (mode === "off") return;
      try {
        if (mode === "tick") outputs.noise?.(seconds === 8 ? 1 : 2, 18, 70);
        else outputs.speak?.(words[seconds], language);
        outputs.vibrate?.(seconds === 8 ? [25] : [25, 70, 25]);
      } catch {
        /* A call that cannot play is skipped. */
      }
    },
  };
}

// The browser's outputs. The audio context is made on the first gesture
// (`unlock`), since a context made earlier starts suspended.
export function browserCallOutputs(): CallOutputs & { unlock(): void } {
  let unlocked = false;
  let context: AudioContext | undefined;
  let noiseBuffer: AudioBuffer | undefined;
  return {
    unlock() {
      unlocked = true;
      try {
        context ??= new AudioContext();
        if (context.state === "suspended")
          void context.resume().catch(() => {});
        if (!noiseBuffer) {
          noiseBuffer = context.createBuffer(
            1,
            context.sampleRate / 10,
            context.sampleRate,
          );
          const data = noiseBuffer.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
      } catch {
        context = undefined;
      }
    },
    noise(count, ms, gapMs) {
      if (!context || !noiseBuffer || context.state !== "running") return;
      for (let i = 0; i < count; i++) {
        const at = context.currentTime + (i * (ms + gapMs)) / 1000;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = noiseBuffer;
        // A sharp attack and a fast fall: a click, not a hiss.
        gain.gain.setValueAtTime(0.35, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + ms / 1000);
        source.connect(gain).connect(context.destination);
        source.start(at);
        source.stop(at + ms / 1000);
      }
    },
    speak(words, language) {
      const speech = globalThis.speechSynthesis;
      if (!unlocked || !speech) return;
      const utterance = new SpeechSynthesisUtterance(words);
      utterance.lang = language === "ru" ? "ru-RU" : "en-US";
      utterance.rate = 1.15;
      speech.cancel();
      speech.speak(utterance);
    },
    vibrate(pattern) {
      if (unlocked) vibrate(pattern);
    },
  };
}
