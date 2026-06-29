/**
 * Normalizes common Git remote URL forms for project config storage.
 */
export function normalizeGitRemote(remote: string | undefined): string | undefined {
    if (remote === undefined) {
        return;
    }
    let normalized = remote;
    const sshMatch = normalized.match(/^git@([^:]+):(.+)$/);
    if (sshMatch !== null) {
        normalized = `https://${sshMatch[1]}/${sshMatch[2]}`;
    }
    if (normalized.endsWith(".git")) {
        normalized = normalized.slice(0, -".git".length);
    }
    return normalized;
}
