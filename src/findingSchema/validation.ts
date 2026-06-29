import { FindingSchemaField } from "./types";

/** Validation result for finding schema settings. */
export interface FindingSchemaValidationResult {
    errors: string[];
}

/**
 * Validates finding schema fields loaded from settings.
 */
export function validateFindingSchemaFields(fields: unknown): FindingSchemaValidationResult {
    const errors: string[] = [];
    if (!Array.isArray(fields)) {
        return { errors: ["findingSchema.fields must be an array."] };
    }

    const seenKeys = new Set<string>();
    fields.forEach((field, index) => {
        const path = `findingSchema.fields[${index}]`;
        if (!isRecord(field)) {
            errors.push(`${path} must be an object.`);
            return;
        }
        if (typeof field.key !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(field.key)) {
            errors.push(`${path}.key must start with a letter and contain only letters, numbers, underscores, or hyphens.`);
        } else if (seenKeys.has(field.key)) {
            errors.push(`${path}.key '${field.key}' is duplicated.`);
        } else {
            seenKeys.add(field.key);
        }
        if (typeof field.label !== "string" || field.label === "") {
            errors.push(`${path}.label must be a non-empty string.`);
        }
        if (!isFindingSchemaFieldType(field.type)) {
            errors.push(`${path}.type must be text, textarea, select, checkbox, or number.`);
        }
        if (field.options !== undefined && (!Array.isArray(field.options) || field.options.some((option) => typeof option !== "string"))) {
            errors.push(`${path}.options must be an array of strings when present.`);
        }
        if (field.type === "select" && !Array.isArray(field.options)) {
            errors.push(`${path}.options is required for select fields.`);
        }
        validateVisibleWhen(field as unknown as FindingSchemaField, path, errors);
    });

    return { errors };
}

/**
 * Validates conditional visibility rules for a schema field.
 */
function validateVisibleWhen(field: FindingSchemaField, path: string, errors: string[]): void {
    if (field.visibleWhen === undefined) {
        return;
    }
    if (!isRecord(field.visibleWhen)) {
        errors.push(`${path}.visibleWhen must be an object when present.`);
        return;
    }
    if (typeof field.visibleWhen.field !== "string" || field.visibleWhen.field === "") {
        errors.push(`${path}.visibleWhen.field must be a non-empty string.`);
    }
    if (field.visibleWhen.equals === undefined && field.visibleWhen.notEquals === undefined) {
        errors.push(`${path}.visibleWhen must define equals or notEquals.`);
    }
    validateVisibleWhenValue(field.visibleWhen.equals, `${path}.visibleWhen.equals`, errors);
    validateVisibleWhenValue(field.visibleWhen.notEquals, `${path}.visibleWhen.notEquals`, errors);
}

/**
 * Validates a single visibleWhen comparison value or an array of comparison values.
 */
function validateVisibleWhenValue(value: unknown, valuePath: string, errors: string[]): void {
    if (value === undefined) {
        return;
    }
    const values = Array.isArray(value) ? value : [value];
    if (values.some((item) => Array.isArray(item))) {
        errors.push(`${valuePath} must be a scalar value or an array of scalar values.`);
    }
}

/**
 * Returns true for supported finding schema field types.
 */
function isFindingSchemaFieldType(value: unknown): boolean {
    return value === "text" || value === "textarea" || value === "select" || value === "checkbox" || value === "number";
}

/**
 * Returns true when a value is a non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
