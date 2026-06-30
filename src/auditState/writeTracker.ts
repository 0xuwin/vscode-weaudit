import * as path from "path";

const SELF_WRITE_SUPPRESS_MS = 1000;
const selfWrittenAuditStateFiles = new Map<string, NodeJS.Timeout>();

/**
 * Marks a weAudit state file as recently written by the extension itself.
 */
export function markAuditStateFileAsSelfWritten(filePath: string): void {
    const normalizedPath = path.resolve(filePath);
    const existingTimer = selfWrittenAuditStateFiles.get(normalizedPath);
    if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
        selfWrittenAuditStateFiles.delete(normalizedPath);
    }, SELF_WRITE_SUPPRESS_MS);
    selfWrittenAuditStateFiles.set(normalizedPath, timer);
}

/**
 * Returns whether a weAudit state file was recently written by the extension itself.
 */
export function isRecentlySelfWrittenAuditStateFile(filePath: string): boolean {
    return selfWrittenAuditStateFiles.has(path.resolve(filePath));
}

/**
 * Clears tracked self-write state for tests and extension teardown.
 */
export function clearAuditStateWriteTrackerForTests(): void {
    for (const timer of selfWrittenAuditStateFiles.values()) {
        clearTimeout(timer);
    }
    selfWrittenAuditStateFiles.clear();
}
