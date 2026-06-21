import { parse } from "url";

/**
 * Generates a source permalink for a remote, commit, path, and line range.
 */
export function generateSourcePermalink(remote: string, commit: string, filePath: string, startLine: number, endLine: number): string {
    const remoteHost = parse(remote).hostname;
    if (remoteHost === "bitbucket.org") {
        return `${remote}/src/${commit}/${filePath}#lines-${startLine + 1}:${endLine + 1}`;
    }

    return `${remote}/blob/${commit}/${filePath}#L${startLine + 1}-L${endLine + 1}`;
}
