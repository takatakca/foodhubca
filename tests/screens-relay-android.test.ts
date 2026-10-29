// Android-mode relay agent (deploy/screens/agent/android-lib.mjs): reads adb output, decides the heartbeat v2 report.
// The report carries mode "android", the package in front and a COUNT of notifications, never their text.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module without types
import { ADB_COMMANDS, countNotifications, decideReport, deviceOnline, parseFrontActivity } from '../deploy/screens/agent/android-lib.mjs';

const PKG = 'com.doordash.merchant';
const activities = (pkg: string, act: string) => `ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)
Display #0 (activities from top to bottom):
  * Task{a1 #12 type=standard A=10123:${pkg}}
    mResumedActivity: ActivityRecord{3f2 u0 ${pkg}/${act} t12}
  ResumedActivity: ActivityRecord{3f2 u0 ${pkg}/${act} t12}
`;
const notif = (entries: Array<[string, string]>) => `NOTIFICATION MANAGER (dumpsys notification)
  Notification List:
${entries.map(([pkg, text], i) => `    NotificationRecord(0x${i}: pkg=${pkg} user=UserHandle{0} id=${100 + i} tag=null key=0|${pkg}|${100 + i}|null|10123: 0)
      uid=10123 opPkg=${pkg}
      contentIntent=PendingIntent{…}
      android.title=String (New order)
      android.text=String (${text})`).join('\n')}
`;

describe('parseFrontActivity', () => {
  it('reads the package and activity in front, expanding a relative activity', () => {
    expect(parseFrontActivity(activities(PKG, '.ui.MainActivity'))).toEqual({ package: PKG, activity: `${PKG}.ui.MainActivity` });
    expect(parseFrontActivity(activities('com.android.launcher3', 'com.android.launcher3.Launcher'))).toEqual({ package: 'com.android.launcher3', activity: 'com.android.launcher3.Launcher' });
  });
  it('falls back to mCurrentFocus and returns null on nothing', () => {
    expect(parseFrontActivity('mCurrentFocus=Window{7a u0 com.ubercab.restaurantmanager/com.ubercab.restaurantmanager.RootActivity}')).toEqual({ package: 'com.ubercab.restaurantmanager', activity: 'com.ubercab.restaurantmanager.RootActivity' });
    expect(parseFrontActivity('')).toBeNull();
    expect(parseFrontActivity(undefined)).toBeNull();
  });
});

describe('countNotifications', () => {
  it('counts only the order app’s records and never returns their text', () => {
    const dump = notif([[PKG, 'Order #1234 for Ana — 2 items'], [PKG, 'Order #1235'], ['com.android.systemui', 'USB debugging']]);
    expect(countNotifications(dump, PKG)).toBe(2);
    expect(countNotifications(dump, 'com.android.systemui')).toBe(1);
    expect(countNotifications(dump, 'com.other')).toBe(0);
    expect(countNotifications(dump, '')).toBe(0);
    expect(String(countNotifications(dump, PKG))).not.toContain('Ana');
  });
  it('does not match a longer package name by prefix', () => {
    expect(countNotifications(notif([['com.doordash.merchantx', 'x']]), PKG)).toBe(0);
  });
});

describe('deviceOnline', () => {
  it('is true only for "device"', () => {
    expect(deviceOnline('device\n')).toBe(true);
    expect(deviceOnline('offline\n')).toBe(false);
    expect(deviceOnline('error: device not found')).toBe(false);
    expect(deviceOnline('')).toBe(false);
  });
});

describe('decideReport (heartbeat v2)', () => {
  const base = { id: 'SCREEN_ID_DOORDASH_2', pkg: PKG, online: true, notifications: 2, autoReloads: 1 };
  it('ok: order app in front → mode android, app = package, waiting = count, no title/url', () => {
    const r = decideReport({ ...base, front: { package: PKG, activity: `${PKG}.ui.MainActivity` } });
    expect(r).toEqual({ id: 'SCREEN_ID_DOORDASH_2', state: 'ok', mode: 'android', autoReloads: 1, app: PKG, waiting: 2 });
    expect(r).not.toHaveProperty('title');
    expect(r).not.toHaveProperty('url');
  });
  it('login: the app’s sign-in activity is in front', () => {
    for (const act of ['.auth.LoginActivity', '.onboarding.WelcomeActivity', '.ui.PhoneVerificationActivity', '.OtpActivity']) {
      expect(decideReport({ ...base, front: { package: PKG, activity: PKG + act } }).state, act).toBe('login');
    }
    // the package name itself never triggers "login" (e.g. com.authapp.merchant)
    expect(decideReport({ ...base, pkg: 'com.authapp.merchant', front: { package: 'com.authapp.merchant', activity: 'com.authapp.merchant.ui.Main' } }).state).toBe('ok');
  });
  it('blank: home screen or another app in front (app field says which)', () => {
    const r = decideReport({ ...base, front: { package: 'com.android.launcher3', activity: 'com.android.launcher3.Launcher' } });
    expect(r.state).toBe('blank');
    expect(r.app).toBe('com.android.launcher3');
    expect(r).not.toHaveProperty('waiting');
    expect(decideReport({ ...base, front: null }).state).toBe('blank');
  });
  it('crashed: device or adb not answering', () => {
    const r = decideReport({ ...base, online: false, front: null });
    expect(r.state).toBe('crashed');
    expect(r.mode).toBe('android');
  });
  it('clamps a bad notification count to 0', () => {
    expect(decideReport({ ...base, notifications: NaN, front: { package: PKG, activity: `${PKG}.Main` } }).waiting).toBe(0);
  });
});

describe('ADB_COMMANDS: the only actions the agent may take', () => {
  it('reads state, front activity and notifications; "reload" only launches the app; never taps or types text', () => {
    expect(ADB_COMMANDS.state).toEqual(['get-state']);
    expect(ADB_COMMANDS.front[1]).toBe('dumpsys');
    expect(ADB_COMMANDS.notifications).toEqual(['shell', 'dumpsys', 'notification']);
    expect(ADB_COMMANDS.toFront(PKG)).toEqual(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1']);
    const all = JSON.stringify(ADB_COMMANDS) + JSON.stringify(ADB_COMMANDS.toFront(PKG)) + JSON.stringify(ADB_COMMANDS.wake);
    expect(all).not.toMatch(/\btap\b|\btext\b|swipe|install|uninstall|pm clear|settings put/);
  });
});
