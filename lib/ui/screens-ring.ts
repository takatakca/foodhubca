// Screens wall: when should the one device that watches every platform screen ring? (docs/ORDER_SCREENS_RESCUE.md, A1)
// Pure, so the console page and the tests share it.
//   - "alert" when a screen that was online drops (offline, signed out, crashed): orders may stop ringing anywhere;
//   - "order" at every refresh while orders wait on an online screen, like a platform tablet that rings until accepted;
//   - nothing otherwise.

export type RingScreen = { id: string; name: string; status: string; titleCount?: number | null };
export type RingMemory = Record<string, string>;

export interface RingDecision {
  tone: 'order' | 'alert' | null;
  /** Orders waiting, summed over online screens. */
  waiting: number;
  waitingOn: string[];
  /** Screens that were online at the previous refresh and are not anymore. */
  newlyDown: string[];
  /** Status of each screen, to pass back as `prev` next time. */
  memory: RingMemory;
}

export function ringDecision(screens: RingScreen[], prev: RingMemory): RingDecision {
  const memory: RingMemory = {};
  const waitingOn: string[] = [];
  const newlyDown: string[] = [];
  let waiting = 0;
  for (const s of screens) {
    memory[s.id] = s.status;
    if (s.status === 'online' && (s.titleCount ?? 0) > 0) { waiting += s.titleCount ?? 0; waitingOn.push(s.name); }
    if (prev[s.id] === 'online' && s.status !== 'online') newlyDown.push(s.name);
  }
  return { tone: newlyDown.length ? 'alert' : waiting > 0 ? 'order' : null, waiting, waitingOn, newlyDown, memory };
}
