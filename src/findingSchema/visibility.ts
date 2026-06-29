import { DetailValue, EntryDetails } from "../types";
import { FindingSchemaField, VisibleWhenValue } from "./types";

/**
 * Returns whether a schema field should be visible for the current detail values.
 */
export function isDetailFieldVisible(field: FindingSchemaField, details: EntryDetails | Record<string, DetailValue | undefined>): boolean {
    if (field.visibleWhen === undefined) {
        return true;
    }

    const actual = details[field.visibleWhen.field];
    if (field.visibleWhen.equals !== undefined && !matchesVisibleWhenValue(actual, field.visibleWhen.equals)) {
        return false;
    }
    if (field.visibleWhen.notEquals !== undefined && matchesVisibleWhenValue(actual, field.visibleWhen.notEquals)) {
        return false;
    }
    return true;
}

/**
 * Returns true when the actual value matches a single value or one value in a list.
 */
function matchesVisibleWhenValue(actual: DetailValue | undefined, expected: VisibleWhenValue): boolean {
    if (Array.isArray(expected)) {
        return expected.some((value) => value === actual);
    }
    return actual === expected;
}
