import { FindingDifficulty, FindingSeverity, FindingType, EntryDetails } from "../types";
import { FindingSchemaField } from "./types";

/** Default fixed fields shown for every finding. */
export function createFixedFindingSchemaFields(): FindingSchemaField[] {
    return [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "description", label: "Description", type: "textarea", placeholder: "The finding details", rows: 8 },
    ];
}

/** Default configurable fields that preserve the existing Finding Details form. */
export function createDefaultFindingSchemaFields(): FindingSchemaField[] {
    const hideForCodeQuality = { field: "severity", notEquals: FindingSeverity.CodeQuality };
    return [
        {
            key: "severity",
            label: "Severity",
            type: "select",
            options: [
                "",
                FindingSeverity.CodeQuality,
                FindingSeverity.Informational,
                FindingSeverity.Undetermined,
                FindingSeverity.Low,
                FindingSeverity.Medium,
                FindingSeverity.High,
            ],
        },
        {
            key: "difficulty",
            label: "Difficulty",
            type: "select",
            options: ["", FindingDifficulty.Undefined, FindingDifficulty.NA, FindingDifficulty.Low, FindingDifficulty.Medium, FindingDifficulty.High],
            visibleWhen: hideForCodeQuality,
        },
        {
            key: "type",
            label: "Type",
            type: "select",
            options: [
                "",
                FindingType.AccessControls,
                FindingType.AuditingAndLogging,
                FindingType.Authentication,
                FindingType.Configuration,
                FindingType.Cryptography,
                FindingType.DataExposure,
                FindingType.DataValidation,
                FindingType.DenialOfService,
                FindingType.ErrorReporting,
                FindingType.Patching,
                FindingType.SessionManagement,
                FindingType.Testing,
                FindingType.Timing,
                FindingType.UndefinedBehavior,
            ],
            visibleWhen: hideForCodeQuality,
        },
        { key: "exploit", label: "Exploit Scenario", type: "textarea", placeholder: "The exploit scenario", rows: 5, visibleWhen: hideForCodeQuality },
        { key: "recommendation", label: "Recommendations", type: "textarea", rows: 5, visibleWhen: hideForCodeQuality },
    ];
}

/**
 * Creates default empty entry details from a finding schema, initializing every field to an empty default value.
 * @param schema The finding schema to derive fields from.
 * @returns Entry details with all schema fields set to empty defaults.
 */
export function createEntryDetailsFromSchema(schema: { fields: FindingSchemaField[] }): EntryDetails {
    const details: EntryDetails = { title: "", description: "" };
    for (const field of schema.fields) {
        switch (field.type) {
            case "checkbox":
                details[field.key] = false;
                break;
            case "number":
                details[field.key] = null;
                break;
            case "select":
                details[field.key] = undefined;
                break;
            default:
                details[field.key] = "";
        }
    }
    return details;
}
