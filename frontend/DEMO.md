# HIP mentor demo

A frontend-only simulation with fictional patients. It does not authenticate users, contact the backend, persist patient records, or synchronize across devices. Refreshing resets the session. The six-month retention policy belongs to the future backend implementation.

## Run locally

Use Node.js 22.13 or later (24 LTS recommended). Run `npm ci`, then `npm run dev` in this directory. Open the local address printed by Vite. `npm run build` creates the production frontend in `dist`.

## Five-minute presentation

1. The demo opens as Charge Nurse. Explain the incoming queue, preparation gaps, and bed availability.
2. Open Robert Ellis. Acknowledge the report, select an available bed, and assign Alex Rivera.
3. Switch to Nurse. Open Robert and complete the cardiac monitor task.
4. Switch to Charge Nurse. Confirm room readiness, confirm arrival, and accept the handoff.
5. Switch to Doctor. Add a resource task or enter a reason for a clinical reassessment override. Observe the activity record.
6. Switch to EMS. Submit a fictional report and update its ETA. Switch to Charge Nurse to see the same report awaiting acknowledgment.
7. Toggle Simulation live to demonstrate manual mode. Changes are disabled until reconnection; notes can record manually coordinated events afterward.
8. Discharge an in-care patient as Charge Nurse. The bed enters turnover; confirm readiness from Bed board.
9. Use Reset demo in the sidebar to repeat. The profile button opens the demo account entry screen.

## Scope boundaries

Role controls demonstrate intended workflows, not backend security. Acuity is manually supplied and not clinical decision support. Bed movement after arrival, persistent alerts, shift acceptance, duplicate transport detection, actual offline synchronization, and EHR integration are not implemented. New reports are submitted once per modal submission; this is not server-side idempotency. Manual mode is a user-controlled demonstration, not actual connectivity detection. ETA remains at its simulated value until edited.
