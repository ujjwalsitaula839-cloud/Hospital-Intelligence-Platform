import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import type { Bed, BedStatus, Department } from '../types';

export interface LayoutBed extends Bed {
  roomMeshColor: string;
}

export interface LayoutRoom {
  roomId: string;
  roomNumber: string;
  department: Department;
  floorNumber: number;
  status: BedStatus;
  roomMeshColor: string;
  beds: LayoutBed[];
  primaryBed: LayoutBed;
  patientName?: string | null;
  patientId?: number | null;
  admissionId?: number | null;
  diagnosis?: string | null;
  acuityLevel?: string | null;
  equipment?: string[];
}

export interface LayoutDepartment {
  name: Department;
  displayName: string;
  rooms: LayoutRoom[];
  totalBeds: number;
  availableBeds: number;
  occupiedBeds: number;
  dirtyBeds: number;
  cleaningBeds: number;
}

export interface LayoutFloor {
  floorNumber: number;
  floorName: string;
  shortCode: string;
  departments: LayoutDepartment[];
  rooms: LayoutRoom[];
  totalBeds: number;
  availableBeds: number;
  occupiedBeds: number;
  dirtyBeds: number;
  cleaningBeds: number;
}

export interface HospitalLayoutData {
  floors: LayoutFloor[];
  flatBeds: Bed[];
  flatRooms: LayoutRoom[];
  metrics: {
    totalBeds: number;
    availableBeds: number;
    occupiedBeds: number;
    dirtyBeds: number;
    cleaningBeds: number;
    occupancyRatePct: number;
  };
}

/**
 * Strict status-to-color mapping:
 * AVAILABLE -> Green (#22c55e)
 * OCCUPIED -> Red (#ef4444)
 * DIRTY -> Yellow (#eab308)
 * CLEANING / CLEANING_IN_PROGRESS -> Blue (#3b82f6)
 */
export function getBedStatusColor(status: BedStatus): string {
  switch (status) {
    case 'AVAILABLE':
      return '#22c55e'; // Green
    case 'OCCUPIED':
      return '#ef4444'; // Red
    case 'DIRTY':
      return '#eab308'; // Yellow
    case 'CLEANING_IN_PROGRESS':
      return '#3b82f6'; // Blue
    case 'RESERVED':
      return '#f97316'; // Orange / Hold
    case 'MAINTENANCE':
    default:
      return '#64748b'; // Neutral Slate
  }
}

const FLOOR_METADATA: Record<number, { name: string; short: string }> = {
  1: { name: 'Ground Floor · Emergency & Acute Triage', short: 'F1 · ED' },
  2: { name: 'Second Floor · Critical Care & Surgical Suites', short: 'F2 · ICU/OR' },
  3: { name: 'Third Floor · Inpatient Step-Down & Medical Ward', short: 'F3 · MED' },
};

const DEPT_NAMES: Record<Department, string> = {
  EMERGENCY: 'Emergency & Trauma',
  ICU: 'Intensive Care Unit (ICU)',
  SURGERY: 'Surgical Operative Suites',
  STEP_DOWN: 'Step-Down Telemetry Unit',
  GENERAL_WARD: 'General Medical Ward',
  PHARMACY: 'Clinical Pharmacy',
  HOUSEKEEPING: 'Housekeeping & Environmental',
  ADMINISTRATION: 'Administrative Operations',
};

export function transformBedsToLayout(rawBeds: Bed[]): HospitalLayoutData {
  const flatRoomsMap = new Map<string, LayoutRoom>();

  // 1. Group Beds into Rooms
  for (const b of rawBeds) {
    const floor = b.floor_number || 1;
    const roomKey = `F${floor}-${b.department}-${b.room_number}`;
    const bedWithColor: LayoutBed = {
      ...b,
      roomMeshColor: getBedStatusColor(b.status),
    };

    if (!flatRoomsMap.has(roomKey)) {
      flatRoomsMap.set(roomKey, {
        roomId: roomKey,
        roomNumber: b.room_number,
        department: b.department,
        floorNumber: floor,
        status: b.status,
        roomMeshColor: getBedStatusColor(b.status),
        beds: [bedWithColor],
        primaryBed: bedWithColor,
        patientName: b.patient_name,
        patientId: b.patient_id,
        admissionId: b.admission_id || b.encounter_id,
        diagnosis: b.primary_diagnosis,
        acuityLevel: b.acuity_level,
        equipment: b.equipment || [],
      });
    } else {
      const existing = flatRoomsMap.get(roomKey)!;
      existing.beds.push(bedWithColor);

      // Upgrade room status priority: OCCUPIED > DIRTY > CLEANING > RESERVED > AVAILABLE
      if (b.status === 'OCCUPIED') {
        existing.status = 'OCCUPIED';
        existing.roomMeshColor = getBedStatusColor('OCCUPIED');
        existing.primaryBed = bedWithColor;
        existing.patientName = b.patient_name;
        existing.patientId = b.patient_id;
        existing.admissionId = b.admission_id || b.encounter_id;
        existing.diagnosis = b.primary_diagnosis;
        existing.acuityLevel = b.acuity_level;
      } else if (existing.status !== 'OCCUPIED' && b.status === 'DIRTY') {
        existing.status = 'DIRTY';
        existing.roomMeshColor = getBedStatusColor('DIRTY');
      } else if (existing.status !== 'OCCUPIED' && existing.status !== 'DIRTY' && b.status === 'CLEANING_IN_PROGRESS') {
        existing.status = 'CLEANING_IN_PROGRESS';
        existing.roomMeshColor = getBedStatusColor('CLEANING_IN_PROGRESS');
      }
      if (b.equipment && b.equipment.length > 0) {
        existing.equipment = Array.from(new Set([...(existing.equipment || []), ...b.equipment]));
      }
    }
  }

  const allRooms = Array.from(flatRoomsMap.values());

  // 2. Group into Floors -> Departments -> Rooms -> Beds
  const floorNumbers = [1, 2, 3];
  const floors: LayoutFloor[] = floorNumbers.map((flNum) => {
    const floorRooms = allRooms.filter((r) => r.floorNumber === flNum);
    const floorBeds = rawBeds.filter((b) => (b.floor_number || 1) === flNum);

    // Group floor rooms into departments
    const deptMap = new Map<Department, LayoutRoom[]>();
    for (const room of floorRooms) {
      if (!deptMap.has(room.department)) {
        deptMap.set(room.department, []);
      }
      deptMap.get(room.department)!.push(room);
    }

    const departments: LayoutDepartment[] = Array.from(deptMap.entries()).map(([deptName, rooms]) => {
      const deptBeds = floorBeds.filter((b) => b.department === deptName);
      return {
        name: deptName,
        displayName: DEPT_NAMES[deptName] || deptName,
        rooms,
        totalBeds: deptBeds.length,
        availableBeds: deptBeds.filter((b) => b.status === 'AVAILABLE').length,
        occupiedBeds: deptBeds.filter((b) => b.status === 'OCCUPIED').length,
        dirtyBeds: deptBeds.filter((b) => b.status === 'DIRTY').length,
        cleaningBeds: deptBeds.filter((b) => b.status === 'CLEANING_IN_PROGRESS').length,
      };
    });

    const meta = FLOOR_METADATA[flNum] || { name: `Floor ${flNum}`, short: `F${flNum}` };

    return {
      floorNumber: flNum,
      floorName: meta.name,
      shortCode: meta.short,
      departments,
      rooms: floorRooms,
      totalBeds: floorBeds.length,
      availableBeds: floorBeds.filter((b) => b.status === 'AVAILABLE').length,
      occupiedBeds: floorBeds.filter((b) => b.status === 'OCCUPIED').length,
      dirtyBeds: floorBeds.filter((b) => b.status === 'DIRTY').length,
      cleaningBeds: floorBeds.filter((b) => b.status === 'CLEANING_IN_PROGRESS').length,
    };
  });

  const totalBeds = rawBeds.length;
  const availableBeds = rawBeds.filter((b) => b.status === 'AVAILABLE').length;
  const occupiedBeds = rawBeds.filter((b) => b.status === 'OCCUPIED').length;
  const dirtyBeds = rawBeds.filter((b) => b.status === 'DIRTY').length;
  const cleaningBeds = rawBeds.filter((b) => b.status === 'CLEANING_IN_PROGRESS').length;
  const occupancyRatePct = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  return {
    floors,
    flatBeds: rawBeds,
    flatRooms: allRooms,
    metrics: {
      totalBeds,
      availableBeds,
      occupiedBeds,
      dirtyBeds,
      cleaningBeds,
      occupancyRatePct,
    },
  };
}

export function useHospitalLayout() {
  const [data, setData] = useState<HospitalLayoutData>(() => transformBedsToLayout([]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchBeds = useCallback(async () => {
    try {
      const beds = await api.getBeds();
      setData(transformBedsToLayout(beds));
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch hospital layout.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    fetchBeds();

    // Setup live WebSocket sync if token exists
    const token = sessionStorage.getItem('token');
    if (token) {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.host;
      const wsUrl = `${wsProtocol}//${wsHost}/ws/beds?token=${encodeURIComponent(token)}`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = () => {
          if (isMounted) {
            fetchBeds();
          }
        };

        ws.onerror = () => {
          // Fall back gracefully to background polling if WebSocket closes
        };
      } catch {
        // Fallback
      }
    }

    // Gentle 10-second polling heartbeat to ensure synchronization
    const pollInterval = setInterval(() => {
      if (isMounted) {
        fetchBeds();
      }
    }, 10000);

    // Immediate sync listeners
    const handleSync = () => {
      if (isMounted) fetchBeds();
    };
    window.addEventListener('hip:bed-updated', handleSync);
    window.addEventListener('hip:state-sync', handleSync);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      window.removeEventListener('hip:bed-updated', handleSync);
      window.removeEventListener('hip:state-sync', handleSync);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [fetchBeds]);

  return {
    floors: data.floors,
    flatBeds: data.flatBeds,
    flatRooms: data.flatRooms,
    metrics: data.metrics,
    loading,
    error,
    refresh: fetchBeds,
  };
}
