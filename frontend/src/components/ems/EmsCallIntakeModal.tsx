import React from 'react';
import EmsIntakeForm from './EmsIntakeForm';
import type { Admission, Patient } from '../../types';

interface EmsCallIntakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: {
    patient: Patient;
    admission: Admission;
  }) => void;
}

export default function EmsCallIntakeModal({
  isOpen,
  onClose,
  onSuccess,
}: EmsCallIntakeModalProps): React.ReactElement | null {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-label="Close EMS Call Intake Modal"
      />

      {/* Modal Dialog Card */}
      <div className="relative z-10 w-full max-w-4xl bg-zinc-950 border border-zinc-700/80 shadow-2xl rounded-2xl overflow-hidden max-h-[92vh] flex flex-col my-auto animate-fadeIn">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/90">
          <div className="flex items-center space-x-3">
            <span className="p-2 bg-red-950/70 border border-red-800/80 text-red-300 rounded-lg text-base">
              📞
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-normal">
                EMS Radio Patch & Inbound Call Intake
              </h2>
              <p className="text-xs text-zinc-400">
                Emergency dispatch intake workspace · Form resets immediately upon submission
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-sm px-2.5 py-1 rounded-md hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto flex-1">
          <EmsIntakeForm
            isModal={true}
            onCancel={onClose}
            onSuccess={onSuccess}
          />
        </div>
      </div>
    </div>
  );
}
