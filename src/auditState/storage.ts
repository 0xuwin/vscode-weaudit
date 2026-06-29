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
    const parsedEntries = normalizeSerializedData(JSON.parse(data) as SerializedData);

    if (!validateSerializedData(parsedEntries)) {
        return;
    }

    return parsedEntries;
}

/**
 * Writes a serialized audit state file to disk as formatted JSON.
 */
export function writeAuditState(filePath: string, data: SerializedData): void {
    fs.writeFileSync(filePath, JSON.stringify(denormalizeSerializedData(data), null, 2), { flag: "w+" });
}

/**
 * Converts serialized JSON field names into internal TypeScript field names.
 */
function normalizeSerializedData(data: SerializedData): SerializedData {
    normalizeEntries(data.treeEntries);
    normalizeEntries(data.resolvedEntries);
    return data;
}

/**
 * Converts internal TypeScript field names into serialized JSON field names.
 */
function denormalizeSerializedData(data: SerializedData): unknown {
    return {
        ...data,
        treeEntries: denormalizeEntries(data.treeEntries),
        resolvedEntries: denormalizeEntries(data.resolvedEntries),
    };
}

/**
 * Normalizes entry location field names in-place.
 */
function normalizeEntries(entries: SerializedData["treeEntries"]): void {
    for (const entry of entries) {
        for (const location of entry.locations) {
            const serializedLocation = location as typeof location & Record<string, unknown>;
            const codeSnippet = serializedLocation["code_snippet"];
            location.codeSnippet = typeof codeSnippet === "string" ? codeSnippet : location.codeSnippet;
            delete serializedLocation["code_snippet"];
        }
    }
}

/**
 * Denormalizes entry location field names for JSON serialization.
 */
function denormalizeEntries(entries: SerializedData["treeEntries"]): unknown[] {
    return entries.map((entry) => ({
        ...entry,
        locations: entry.locations.map((location) => {
            const { codeSnippet, ...rest } = location;
            return { ...rest, ["code_snippet"]: codeSnippet };
        }),
    }));
}
