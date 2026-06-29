import { expect } from "chai";

import { createDefaultFindingSchemaFields, createFixedFindingSchemaFields } from "../../src/findingSchema/defaults";
import { renderEntryDetailsMarkdown } from "../../src/findingSchema/markdown";
import { renderLabelTemplate } from "../../src/findingSchema/labelTemplate";
import { validateFindingSchemaFields } from "../../src/findingSchema/validation";
import { isDetailFieldVisible } from "../../src/findingSchema/visibility";

describe("findingSchema", () => {
    describe("defaults", () => {
        it("creates fixed title and description fields", () => {
            const fields = createFixedFindingSchemaFields();

            expect(fields.map((field) => field.key)).to.deep.equal(["title", "description"]);
        });

        it("creates default configurable fields for the previous details form", () => {
            const fields = createDefaultFindingSchemaFields();

            expect(fields.map((field) => field.key)).to.deep.equal(["severity", "difficulty", "type", "exploit", "recommendation"]);
            expect(fields.slice(1).every((field) => field.visibleWhen?.field === "severity")).to.equal(true);
        });
    });

    describe("validation", () => {
        it("accepts valid field definitions", () => {
            const result = validateFindingSchemaFields([
                { key: "confirmed", label: "Confirmed", type: "checkbox" },
                { key: "impact", label: "Impact", type: "textarea", rows: 6 },
                { key: "category", label: "Category", type: "select", options: ["", "A", "B"] },
            ]);

            expect(result.errors).to.deep.equal([]);
        });

        it("rejects duplicate keys", () => {
            const result = validateFindingSchemaFields([
                { key: "impact", label: "Impact", type: "text" },
                { key: "impact", label: "Impact Again", type: "text" },
            ]);

            expect(result.errors.some((error) => error.includes("duplicated"))).to.equal(true);
        });

        it("requires options for select fields", () => {
            const result = validateFindingSchemaFields([{ key: "category", label: "Category", type: "select" }]);

            expect(result.errors.some((error) => error.includes("options is required"))).to.equal(true);
        });

        it("validates visibleWhen rules", () => {
            const result = validateFindingSchemaFields([{ key: "extra", label: "Extra", type: "text", visibleWhen: { field: "severity" } }]);

            expect(result.errors.some((error) => error.includes("equals or notEquals"))).to.equal(true);
        });

        it("accepts visibleWhen array rules", () => {
            const result = validateFindingSchemaFields([
                { key: "impact", label: "Impact", type: "textarea", visibleWhen: { field: "type", equals: ["Issue", "Recommendation"] } },
            ]);

            expect(result.errors).to.deep.equal([]);
        });
    });

    describe("visibility", () => {
        it("shows fields when actual value is included in equals array", () => {
            const visible = isDetailFieldVisible(
                { key: "impact", label: "Impact", type: "textarea", visibleWhen: { field: "type", equals: ["Issue", "Recommendation"] } },
                { title: "Finding", type: "Issue" },
            );

            expect(visible).to.equal(true);
        });

        it("hides fields when actual value is included in notEquals array", () => {
            const visible = isDetailFieldVisible(
                { key: "impact", label: "Impact", type: "textarea", visibleWhen: { field: "type", notEquals: ["Question", "Note"] } },
                { title: "Finding", type: "Question" },
            );

            expect(visible).to.equal(false);
        });
    });

    describe("markdown", () => {
        it("renders configured custom fields in schema order", () => {
            const markdown = renderEntryDetailsMarkdown(
                {
                    title: "Finding title",
                    severity: "High",
                    type: "Issue",
                    description: "Description text",
                    impact: "Impact text",
                    suggestion: "Suggestion text",
                },
                {
                    fields: [
                        { key: "title", label: "Title", type: "text" },
                        { key: "severity", label: "Severity", type: "select", options: ["High"] },
                        { key: "type", label: "Type", type: "select", options: ["Issue"] },
                        { key: "description", label: "Description", type: "textarea" },
                        { key: "impact", label: "Impact", type: "textarea", visibleWhen: { field: "type", equals: ["Issue", "Recommendation"] } },
                        { key: "suggestion", label: "Suggestion", type: "textarea" },
                    ],
                },
            );

            expect(markdown).to.contain("## Title\nFinding title");
            expect(markdown).to.contain("## Type\nIssue");
            expect(markdown).to.contain("## Impact\nImpact text");
            expect(markdown.indexOf("## Type")).to.be.lessThan(markdown.indexOf("## Description"));
        });

        it("omits hidden and empty fields", () => {
            const markdown = renderEntryDetailsMarkdown(
                { title: "Finding title", type: "Question", impact: "Hidden impact", feedback: "" },
                {
                    fields: [
                        { key: "title", label: "Title", type: "text" },
                        { key: "impact", label: "Impact", type: "textarea", visibleWhen: { field: "type", equals: ["Issue", "Recommendation"] } },
                        { key: "feedback", label: "Feedback", type: "textarea" },
                    ],
                },
            );

            expect(markdown).to.contain("## Title\nFinding title");
            expect(markdown).not.to.contain("Hidden impact");
            expect(markdown).not.to.contain("Feedback");
        });
    });

    describe("labelTemplate", () => {
        it("renders label templates with built-in and custom detail fields", () => {
            const label = renderLabelTemplate("[${severity}] ${type}: ${title}", {
                title: "Missing access control",
                severity: "High",
                type: "Issue",
            });

            expect(label).to.equal("[High] Issue: Missing access control");
        });

        it("renders missing placeholders as empty strings", () => {
            const label = renderLabelTemplate("${severity}: ${title}", {
                title: "Needs review",
            });

            expect(label).to.equal(": Needs review");
        });
    });
});
