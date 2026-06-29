import { expect } from "chai";

import { renderFindingMarkdown } from "../../src/markdown/findingMarkdown";
import { FullEntry, EntryType } from "../../src/types";
import { FindingSchema } from "../../src/findingSchema/types";

describe("findingMarkdown", () => {
    const schema: FindingSchema = {
        fields: [
            { key: "title", label: "Title", type: "text" },
            { key: "severity", label: "Severity", type: "select", options: ["High", "Medium", "Low"] },
            { key: "description", label: "Description", type: "textarea" },
            { key: "impact", label: "Impact", type: "textarea" },
        ],
    };

    function createTestEntry(overrides: Partial<FullEntry> = {}): FullEntry {
        return {
            label: "Test Finding",
            entryType: EntryType.Finding,
            author: "tester",
            details: {
                title: "Test Finding",
                severity: "High",
                description: "Something is wrong",
                impact: "Could drain funds",
            },
            locations: [
                {
                    path: "contracts/Vault.sol",
                    startLine: 10,
                    endLine: 20,
                    label: "",
                    codeSnippet: "function withdraw() external {\n    // vulnerable\n}",
                },
                {
                    path: "contracts/Router.sol",
                    startLine: 5,
                    endLine: 8,
                    label: "callback",
                    codeSnippet: "function callback() external {\n    // entry point\n}",
                },
            ],
            ...overrides,
        };
    }

    describe("renderFindingMarkdown", () => {
        it("renders detail fields as level-2 headings in schema order", () => {
            const markdown = renderFindingMarkdown(createTestEntry(), schema);

            expect(markdown).to.contain("## Title\nTest Finding");
            expect(markdown).to.contain("## Severity\nHigh");
            expect(markdown).to.contain("## Description\nSomething is wrong");
            expect(markdown).to.contain("## Impact\nCould drain funds");

            const titleIdx = markdown.indexOf("## Title");
            const severityIdx = markdown.indexOf("## Severity");
            const descriptionIdx = markdown.indexOf("## Description");
            const impactIdx = markdown.indexOf("## Impact");
            expect(titleIdx).to.be.lessThan(severityIdx);
            expect(severityIdx).to.be.lessThan(descriptionIdx);
            expect(descriptionIdx).to.be.lessThan(impactIdx);
        });

        it("appends Code References with path, line range, and code snippet", () => {
            const markdown = renderFindingMarkdown(createTestEntry(), schema);

            expect(markdown).to.contain("## Code References");
            expect(markdown).to.contain("contracts/Vault.sol#L11-21");
            expect(markdown).to.contain("```\nfunction withdraw() external {\n    // vulnerable\n}\n```");
            expect(markdown).to.contain("contracts/Router.sol#L6-9");
            expect(markdown).to.contain("```\nfunction callback() external {\n    // entry point\n}\n```");
        });

        it("uses 1-indexed line numbers", () => {
            const entry = createTestEntry({
                locations: [
                    {
                        path: "test.ts",
                        startLine: 0,
                        endLine: 0,
                        label: "",
                        codeSnippet: "hello",
                    },
                ],
            });

            const markdown = renderFindingMarkdown(entry, schema);

            expect(markdown).to.contain("test.ts#L1-1");
        });

        it("omits empty detail fields", () => {
            const entry = createTestEntry({
                details: {
                    title: "Minimal",
                    description: "",
                    impact: "",
                    severity: "",
                },
            });

            const markdown = renderFindingMarkdown(entry, schema);

            expect(markdown).to.contain("## Title\nMinimal");
            expect(markdown).not.to.contain("## Description");
            expect(markdown).not.to.contain("## Impact");
            expect(markdown).not.to.contain("## Severity");
        });

        it("places Code References after detail fields", () => {
            const markdown = renderFindingMarkdown(createTestEntry(), schema);

            const impactIdx = markdown.indexOf("## Impact");
            const codeRefIdx = markdown.indexOf("## Code References");
            expect(impactIdx).to.be.lessThan(codeRefIdx);
        });
    });
});
