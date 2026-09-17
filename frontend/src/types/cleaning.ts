export type CleaningStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED';

export interface CleaningTask {
    cleaning_id: number;
    bed_id: number;
    bed_code: string;
    department: string;
    room_number: string;
    status: CleaningStatus;
    personnel_id?: number | null;
    requested_datetime: string;
    started_datetime?: string | null;
    completed_datetime?: string | null;
    requested_at?: string;
    started_at?: string | null;
    completed_at?: string | null;
    disinfection_notes?: string | null;
}

export interface CleaningTasksResponse {
    tasks: CleaningTask[];
}
