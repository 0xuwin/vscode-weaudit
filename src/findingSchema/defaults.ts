import { FindingDifficulty, FindingSeverity, FindingType } from "../types";
import { FindingSchemaField } from "./types";

/** Default fixed fields shown for every finding. */
export function createFixedFindingSchemaFields(): FindingSchemaField[] {
    return [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "description", label: "Description", type: "textarea", placeholder: "The finding details", rows: 5 },
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
