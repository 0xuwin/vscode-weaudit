import { DetailValue } from "../types";

export const FINDING_SCHEMA_FIELDS_SETTING = "findingSchema.fields";
export const FINDING_SCHEMA_LABEL_TEMPLATE_SETTING = "findingSchema.labelTemplate";

/** Supported field control types for finding details. */
export type FindingSchemaFieldType = "text" | "textarea" | "select" | "checkbox" | "number";

/** Value type accepted by a conditional visibility rule. */
export type VisibleWhenValue = DetailValue | DetailValue[];

/** Visibility rule for dynamically rendered finding fields. */
export interface FindingFieldVisibleWhen {
    field: string;
    equals?: VisibleWhenValue;
    notEquals?: VisibleWhenValue;
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
