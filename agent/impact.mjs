import { readFileSync } from 'node:fs';

// Share the repository rubric with the builder and downloaded projects.
export const DEMO_IMPACT_SCORECARD = readFileSync(new URL('../DEMO_IMPACT_SCORECARD.md', import.meta.url), 'utf8');
export const DEMO_IMPACT_INSTRUCTIONS = `Use the Demo Impact Scorecard below when choosing and reviewing the generated SuperDoc demo. Assess that example only; Demo Bot, its interfaces and infrastructure do not receive impact scores. Aim for the highest honest scores within the existing feature, code, and token limits; prefer a clear customer workflow to extra features.
In guidance, include a concise provisional assessment: all six category scores (1–5) with brief evidence or limitations, the total out of 30, a Keep / Improve / Merge / Retire recommendation, and the most valuable next improvement. You cannot run the generated demo or measure customer outcomes here: do not claim browser verification, canonical/validated status, usage or adoption. Credibility cannot exceed 3 until the demo has been verified in a browser. Mark outcomes as not measured. These are public assessment results, not private reasoning. Return only the source and guidance required by the existing output schema; the host includes the rubric in the download.

${DEMO_IMPACT_SCORECARD}`;
