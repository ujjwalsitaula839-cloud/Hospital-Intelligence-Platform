export type AcuityLevel = 'ESI_1' | 'ESI_2' | 'ESI_3' | 'ESI_4' | 'ESI_5';

export interface InboundEMSUnit {
    id: string;
    unit_code: string;           // e.g., "MEDIC-42"
    eta_minutes: number;         // Initial radio ETA
    arrival_timestamp: number;   // Epoch ms target for countdown timers
    acuity: AcuityLevel;         // ESI-1 (Resuscitation) down to ESI-5 (Non-urgent)
    chief_complaint: string;     // e.g., "Acute Anterolateral STEMI"
    vitals: {
        bp?: string;
        hr?: number;
        spo2?: number;
    };
    equipment_needed: string[];  // e.g., ['Ventilator', 'Crash Cart']
    recommended_bed_code?: string;
    status: 'INBOUND' | 'ACCEPTED' | 'ARRIVED' | 'CANCELLED';
}

export interface BedRecommendation {
    bed_code: string;
    confidence_score: number;    // e.g., 0.94
    match_reasons: string[];
    equipment_satisfied: boolean;
}