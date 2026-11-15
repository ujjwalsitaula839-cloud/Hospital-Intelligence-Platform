import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import { useDialog } from '../hooks/useDialog';

function NestedDialogHarness() {
  const [chartOpen, setChartOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);

  const chartRef = useDialog<HTMLDivElement>(chartOpen, () => setChartOpen(false));
  const handoffRef = useDialog<HTMLDivElement>(handoffOpen, () => setHandoffOpen(false));

  return (
    <div>
      <button type="button" data-testid="page-background-button">
        Page Background Action
      </button>
      <button type="button" data-testid="open-chart-button" onClick={() => setChartOpen(true)}>
        Open Patient Chart
      </button>

      {chartOpen && (
        <div
          ref={chartRef}
          role="dialog"
          aria-modal="true"
          aria-label="Patient EHR Chart"
          tabIndex={-1}
          data-testid="chart-dialog"
        >
          <h2>Patient EHR Chart: Jane Doe</h2>
          <button type="button" data-testid="chart-action-button">
            View Lab Results
          </button>
          <button
            type="button"
            data-testid="open-handoff-from-chart"
            onClick={() => setHandoffOpen(true)}
          >
            Open Shift Handoff
          </button>
          <button type="button" data-testid="close-chart-button" onClick={() => setChartOpen(false)}>
            Close Chart
          </button>
        </div>
      )}

      {handoffOpen && (
        <div
          ref={handoffRef}
          role="dialog"
          aria-modal="true"
          aria-label="Clinical Shift Handoff"
          tabIndex={-1}
          data-testid="handoff-dialog"
        >
          <h2>Shift Handoff (I-PASS)</h2>
          <input data-testid="handoff-nurse-input" placeholder="Select Oncoming Nurse" />
          <button type="button" data-testid="confirm-handoff-button">
            Confirm Handover
          </button>
          <button
            type="button"
            data-testid="cancel-handoff-button"
            onClick={() => setHandoffOpen(false)}
          >
            Cancel Handoff
          </button>
        </div>
      )}
    </div>
  );
}

describe('Nested Dialog Keyboard Handling (useDialog)', () => {
  it('manages nested dialog focus, focus trap, escape key, and focus restoration without jumping behind parent', async () => {
    render(<NestedDialogHarness />);

    // 1. Initial page state
    const openChartBtn = screen.getByTestId('open-chart-button');
    openChartBtn.focus();
    expect(document.activeElement).toBe(openChartBtn);

    // 2. Open Patient Chart (Parent Dialog)
    fireEvent.click(openChartBtn);
    const chartDialog = screen.getByTestId('chart-dialog');
    expect(chartDialog).toBeInTheDocument();
    // Focus moves into chart dialog
    const chartFirstBtn = screen.getByTestId('chart-action-button');
    expect(document.activeElement).toBe(chartFirstBtn);

    // 3. Open Shift Handoff (Child / Nested Dialog) from within the Chart Dialog
    const openHandoffBtn = screen.getByTestId('open-handoff-from-chart');
    openHandoffBtn.focus();
    fireEvent.click(openHandoffBtn);

    const handoffDialog = screen.getByTestId('handoff-dialog');
    expect(handoffDialog).toBeInTheDocument();

    // Focus moves into handoff dialog (topmost dialog)
    const handoffInput = screen.getByTestId('handoff-nurse-input');
    const cancelHandoffBtn = screen.getByTestId('cancel-handoff-button');
    expect(document.activeElement).toBe(handoffInput);

    // 4. Tab and Shift+Tab stay strictly within the topmost handoff dialog
    // Tab from last element wraps to first
    cancelHandoffBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(handoffInput);

    // Shift+Tab from first element wraps to last
    handoffInput.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancelHandoffBtn);

    // None of the chart dialog elements received focus while handoff dialog was top
    expect(chartDialog.contains(document.activeElement)).toBe(false);

    // 5. Escape closes ONLY the topmost dialog (Shift Handoff), leaving Patient Chart open
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('handoff-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('chart-dialog')).toBeInTheDocument();

    // 6. Focus restoration returns to the opener in the parent dialog, NOT jumping to page background
    expect(document.activeElement).toBe(openHandoffBtn);
    expect(document.activeElement).not.toBe(openChartBtn);
    expect(document.activeElement).not.toBe(screen.getByTestId('page-background-button'));

    // 7. After handoff closes, the chart's focus trap works again
    const closeChartBtn = screen.getByTestId('close-chart-button');
    closeChartBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(chartFirstBtn);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(closeChartBtn);

    // 8. Pressing Escape now closes the chart dialog
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('chart-dialog')).not.toBeInTheDocument();

    // Focus returns to the original opener on the page
    expect(document.activeElement).toBe(openChartBtn);
  });
});
