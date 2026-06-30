import * as assert from "node:assert";
import * as path from "node:path";

import { clearAuditStateWriteTrackerForTests, isRecentlySelfWrittenAuditStateFile, markAuditStateFileAsSelfWritten } from "../../src/auditState/writeTracker";

describe("auditState/writeTracker", () => {
    afterEach(() => {
        clearAuditStateWriteTrackerForTests();
    });

    it("tracks recently self-written audit state files by normalized path", () => {
        const filePath = path.join("workspace", ".vscode", "alice.weaudit");
        const equivalentPath = path.join("workspace", ".vscode", "..", ".vscode", "alice.weaudit");

        markAuditStateFileAsSelfWritten(filePath);

        assert.strictEqual(isRecentlySelfWrittenAuditStateFile(equivalentPath), true);
    });

    it("clears tracked self-written audit state files", () => {
        const filePath = path.join("workspace", ".vscode", "alice.weaudit");

        markAuditStateFileAsSelfWritten(filePath);
        clearAuditStateWriteTrackerForTests();

        assert.strictEqual(isRecentlySelfWrittenAuditStateFile(filePath), false);
    });
});
