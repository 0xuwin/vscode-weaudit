import { EntryDetails } from "../types";

/**
 * Renders a finding label from a template and detail fields.
 */
export function renderLabelTemplate(template: string, details: EntryDetails): string {
    return template.replace(/\$\{([A-Za-z][A-Za-z0-9_-]*)\}/g, (_match, key: string) => stringifyTemplateValue(details[key]));
}

/**
 * Converts a detail value into a label-friendly string.
 */
function stringifyTemplateValue(value: EntryDetails[string]): string {
    if (value === undefined || value === null) {
        return "";
    }
    if (Array.isArray(value)) {
        return value.join(", ");
    }
    return String(value);
}
