/**
 * Plays a scripted run into a bus on its recorded clock, compressed by `speed`, with a
 * "skip to the end" for demos. The page can't tell this from a live run.
 */

import type { RunBus, RunEvent } from '../events.js';

export interface Playback {
  /** Pushes everything still pending right now. */
  skip(): void;
}

export function playInto(bus: RunBus, events: RunEvent[], speed: number): Playback {
  const startedAt = Date.now();
  let next = 0;
  const timers: NodeJS.Timeout[] = [];
  const push = (i: number) => {
    if (i < next) return;
    for (; next <= i; next++) bus.push({ ...events[next], t: Math.round(events[next].t / speed) });
  };
  events.forEach((event, i) => {
    const delay = Math.max(0, event.t / speed - (Date.now() - startedAt));
    timers.push(setTimeout(() => push(i), delay));
  });
  return {
    skip() {
      for (const timer of timers) clearTimeout(timer);
      if (events.length) push(events.length - 1);
    },
  };
}
