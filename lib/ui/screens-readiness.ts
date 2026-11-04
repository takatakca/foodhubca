import type { Scope } from '../foodhub/scope';
import { SETUP_PLATFORMS } from './screens-setup';
import { screenChannel } from './screens-scope';

export interface ReadinessScreen {
  platform: string;
  locationCode: string;
  status: string;
  lastSeenAt?: string | null;
  command?: { kind: string } | null;
}

/** Summaries use authorized server observations, never inferred provider/API authentication. */
export function screenReadiness(screens: ReadonlyArray<ReadinessScreen>, scope: Pick<Scope, 'kitchen' | 'channel'>, target = 18) {
  return SETUP_PLATFORMS.filter((platform) => !scope.channel || screenChannel(platform) === scope.channel).map((platform) => {
    const accounts = screens.filter((screen) => screen.platform === platform && (!scope.kitchen || screen.locationCode === scope.kitchen));
    const reports = accounts.flatMap((screen) => {
      const value = screen.lastSeenAt ? Date.parse(screen.lastSeenAt) : NaN;
      return Number.isFinite(value) ? [value] : [];
    });
    return {
      platform, channel: screenChannel(platform)!, target,
      registered: accounts.length,
      online: accounts.filter((screen) => screen.status === 'online').length,
      signIn: accounts.filter((screen) => screen.status === 'login_required').length,
      unavailable: accounts.filter((screen) => screen.status === 'offline' || screen.status === 'error').length,
      never: accounts.filter((screen) => screen.status === 'never').length,
      pending: accounts.filter((screen) => !!screen.command).length,
      lastReportAt: reports.length ? new Date(Math.max(...reports)).toISOString() : null,
    };
  });
}
