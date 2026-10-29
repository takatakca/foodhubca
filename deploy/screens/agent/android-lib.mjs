// Pure helpers of the Android screen agent (android.mjs): read adb output, decide the screen's state, build the
// heartbeat v2 report. No I/O here, so tests run without a device. Contract: docs/ORDER_SCREENS_RESCUE.md.
//   state  ok      = the order app is in front and the device answers
//          login   = the order app's own sign-in activity is in front
//          blank   = another app or the home screen is in front
//          crashed = the device or adb is not answering
//   waiting = COUNT of the order app's notifications. Their text is never read, kept or sent.

export const SIGN_IN_ACTIVITY_RE = /(login|signin|sign_in|auth|onboarding|welcome|phoneverif|otp|password)/i;

/** "mResumedActivity: ActivityRecord{… com.doordash.merchant/.ui.MainActivity t12}" → { package, activity }. */
export function parseFrontActivity(dumpsys) {
  const text = String(dumpsys ?? '');
  const m = /(?:mResumedActivity|mFocusedActivity|topResumedActivity|ResumedActivity)[^\n]*?\s([A-Za-z][\w.]*)\/(\.?[\w.$]+)/.exec(text)
    ?? /mCurrentFocus=Window\{[^}]*\s([A-Za-z][\w.]*)\/(\.?[\w.$]+)/.exec(text);
  if (!m) return null;
  const pkg = m[1];
  const activity = m[2].startsWith('.') ? pkg + m[2] : m[2];
  return { package: pkg, activity };
}

/** Count the notifications posted by one package in `dumpsys notification` output (used by tests and as a fallback). */
export function countNotifications(dumpsys, pkg) {
  const text = String(dumpsys ?? '');
  if (!pkg) return 0;
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // One "NotificationRecord(… pkg=com.x …)" line per notification; group summaries are counted once like any other.
  const records = text.match(new RegExp(`NotificationRecord\\([^\\n]*\\bpkg=${esc}\\b`, 'g')) ?? [];
  return records.length;
}

/** The output of the on-device count (`grep -c`): a bare integer, or NaN when it is not one. */
export function parseCount(stdout) {
  const m = /^\s*(\d+)\s*$/m.exec(String(stdout ?? ''));
  return m ? Number(m[1]) : NaN;
}

/** Device state from `adb get-state` / `adb devices` output. */
export function deviceOnline(getState) {
  return /^\s*device\s*$/m.test(String(getState ?? ''));
}

/**
 * Decide the report for one heartbeat. `front` = parseFrontActivity(), `online` = deviceOnline(), `notifications` =
 * countNotifications(). Returns the v2 report (no title, no url: there is no page).
 */
export function decideReport({ id, pkg, online, front, notifications, autoReloads = 0 }) {
  let state;
  if (!online) state = 'crashed';
  else if (!front || front.package !== pkg) state = 'blank';
  else if (SIGN_IN_ACTIVITY_RE.test(front.activity.replace(pkg, ''))) state = 'login';
  else state = 'ok';
  const report = { id, state, mode: 'android', autoReloads };
  if (front?.package) report.app = front.package;
  if (state === 'ok' || state === 'login') report.waiting = Number.isFinite(notifications) ? Math.max(0, notifications) : 0;
  return report;
}

/** The only adb actions the agent is allowed to take. Nothing is ever tapped or typed. */
export const ADB_COMMANDS = Object.freeze({
  state: ['get-state'],
  front: ['shell', 'dumpsys', 'activity', 'activities'],
  /** Counted ON the device: only a number crosses adb, never a notification line. grep -c exits 1 on zero, hence "|| true". */
  notificationCount: (pkg) => ['shell', `dumpsys notification | grep -c -E '^ +NotificationRecord\\(0x[0-9a-f]+: pkg=${pkg.replace(/\./g, '\\.')} ' || true`],
  /** "reload": bring the order app back to the front. `am start` of its launcher intent is deterministic and has no side effect (no tap). */
  toFront: (pkg) => ['shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', pkg],
  wake: ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'],
});
