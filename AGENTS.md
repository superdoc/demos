# Working on SuperDoc demos

Read [DEMO_IMPACT_SCORECARD.md](./DEMO_IMPACT_SCORECARD.md) whenever creating a
demo or changing an existing demo's behavior, presentation, or onboarding.
Follow the demo directory's own instructions as well.

The rubric applies to actual demo apps and examples, including Demo Bot's
generated projects. Demo Bot itself, its gallery and Slack interfaces, and
supporting infrastructure are engineering tools: verify them with functional,
reliability and security checks, without assigning a Demo Impact Score.

1. Before implementation, identify the customer workflow and intended next
   action. Check relevance, clarity, differentiation, reusability, actionability,
   and credibility to choose the most valuable focused change.
2. Aim for the highest evidence-supported scores, targeting 26–30/30. Improve
   weak categories within the user's scope; do not inflate ratings, invent
   outcomes, or add unnecessary features to chase the total.
3. Verify the actual demo and its setup path. Distinguish browser-tested behavior
   from assumptions, mocked integrations, and unverified customer claims.
4. Before handoff, create or update `<demo-directory>/DEMO_SCORECARD.md` using the
   shared template. Record all six scores with rationale, the total and rating,
   a Keep / Improve / Merge / Retire recommendation, and the next improvement.
   Keep outcome metrics separate and mark missing evidence explicitly.
5. Include the scorecard link, total, key evidence, and remaining weakness in the
   PR description or final handoff. A scorecard recommendation does not authorize
   merging or retiring a demo. Do not rescore unrelated demos during a narrow task.
