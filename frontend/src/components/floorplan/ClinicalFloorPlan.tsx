import React, { useState } from 'react';
import { useHospitalLayout, getBedStatusColor } from '../../hooks/useHospitalLayout';
import type { Bed } from '../../types';

interface ClinicalFloorPlanProps {
  onSelectBed: (bed: Bed) => void;
  selectedBedCode?: string | null;
}

export default function ClinicalFloorPlan({ onSelectBed, selectedBedCode }: ClinicalFloorPlanProps): React.ReactElement {
  const { floors, flatBeds, loading, error, refresh } = useHospitalLayout();
  const [selectedFloorNum, setSelectedFloorNum] = useState<number>(1);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const currentFloor = floors.find((f) => f.floorNumber === selectedFloorNum) || floors[0];

  const filteredRooms = currentFloor?.rooms.filter((room) => {
    if (statusFilter === 'ALL') return true;
    return room.status === statusFilter;
  }) || [];

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-sm overflow-hidden flex flex-col">
      {/* Top Header & Floor Switcher */}
      <div className="p-4 bg-zinc-900/90 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
              Interactive 3D Floor Plan
            </h2>
          </div>
          <span className="text-[11px] font-mono text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded-xs border border-zinc-700/60">
            PostgreSQL Live Sync
          </span>
        </div>

        {/* Floor Switcher Buttons */}
        <div className="flex items-center gap-1.5 bg-zinc-950 p-1 border border-zinc-800 rounded-xs font-mono text-xs">
          {floors.map((fl) => (
            <button
              key={fl.floorNumber}
              type="button"
              onClick={() => setSelectedFloorNum(fl.floorNumber)}
              className={`px-3 py-1.5 rounded-xs font-bold transition-all ${
                selectedFloorNum === fl.floorNumber
                  ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
              }`}
            >
              Floor {fl.floorNumber}
            </button>
          ))}
        </div>

        {/* Action button */}
        <button
          type="button"
          onClick={() => refresh()}
          className="text-xs font-mono text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 transition-colors"
        >
          ↻ Refresh Layout
        </button>
      </div>

      {/* Live Floor Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 border-b border-zinc-800 bg-zinc-950/70 font-mono text-xs divide-x divide-zinc-800">
        <div className="p-3 text-center">
          <span className="text-[10px] uppercase text-zinc-400 block">Total Beds</span>
          <span className="text-lg font-bold text-white">{currentFloor?.totalBeds || 0}</span>
        </div>
        <div className="p-3 text-center">
          <span className="text-[10px] uppercase text-emerald-400 block">Available (Green)</span>
          <span className="text-lg font-bold text-emerald-400">{currentFloor?.availableBeds || 0}</span>
        </div>
        <div className="p-3 text-center">
          <span className="text-[10px] uppercase text-red-400 block">Occupied (Red)</span>
          <span className="text-lg font-bold text-red-400">{currentFloor?.occupiedBeds || 0}</span>
        </div>
        <div className="p-3 text-center">
          <span className="text-[10px] uppercase text-yellow-400 block">Dirty (Yellow)</span>
          <span className="text-lg font-bold text-yellow-400">{currentFloor?.dirtyBeds || 0}</span>
        </div>
        <div className="p-3 text-center col-span-2 sm:col-span-1 border-t sm:border-t-0 border-zinc-800">
          <span className="text-[10px] uppercase text-blue-400 block">Cleaning (Blue)</span>
          <span className="text-lg font-bold text-blue-400">{currentFloor?.cleaningBeds || 0}</span>
        </div>
      </div>

      {/* Status Filter Bar */}
      <div className="px-4 py-2.5 bg-zinc-900/40 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="text-zinc-400 uppercase text-[10px] tracking-wider">Filter Rooms:</span>
          <div className="flex flex-wrap gap-1">
            {(['ALL', 'AVAILABLE', 'OCCUPIED', 'DIRTY', 'CLEANING_IN_PROGRESS'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2 py-0.5 text-[11px] rounded-xs border transition-colors ${
                  statusFilter === st
                    ? 'border-white bg-zinc-800 text-white font-bold'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                {st === 'ALL' ? 'All Spaces' : st.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <span className="text-[11px] text-zinc-400">
          Viewing: <strong className="text-zinc-200">{currentFloor?.floorName}</strong>
        </span>
      </div>

      {/* Main Floor Plan Interactive Canvas / Grid */}
      <div className="p-6 bg-radial from-zinc-900/60 to-zinc-950 min-h-[460px] flex flex-col justify-start">
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center text-zinc-400 font-mono text-xs">
            <span className="animate-spin text-lg mb-2">↻</span>
            Loading floor layout & live census telemetry...
          </div>
        ) : error ? (
          <div className="p-4 bg-red-950/60 border border-red-800 text-red-300 font-mono text-xs">
            Error loading layout: {error}
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-zinc-500 font-mono text-xs border border-dashed border-zinc-800 rounded-sm">
            No rooms match filter "{statusFilter}" on Floor {selectedFloorNum}.
          </div>
        ) : (
          <div className="space-y-6">
            {currentFloor?.departments.map((dept) => {
              const deptRooms = filteredRooms.filter((r) => r.department === dept.name);
              if (deptRooms.length === 0) return null;

              return (
                <div key={dept.name} className="border border-zinc-800/80 bg-zinc-950/80 rounded-sm p-4">
                  {/* Department Subheader */}
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-800/70">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-cyan-500" />
                      <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                        {dept.displayName}
                      </h3>
                      <span className="text-[10px] font-mono text-zinc-500">
                        ({deptRooms.length} {deptRooms.length === 1 ? 'room' : 'rooms'})
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400">
                      <span>Open: <strong className="text-emerald-400">{dept.availableBeds}</strong></span>
                      <span>Occupied: <strong className="text-red-400">{dept.occupiedBeds}</strong></span>
                    </div>
                  </div>

                  {/* Room Cards / 3D Layout Tiles */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {deptRooms.map((room) => {
                      const primaryBed = room.primaryBed;
                      const isSelected = selectedBedCode && primaryBed.bed_code.toUpperCase() === selectedBedCode.toUpperCase();
                      const statusColor = getBedStatusColor(room.status);

                      return (
                        <div
                          key={room.roomId}
                          onClick={() => onSelectBed(primaryBed)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') onSelectBed(primaryBed);
                          }}
                          className={`relative text-left p-3.5 rounded-xs border transition-all cursor-pointer select-none group ${
                            isSelected
                              ? 'border-white bg-zinc-800/90 shadow-lg ring-1 ring-white/50'
                              : 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/70 hover:border-zinc-700'
                          }`}
                          style={{
                            borderLeftWidth: '4px',
                            borderLeftColor: statusColor,
                          }}
                        >
                          {/* Room Header & Status Dot */}
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-mono font-bold text-white group-hover:text-cyan-300 transition-colors">
                              Room {room.roomNumber} · {primaryBed.bed_code}
                            </span>
                            <span
                              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-xs uppercase tracking-wider"
                              style={{
                                color: statusColor,
                                backgroundColor: `${statusColor}18`,
                                border: `1px solid ${statusColor}40`,
                              }}
                            >
                              {room.status.replace('_', ' ')}
                            </span>
                          </div>

                          {/* Patient or Bed Info */}
                          {room.status === 'OCCUPIED' && room.patientName ? (
                            <div className="space-y-0.5 text-xs font-mono">
                              <div className="text-zinc-200 font-bold truncate">
                                👤 {room.patientName}
                              </div>
                              {room.diagnosis && (
                                <div className="text-[11px] text-zinc-400 truncate">
                                  Dx: {room.diagnosis}
                                </div>
                              )}
                              {room.acuityLevel && (
                                <div className="text-[10px] text-red-400 font-bold">
                                  {room.acuityLevel.replace('_', ' ')}
                                </div>
                              )}
                            </div>
                          ) : room.status === 'AVAILABLE' ? (
                            <div className="text-[11px] font-mono text-emerald-400/90 pt-1 flex items-center gap-1">
                              <span>✓ Ready for Immediate Admission</span>
                            </div>
                          ) : room.status === 'DIRTY' ? (
                            <div className="text-[11px] font-mono text-yellow-400/90 pt-1 flex items-center gap-1">
                              <span>⚠ Pending Environmental Disinfection</span>
                            </div>
                          ) : room.status === 'CLEANING_IN_PROGRESS' ? (
                            <div className="text-[11px] font-mono text-blue-400/90 pt-1 flex items-center gap-1">
                              <span className="animate-pulse">⏳ Sanitization in Progress</span>
                            </div>
                          ) : (
                            <div className="text-[11px] font-mono text-zinc-400 pt-1">
                              Bed Type: {primaryBed.bed_type}
                            </div>
                          )}

                          {/* Equipment Tags */}
                          {room.equipment && room.equipment.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-zinc-800/80 flex flex-wrap gap-1">
                              {room.equipment.map((eq, i) => (
                                <span
                                  key={i}
                                  className="text-[9px] font-mono bg-zinc-950 text-cyan-300 border border-zinc-800 px-1 py-0.2 rounded-xs"
                                >
                                  ⚙ {eq}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Hover action prompt */}
                          <div className="mt-2 text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300 transition-colors flex items-center justify-between">
                            <span>Click to inspect</span>
                            <span>→</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend Footer */}
      <div className="p-3 bg-zinc-900/90 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[10px] uppercase text-zinc-400 tracking-wider">Status Key:</span>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-zinc-300 text-[11px]">AVAILABLE</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <span className="text-zinc-300 text-[11px]">OCCUPIED</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
            <span className="text-zinc-300 text-[11px]">DIRTY</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
            <span className="text-zinc-300 text-[11px]">CLEANING</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
            <span className="text-zinc-300 text-[11px]">RESERVED</span>
          </div>
        </div>

        <div className="text-[11px] text-zinc-400">
          Total Live Registry: <strong className="text-white">{flatBeds.length} Beds</strong> across 3 Floors
        </div>
      </div>
    </div>
  );
}
