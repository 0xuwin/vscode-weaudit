import { DetailValue } from "../types";

export const FINDING_SCHEMA_FIELDS_SETTING = "findingSchema.fields";

/** Supported field control types for finding details. */
export type FindingSchemaFieldType = "text" | "textarea" | "select" | "checkbox" | "number";

/** Visibility rule for dynamically rendered finding fields. */
export interface FindingFieldVisibleWhen {
    field: string;
    equals?: DetailValue;
    notEquals?: DetailValue;
}

/** A finding detail field rendered in the Finding Details panel. */
export interface FindingSchemaField {
    key: string;
    label: string;
    type: FindingSchemaFieldType;
    required?: boolean;
    options?: string[];
    placeholder?: string;
    rows?: number;
    visibleWhen?: FindingFieldVisibleWhen;
}

/** Finding schema settings consumed by the Finding Details panel. */
export interface FindingSchema {
    fields: FindingSchemaField[];
}
