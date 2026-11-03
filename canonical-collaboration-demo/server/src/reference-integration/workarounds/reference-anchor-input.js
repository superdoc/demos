import { ToolInputError } from '../agent/tool-errors.js';

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
