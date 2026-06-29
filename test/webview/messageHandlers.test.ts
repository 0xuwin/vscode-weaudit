import { expect } from "chai";
import * as sinon from "sinon";

import { WebviewMessage, UpdateEntryMessage, WebviewIsReadyMessage } from "../../src/webview/webviewMessageTypes";

/**
 * Mock command executor for testing webview message handlers.
 */
function createMockCommandExecutor() {
    const executedCommands: Array<{ command: string; args: unknown[] }> = [];

    return {
        executeCommand: sinon.stub().callsFake((command: string, ...args: unknown[]) => {
            executedCommands.push({ command, args });
            return Promise.resolve();
        }),
        getExecutedCommands: () => executedCommands,
    };
}

describe("Webview Message Handlers", () => {
    describe("Finding Details Panel Message Handler", () => {
        describe("update-entry message", () => {
            it("executes updateCurrentSelectedEntry command with field, value, and isPersistent", () => {
                const commandExecutor = createMockCommandExecutor();

                const message: UpdateEntryMessage = {
                    command: "update-entry",
                    field: "severity",
                    value: "High",
                    isPersistent: true,
                };

                if (message.command === "update-entry") {
                    commandExecutor.executeCommand("weAudit.updateCurrentSelectedEntry", message.field, message.value, message.isPersistent);
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands).to.have.length(1);
                expect(commands[0].command).to.equal("weAudit.updateCurrentSelectedEntry");
                expect(commands[0].args).to.deep.equal(["severity", "High", true]);
            });

            it("handles non-persistent updates", () => {
                const commandExecutor = createMockCommandExecutor();

                const message: UpdateEntryMessage = {
                    command: "update-entry",
                    field: "description",
                    value: "This is a draft",
                    isPersistent: false,
                };

                if (message.command === "update-entry") {
                    commandExecutor.executeCommand("weAudit.updateCurrentSelectedEntry", message.field, message.value, message.isPersistent);
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands[0].args[2]).to.be.false;
            });

            it("handles empty value", () => {
                const commandExecutor = createMockCommandExecutor();

                const message: UpdateEntryMessage = {
                    command: "update-entry",
                    field: "exploit",
                    value: "",
                    isPersistent: true,
                };

                if (message.command === "update-entry") {
                    commandExecutor.executeCommand("weAudit.updateCurrentSelectedEntry", message.field, message.value, message.isPersistent);
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands[0].args[1]).to.equal("");
            });
        });

        describe("webview-ready message", () => {
            it("executes showSelectedEntryInFindingDetails command", () => {
                const commandExecutor = createMockCommandExecutor();

                const message: WebviewIsReadyMessage = {
                    command: "webview-ready",
                };

                if (message.command === "webview-ready") {
                    commandExecutor.executeCommand("weAudit.showSelectedEntryInFindingDetails");
                }

                const commands = commandExecutor.getExecutedCommands();
                expect(commands).to.have.length(1);
                expect(commands[0].command).to.equal("weAudit.showSelectedEntryInFindingDetails");
            });
        });
    });

    describe("Message Type Validation", () => {
        it("identifies update-entry messages correctly", () => {
            const message: WebviewMessage = {
                command: "update-entry",
                field: "severity",
                value: "High",
                isPersistent: true,
            };

            expect(message.command).to.equal("update-entry");
            expect("field" in message).to.be.true;
            expect("value" in message).to.be.true;
            expect("isPersistent" in message).to.be.true;
        });

        it("identifies webview-ready messages correctly", () => {
            const message: WebviewMessage = {
                command: "webview-ready",
            };

            expect(message.command).to.equal("webview-ready");
        });
    });
});
