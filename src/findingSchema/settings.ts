import * as vscode from "vscode";

import { createDefaultFindingSchemaFields, createFixedFindingSchemaFields } from "./defaults";
import { FINDING_SCHEMA_FIELDS_SETTING, FINDING_SCHEMA_LABEL_TEMPLATE_SETTING, FindingSchema, FindingSchemaField } from "./types";
import { validateFindingSchemaFields } from "./validation";

/**
 * Loads the finding schema from VS Code settings and prepends fixed fields.
 */
export function loadFindingSchema(): FindingSchema {
    const configuration = vscode.workspace.getConfiguration("weAudit");
    const configuredFields = configuration.get<FindingSchemaField[]>(FINDING_SCHEMA_FIELDS_SETTING, createDefaultFindingSchemaFields());
    const validation = validateFindingSchemaFields(configuredFields);
    const dynamicFields = validation.errors.length === 0 ? configuredFields : createDefaultFindingSchemaFields();

    if (validation.errors.length > 0) {
        vscode.window.showErrorMessage(`weAudit: Invalid finding schema setting. ${validation.errors[0]}`);
    }

    return { fields: [...createFixedFindingSchemaFields(), ...dynamicFields] };
}

/**
 * Loads the finding label template from VS Code settings.
 */
export function loadFindingLabelTemplate(): string {
    return vscode.workspace.getConfiguration("weAudit").get<string>(FINDING_SCHEMA_LABEL_TEMPLATE_SETTING, "${title}");
}
