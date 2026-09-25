// The member app's first-sign-in legal step (#20, e-people-legal): when an organization has published
// member documents (privacy, terms, notices, photo consent …) a member who has not answered the current
// versions sees "Before you continue" until they are answered. Flows that sign members in for OTHER
// journeys answer it through the UI, the way a member would (never by skipping or faking the step):
// every "I have read and accept …" is ticked and every yes/no consent is answered.
//
//   const { acceptLegalStep } = require('../legal-step.cjs');
//   await acceptLegalStep(page, sql);   // after the sign-in; a no-op when nothing is published
//
// `sql` is the flow's own psql helper: with no published member document at all on the stack the step
// cannot appear, so the flow does not wait for it.
'use strict';

async function acceptLegalStep(p, sql, { waitMs = 8000, consent = 'Yes' } = {}) {
  if (sql && sql("select count(*) from app.legal_documents where published_at is not null and member_step <> 'none'") === '0') return false;
  const step = p.getByTestId('legal-step');
  if (!(await step.waitFor({ timeout: waitMs }).then(() => true, () => false))) return false;
  for (const cb of await step.getByRole('checkbox', { name: /I have read and accept/ }).all()) {
    if (!(await cb.isChecked().catch(() => false))) await cb.click();
  }
  for (const chip of await step.getByRole('checkbox', { name: consent, exact: true }).all()) {
    if (!(await chip.isChecked().catch(() => false))) await chip.click();
  }
  await step.getByRole('button', { name: /agree and continue/i }).click();
  await step.waitFor({ state: 'hidden', timeout: 20000 });
  return true;
}

module.exports = { acceptLegalStep };
