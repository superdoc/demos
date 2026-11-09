import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
} from "docx";
import { writeFile } from "node:fs/promises";
const body = (text: string) => new Paragraph({ text, spacing: { after: 180 } });
const heading = (
  text: string,
  level: (typeof HeadingLevel)[keyof typeof HeadingLevel],
) =>
  new Paragraph({ text, heading: level, spacing: { before: 260, after: 140 } });
const content = [
  heading("Meridian project brief", HeadingLevel.TITLE),
  body(
    "A fictional project, built to show how a real Word document can power its own navigation.",
  ),
  heading("Overview", HeadingLevel.HEADING_1),
  heading("Goals and outcomes", HeadingLevel.HEADING_2),
  body(
    "Give project reviewers a clear route through the plan. Native Word heading styles define the structure; the sidebar follows that structure.",
  ),
  heading("Scope", HeadingLevel.HEADING_2),
  body(
    "This sample includes nested sections, repeated heading names and a longer delivery plan. All names and project details are synthetic.",
  ),
  heading("Delivery plan", HeadingLevel.HEADING_1),
  heading("Milestones", HeadingLevel.HEADING_2),
  heading("Preparation", HeadingLevel.HEADING_3),
  body(
    "Gather the inputs, agree the review questions, and choose who will make each decision.",
  ),
  heading("Notes", HeadingLevel.HEADING_2),
  body(
    "This Notes section belongs to the delivery plan. Another Notes section appears later so navigation must use native identities, not just matching words.",
  ),
  ...Array.from({ length: 18 }, (_, i) =>
    body(
      `Delivery checkpoint ${i + 1}. Confirm the current document, review the remaining questions, and retain a clear next action. This is ordinary body copy and should never become an outline item.`,
    ),
  ),
  heading("Decisions", HeadingLevel.HEADING_1),
  heading("Notes", HeadingLevel.HEADING_2),
  body(
    "This Notes section belongs to decisions. Clicking it should reach this section, even though its title is repeated.",
  ),
  heading("Next steps", HeadingLevel.HEADING_2),
  body(
    "Try renaming a heading directly in the document. The outline updates without a save or reload. Use File > Save As to keep your changes.",
  ),
];
const bold = (text: string) =>
  new Paragraph({
    children: [new TextRun({ text, bold: true })],
    spacing: { after: 140 },
  });
const unstyled = [
  bold("Meridian planning notes"),
  body(
    "This file intentionally has no Word heading styles. Bold text alone does not create outline entries. Apply a Word heading style to add a section to the outline.",
  ),
  new Table({
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [
              bold("AI PREPARES"),
              bold("Keep the original intent"),
              body(
                "Research the relevant background before preparing a proposal.",
              ),
            ],
          }),
          new TableCell({
            children: [
              bold("AI PREPARES"),
              bold("Read the relationship"),
              body("Understand the conversation and the timing."),
            ],
          }),
        ],
      }),
    ],
  }),
  bold("A complete emphasized sentence is still body copy."),
  body(
    "The outline reads native Word headings through the Document API. It does not infer headings from bold text.",
  ),
];
for (const [name, children] of [
  ["project-brief", content],
  ["unstyled-brief", unstyled],
] as const) {
  const doc = new Document({
    creator: "SuperDoc",
    title: "Synthetic outline demonstration",
    styles: {
      default: {
        document: { run: { font: "Arial", size: 22, color: "27364B" } },
      },
    },
    sections: [{ children: [...children] }],
  });
  await writeFile(
    new URL(`../public/${name}.docx`, import.meta.url),
    await Packer.toBuffer(doc),
  );
}
