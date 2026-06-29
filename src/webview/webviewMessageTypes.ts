import type { DetailValue } from "../types";
import type { FindingSchema } from "../findingSchema/types";

export type WebviewMessage = UpdateEntryMessage | WebviewIsReadyMessage | SetFindingDetailsMessage;

export interface SetFindingDetailsMessage {
    command: "set-finding-details";
    title: string;
    details: Record<string, DetailValue | undefined>;
    schema: FindingSchema;
}

export interface UpdateEntryMessage {
    command: "update-entry";
    field: string;
    value: DetailValue;
    isPersistent: boolean;
}

export interface WebviewIsReadyMessage {
    command: "webview-ready";
}
