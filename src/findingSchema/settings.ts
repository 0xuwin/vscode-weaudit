import * as vscode from "vscode";

import { createDefaultFindingSchemaFields, createDefaultSeverityOptions, createFixedFindingSchemaFields } from "./defaults";
import { FINDING_SCHEMA_FIELDS_SETTING, FINDING_SCHEMA_SEVERITY_OPTIONS_SETTING, FindingSchema, FindingSchemaField } from "./types";
import { validateFindingSchemaFields, validateSeverityOptions } from "./validation";

/**
 * Loads the finding schema from VS Code settings and prepends fixed fields.
 */
export function loadFindingSchema(): FindingSchema {
    const configuration = vscode.workspace.getConfiguration("weAudit");
    const configuredFields = configuration.get<FindingSchemaField[]>(FINDING_SCHEMA_FIELDS_SETTING, createDefaultFindingSchemaFields());
    const configuredSeverityOptions = configuration.get<string[]>(FINDING_SCHEMA_SEVERITY_OPTIONS_SETTING, createDefaultSeverityOptions());
    const validation = validateFindingSchemaFields(configuredFields);
    const severityValidation = validateSeverityOptions(configuredSeverityOptions);
    const dynamicFields = validation.errors.length === 0 ? configuredFields : createDefaultFindingSchemaFields();
    const severityOptions = severityValidation.errors.length === 0 ? configuredSeverityOptions : createDefaultSeverityOptions();

    if (validation.errors.length > 0) {
        vscode.window.showErrorMessage(`weAudit: Invalid finding schema setting. ${validation.errors[0]}`);
    }
    if (severityValidation.errors.length > 0) {
        vscode.window.showErrorMessage(`weAudit: Invalid severity options setting. ${severityValidation.errors[0]}`);
    }

    return { fields: [...createFixedFindingSchemaFields(severityOptions), ...dynamicFields] };
}
