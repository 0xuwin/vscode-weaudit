import { DetailValue, EntryDetails } from "../types";
import { FindingSchema } from "./types";
import { isDetailFieldVisible } from "./visibility";

/**
 * Renders finding details as Markdown using the configured schema order and visibility rules.
 */
export function renderEntryDetailsMarkdown(details: EntryDetails, schema: FindingSchema): string {
    let markdown = "";
    for (const field of schema.fields) {
        if (!isDetailFieldVisible(field, details)) {
            continue;
        }

        const value = details[field.key];
        if (isEmptyDetailValue(value)) {
            continue;
        }

        markdown += `## ${field.label}\n${formatDetailValue(value)}\n\n`;
    }
    return markdown;
}

/**
 * Returns true when a detail value should be omitted from Markdown output.
 */
function isEmptyDetailValue(value: DetailValue | undefined): value is undefined | null | "" | [] {
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Formats a typed detail value for Markdown output.
 */
function formatDetailValue(value: DetailValue): string {
    if (Array.isArray(value)) {
        return value.join(", ");
    }
    if (typeof value === "boolean") {
        return value ? "Yes" : "No";
    }
    return String(value);
}
