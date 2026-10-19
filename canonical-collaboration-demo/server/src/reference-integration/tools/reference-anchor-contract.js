import { ToolInputError } from '../agent/tool-errors.js';

const text = { type: 'string', minLength: 1 };
const object = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });

// Each variant requires its own placement fields. Strict tool decoding cannot
// emit a sectionEnd without a heading or attach numeric offsets to an anchor.
export const referenceAnchorSchema = {
  anyOf: [
    object({
      kind: { type: 'string', enum: ['sectionEnd'] },
      sectionHeading: { ...text, description: 'Required for requests at the end/final sentence of a named section. Copy the heading, never a paragraph or sentence from that section.' },
    }),
    object({
      kind: { type: 'string', enum: ['afterText'] },
      text: { ...text, description: 'Use only when the user specifies particular words or a phrase. Do not use this variant for the final sentence/end of a named section: use sectionEnd.' },
      sectionHeading: { type: ['string', 'null'], description: 'Exact section heading to scope the quote; null when unnecessary.' },
      blockId: { type: ['string', 'null'], description: 'Inspected paragraph nodeId to scope the quote; null when unnecessary.' },
    }),
    object({
      kind: { type: 'string', enum: ['paragraphEnd'] },
      blockId: { ...text, description: 'Copy the inspected paragraph nodeId. Insert after its last visible character.' },
    }),
  ],
};

const variants = {
  afterText: { required: ['text'], allowed: ['kind', 'text', 'sectionHeading', 'blockId'] },
  sectionEnd: { required: ['sectionHeading'], allowed: ['kind', 'sectionHeading'] },
  paragraphEnd: { required: ['blockId'], allowed: ['kind', 'blockId'] },
};
const examples = [
  { kind: 'sectionEnd', sectionHeading: 'Overview' },
  { kind: 'afterText', text: 'exact words from the document', sectionHeading: null, blockId: null },
  { kind: 'paragraphEnd', blockId: 'an inspected paragraph nodeId' },
];

export const referenceAnchorInstructions = 'Choose the anchor kind from the USER REQUEST, not from a convenient inspected paragraph. A request for the final/last sentence or end of a named section MUST use sectionEnd with that heading. Never translate that request into afterText or paragraphEnd: an inspected paragraph can be only the first paragraph of the section. Use afterText only when the user identifies particular words/phrases, supplying null for unused sectionHeading and blockId scopes. Use paragraphEnd only for a specifically requested paragraph. Semantic anchors resolve against the current document: reuse inspected headings or exact quotes after a metadata edit. Use the latest returned evaluatedRevision rather than inspecting solely to refresh a revision already supplied by a successful tool call; inspect when no current receipt is available or a stale-revision error requires it. When a tool returns INVALID_REFERENCE_ANCHOR, correct the exact argument paths in issues using recovery.examples. Inspecting again does not repair malformed arguments. Do not repeat unchanged invalid calls. A successful insertion with resolvedAnchor.verified=true remains applied: do not insert it again. Report only verified placement and successful mutations.';

export function validateReferenceAnchor(anchor) {
  const issues = [];
  const issue = (path, message) => issues.push({ path, message });
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) {
    issue('anchor', 'Required object. Choose one of the provided anchor examples. Numeric blockId/offset arguments are not supported.');
  } else if (!Object.hasOwn(variants, anchor.kind)) {
    issue('anchor.kind', 'Must be exactly afterText, sectionEnd, or paragraphEnd.');
  } else {
    const variant = variants[anchor.kind];
    for (const key of variant.required) {
      if (typeof anchor[key] !== 'string' || !anchor[key].trim()) {
        issue(`anchor.${key}`, `Required non-empty string for kind=${anchor.kind}.`);
      }
    }
    for (const [key, value] of Object.entries(anchor)) {
      if (!variant.allowed.includes(key)) {
        issue(`anchor.${key}`, `Not allowed for kind=${anchor.kind}. Remove this property; do not calculate character offsets.`);
      } else if (!['kind', ...variant.required].includes(key) && value !== null
        && (typeof value !== 'string' || !value.trim())) {
        issue(`anchor.${key}`, 'Use a non-empty string or null when this scope is unnecessary.');
      }
    }
  }
  if (issues.length) throw new ToolInputError('INVALID_REFERENCE_ANCHOR', issues, {
    action: 'correct_arguments', inspectRequired: false,
    message: 'Correct the listed argument paths and retry. Inspect only if you need document text or the current revision. Do not repeat the same invalid arguments.',
    examples,
  });
  return Object.fromEntries(Object.entries(anchor).filter(([, value]) => value !== null && value !== undefined));
}
