import releaseProbe from './release-probe.json';

/** The source identity reported by the public release marker. */
export function releaseSha(): string {
  return (
    process.env.FOODHUB_RELEASE_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.GITHUB_SHA ||
    process.env.COOLIFY_COMMIT_SHA ||
    ''
  ).trim();
}

export function validatedReleaseSha(value: unknown): string | undefined {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value) ? value : undefined;
}

export function releaseProbeNonce(params: URLSearchParams): string | undefined {
  const values = params.getAll(releaseProbe.query);
  return values.length === 1 && /^[a-f0-9]{32}$/.test(values[0]) ? values[0] : undefined;
}
