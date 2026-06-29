/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { provideVSCodeDesignSystem, vsCodeCheckbox, vsCodeDropdown, vsCodeOption, vsCodeTextArea, vsCodeTextField } from "@vscode/webview-ui-toolkit";
import { Checkbox, Dropdown, TextArea, TextField } from "@vscode/webview-ui-toolkit";

import type { DetailValue } from "../types";
import type { FindingSchema, FindingSchemaField } from "../findingSchema/types";
import { isDetailFieldVisible } from "../findingSchema/visibility";
import type { SetFindingDetailsMessage, UpdateEntryMessage } from "./webviewMessageTypes";

provideVSCodeDesignSystem().register(vsCodeCheckbox(), vsCodeDropdown(), vsCodeOption(), vsCodeTextArea(), vsCodeTextField());

const vscode = acquireVsCodeApi();
let currentDetails: Record<string, DetailValue | undefined> = {};
let currentSchema: FindingSchema = { fields: [] };

window.addEventListener("load", () => {
    main();
    vscode.postMessage({ command: "webview-ready" });
});

/**
 * Initializes the Finding Details webview message listener.
 */
function main(): void {
    const containerDiv = document.getElementById("container-div") as HTMLDivElement;
    containerDiv.style.display = "none";

    window.addEventListener("message", (event) => {
        const message = event.data;

        switch (message.command) {
            case "set-finding-details":
                renderFindingDetails(message as SetFindingDetailsMessage);
                containerDiv.style.display = "block";
                break;
            case "hide-finding-details":
                containerDiv.style.display = "none";
                break;
        }
    });
}

/**
 * Renders fields from the configured finding schema.
 */
function renderFindingDetails(message: SetFindingDetailsMessage): void {
    currentDetails = { ...message.details, title: message.title };
    currentSchema = message.schema;

    const fieldsContainer = document.getElementById("fields-container") as HTMLDivElement;
    fieldsContainer.replaceChildren();

    for (const field of currentSchema.fields) {
        fieldsContainer.appendChild(createFieldRow(field));
    }
    updateAllFieldVisibility();
}

/**
 * Creates a labeled field row for a schema field.
 */
function createFieldRow(field: FindingSchemaField): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "detailsDiv";
    row.dataset.fieldKey = field.key;

    if (field.type === "textarea") {
        row.appendChild(createTextArea(field));
        return row;
    }

    const label = document.createElement("span");
    label.className = "detailSpan";
    label.textContent = `${field.label}:`;
    row.appendChild(label);
    row.appendChild(createFieldControl(field));
    return row;
}

/**
 * Creates the correct input control for a schema field.
 */
function createFieldControl(field: FindingSchemaField): HTMLElement {
    switch (field.type) {
        case "select":
            return createDropdown(field);
        case "checkbox":
            return createCheckbox(field);
        case "number":
        case "text":
            return createTextField(field);
        case "textarea":
            return createTextArea(field);
    }
}

/**
 * Creates a text input field.
 */
function createTextField(field: FindingSchemaField): TextField {
    const element = document.createElement("vscode-text-field") as TextField;
    element.id = field.key;
    element.value = stringifyDetailValue(currentDetails[field.key]);
    if (field.placeholder !== undefined) {
        element.placeholder = field.placeholder;
    }
    if (field.type === "number") {
        element.setAttribute("type", "number");
    }
    element.addEventListener("change", handlePersistentFieldChange);
    return element;
}

/**
 * Creates a multiline textarea field.
 */
function createTextArea(field: FindingSchemaField): TextArea {
    const element = document.createElement("vscode-text-area") as TextArea;
    element.id = field.key;
    element.textContent = field.label;
    element.value = stringifyDetailValue(currentDetails[field.key]);
    if (field.placeholder !== undefined) {
        element.placeholder = field.placeholder;
    }
    if (field.rows !== undefined) {
        element.rows = field.rows;
    }
    element.addEventListener("change", handlePersistentFieldChange);
    element.addEventListener("input", handleNonPersistentFieldChange);
    return element;
}

/**
 * Creates a dropdown field.
 */
function createDropdown(field: FindingSchemaField): Dropdown {
    const element = document.createElement("vscode-dropdown") as Dropdown;
    element.id = field.key;
    element.setAttribute("position", "below");
    for (const option of field.options ?? []) {
        const optionElement = document.createElement("vscode-option");
        optionElement.textContent = option;
        element.appendChild(optionElement);
    }
    element.value = stringifyDetailValue(currentDetails[field.key]);
    element.addEventListener("change", (event) => {
        handlePersistentFieldChange(event);
        updateAllFieldVisibility();
    });
    return element;
}

/**
 * Creates a checkbox field.
 */
function createCheckbox(field: FindingSchemaField): Checkbox {
    const element = document.createElement("vscode-checkbox") as Checkbox;
    element.id = field.key;
    element.textContent = field.label;
    element.checked = currentDetails[field.key] === true;
    element.addEventListener("change", handlePersistentFieldChange);
    return element;
}

/**
 * Handles non-persistent input changes for text areas.
 */
function handleNonPersistentFieldChange(e: Event): void {
    handleFieldChange(e, false);
}

/**
 * Handles persistent field changes.
 */
function handlePersistentFieldChange(e: Event): void {
    handleFieldChange(e, true);
}

/**
 * Sends a field update message to the extension host.
 */
function handleFieldChange(e: Event, isPersistent: boolean): void {
    const element = e.target as HTMLInputElement;
    const field = element.id;
    const schemaField = currentSchema.fields.find((item) => item.key === field);
    const value = getElementValue(element, schemaField);
    currentDetails[field] = value;

    const message: UpdateEntryMessage = {
        command: "update-entry",
        field,
        value,
        isPersistent,
    };
    vscode.postMessage(message);
}

/**
 * Gets a typed value from a rendered field element.
 */
function getElementValue(element: HTMLInputElement, field: FindingSchemaField | undefined): DetailValue {
    if (field?.type === "checkbox") {
        return Boolean((element as unknown as Checkbox).checked);
    }
    if (field?.type === "number") {
        const value = element.value;
        return value === "" ? null : Number(value);
    }
    return element.value;
}

/**
 * Updates conditional visibility for every rendered field.
 */
function updateAllFieldVisibility(): void {
    for (const field of currentSchema.fields) {
        const row = document.querySelector<HTMLDivElement>(`[data-field-key="${field.key}"]`);
        if (row !== null) {
            row.style.display = isDetailFieldVisible(field, currentDetails) ? "" : "none";
        }
    }
}

/**
 * Converts detail values into input-friendly strings.
 */
function stringifyDetailValue(value: DetailValue | undefined): string {
    if (value === undefined || value === null) {
        return "";
    }
    if (Array.isArray(value)) {
        return value.join(", ");
    }
    return String(value);
}
