import * as fs from "fs";

import { SerializedData, validateSerializedData } from "../types";

/**
 * Reads and validates a serialized audit state file from disk.
 */
export function readAuditState(filePath: string): SerializedData | undefined {
    if (!fs.existsSync(filePath)) {
        return;
    }

    const data = fs.readFileSync(filePath).toString();
    const parsedEntries = JSON.parse(data) as SerializedData;

    if (!validateSerializedData(parsedEntries)) {
        return;
    }

    return parsedEntries;
}

/**
 * Writes a serialized audit state file to disk as formatted JSON.
 */
export function writeAuditState(filePath: string, data: SerializedData): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { flag: "w+" });
}
