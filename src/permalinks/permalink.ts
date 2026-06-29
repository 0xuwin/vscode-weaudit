/**
 * Generates a source permalink for a remote, commit, path, and line range.
 */
export function generateSourcePermalink(remote: string, commit: string, filePath: string, startLine: number, endLine: number): string {
    const remoteHost = getRemoteHostname(remote);
    if (remoteHost === "bitbucket.org") {
        return `${remote}/src/${commit}/${filePath}#lines-${startLine + 1}:${endLine + 1}`;
    }

    return `${remote}/blob/${commit}/${filePath}#L${startLine + 1}-L${endLine + 1}`;
}

/**
 * Extracts a hostname using the WHATWG URL API, returning undefined for invalid URLs.
 */
function getRemoteHostname(remote: string): string | undefined {
    try {
        return new URL(remote).hostname;
    } catch {
        return;
    }
}
