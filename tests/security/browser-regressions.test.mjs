// Executes actual browser store modules with synthetic storage only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function browserModule(relativePath) {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const context = vm.createContext({
    localStorage: storage,
    window: { localStorage: storage, dispatchEvent() {} },
    CustomEvent: class { constructor(type, options) { Object.assign(this, { type, ...options }); } },
  });
  const source = await readFile(new URL(`../../frontend/src/dashboard/${relativePath}`, import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => { throw new Error('Unexpected external module dependency'); });
  await module.evaluate();
  return { api: module.namespace, values };
}

test('F05: census snapshots do not persist patient names or diagnoses', async () => {
  const { api, values } = await browserModule('snapshot.js');
  api.saveSnapshot({ census: { rooms: [{ id: 'TEST-1', patient: 'SYNTHETIC_PHI_MARKER', diagnosis: 'SYNTHETIC_DIAGNOSIS_MARKER' }] } });
  assert.ok(![...values.values()].some(value => value.includes('SYNTHETIC_PHI_MARKER') || value.includes('SYNTHETIC_DIAGNOSIS_MARKER')), 'F05: PHI was persisted in localStorage');
});

test('F05: EMS intake does not persist clinical data in localStorage', async () => {
  const { api, values } = await browserModule('emsService.js');
  api.createEmsRun({ patientName: 'SYNTHETIC_PHI_MARKER', complaint: 'SYNTHETIC_COMPLAINT_MARKER' });
  assert.ok(![...values.values()].some(value => value.includes('SYNTHETIC_PHI_MARKER') || value.includes('SYNTHETIC_COMPLAINT_MARKER')), 'F05: clinical intake was persisted in localStorage');
});

test('F23: zero capacity must remain zero in copilot responses', async () => {
  const { api } = await browserModule('emsService.js');
  const answer = api.queryClinicalCopilot('bed capacity', [
    { department: 'EMERGENCY', status: 'OCCUPIED' },
    { department: 'ICU', status: 'OCCUPIED' },
  ]);
  assert.match(answer, /Emergency Department has 0 available beds/);
  assert.match(answer, /ICU\) has 0 available beds/);
});
