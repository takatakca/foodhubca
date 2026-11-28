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
