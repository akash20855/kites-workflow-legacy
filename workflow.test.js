const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./workflow.js');

const DAY = W.DAY_MS;
const T0 = '2026-10-01T10:00:00.000Z';

function sampleType() {
  return W.makeJobType('Wedding', '#e11d48', [
    W.makeTemplateTask('Send questionnaire', 'email', 'LEAD_CREATED', 2, { autoSend: true, emailTemplate: 'questionnaire' }),
    W.makeTemplateTask('Send contract', 'email', 'JOB_ACCEPTED', 1, { autoSend: false }),
    W.makeTemplateTask('Pre-shoot reminder', 'email', 'MAIN_SHOOT', -3, { autoSend: true, emailTemplate: 'reminder' }),
    W.makeTemplateTask('Book second shooter', 'extra_shoot', 'JOB_ACCEPTED', 0),
    W.makeTemplateTask('Edit photos', 'todo', 'MAIN_SHOOT', 14),
  ]);
}

test('new lead starts at LEAD_CREATED with that milestone dated', () => {
  const rec = W.createRecord({ name: 'Smith', shootDate: '2026-11-20T09:00:00.000Z', clientEmail: 'a@b.c' }, sampleType(), T0);
  assert.equal(rec.stage, 'LEAD_CREATED');
  assert.equal(rec.milestoneDates.LEAD_CREATED, T0);
  assert.equal(W.stageLabel(rec.stage), 'Lead');
});

test('milestone-anchored tasks wait for the milestone; shoot-anchored tasks use the scheduled shoot date', () => {
  const rec = W.createRecord({ name: 'Smith', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  const contract = rec.tasks.find((t) => t.title === 'Send contract');
  const edit = rec.tasks.find((t) => t.title === 'Edit photos');
  assert.equal(contract.dueDate, null);
  assert.equal(new Date(edit.dueDate).getTime(), new Date('2026-12-04T09:00:00.000Z').getTime());
  const q = rec.tasks.find((t) => t.title === 'Send questionnaire');
  assert.equal(new Date(q.dueDate).getTime(), new Date(T0).getTime() + 2 * DAY);
});

test('accepting a quote moves to JOB_ACCEPTED, creates invoices and recomputes due dates', () => {
  const rec = W.createRecord({ name: 'Smith', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  const q = W.makeQuote(rec, 'fixed', [{ label: 'Wedding package', price: 2000 }], { depositPercent: 30 });
  const T1 = '2026-10-05T10:00:00.000Z';
  W.acceptQuote(rec, q.id, T1);
  assert.equal(rec.stage, 'JOB_ACCEPTED');
  assert.equal(rec.invoices.length, 2);
  assert.equal(rec.invoices[0].amount, 600);
  assert.equal(rec.invoices[1].amount, 1400);
  assert.equal(W.balanceDue(rec), 2000);
  const contract = rec.tasks.find((t) => t.title === 'Send contract');
  assert.equal(new Date(contract.dueDate).getTime(), new Date(T1).getTime() + DAY);
});

test('stages never move backwards', () => {
  const rec = W.createRecord({ name: 'x' }, null, T0);
  W.markMilestoneManual(rec, 'JOB_COMPLETE', T0);
  W.markMilestoneManual(rec, 'JOB_ACCEPTED', T0);
  assert.equal(rec.stage, 'JOB_COMPLETE');
});

test('auto-send emails fire only when due, and manual-check tasks never auto-send', () => {
  const rec = W.createRecord({ name: 'Smith', clientEmail: 'a@b.c', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  // Questionnaire is due T0+2d.
  assert.equal(W.runAutomations(rec, new Date(new Date(T0).getTime() + DAY)), 0);
  assert.equal(W.runAutomations(rec, new Date(new Date(T0).getTime() + 2 * DAY)), 1);
  assert.equal(rec.emailLog[0].template, 'questionnaire');
  // Running again must not resend the questionnaire; only the shoot reminder is newly due.
  assert.equal(W.runAutomations(rec, new Date('2027-01-01T00:00:00Z')), 1);
  assert.equal(rec.emailLog.filter((e) => e.template === 'questionnaire').length, 1);
  assert.equal(W.runAutomations(rec, new Date('2027-06-01T00:00:00Z')), 0);
  // Contract task has autoSend=false, so it is never sent automatically.
  W.reachMilestone(rec, 'JOB_ACCEPTED', T0);
  W.runAutomations(rec, new Date('2027-01-01T00:00:00Z'));
  assert.ok(!rec.emailLog.some((e) => e.subject === 'Send contract'));
});

test('reminder before shoot is sent after shoot milestone sets its due date', () => {
  const rec = W.createRecord({ name: 'Smith', clientEmail: 'a@b.c', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  W.acceptQuote(rec, W.makeQuote(rec, 'fixed', [{ label: 'p', price: 100 }], {}).id, T0);
  // Reminder anchors to shoot date minus 3 days; not due before that.
  const reminder = rec.tasks.find((t) => t.title === 'Pre-shoot reminder');
  assert.equal(new Date(reminder.dueDate).getTime(), new Date('2026-11-17T09:00:00.000Z').getTime());
  W.runAutomations(rec, new Date('2026-11-16T00:00:00Z'));
  assert.ok(!rec.emailLog.some((e) => e.subject === 'Pre-shoot reminder'));
  W.runAutomations(rec, new Date('2026-11-17T10:00:00Z'));
  assert.ok(rec.emailLog.some((e) => e.subject === 'Pre-shoot reminder'));
});

test('clock moves an accepted job to MAIN_SHOOT on the shoot date', () => {
  const rec = W.createRecord({ name: 'Smith', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  W.acceptQuote(rec, W.makeQuote(rec, 'fixed', [{ label: 'p', price: 100 }], {}).id, T0);
  W.applyClock(rec, '2026-11-19T00:00:00Z');
  assert.equal(rec.stage, 'JOB_ACCEPTED');
  W.applyClock(rec, '2026-11-20T09:00:00Z');
  assert.equal(rec.stage, 'MAIN_SHOOT');
});

test('a lead without an accepted quote does not jump to MAIN_SHOOT on the clock', () => {
  const rec = W.createRecord({ name: 'Lead', shootDate: '2026-11-20T09:00:00.000Z' }, null, T0);
  W.applyClock(rec, '2026-12-01T00:00:00Z');
  assert.equal(rec.stage, 'LEAD_CREATED');
});

test('payments: partial payment keeps balance, any payment on an invoice accepts the job', () => {
  const rec = W.createRecord({ name: 'Smith' }, null, T0);
  const q = W.makeQuote(rec, 'pick_choose', [{ label: 'Gold', price: 1000 }], { depositPercent: 50 });
  // Quote not accepted yet, so no invoices exist. Accept to create them.
  W.acceptQuote(rec, q.id, T0);
  W.recordPayment(rec, 200, T0);
  assert.equal(W.amountPaid(rec), 200);
  assert.equal(W.balanceDue(rec), 800);
  assert.throws(() => W.recordPayment(rec, 0, T0), /positive/);
});

test('quote without autoInvoice does not create invoices but still accepts the job', () => {
  const rec = W.createRecord({ name: 'Smith' }, null, T0);
  const q = W.makeQuote(rec, 'fixed', [{ label: 'x', price: 50 }], { autoInvoice: false });
  W.acceptQuote(rec, q.id, T0);
  assert.equal(rec.invoices.length, 0);
  assert.equal(rec.stage, 'JOB_ACCEPTED');
});

test('backup round-trips and rejects foreign data', () => {
  const jt = sampleType();
  const rec = W.createRecord({ name: 'Smith' }, jt, T0);
  const json = W.exportData({ jobTypes: [jt], records: [rec] });
  const back = W.importData(json);
  assert.equal(back.records[0].name, 'Smith');
  assert.equal(back.jobTypes[0].name, 'Wedding');
  assert.throws(() => W.importData('{"foo":1}'), /valid/);
});

test('invalid milestone and task type are rejected', () => {
  assert.throws(() => W.makeTemplateTask('x', 'bogus', null, 0), /task type/);
  assert.throws(() => W.makeTemplateTask('x', 'todo', 'NOPE', 0), /milestone/);
});
