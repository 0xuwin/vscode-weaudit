import { FullEntry } from "../types";
import { renderEntryDetailsMarkdown } from "../findingSchema/markdown";
import { FindingSchema } from "../findingSchema/types";

/**
 * Renders a finding as Markdown using configured detail fields and code references.
 * @param entry The finding entry to render.
 * @param schema The finding schema to use for detail field rendering.
 */
export function renderFindingMarkdown(entry: FullEntry, schema: FindingSchema): string {
    let markdownBody = renderEntryDetailsMarkdown(entry.details, schema);
    markdownBody += "## Code References\n";
    for (const location of entry.locations) {
        markdownBody += `\n${location.path}#L${location.startLine + 1}-${location.endLine + 1}\n`;
        markdownBody += `\`\`\`\n${location.codeSnippet}\n\`\`\`\n`;
    }
    markdownBody += "\n";
    return markdownBody;
}
