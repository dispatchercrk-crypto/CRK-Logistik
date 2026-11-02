import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Award,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  Download,
  Scale,
  Truck,
} from 'lucide-react';
import {
  Assignment,
  DriverExpense,
  DriverMaster,
  FleetCardMaster,
  VehicleMaster,
  isCompletedTaskStatus,
  TaskStatus,
} from '../types';
import {
  calculateTripDurationMinutes,
  evaluateActiveUnitsCbmSummary,
  evaluateAssignmentLoadUtilization,
  evaluateAssignmentOtd,
  formatCbmValue,
  formatDurationMinutes,
  formatWeightKg,
  parseLoadMeasurement,
} from '../utils/media';
import {
  ExpensePdfPeriodMode,
  downloadFleetCardExpensePdfReport,
  filterDriverExpensesForPdf,
} from '../utils/expensePdfReport';

const PIE_COLORS = [
  '#0f172a',
  '#0284c7',
  '#059669',
  '#d97706',
  '#475569',
  '#0d9488',
  '#2563eb',
];

export interface DriverPerformanceRow {
  driverId: string;
  driverName: string;
  totalTasks: number;
  completedDeliveries: number;
  onTimeDeliveries: number;
  pendingTasks: number;
  avgDurationMinutes: number | null;
  completionRate: number;
  onTimeRate: number | null;
}

export interface OnTimeSchedulePoint {
  tanggalLabel: string;
  tepatWaktu: number;
  terlambat: number;
  aktifDalamJadwal: number;
  aktifLewatJadwal: number;
}

export function useOnTimeDeliveryStats(assignments: Assignment[]) {
  return useMemo(() => {
    const nowMs = Date.now();
    let onTimeCompleted = 0;
    let lateCompleted = 0;
    let onTrackActive = 0;
    let overdueActive = 0;
    let lateMinutesSum = 0;
    let lateMinutesCount = 0;

    const byDate = new Map<
      string,
      {
        tanggalRaw: string;
        tepatWaktu: number;
        terlambat: number;
        aktifDalamJadwal: number;
        aktifLewatJadwal: number;
      }
    >();

    for (const asg of assignments) {
      const ev = evaluateAssignmentOtd(asg, nowMs);
      const dateKey = (asg.tanggalTugas || 'Tanpa Jadwal').trim();
      const bucket = byDate.get(dateKey) || {
        tanggalRaw: dateKey,
        tepatWaktu: 0,
        terlambat: 0,
        aktifDalamJadwal: 0,
        aktifLewatJadwal: 0,
      };

      if (ev.category === 'ON_TIME') {
        onTimeCompleted += 1;
        bucket.tepatWaktu += 1;
      } else if (ev.category === 'LATE_COMPLETED') {
        lateCompleted += 1;
        bucket.terlambat += 1;
        if (ev.delayMinutes > 0) {
          lateMinutesSum += ev.delayMinutes;
          lateMinutesCount += 1;
        }
      } else if (ev.category === 'OVERDUE_ACTIVE') {
        overdueActive += 1;
        bucket.aktifLewatJadwal += 1;
      } else if (ev.category === 'ON_TRACK_ACTIVE') {
        onTrackActive += 1;
        bucket.aktifDalamJadwal += 1;
      }

      if (asg.tanggalTugas) {
        byDate.set(dateKey, bucket);
      }
    }

    const totalCompleted = onTimeCompleted + lateCompleted;
    const totalScheduled =
      onTimeCompleted + lateCompleted + onTrackActive + overdueActive;

    const onTimeDeliveryRate =
      totalCompleted > 0
        ? Math.round((onTimeCompleted / totalCompleted) * 1000) / 10
        : null;

    const overallScheduleAdherence =
      totalScheduled > 0
        ? Math.round(
            ((onTimeCompleted + onTrackActive) / totalScheduled) * 1000
          ) / 10
        : null;

    const avgLateMinutes =
      lateMinutesCount > 0
        ? Math.round(lateMinutesSum / lateMinutesCount)
        : null;

    const timelineData: OnTimeSchedulePoint[] = Array.from(byDate.values())
      .sort((a, b) => a.tanggalRaw.localeCompare(b.tanggalRaw))
      .slice(-7)
      .map((item) => {
        const shortLabel =
          item.tanggalRaw.length >= 10
            ? item.tanggalRaw.slice(5)
            : item.tanggalRaw;
        return {
          tanggalLabel: shortLabel,
          tepatWaktu: item.tepatWaktu,
          terlambat: item.terlambat,
          aktifDalamJadwal: item.aktifDalamJadwal,
          aktifLewatJadwal: item.aktifLewatJadwal,
        };
      });

    return {
      onTimeCompleted,
      lateCompleted,
      onTrackActive,
      overdueActive,
      totalCompleted,
      totalScheduled,
      onTimeDeliveryRate,
      overallScheduleAdherence,
      avgLateMinutes,
      timelineData,
    };
  }, [assignments]);
}

export function useDriverPerformanceStats(
  assignments: Assignment[],
  drivers: DriverMaster[]
): {
  completedCount: number;
  pendingCount: number;
  waitingCount: number;
  inTransitCount: number;
  overallAvgMinutes: number | null;
  performanceRows: DriverPerformanceRow[];
} {
  return useMemo(() => {
    const nowMs = Date.now();
    let completedCount = 0;
    let waitingCount = 0;
    let inTransitCount = 0;

    let totalDurationSum = 0;
    let totalDurationTrips = 0;

    const map = new Map<
      string,
      {
        driverId: string;
        driverName: string;
        totalTasks: number;
        completedDeliveries: number;
        onTimeDeliveries: number;
        pendingTasks: number;
        durationSum: number;
        durationCount: number;
      }
    >();

    for (const d of drivers) {
      map.set(d.id.toUpperCase(), {
        driverId: d.id.toUpperCase(),
        driverName: d.name,
        totalTasks: 0,
        completedDeliveries: 0,
        onTimeDeliveries: 0,
        pendingTasks: 0,
        durationSum: 0,
        durationCount: 0,
      });
    }

    for (const asg of assignments) {
      if (isCompletedTaskStatus(asg.status)) {
        completedCount++;
      } else if (asg.status === TaskStatus.MENUNGGU_BERANGKAT) {
        waitingCount++;
      } else {
        inTransitCount++;
      }

      const key = (asg.driverId || asg.driverName || 'UNKNOWN')
        .trim()
        .toUpperCase();
      const existing = map.get(key) || {
        driverId: asg.driverId || '-',
        driverName: asg.driverName || 'Driver',
        totalTasks: 0,
        completedDeliveries: 0,
        onTimeDeliveries: 0,
        pendingTasks: 0,
        durationSum: 0,
        durationCount: 0,
      };

      existing.totalTasks += 1;
      if (isCompletedTaskStatus(asg.status)) {
        existing.completedDeliveries += 1;
        const otd = evaluateAssignmentOtd(asg, nowMs);
        if (otd.category === 'ON_TIME') {
          existing.onTimeDeliveries += 1;
        }
        const mins = calculateTripDurationMinutes(
          asg.departureData?.timestamp,
          asg.handoverData?.timestamp || asg.deliveredAt
        );
        if (mins !== null) {
          existing.durationSum += mins;
          existing.durationCount += 1;
          totalDurationSum += mins;
          totalDurationTrips += 1;
        }
      } else {
        existing.pendingTasks += 1;
      }

      map.set(key, existing);
    }

    const performanceRows: DriverPerformanceRow[] = Array.from(map.values())
      .map((item) => ({
        driverId: item.driverId,
        driverName: item.driverName,
        totalTasks: item.totalTasks,
        completedDeliveries: item.completedDeliveries,
        onTimeDeliveries: item.onTimeDeliveries,
        pendingTasks: item.pendingTasks,
        avgDurationMinutes:
          item.durationCount > 0
            ? Math.round(item.durationSum / item.durationCount)
            : null,
        completionRate:
          item.totalTasks > 0
            ? Math.round((item.completedDeliveries / item.totalTasks) * 100)
            : 0,
        onTimeRate:
          item.completedDeliveries > 0
            ? Math.round(
                (item.onTimeDeliveries / item.completedDeliveries) * 100
              )
            : null,
      }))
      .sort((a, b) => {
        if (b.completedDeliveries !== a.completedDeliveries) {
          return b.completedDeliveries - a.completedDeliveries;
        }
        return b.totalTasks - a.totalTasks;
      });

    return {
      completedCount,
      pendingCount: waitingCount + inTransitCount,
      waitingCount,
      inTransitCount,
      overallAvgMinutes:
        totalDurationTrips > 0
          ? Math.round(totalDurationSum / totalDurationTrips)
          : null,
      performanceRows,
    };
  }, [assignments, drivers]);
}

export interface LoadUtilizationChartItem {
  label: string;
  fullLabel: string;
  utilitas: number;
  loadDisplay: string;
  capacityDisplay: string;
  color: string;
}

export interface PeriodLoadChartItem {
  periodKey: string;
  label: string;
  fullPeriodLabel: string;
  totalKg: number;
  tripCount: number;
  avgUtilPct: number | null;
}

export interface DailyVehicleLoadRow {
  dateKey: string;
  label: string;
  fullDateLabel: string;
  totalKg: number;
  tripCount: number;
  byVehicle: Record<string, number>;
  tripsByVehicle: Record<string, number>;
  [plateKey: string]: string | number | Record<string, number>;
}

const VEHICLE_BAR_PALETTE = [
  '#0f172a',
  '#0284c7',
  '#059669',
  '#d97706',
  '#2563eb',
  '#0d9488',
  '#475569',
  '#b45309',
  '#7c3aed',
  '#be123c',
];

const SHORT_MONTHS_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

const FULL_MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

function parseAssignmentDate(rawTanggal?: string, fallbackIso?: string): Date | null {
  const trimmed = String(rawTanggal || '').trim();
  if (trimmed) {
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      const d = new Date(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3])
      );
      if (!Number.isNaN(d.getTime())) return d;
    }
    const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (dmyMatch) {
      const d = new Date(
        Number(dmyMatch[3]),
        Number(dmyMatch[2]) - 1,
        Number(dmyMatch[1])
      );
      if (!Number.isNaN(d.getTime())) return d;
    }
    const generic = new Date(trimmed);
    if (!Number.isNaN(generic.getTime())) return generic;
  }
  if (fallbackIso) {
    const fb = new Date(fallbackIso);
    if (!Number.isNaN(fb.getTime())) return fb;
  }
  return null;
}

function getMondayStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

function toIsoDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useLoadUtilizationStats(
  assignments: Assignment[],
  vehicles: VehicleMaster[]
) {
  return useMemo(() => {
    let pctSum = 0;
    let measuredTripsCount = 0;
    let weightTripsCount = 0;
    let totalLoadKg = 0;
    let optimalCount = 0;
    let moderateCount = 0;
    let underloadCount = 0;
    let overloadCount = 0;
    let unmeasuredCount = 0;

    const chartData: LoadUtilizationChartItem[] = [];
    const dailyMap = new Map<
      string,
      {
        dateObj: Date;
        totalKg: number;
        tripCount: number;
        byVehicle: Record<string, number>;
        tripsByVehicle: Record<string, number>;
      }
    >();
    const vehicleTotalsMap = new Map<string, number>();

    const weeklyMap = new Map<
      string,
      {
        monday: Date;
        totalKg: number;
        tripCount: number;
        utilSum: number;
        utilCount: number;
      }
    >();
    const monthlyMap = new Map<
      string,
      {
        year: number;
        monthIdx: number;
        totalKg: number;
        tripCount: number;
        utilSum: number;
        utilCount: number;
      }
    >();

    for (const asg of assignments) {
      const evalRes = evaluateAssignmentLoadUtilization(asg, vehicles);
      const parsedDate = parseAssignmentDate(asg.tanggalTugas, asg.createdAt);
      const cleanPlate = String(asg.plateNumber || 'Tanpa Nopol').trim();

      if (evalRes.loadKg !== null && evalRes.loadKg > 0) {
        totalLoadKg += evalRes.loadKg;
        weightTripsCount++;
        vehicleTotalsMap.set(
          cleanPlate,
          (vehicleTotalsMap.get(cleanPlate) || 0) + evalRes.loadKg
        );

        if (parsedDate) {
          const dayDate = new Date(
            parsedDate.getFullYear(),
            parsedDate.getMonth(),
            parsedDate.getDate()
          );
          const dayKey = toIsoDateKey(dayDate);
          const prevDay = dailyMap.get(dayKey) || {
            dateObj: dayDate,
            totalKg: 0,
            tripCount: 0,
            byVehicle: {},
            tripsByVehicle: {},
          };
          prevDay.totalKg += evalRes.loadKg;
          prevDay.tripCount += 1;
          prevDay.byVehicle[cleanPlate] =
            (prevDay.byVehicle[cleanPlate] || 0) + evalRes.loadKg;
          prevDay.tripsByVehicle[cleanPlate] =
            (prevDay.tripsByVehicle[cleanPlate] || 0) + 1;
          dailyMap.set(dayKey, prevDay);

          const monday = getMondayStart(parsedDate);
          const weekKey = toIsoDateKey(monday);
          const prevWeek = weeklyMap.get(weekKey) || {
            monday,
            totalKg: 0,
            tripCount: 0,
            utilSum: 0,
            utilCount: 0,
          };
          prevWeek.totalKg += evalRes.loadKg;
          prevWeek.tripCount += 1;
          if (evalRes.utilizationPct !== null) {
            prevWeek.utilSum += evalRes.utilizationPct;
            prevWeek.utilCount += 1;
          }
          weeklyMap.set(weekKey, prevWeek);

          const monthKey = `${parsedDate.getFullYear()}-${String(
            parsedDate.getMonth() + 1
          ).padStart(2, '0')}`;
          const prevMonth = monthlyMap.get(monthKey) || {
            year: parsedDate.getFullYear(),
            monthIdx: parsedDate.getMonth(),
            totalKg: 0,
            tripCount: 0,
            utilSum: 0,
            utilCount: 0,
          };
          prevMonth.totalKg += evalRes.loadKg;
          prevMonth.tripCount += 1;
          if (evalRes.utilizationPct !== null) {
            prevMonth.utilSum += evalRes.utilizationPct;
            prevMonth.utilCount += 1;
          }
          monthlyMap.set(monthKey, prevMonth);
        }
      }

      if (evalRes.utilizationPct !== null) {
        measuredTripsCount++;
        pctSum += evalRes.utilizationPct;
        if (evalRes.category === 'OPTIMAL') optimalCount++;
        else if (evalRes.category === 'MODERATE') moderateCount++;
        else if (evalRes.category === 'UNDERLOAD') underloadCount++;
        else if (evalRes.category === 'OVERLOAD') overloadCount++;

        if (chartData.length < 8) {
          const shortNo = (
            asg.noPenugasan.split('/').pop() || asg.noPenugasan
          ).trim();
          const compactPlate = asg.plateNumber.replace(/\s+/g, '');
          const compactLabel =
            shortNo.length <= 6
              ? `#${shortNo}`
              : compactPlate.slice(0, 9);
          const barColor =
            evalRes.category === 'OVERLOAD'
              ? '#dc2626'
              : evalRes.category === 'OPTIMAL'
              ? '#059669'
              : evalRes.category === 'MODERATE'
              ? '#0284c7'
              : '#d97706';
          chartData.push({
            label: compactLabel,
            fullLabel: `${asg.plateNumber} · ${asg.noPenugasan}`,
            utilitas: Math.min(evalRes.utilizationPct, 140),
            loadDisplay: evalRes.loadDisplay || '-',
            capacityDisplay: evalRes.capacityDisplay || '-',
            color: barColor,
          });
        }
      } else {
        unmeasuredCount++;
      }
    }

    const activePlatesSorted = Array.from(vehicleTotalsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([plate]) => plate);

    const allSelectablePlates = Array.from(
      new Set([
        ...activePlatesSorted,
        ...vehicles.map((v) => String(v.plateNumber || '').trim()).filter(Boolean),
      ])
    );

    const vehicleColorMap: Record<string, string> = {};
    allSelectablePlates.forEach((plate, idx) => {
      vehicleColorMap[plate] =
        VEHICLE_BAR_PALETTE[idx % VEHICLE_BAR_PALETTE.length];
    });

    const dailyVehicleData: DailyVehicleLoadRow[] = Array.from(
      dailyMap.entries()
    )
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([dateKey, item]) => {
        const row: DailyVehicleLoadRow = {
          dateKey,
          label: `${item.dateObj.getDate()} ${
            SHORT_MONTHS_ID[item.dateObj.getMonth()]
          }`,
          fullDateLabel: `${item.dateObj.getDate()} ${
            FULL_MONTHS_ID[item.dateObj.getMonth()]
          } ${item.dateObj.getFullYear()}`,
          totalKg: Math.round(item.totalKg * 10) / 10,
          tripCount: item.tripCount,
          byVehicle: item.byVehicle,
          tripsByVehicle: item.tripsByVehicle,
        };
        for (const plate of allSelectablePlates) {
          row[plate] = Math.round((item.byVehicle[plate] || 0) * 10) / 10;
        }
        return row;
      });

    const recentActivePlates = activePlatesSorted.filter((plate) =>
      dailyVehicleData.some((d) => Number(d[plate] || 0) > 0)
    );

    const weeklyLoadData: PeriodLoadChartItem[] = Array.from(
      weeklyMap.entries()
    )
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([weekKey, item]) => {
        const sunday = new Date(item.monday);
        sunday.setDate(sunday.getDate() + 6);
        const startLabel = `${item.monday.getDate()} ${
          SHORT_MONTHS_ID[item.monday.getMonth()]
        }`;
        const endLabel = `${sunday.getDate()} ${
          SHORT_MONTHS_ID[sunday.getMonth()]
        } ${sunday.getFullYear()}`;
        return {
          periodKey: weekKey,
          label: startLabel,
          fullPeriodLabel: `Minggu ${startLabel} – ${endLabel}`,
          totalKg: Math.round(item.totalKg * 10) / 10,
          tripCount: item.tripCount,
          avgUtilPct:
            item.utilCount > 0
              ? Math.round((item.utilSum / item.utilCount) * 10) / 10
              : null,
        };
      });

    const monthlyLoadData: PeriodLoadChartItem[] = Array.from(
      monthlyMap.entries()
    )
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([monthKey, item]) => {
        const shortYr = String(item.year).slice(-2);
        return {
          periodKey: monthKey,
          label: `${SHORT_MONTHS_ID[item.monthIdx]} '${shortYr}`,
          fullPeriodLabel: `${FULL_MONTHS_ID[item.monthIdx]} ${item.year}`,
          totalKg: Math.round(item.totalKg * 10) / 10,
          tripCount: item.tripCount,
          avgUtilPct:
            item.utilCount > 0
              ? Math.round((item.utilSum / item.utilCount) * 10) / 10
              : null,
        };
      });

    let totalFleetCapacityKg = 0;
    let activeVehiclesCount = 0;
    let readyVehiclesCount = 0;
    let maintenanceVehiclesCount = 0;

    for (const v of vehicles) {
      if (v.status === 'Dalam Tugas') activeVehiclesCount++;
      else if (v.status === 'Siap Jalan') readyVehiclesCount++;
      else if (v.status === 'Perawatan') maintenanceVehiclesCount++;

      const capParsed = parseLoadMeasurement(v.capacity);
      if (capParsed && capParsed.family === 'WEIGHT_KG') {
        totalFleetCapacityKg += capParsed.normalizedValue;
      }
    }

    const operationalUnits = Math.max(
      1,
      vehicles.length - maintenanceVehiclesCount
    );
    const fleetActivePct =
      vehicles.length > 0
        ? Math.round((activeVehiclesCount / operationalUnits) * 1000) / 10
        : null;

    const avgUtilizationPct =
      measuredTripsCount > 0
        ? Math.round((pctSum / measuredTripsCount) * 10) / 10
        : null;

    return {
      avgUtilizationPct,
      measuredTripsCount,
      weightTripsCount,
      totalLoadKg,
      totalFleetCapacityKg,
      activeVehiclesCount,
      readyVehiclesCount,
      maintenanceVehiclesCount,
      fleetActivePct,
      optimalCount,
      moderateCount,
      underloadCount,
      overloadCount,
      unmeasuredCount,
      chartData,
      dailyVehicleData,
      recentActivePlates,
      allSelectablePlates,
      vehicleColorMap,
      vehicleTotalsMap,
      weeklyLoadData,
      monthlyLoadData,
    };
  }, [assignments, vehicles]);
}

function formatMasterVehicleCapacity(vehicle?: VehicleMaster | null): string {
  if (!vehicle) return 'Belum diatur';
  const rawCap = String(vehicle.capacity || '').trim();
  if (!rawCap) return 'Belum diatur';
  const parsed = parseLoadMeasurement(rawCap);
  if (parsed?.family === 'WEIGHT_KG') {
    return formatWeightKg(parsed.normalizedValue);
  }
  return parsed?.displayText || rawCap;
}

function computePerUnitCapacityRangeLabel(vehicles: VehicleMaster[]): string {
  if (vehicles.length === 0) return 'Belum diatur';

  const weightKgList: number[] = [];
  const otherLabels: string[] = [];

  for (const v of vehicles) {
    const rawCap = String(v.capacity || '').trim();
    if (!rawCap) continue;
    const parsed = parseLoadMeasurement(rawCap);
    if (parsed?.family === 'WEIGHT_KG' && parsed.normalizedValue > 0) {
      weightKgList.push(parsed.normalizedValue);
    } else {
      otherLabels.push(parsed?.displayText || rawCap);
    }
  }

  if (weightKgList.length > 0) {
    const minKg = Math.min(...weightKgList);
    const maxKg = Math.max(...weightKgList);
    if (minKg === maxKg) {
      return `${formatWeightKg(minKg)} / Unit`;
    }
    return `${formatWeightKg(minKg)} – ${formatWeightKg(maxKg)} / Unit`;
  }

  const uniqueOther = Array.from(new Set(otherLabels));
  if (uniqueOther.length === 1) {
    return `${uniqueOther[0]} / Unit`;
  }
  if (uniqueOther.length > 1) {
    return `${uniqueOther[0]} – ${uniqueOther[uniqueOther.length - 1]} / Unit`;
  }

  return 'Belum diatur';
}

function assignmentMatchesVehicle(
  asg: Assignment,
  vehicle: VehicleMaster
): boolean {
  const asgVehId = String(asg.vehicleId || '').trim().toLowerCase();
  const targetVehId = String(vehicle.id || '').trim().toLowerCase();
  if (asgVehId && targetVehId && asgVehId === targetVehId) {
    return true;
  }

  const asgPlate = String(asg.plateNumber || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  const targetPlate = String(vehicle.plateNumber || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  return Boolean(asgPlate && targetPlate && asgPlate === targetPlate);
}

interface LoadUtilizationSectionProps {
  assignments: Assignment[];
  vehicles: VehicleMaster[];
}

type LoadChartMode = 'harian_armada' | 'mingguan' | 'bulanan' | 'per_tugas';

export const LoadUtilizationSection: React.FC<LoadUtilizationSectionProps> = ({
  assignments,
  vehicles,
}) => {
  const fleetStats = useLoadUtilizationStats(assignments, vehicles);
  const [chartMode, setChartMode] = useState<LoadChartMode>('harian_armada');
  const [userSelectedUnitId, setUserSelectedUnitId] = useState<string | null>(
    null
  );
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [isExportingImage, setIsExportingImage] = useState(false);

  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!downloadMenuOpen) return;
    const handleOutsideClick = (ev: MouseEvent) => {
      if (
        downloadMenuRef.current &&
        !downloadMenuRef.current.contains(ev.target as Node)
      ) {
        setDownloadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [downloadMenuOpen]);

  // Smart default: pick a single Unit Armada from Master Data (preferring the unit from the latest assignment,
  // or the first Master Data unit) so `Kapasitas Muatan` always reflects 1 Unit Armada dynamically from Master Data,
  // while still allowing the Dispatcher to pick any other unit or 'ALL' (Semua Unit Armada).
  const effectiveUnitId = useMemo<string>(() => {
    if (vehicles.length === 0) return 'ALL';
    if (userSelectedUnitId === 'ALL') return 'ALL';
    if (
      userSelectedUnitId &&
      vehicles.some((v) => v.id === userSelectedUnitId)
    ) {
      return userSelectedUnitId;
    }

    // Prefer vehicle with most recent measured load, or most recent assignment
    for (let i = assignments.length - 1; i >= 0; i -= 1) {
      const asg = assignments[i];
      if (!String(asg.beratMuatan || '').trim()) continue;
      const matched = vehicles.find((v) => assignmentMatchesVehicle(asg, v));
      if (matched) return matched.id;
    }
    for (let i = assignments.length - 1; i >= 0; i -= 1) {
      const asg = assignments[i];
      const matched = vehicles.find((v) => assignmentMatchesVehicle(asg, v));
      if (matched) return matched.id;
    }

    return vehicles[0].id;
  }, [assignments, userSelectedUnitId, vehicles]);

  const selectedVehicle = useMemo<VehicleMaster | null>(() => {
    if (effectiveUnitId === 'ALL') return null;
    return vehicles.find((v) => v.id === effectiveUnitId) || null;
  }, [effectiveUnitId, vehicles]);

  const selectedPlate = selectedVehicle
    ? String(selectedVehicle.plateNumber || '').trim()
    : 'ALL';

  const scopedAssignments = useMemo<Assignment[]>(() => {
    if (!selectedVehicle) return assignments;
    return assignments.filter((asg) =>
      assignmentMatchesVehicle(asg, selectedVehicle)
    );
  }, [assignments, selectedVehicle]);

  const stats = useLoadUtilizationStats(scopedAssignments, vehicles);

  const dynamicCapacityLabel = useMemo<string>(() => {
    if (selectedVehicle) {
      return formatMasterVehicleCapacity(selectedVehicle);
    }
    return computePerUnitCapacityRangeLabel(vehicles);
  }, [selectedVehicle, vehicles]);

  const displayedDailyPlates = useMemo(() => {
    if (selectedVehicle && selectedPlate !== 'ALL') {
      return [selectedPlate];
    }
    return fleetStats.recentActivePlates;
  }, [fleetStats.recentActivePlates, selectedPlate, selectedVehicle]);

  const filteredDailyData = useMemo<DailyVehicleLoadRow[]>(() => {
    if (!selectedVehicle || selectedPlate === 'ALL') {
      return fleetStats.dailyVehicleData;
    }
    return fleetStats.dailyVehicleData.map(
      (row): DailyVehicleLoadRow => ({
        ...row,
        totalKg: Number(row[selectedPlate] || 0),
        tripCount: Number(row.tripsByVehicle[selectedPlate] || 0),
      })
    );
  }, [fleetStats.dailyVehicleData, selectedPlate, selectedVehicle]);

  const selectedUnitHasDailyLoad = useMemo(() => {
    if (!selectedVehicle || selectedPlate === 'ALL') {
      return filteredDailyData.length > 0;
    }
    return filteredDailyData.some((r) => Number(r[selectedPlate] || 0) > 0);
  }, [filteredDailyData, selectedPlate, selectedVehicle]);

  const displayMainPct =
    stats.avgUtilizationPct !== null
      ? stats.avgUtilizationPct
      : selectedVehicle
      ? selectedVehicle.status === 'Dalam Tugas'
        ? 100
        : 0
      : fleetStats.fleetActivePct;

  const progressWidth =
    displayMainPct !== null ? Math.min(100, Math.max(0, displayMainPct)) : 0;

  const activePeriodData =
    chartMode === 'mingguan' ? stats.weeklyLoadData : stats.monthlyLoadData;

  const maxWeightInActiveView = useMemo(() => {
    if (chartMode === 'harian_armada') {
      if (selectedVehicle && selectedPlate !== 'ALL') {
        return filteredDailyData.reduce(
          (mx, item) => Math.max(mx, Number(item[selectedPlate] || 0)),
          0
        );
      }
      const useStacked = displayedDailyPlates.length > 3;
      return filteredDailyData.reduce((mx, item) => {
        if (useStacked) {
          return Math.max(mx, item.totalKg);
        }
        const dayMaxPlate = displayedDailyPlates.reduce(
          (pmx, plate) => Math.max(pmx, Number(item[plate] || 0)),
          0
        );
        return Math.max(mx, dayMaxPlate);
      }, 0);
    }
    return activePeriodData.reduce((mx, item) => Math.max(mx, item.totalKg), 0);
  }, [
    activePeriodData,
    chartMode,
    displayedDailyPlates,
    filteredDailyData,
    selectedPlate,
    selectedVehicle,
  ]);

  const useTonScale = maxWeightInActiveView >= 1000;
  const shouldStackDailyBars =
    !selectedVehicle && displayedDailyPlates.length > 3;

  const formatWeightAxisTick = (val: number): string => {
    if (!Number.isFinite(val) || val <= 0) return '0';
    if (useTonScale) {
      const tons = val / 1000;
      return `${tons % 1 === 0 ? tons.toFixed(0) : tons.toFixed(1)} T`;
    }
    return `${Math.round(val)} Kg`;
  };

  const canExportChart =
    (chartMode === 'harian_armada' && selectedUnitHasDailyLoad) ||
    ((chartMode === 'mingguan' || chartMode === 'bulanan') &&
      activePeriodData.length > 0) ||
    (chartMode === 'per_tugas' && stats.chartData.length > 0);

  const handleSelectPlateFromLegend = (plate: string) => {
    const matched = vehicles.find(
      (v) =>
        String(v.plateNumber || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '') ===
        plate.trim().toLowerCase().replace(/\s+/g, '')
    );
    if (!matched) return;
    setUserSelectedUnitId((prev) =>
      (prev ?? effectiveUnitId) === matched.id ? 'ALL' : matched.id
    );
  };

  const handleDownloadChartImage = async (format: 'png' | 'jpg') => {
    setDownloadMenuOpen(false);
    if (!chartWrapperRef.current || isExportingImage) return;
    const svgEl = chartWrapperRef.current.querySelector('svg');
    if (!svgEl) return;

    setIsExportingImage(true);
    try {
      const rect = svgEl.getBoundingClientRect();
      const svgWidth = Math.max(640, Math.round(rect.width || 680));
      const svgHeight = Math.max(260, Math.round(rect.height || 260));

      const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
      clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clonedSvg.setAttribute('width', String(svgWidth));
      clonedSvg.setAttribute('height', String(svgHeight));
      clonedSvg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

      const textNodes = clonedSvg.querySelectorAll('text');
      textNodes.forEach((node) => {
        if (!node.getAttribute('font-family')) {
          node.setAttribute(
            'font-family',
            'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif'
          );
        }
      });

      const svgMarkup = new XMLSerializer().serializeToString(clonedSvg);
      const svgBlob = new Blob([svgMarkup], {
        type: 'image/svg+xml;charset=utf-8',
      });
      const objectUrl = URL.createObjectURL(svgBlob);

      const loadedImg = await new Promise<HTMLImageElement>(
        (resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = (err) => reject(err);
          img.src = objectUrl;
        }
      );

      const legendItems: Array<{ label: string; color: string }> =
        chartMode === 'harian_armada'
          ? displayedDailyPlates.map((plate) => ({
              label: plate,
              color: fleetStats.vehicleColorMap[plate] || '#0f172a',
            }))
          : chartMode === 'per_tugas'
          ? [
              { label: 'Optimal (70–100%)', color: '#059669' },
              { label: 'Moderat (40–69%)', color: '#0284c7' },
              { label: 'Rendah (<40%)', color: '#d97706' },
              { label: 'Overload (>100%)', color: '#dc2626' },
            ]
          : [
              {
                label: selectedVehicle
                  ? `Total Muatan (${selectedVehicle.plateNumber})`
                  : 'Total Berat Muatan',
                color: '#0f172a',
              },
            ];

      const padX = 32;
      const headerHeight = 76;
      const legendRows = Math.max(1, Math.ceil(legendItems.length / 4));
      const footerHeight = 28 + legendRows * 24;
      const canvasWidth = svgWidth + padX * 2;
      const canvasHeight = headerHeight + svgHeight + footerHeight;
      const scale = 2;

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth * scale;
      canvas.height = canvasHeight * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, canvasWidth - 1, canvasHeight - 1);

      const unitHeaderSuffix = selectedVehicle
        ? ` (${selectedVehicle.plateNumber})`
        : ' (Semua Armada)';

      const modeTitle =
        chartMode === 'harian_armada'
          ? !selectedVehicle
            ? 'Total Muatan Harian per Unit Armada'
            : `Tren Muatan Harian Unit ${selectedVehicle.plateNumber}`
          : chartMode === 'mingguan'
          ? `Total Berat Muatan per Minggu${unitHeaderSuffix}`
          : chartMode === 'bulanan'
          ? `Total Berat Muatan per Bulan${unitHeaderSuffix}`
          : `Rasio Utilitas Kapasitas per Surat Tugas (%)${unitHeaderSuffix}`;

      ctx.fillStyle = '#0f172a';
      ctx.font =
        '700 16px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(`Utilitas Muatan Armada — ${modeTitle}`, padX, 32);

      const totalWeightLabel =
        stats.totalLoadKg > 0 ? formatWeightKg(stats.totalLoadKg) : '0 Kg';
      const dateStamp = new Date().toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
      ctx.fillStyle = '#64748b';
      ctx.font =
        '500 12px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(
        `CRK Logistik · Total Muatan: ${totalWeightLabel} · Kapasitas Muatan: ${dynamicCapacityLabel} · Dicetak ${dateStamp}`,
        padX,
        54
      );

      ctx.drawImage(loadedImg, padX, headerHeight, svgWidth, svgHeight);
      URL.revokeObjectURL(objectUrl);

      let cursorX = padX;
      let cursorY = headerHeight + svgHeight + 20;
      ctx.font =
        '600 11px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif';
      for (const item of legendItems) {
        const itemWidth = ctx.measureText(item.label).width + 28;
        if (cursorX + itemWidth > canvasWidth - padX && cursorX > padX) {
          cursorX = padX;
          cursorY += 22;
        }
        ctx.fillStyle = item.color;
        ctx.fillRect(cursorX, cursorY - 9, 10, 10);
        ctx.fillStyle = '#334155';
        ctx.fillText(item.label, cursorX + 15, cursorY);
        cursorX += itemWidth;
      }

      const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
      const dataUrl = canvas.toDataURL(mimeType, 0.95);
      const isoToday = toIsoDateKey(new Date());
      const unitSlug = selectedVehicle
        ? `-${selectedVehicle.plateNumber.replace(/\s+/g, '')}`
        : '';
      const fileName = `Utilitas-Muatan-${chartMode}${unitSlug}-${isoToday}.${format}`;

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Gagal mengunduh grafik utilitas muatan:', err);
    } finally {
      setIsExportingImage(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Scale className="h-4 w-4 shrink-0 text-slate-700" />
              Utilitas Muatan &amp; Produktivitas Tonase Armada
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Pemantauan tren total berat muatan harian tiap unit armada, rekap
              mingguan, bulanan, serta rasio kapasitas kargo pengiriman.
            </p>
          </div>

          {vehicles.length > 0 && (
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 shrink-0">
              <label
                htmlFor="master-unit-capacity-select"
                className="text-xs font-semibold text-slate-700 whitespace-nowrap"
              >
                Unit Armada:
              </label>
              <select
                id="master-unit-capacity-select"
                aria-label="Pilih Unit Armada Master Data"
                value={effectiveUnitId}
                onChange={(e) => setUserSelectedUnitId(e.target.value)}
                className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 transition-colors focus:border-slate-900 focus:outline-none sm:w-auto sm:min-w-[260px]"
              >
                {vehicles.map((v) => {
                  const unitCap = formatMasterVehicleCapacity(v);
                  const cleanPlate = String(v.plateNumber || '').trim();
                  const unitLoad = fleetStats.vehicleTotalsMap.get(cleanPlate) || 0;
                  return (
                    <option key={v.id} value={v.id}>
                      {v.plateNumber} · {v.vehicleType || v.id} ({unitCap}
                      {unitLoad > 0 ? ` · Muatan ${formatWeightKg(unitLoad)}` : ''}
                      )
                    </option>
                  );
                })}
                <option value="ALL">
                  Semua Unit Armada ({vehicles.length} Unit Gabungan)
                </option>
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] sm:text-xs text-slate-600 tabular-nums">
            <span>
              Terukur: {stats.measuredTripsCount}/{scopedAssignments.length}{' '}
              Tugas
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Total Muatan:{' '}
              <strong className="font-semibold text-slate-900">
                {stats.totalLoadKg > 0
                  ? formatWeightKg(stats.totalLoadKg)
                  : '0 Kg'}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {selectedVehicle ? 'Kapasitas' : 'Kapasitas/Unit'}:{' '}
              <strong className="font-semibold text-slate-900">
                {dynamicCapacityLabel}
              </strong>
              {selectedVehicle ? ` (${selectedVehicle.plateNumber})` : ''}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 max-w-full">
            <div
              className="flex max-w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-lg bg-slate-100 p-1"
              role="tablist"
              aria-label="Periode Diagram Utilitas Muatan"
            >
              <button
                type="button"
                onClick={() => setChartMode('harian_armada')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  chartMode === 'harian_armada'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Per Hari
              </button>
              <button
                type="button"
                onClick={() => setChartMode('mingguan')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  chartMode === 'mingguan'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Per Minggu
              </button>
              <button
                type="button"
                onClick={() => setChartMode('bulanan')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  chartMode === 'bulanan'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Per Bulan
              </button>
              <button
                type="button"
                onClick={() => setChartMode('per_tugas')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  chartMode === 'per_tugas'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Per Tugas (%)
              </button>
            </div>

            <div className="relative shrink-0" ref={downloadMenuRef}>
              <button
                type="button"
                disabled={!canExportChart || isExportingImage}
                onClick={() => setDownloadMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 text-slate-700" />
                <span className="hidden sm:inline">
                  {isExportingImage ? 'Menyiapkan...' : 'Unduh Grafik'}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
              </button>

              {downloadMenuOpen && (
                <div className="absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => void handleDownloadChartImage('png')}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <span>Simpan Gambar PNG</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      HD
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadChartImage('jpg')}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <span>Simpan Gambar JPG</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      Laporan
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-12 xl:items-start">
        {/* Left Column: Primary KPI + Clean Hairline Breakdown */}
        <div className="xl:col-span-4 min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">
                {stats.avgUtilizationPct !== null
                  ? selectedVehicle
                    ? `Rata-Rata Utilitas (${selectedVehicle.plateNumber})`
                    : 'Rata-Rata Utilitas Muatan'
                  : selectedVehicle
                  ? `Utilitas Unit ${selectedVehicle.plateNumber}`
                  : 'Utilitas Unit Armada Aktif'}
              </p>
              <p className="mt-1 font-mono text-3xl font-bold text-slate-900 tabular-nums">
                {displayMainPct !== null ? `${displayMainPct}%` : '—'}
              </p>
            </div>
            <div className="text-xs text-slate-500 sm:text-right">
              {stats.avgUtilizationPct !== null ? (
                <span
                  className={`font-semibold ${
                    stats.avgUtilizationPct > 100
                      ? 'text-red-600'
                      : stats.avgUtilizationPct >= 70
                      ? 'text-emerald-700'
                      : stats.avgUtilizationPct >= 40
                      ? 'text-sky-700'
                      : 'text-amber-700'
                  }`}
                >
                  {stats.avgUtilizationPct > 100
                    ? 'Indikasi Overload (>100%)'
                    : stats.avgUtilizationPct >= 70
                    ? 'Efisiensi Muatan Optimal'
                    : stats.avgUtilizationPct >= 40
                    ? 'Utilitas Muatan Moderat'
                    : 'Kapasitas Masih Longgar'}
                </span>
              ) : selectedVehicle ? (
                <span>
                  Kapasitas Master Armada:{' '}
                  <strong className="font-semibold text-slate-700">
                    {dynamicCapacityLabel}
                  </strong>{' '}
                  · {selectedVehicle.vehicleType || selectedVehicle.id}
                </span>
              ) : (
                <span>
                  Isi Berat Muatan &amp; Kapasitas Armada untuk rasio kargo
                </span>
              )}
            </div>
          </div>

          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                (displayMainPct || 0) > 100
                  ? 'bg-red-600'
                  : (displayMainPct || 0) >= 70
                  ? 'bg-emerald-600'
                  : (displayMainPct || 0) >= 40
                  ? 'bg-sky-600'
                  : 'bg-amber-500'
              }`}
              style={{ width: `${progressWidth}%` }}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-xs">
            <div className="bg-white p-3.5 min-w-0">
              <p className="truncate text-slate-500">Optimal (70–100%)</p>
              <p className="mt-1 font-mono text-base font-bold text-emerald-700 tabular-nums">
                {stats.optimalCount} Tugas
              </p>
            </div>
            <div className="bg-white p-3.5 min-w-0">
              <p className="truncate text-slate-500">Moderat (40–69%)</p>
              <p className="mt-1 font-mono text-base font-bold text-sky-700 tabular-nums">
                {stats.moderateCount} Tugas
              </p>
            </div>
            <div className="bg-white p-3.5 min-w-0">
              <p className="truncate text-slate-500">
                Rendah (&lt;40%) / Lebih
              </p>
              <p className="mt-1 font-mono text-base font-bold text-amber-700 tabular-nums">
                {stats.underloadCount} /{' '}
                <span
                  className={
                    stats.overloadCount > 0 ? 'text-red-600' : 'text-slate-700'
                  }
                >
                  {stats.overloadCount}
                </span>
              </p>
            </div>
            <div className="bg-white p-3.5 min-w-0">
              {selectedVehicle ? (
                <>
                  <p className="truncate text-slate-500">
                    Kapasitas ({selectedVehicle.id})
                  </p>
                  <p className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums truncate">
                    {dynamicCapacityLabel}
                  </p>
                </>
              ) : (
                <>
                  <p className="truncate text-slate-500">Unit Jalan / Siap</p>
                  <p className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums">
                    {fleetStats.activeVehiclesCount} /{' '}
                    {fleetStats.readyVehiclesCount} Unit
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Recharts Visualization (Daily Per-Vehicle / Weekly / Monthly / Per-Task %) */}
        <div className="xl:col-span-8 min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-700">
                {chartMode === 'harian_armada'
                  ? !selectedVehicle
                    ? 'Total Berat Muatan per Hari untuk Setiap Armada'
                    : `Tren Muatan Harian Armada: ${selectedVehicle.plateNumber} (Kapasitas ${dynamicCapacityLabel})`
                  : chartMode === 'mingguan'
                  ? !selectedVehicle
                    ? 'Total Berat Muatan per Minggu (Semua Armada)'
                    : `Total Berat Muatan per Minggu: ${selectedVehicle.plateNumber}`
                  : chartMode === 'bulanan'
                  ? !selectedVehicle
                    ? 'Total Berat Muatan per Bulan (Semua Armada)'
                    : `Total Berat Muatan per Bulan: ${selectedVehicle.plateNumber}`
                  : !selectedVehicle
                  ? 'Rasio Utilitas Kapasitas per Surat Tugas (%)'
                  : `Rasio Utilitas Kapasitas Unit ${selectedVehicle.plateNumber} (%)`}
              </span>
            </div>

            <span className="font-mono tabular-nums">
              {chartMode === 'per_tugas'
                ? 'Satuan: % Kapasitas'
                : useTonScale
                ? 'Satuan: Ton (1 Ton = 1.000 Kg)'
                : 'Satuan: Kilogram (Kg)'}
            </span>
          </div>

          <div ref={chartWrapperRef} className="w-full">
            {chartMode === 'harian_armada' ? (
              !selectedUnitHasDailyLoad ? (
                <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
                  <Truck className="h-6 w-6 text-slate-400" />
                  <p className="mt-2 text-xs font-semibold text-slate-800">
                    {!selectedVehicle
                      ? 'Belum Ada Berat Muatan Harian per Armada Tercatat'
                      : `Belum Ada Riwayat Berat Muatan untuk Armada ${selectedVehicle.plateNumber} (Kapasitas ${dynamicCapacityLabel})`}
                  </p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                    Isi kolom{' '}
                    <span className="font-semibold text-slate-700">
                      Berat Muatan
                    </span>{' '}
                    saat menerbitkan Surat Tugas untuk armada ini agar rasio
                    terhadap kapasitas{' '}
                    <span className="font-mono font-semibold text-slate-700">
                      {dynamicCapacityLabel}
                    </span>{' '}
                    dihitung otomatis.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={filteredDailyData}
                        margin={{ top: 12, right: 16, left: 4, bottom: 12 }}
                        barGap={3}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="#e2e8f0"
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: '#475569' }}
                          tickLine={false}
                          axisLine={{ stroke: '#cbd5e1' }}
                          tickMargin={10}
                          minTickGap={20}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          width={62}
                          tickFormatter={formatWeightAxisTick}
                          tick={{ fontSize: 11, fill: '#475569' }}
                          tickLine={false}
                          axisLine={false}
                          tickMargin={6}
                        />
                        <Tooltip
                          labelFormatter={(_label, payload) => {
                            const first = payload?.[0]?.payload as
                              | DailyVehicleLoadRow
                              | undefined;
                            if (!first) return String(_label || '');
                            return `${first.fullDateLabel} · Total Harian ${formatWeightKg(
                              first.totalKg
                            )} (${first.tripCount} Tugas)`;
                          }}
                          formatter={(val, name, item) => {
                            const kgVal = Number(val ?? 0);
                            const row = item?.payload as
                              | DailyVehicleLoadRow
                              | undefined;
                            const plateName = String(name || '');
                            const trips =
                              row?.tripsByVehicle?.[plateName] || 0;
                            const matchedVeh = vehicles.find(
                              (v) =>
                                String(v.plateNumber || '').trim() === plateName
                            );
                            const capSuffix = matchedVeh
                              ? ` / Kapasitas ${formatMasterVehicleCapacity(
                                  matchedVeh
                                )}`
                              : '';
                            const tripSuffix =
                              trips > 0 ? ` (${trips} Tugas)` : '';
                            return [
                              `${formatWeightKg(kgVal)}${capSuffix}${tripSuffix}`,
                              `Armada ${plateName}`,
                            ];
                          }}
                          contentStyle={{
                            fontSize: '12px',
                            borderRadius: '8px',
                            borderColor: '#cbd5e1',
                          }}
                        />
                        {displayedDailyPlates.map((plate, idx) => {
                          const isTopOfStack =
                            !shouldStackDailyBars ||
                            idx === displayedDailyPlates.length - 1;
                          return (
                            <Bar
                              key={plate}
                              dataKey={plate}
                              name={plate}
                              stackId={
                                shouldStackDailyBars ? 'dailyFleet' : undefined
                              }
                              fill={
                                fleetStats.vehicleColorMap[plate] || '#0f172a'
                              }
                              radius={isTopOfStack ? [5, 5, 0, 0] : [0, 0, 0, 0]}
                              maxBarSize={
                                displayedDailyPlates.length === 1 ? 42 : 28
                              }
                            />
                          );
                        })}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Non-overlapping interactive fleet unit legend */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2.5 text-xs">
                    {fleetStats.recentActivePlates.map((plate) => {
                      const active =
                        !selectedVehicle || selectedPlate === plate;
                      const matchedVeh = vehicles.find(
                        (v) => String(v.plateNumber || '').trim() === plate
                      );
                      return (
                        <button
                          key={plate}
                          type="button"
                          onClick={() => handleSelectPlateFromLegend(plate)}
                          title={`Klik untuk melihat kapasitas & tren armada ${plate}`}
                          className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono transition-opacity ${
                            active
                              ? 'text-slate-800 opacity-100 hover:bg-slate-100'
                              : 'text-slate-400 opacity-50 hover:opacity-80'
                          }`}
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-xs"
                            style={{
                              backgroundColor:
                                fleetStats.vehicleColorMap[plate] || '#0f172a',
                            }}
                          />
                          <span>
                            {plate}
                            {matchedVeh
                              ? ` (${formatMasterVehicleCapacity(matchedVeh)})`
                              : ''}
                          </span>
                        </button>
                      );
                    })}
                    {selectedVehicle && (
                      <button
                        type="button"
                        onClick={() => setUserSelectedUnitId('ALL')}
                        className="ml-auto text-xs font-medium text-sky-700 hover:underline"
                      >
                        Tampilkan Semua Armada
                      </button>
                    )}
                  </div>
                </div>
              )
            ) : chartMode !== 'per_tugas' ? (
              activePeriodData.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
                  <Truck className="h-6 w-6 text-slate-400" />
                  <p className="mt-2 text-xs font-semibold text-slate-800">
                    Belum Ada Berat Muatan Tercatat (
                    {chartMode === 'mingguan' ? 'Mingguan' : 'Bulanan'}
                    {selectedVehicle ? ` · ${selectedVehicle.plateNumber}` : ''}
                    )
                  </p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                    Isi kolom{' '}
                    <span className="font-semibold text-slate-700">
                      Berat Muatan
                    </span>{' '}
                    saat menerbitkan Surat Tugas (contoh:{' '}
                    <span className="font-mono text-slate-700">2.5 Ton</span> atau{' '}
                    <span className="font-mono text-slate-700">1800 Kg</span>)
                    untuk memantau grafik produktivitas tonase armada.
                  </p>
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={activePeriodData}
                      margin={{ top: 12, right: 16, left: 4, bottom: 16 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#e2e8f0"
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#475569' }}
                        tickLine={false}
                        axisLine={{ stroke: '#cbd5e1' }}
                        tickMargin={10}
                        minTickGap={20}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        width={62}
                        tickFormatter={formatWeightAxisTick}
                        tick={{ fontSize: 11, fill: '#475569' }}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={6}
                      />
                      <Tooltip
                        labelFormatter={(_label, payload) => {
                          const first = payload?.[0]?.payload as
                            | PeriodLoadChartItem
                            | undefined;
                          return first?.fullPeriodLabel || String(_label || '');
                        }}
                        formatter={(val, _name, item) => {
                          const p = item?.payload as
                            | PeriodLoadChartItem
                            | undefined;
                          const kgVal = Number(val ?? 0);
                          const weightText = formatWeightKg(kgVal);
                          const extra = p
                            ? ` · ${p.tripCount} Tugas${
                                p.avgUtilPct !== null
                                  ? ` (Rata-rata ${p.avgUtilPct}%)`
                                  : ''
                              }`
                            : '';
                          return [
                            `${weightText}${extra}`,
                            selectedVehicle
                              ? `Total Muatan ${selectedVehicle.plateNumber} (Kap. ${dynamicCapacityLabel})`
                              : 'Total Berat Muatan',
                          ];
                        }}
                        contentStyle={{
                          fontSize: '12px',
                          borderRadius: '8px',
                          borderColor: '#cbd5e1',
                        }}
                      />
                      <Bar
                        dataKey="totalKg"
                        name={
                          selectedVehicle
                            ? `Total Muatan (${selectedVehicle.plateNumber})`
                            : 'Total Berat Muatan'
                        }
                        fill="#0f172a"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={44}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )
            ) : stats.chartData.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
                <Truck className="h-6 w-6 text-slate-400" />
                <p className="mt-2 text-xs font-semibold text-slate-800">
                  Belum Ada Rasio Utilitas Kapasitas Terukur
                  {selectedVehicle ? ` (${selectedVehicle.plateNumber})` : ''}
                </p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                  Kapasitas Master Armada saat ini:{' '}
                  <span className="font-mono font-semibold text-slate-700">
                    {dynamicCapacityLabel}
                  </span>
                  . Masukkan Berat / Volume Muatan pada Surat Tugas untuk
                  melihat persentase utilitas per pengiriman.
                </p>
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stats.chartData}
                    margin={{ top: 12, right: 16, left: 4, bottom: 16 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#e2e8f0"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickLine={false}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickMargin={10}
                      minTickGap={18}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      width={56}
                      domain={[0, 120]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={6}
                    />
                    <Tooltip
                      labelFormatter={(_label, payload) => {
                        const first = payload?.[0]?.payload as
                          | LoadUtilizationChartItem
                          | undefined;
                        return first?.fullLabel || String(_label || '');
                      }}
                      formatter={(val, _name, item) => {
                        const p = item?.payload as
                          | LoadUtilizationChartItem
                          | undefined;
                        const numVal = val ?? 0;
                        const detail = p
                          ? `${numVal}% (${p.loadDisplay} / Kapasitas ${p.capacityDisplay})`
                          : `${numVal}%`;
                        return [detail, 'Utilitas Muatan'];
                      }}
                      contentStyle={{
                        fontSize: '12px',
                        borderRadius: '8px',
                        borderColor: '#cbd5e1',
                      }}
                    />
                    <Bar
                      dataKey="utilitas"
                      name="Utilitas Muatan (%)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={44}
                    >
                      {stats.chartData.map((entry, index) => (
                        <Cell key={`util-cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface OnTimeSummaryProps {
  assignments: Assignment[];
}

export const OnTimeDeliverySummarySection: React.FC<OnTimeSummaryProps> = ({
  assignments,
}) => {
  const otd = useOnTimeDeliveryStats(assignments);

  const otdBarData = [
    {
      status: 'Tepat Waktu',
      jumlah: otd.onTimeCompleted,
      color: '#059669',
    },
    {
      status: 'Selesai Terlambat',
      jumlah: otd.lateCompleted,
      color: '#dc2626',
    },
    {
      status: 'Aktif Sesuai Jadwal',
      jumlah: otd.onTrackActive,
      color: '#0284c7',
    },
    {
      status: 'Aktif Lewat Jadwal',
      jumlah: otd.overdueActive,
      color: '#d97706',
    },
  ];

  const displayRate =
    otd.onTimeDeliveryRate !== null ? `${otd.onTimeDeliveryRate}%` : '—';

  const progressWidth =
    otd.onTimeDeliveryRate !== null
      ? Math.min(100, Math.max(0, otd.onTimeDeliveryRate))
      : 0;

  return (
    <section
      aria-label="Ringkasan On-Time Delivery"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0">
        {/* Left Column: On-Time Delivery KPI & Schedule Adherence Breakdown */}
        <div className="p-4 sm:p-6 lg:col-span-5 flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 min-w-0">
                <CalendarClock className="h-4 w-4 text-emerald-700 shrink-0" />
                <span className="truncate">
                  Ketepatan Waktu Pengiriman (OTD)
                </span>
              </div>
              {otd.overallScheduleAdherence !== null && (
                <span className="font-mono text-xs text-slate-500 tabular-nums shrink-0">
                  Kepatuhan: {otd.overallScheduleAdherence}%
                </span>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
              <span className="font-mono text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
                {displayRate}
              </span>
              <span className="text-xs text-slate-500">
                {otd.totalCompleted > 0
                  ? `${otd.onTimeCompleted} dari ${otd.totalCompleted} serah terima tepat waktu`
                  : 'Menunggu penyelesaian pengiriman pertama'}
              </span>
            </div>

            {/* Linear Progress Bar */}
            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-transform duration-200"
                  style={{ width: `${progressWidth}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] sm:text-xs text-slate-500">
                <span>
                  Evaluasi timestamp real-time serah terima terhadap jadwal
                  tanggal &amp; jam tiba asli
                </span>
                {otd.avgLateMinutes !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-red-700 tabular-nums">
                      Rata-rata deviasi terlambat:{' '}
                      {formatDurationMinutes(otd.avgLateMinutes)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Hairline-divided 4-metric breakdown (no nested cards) */}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 pt-3.5 sm:grid-cols-4 lg:grid-cols-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-600">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                <span className="truncate">Tepat Waktu</span>
              </div>
              <p className="mt-0.5 font-mono text-base sm:text-lg font-bold text-emerald-700 tabular-nums">
                {otd.onTimeCompleted}
              </p>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-600">
                <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                <span className="truncate">Terlambat</span>
              </div>
              <p className="mt-0.5 font-mono text-base sm:text-lg font-bold text-red-600 tabular-nums">
                {otd.lateCompleted}
              </p>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-600">
                <Clock className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                <span className="truncate">Aktif Sesuai</span>
              </div>
              <p className="mt-0.5 font-mono text-base sm:text-lg font-bold text-sky-700 tabular-nums">
                {otd.onTrackActive}
              </p>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-600">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                <span className="truncate">Aktif Lewat</span>
              </div>
              <p className="mt-0.5 font-mono text-base sm:text-lg font-bold text-amber-700 tabular-nums">
                {otd.overdueActive}
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Recharts On-Time vs Schedule Visualization */}
        <div className="p-4 sm:p-6 lg:col-span-7 min-w-0">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">
                Visualisasi Ketepatan Jadwal Pengiriman (On-Time vs Terlambat)
              </h3>
              <p className="text-xs text-slate-500">
                {otd.timelineData.length > 1
                  ? 'Perbandingan realisasi timestamp pengiriman terhadap tanggal jadwal penugasan'
                  : 'Distribusi status ketepatan jadwal seluruh penugasan rantai dingin'}
              </p>
            </div>
          </div>

          {assignments.length === 0 ? (
            <div className="flex h-40 sm:h-52 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 text-center text-xs text-slate-500">
              Data visualisasi On-Time Delivery akan tampil setelah Surat Tugas
              diterbitkan.
            </div>
          ) : otd.timelineData.length > 1 ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={otd.timelineData}
                  margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="tanggalLabel"
                    tick={{ fontSize: 11, fill: '#334155' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#334155' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <Tooltip
                    formatter={(val, name) => [`${val ?? 0} Tugas`, String(name)]}
                    contentStyle={{
                      borderRadius: '8px',
                      borderColor: '#cbd5e1',
                      fontSize: '12px',
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={30}
                    wrapperStyle={{ fontSize: '11px' }}
                  />
                  <Bar
                    dataKey="tepatWaktu"
                    name="Selesai Tepat Waktu"
                    stackId="otd"
                    fill="#059669"
                    maxBarSize={48}
                  />
                  <Bar
                    dataKey="terlambat"
                    name="Selesai Terlambat"
                    stackId="otd"
                    fill="#dc2626"
                    maxBarSize={48}
                  />
                  <Bar
                    dataKey="aktifDalamJadwal"
                    name="Aktif Sesuai Jadwal"
                    stackId="otd"
                    fill="#0284c7"
                    maxBarSize={48}
                  />
                  <Bar
                    dataKey="aktifLewatJadwal"
                    name="Aktif Lewat Jadwal"
                    stackId="otd"
                    fill="#d97706"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={otdBarData}
                  margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="status"
                    tick={{ fontSize: 11, fill: '#334155' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#334155' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <Tooltip
                    formatter={(val) => [`${val ?? 0} Penugasan`, 'Jumlah']}
                    contentStyle={{
                      borderRadius: '8px',
                      borderColor: '#cbd5e1',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="jumlah" radius={[6, 6, 0, 0]} maxBarSize={56}>
                    {otdBarData.map((entry, idx) => (
                      <Cell key={`otd-cell-${idx}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

interface DashboardChartsProps {
  assignments: Assignment[];
  drivers: DriverMaster[];
}

export const DashboardChartsSection: React.FC<DashboardChartsProps> = ({
  assignments,
  drivers,
}) => {
  const stats = useDriverPerformanceStats(assignments, drivers);

  const barData = [
    {
      kategori: 'Tugas Selesai',
      jumlah: stats.completedCount,
      color: '#059669',
    },
    {
      kategori: 'Tugas Pending',
      jumlah: stats.pendingCount,
      color: '#d97706',
    },
  ];

  const pieData = stats.performanceRows
    .filter((r) => r.totalTasks > 0)
    .map((r) => ({
      name: `${r.driverName} (${r.completedDeliveries}/${r.totalTasks})`,
      value: r.totalTasks,
    }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
      {/* Bar Chart: Completed vs Pending Tasks */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 sm:mb-4">
          <h3 className="text-sm font-bold text-slate-900">
            Perbandingan Tugas Selesai vs Pending
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Total pengiriman rantai dingin selesai dibanding antrian &amp; dalam
            perjalanan
          </p>
        </div>

        <div className="h-52 sm:h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={barData}
              margin={{ top: 10, right: 16, left: -12, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="kategori"
                tick={{ fontSize: 12, fill: '#334155' }}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: '#334155' }}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <Tooltip
                formatter={(val) => [`${val ?? 0} Penugasan`, 'Jumlah']}
                contentStyle={{
                  borderRadius: '8px',
                  borderColor: '#cbd5e1',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="jumlah" radius={[6, 6, 0, 0]} maxBarSize={64}>
                {barData.map((entry, index) => (
                  <Cell key={`bar-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pie Chart: Task Distribution by Driver Performance */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 sm:mb-4">
          <h3 className="text-sm font-bold text-slate-900">
            Distribusi Penugasan &amp; Performa Driver
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Proporsi beban tugas pengiriman dan rasio selesai per Driver
          </p>
        </div>

        {pieData.length === 0 ? (
          <div className="flex h-44 sm:h-60 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 text-center text-xs text-slate-500">
            Belum ada data penugasan untuk divisualisasikan.
          </div>
        ) : (
          <div className="h-52 sm:h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="46%"
                  innerRadius={48}
                  outerRadius={78}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((_entry, index) => (
                    <Cell
                      key={`pie-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val) => [`${val ?? 0} Tugas`, 'Total']}
                  contentStyle={{
                    borderRadius: '8px',
                    borderColor: '#cbd5e1',
                    fontSize: '12px',
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  wrapperStyle={{ fontSize: '11px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

interface DriverPerformanceViewProps {
  assignments: Assignment[];
  drivers: DriverMaster[];
}

export const DriverPerformanceView: React.FC<DriverPerformanceViewProps> = ({
  assignments,
  drivers,
}) => {
  const stats = useDriverPerformanceStats(assignments, drivers);
  const otd = useOnTimeDeliveryStats(assignments);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 lg:grid-cols-4">
        <div className="bg-white p-3.5 sm:p-5 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-slate-500">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
            <span className="truncate">Pengiriman Selesai</span>
          </div>
          <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {stats.completedCount}
          </p>
        </div>

        <div className="bg-white p-3.5 sm:p-5 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-slate-500">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
            <span className="truncate">On-Time Rate</span>
          </div>
          <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-emerald-700 tabular-nums">
            {otd.onTimeDeliveryRate !== null
              ? `${otd.onTimeDeliveryRate}%`
              : '—'}
          </p>
        </div>

        <div className="bg-white p-3.5 sm:p-5 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-slate-500">
            <Clock className="h-3.5 w-3.5 shrink-0 text-sky-700" />
            <span className="truncate">Rata-Rata Durasi</span>
          </div>
          <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {formatDurationMinutes(stats.overallAvgMinutes)}
          </p>
        </div>

        <div className="bg-white p-3.5 sm:p-5 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-slate-500">
            <Truck className="h-3.5 w-3.5 shrink-0 text-slate-700" />
            <span className="truncate">Driver Aktif</span>
          </div>
          <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {stats.performanceRows.length}
          </p>
        </div>
      </div>

      {/* Charts */}
      <DashboardChartsSection assignments={assignments} drivers={drivers} />

      {/* Driver Performance Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-bold text-slate-900">
            Tabel Evaluasi Performa &amp; Ketepatan Waktu Driver
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Dihitung otomatis berdasarkan log keberangkatan, serah terima
            real-time, dan jadwal penugasan asli
          </p>
        </div>

        {stats.performanceRows.length === 0 ? (
          <div className="p-12 text-center">
            <Award className="mx-auto h-8 w-8 text-slate-400" />
            <h3 className="mt-3 text-base font-semibold text-slate-900">
              Belum Ada Data Performa Driver
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
              Data rata-rata durasi perjalanan dan On-Time Delivery akan
              dihitung otomatis setelah Driver menyelesaikan penugasan.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">ID Driver</th>
                  <th className="px-4 py-3">Nama Driver</th>
                  <th className="px-4 py-3 text-right">Total Tugas</th>
                  <th className="px-4 py-3 text-right">Pengiriman Selesai</th>
                  <th className="px-4 py-3 text-right">Tugas Pending</th>
                  <th className="px-4 py-3 text-right">On-Time Rate</th>
                  <th className="px-4 py-3 text-right">
                    Rata-Rata Durasi Perjalanan
                  </th>
                  <th className="px-4 py-3 text-right">Tingkat Penyelesaian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.performanceRows.map((row) => (
                  <tr
                    key={`${row.driverId}-${row.driverName}`}
                    className="hover:bg-slate-50/80"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {row.driverId}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {row.driverName}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {row.totalTasks}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-bold text-emerald-700 tabular-nums">
                      {row.completedDeliveries}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-amber-700 tabular-nums">
                      {row.pendingTasks}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                      {row.onTimeRate !== null ? `${row.onTimeRate}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {formatDurationMinutes(row.avgDurationMinutes)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-800 tabular-nums">
                      {row.completionRate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

interface ActiveUnitsCbmSectionProps {
  vehicles: VehicleMaster[];
  assignments: Assignment[];
}

export const ActiveUnitsCbmSection: React.FC<ActiveUnitsCbmSectionProps> = ({
  vehicles,
  assignments,
}) => {
  const cbmSummary = useMemo(
    () => evaluateActiveUnitsCbmSummary(vehicles, assignments),
    [vehicles, assignments]
  );

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200 px-4 sm:px-6 py-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Perhitungan Volume Muatan (CBM) Per Unit — Sedang Bertugas
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Akumulasi kubikasi muatan (m³ / CBM) real-time terhadap kapasitas
            ruang box pada setiap unit berstatus Dalam Tugas
          </p>
        </div>
        <div className="text-xs font-mono font-semibold text-slate-700 tabular-nums">
          {cbmSummary.activeUnitsCount} Unit Bertugas ·{' '}
          {cbmSummary.activeAssignmentsCount} Surat Tugas Aktif
        </div>
      </div>

      {/* 4 KPI Summary Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border-b border-slate-200">
        <div className="bg-white p-3.5 sm:p-4 min-w-0">
          <p className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
            Unit Sedang Bertugas
          </p>
          <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-slate-900 tabular-nums">
            {cbmSummary.activeUnitsCount} Unit
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
            dari {vehicles.length} total armada
          </p>
        </div>

        <div className="bg-white p-3.5 sm:p-4 min-w-0">
          <p className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
            Total Muatan CBM Aktif
          </p>
          <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-sky-800 tabular-nums">
            {formatCbmValue(cbmSummary.totalUsedCbm)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
            {cbmSummary.activeAssignmentsCount} pengiriman berjalan
          </p>
        </div>

        <div className="bg-white p-3.5 sm:p-4 min-w-0">
          <p className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
            Kapasitas Box Unit Aktif
          </p>
          <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-slate-900 tabular-nums">
            {formatCbmValue(cbmSummary.totalCapacityCbm)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Total ruang unit bertugas
          </p>
        </div>

        <div className="bg-white p-3.5 sm:p-4 min-w-0">
          <p className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
            Sisa Ruang &amp; Utilitas CBM
          </p>
          <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-emerald-700 tabular-nums">
            {formatCbmValue(cbmSummary.totalRemainingCbm)}
          </p>
          <p className="mt-0.5 text-[11px] font-mono text-slate-600 tabular-nums">
            Utilitas rata-rata:{' '}
            {cbmSummary.avgUtilizationPct !== null
              ? `${cbmSummary.avgUtilizationPct}%`
              : '0%'}
          </p>
        </div>
      </div>

      {cbmSummary.units.length === 0 ? (
        <div className="p-5 sm:p-6">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-center">
            <p className="text-sm font-semibold text-slate-900">
              Belum Ada Unit Armada yang Sedang Bertugas (0 Unit)
            </p>
            <p className="mx-auto mt-1 max-w-xl text-xs text-slate-600 leading-relaxed">
              Seluruh unit armada saat ini berstatus Siap Jalan / tidak memiliki
              Surat Tugas aktif. Rincian kubikasi muatan (CBM), sisa ruang box,
              dan persentase utilitas per unit akan dihitung otomatis begitu
              Surat Tugas diterbitkan.
            </p>
            {vehicles.length > 0 && (
              <div className="mt-3.5 pt-3 border-t border-slate-200/80 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-slate-600 font-mono tabular-nums">
                {vehicles.map((v) => (
                  <span key={v.id}>
                    <strong className="text-slate-800">{v.plateNumber}</strong>:{' '}
                    {v.capacityCbm || '-'} ({v.capacity})
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="px-4 py-3">Unit &amp; No. Polisi</th>
                <th className="px-4 py-3">Surat Tugas Aktif &amp; Tujuan</th>
                <th className="px-4 py-3 text-right">Muatan Terpakai</th>
                <th className="px-4 py-3 text-right">Kapasitas Box</th>
                <th className="px-4 py-3 text-right">Sisa Ruang CBM</th>
                <th className="px-4 py-3 w-48">Utilitas Ruang (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {cbmSummary.units.map((u) => {
                const pctBar =
                  u.utilizationPct !== null
                    ? Math.min(100, Math.max(0, u.utilizationPct))
                    : 0;
                const barColor =
                  u.category === 'OVERLOAD'
                    ? 'bg-rose-600'
                    : u.category === 'OPTIMAL'
                    ? 'bg-emerald-600'
                    : u.category === 'MODERATE'
                    ? 'bg-sky-600'
                    : 'bg-amber-500';
                const pctTextColor =
                  u.category === 'OVERLOAD'
                    ? 'text-rose-700'
                    : u.category === 'OPTIMAL'
                    ? 'text-emerald-700'
                    : u.category === 'MODERATE'
                    ? 'text-sky-700'
                    : 'text-slate-700';

                return (
                  <tr key={u.unitId} className="hover:bg-slate-50/70 align-top">
                    <td className="px-4 py-3.5">
                      <p className="font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums">
                        {u.plateNumber}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {u.unitId} · {u.vehicleType}
                      </p>
                      <p className="mt-0.5 text-[11px] font-mono text-slate-500 tabular-nums">
                        Daya Angkut: {u.capacityWeight}
                      </p>
                    </td>

                    <td className="px-4 py-3.5">
                      {u.activeAssignments.length === 0 ? (
                        <span className="text-xs text-slate-500">
                          Status manual Dalam Tugas (tanpa Surat Tugas aktif)
                        </span>
                      ) : (
                        <div className="space-y-1.5">
                          {u.activeAssignments.map((item) => (
                            <div
                              key={item.id}
                              className="text-xs text-slate-700 leading-snug"
                            >
                              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                {item.noPenugasan}
                              </span>{' '}
                              · <span className="font-medium">{item.destination}</span>{' '}
                              ·{' '}
                              <span className="font-mono font-semibold text-sky-800 tabular-nums">
                                {item.volumeDisplay}
                              </span>
                              {item.beratMuatan ? (
                                <span className="text-slate-500 font-mono tabular-nums">
                                  {' '}
                                  · {item.beratMuatan}
                                </span>
                              ) : null}
                              <p className="text-[11px] text-slate-500">
                                Driver: {item.driverName} · {item.status}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right font-mono text-xs sm:text-sm font-bold text-sky-900 tabular-nums whitespace-nowrap">
                      {u.usedCbmDisplay}
                    </td>

                    <td className="px-4 py-3.5 text-right font-mono text-xs sm:text-sm font-semibold text-slate-800 tabular-nums whitespace-nowrap">
                      {u.capacityCbmDisplay}
                    </td>

                    <td className="px-4 py-3.5 text-right font-mono text-xs sm:text-sm tabular-nums whitespace-nowrap">
                      {u.overCbm > 0 ? (
                        <span className="font-bold text-rose-700">
                          +{formatCbmValue(u.overCbm)} (Overload)
                        </span>
                      ) : (
                        <span className="font-semibold text-emerald-700">
                          {u.remainingCbmDisplay}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-between gap-2 font-mono text-xs font-bold tabular-nums">
                        <span className={pctTextColor}>
                          {u.utilizationPct !== null
                            ? `${u.utilizationPct}%`
                            : '—'}
                        </span>
                        <span className="text-[11px] font-normal text-slate-500">
                          {u.category === 'OVERLOAD'
                            ? 'Melebihi Box'
                            : u.category === 'OPTIMAL'
                            ? 'Optimal'
                            : u.category === 'MODERATE'
                            ? 'Moderat'
                            : u.category === 'UNDERLOAD'
                            ? 'Ruang Longgar'
                            : 'Belum Diukur'}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${pctBar}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export function formatIdrCurrency(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (safe < 0) {
    return `-Rp ${Math.abs(safe).toLocaleString('id-ID')}`;
  }
  return `Rp ${safe.toLocaleString('id-ID')}`;
}

export interface FleetCardExpenseBreakdownRow {
  key: string;
  fleetCardId: string;
  cardNumber: string;
  shortCardLabel: string;
  txCount: number;
  totalPengirimanBbm: number;
  totalPengeluaranTol: number;
  totalPengeluaran: number;
  currentBalance: number | null;
}

export const FleetCardExpenseVisualizationSection: React.FC<{
  fleetCards: FleetCardMaster[];
  driverExpenses: DriverExpense[];
  onOpenFleetCardMenu?: () => void;
  onOpenExpensesMenu?: () => void;
  onPdfDownloaded?: (fileName: string, rowCount: number) => void;
}> = ({
  fleetCards,
  driverExpenses,
  onOpenFleetCardMenu,
  onOpenExpensesMenu,
  onPdfDownloaded,
}) => {
  const defaultTodayWib = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }, []);

  const [pdfPeriodMode, setPdfPeriodMode] =
    useState<ExpensePdfPeriodMode>('DAILY');
  const [pdfSelectedDate, setPdfSelectedDate] =
    useState<string>(defaultTodayWib);
  const [pdfSelectedMonth, setPdfSelectedMonth] = useState<string>(() =>
    defaultTodayWib.slice(0, 7)
  );
  const [pdfCardFilter, setPdfCardFilter] = useState<string>('ALL');
  const summary = useMemo(() => {
    const normalizeCardKey = (val: string) =>
      String(val || '')
        .trim()
        .replace(/[\s-]+/g, '')
        .toUpperCase();

    const mapByKey = new Map<string, FleetCardExpenseBreakdownRow>();

    for (const fc of fleetCards) {
      const cardNum = String(fc.cardNumber || '').trim() || fc.id;
      const normKey = normalizeCardKey(cardNum) || fc.id.toUpperCase();
      mapByKey.set(normKey, {
        key: normKey,
        fleetCardId: fc.id,
        cardNumber: cardNum,
        shortCardLabel:
          cardNum.length > 18 ? `...${cardNum.slice(-10)}` : cardNum,
        txCount: 0,
        totalPengirimanBbm: 0,
        totalPengeluaranTol: 0,
        totalPengeluaran: 0,
        currentBalance: Number.isFinite(fc.balance) ? fc.balance : 0,
      });
    }

    for (const exp of driverExpenses) {
      const rawCardNum =
        String(exp.fleetCardNumber || '').trim() ||
        String(exp.fleetCardId || '').trim() ||
        'Tanpa Nomor Kartu';
      const normKey = normalizeCardKey(rawCardNum) || 'TANPANOMORKARTU';

      let existing = mapByKey.get(normKey);
      if (!existing && exp.fleetCardId) {
        const matchedMaster = fleetCards.find(
          (fc) => fc.id.toLowerCase() === exp.fleetCardId.toLowerCase()
        );
        if (matchedMaster) {
          const masterKey =
            normalizeCardKey(matchedMaster.cardNumber) ||
            matchedMaster.id.toUpperCase();
          existing = mapByKey.get(masterKey);
        }
      }

      if (!existing) {
        existing = {
          key: normKey,
          fleetCardId: exp.fleetCardId || '-',
          cardNumber: rawCardNum,
          shortCardLabel:
            rawCardNum.length > 18 ? `...${rawCardNum.slice(-10)}` : rawCardNum,
          txCount: 0,
          totalPengirimanBbm: 0,
          totalPengeluaranTol: 0,
          totalPengeluaran: 0,
          currentBalance: null,
        };
        mapByKey.set(normKey, existing);
      }

      const bbm = Number.isFinite(exp.totalPengirimanBbm)
        ? Math.max(0, exp.totalPengirimanBbm)
        : 0;
      const tol = Number.isFinite(exp.totalPengeluaranTol)
        ? Math.max(0, exp.totalPengeluaranTol)
        : 0;
      const total =
        Number.isFinite(exp.totalPengeluaran) && exp.totalPengeluaran > 0
          ? exp.totalPengeluaran
          : bbm + tol;

      existing.txCount += 1;
      existing.totalPengirimanBbm += bbm;
      existing.totalPengeluaranTol += tol;
      existing.totalPengeluaran += total;
    }

    const rows = Array.from(mapByKey.values()).sort((a, b) => {
      if (b.totalPengeluaran !== a.totalPengeluaran) {
        return b.totalPengeluaran - a.totalPengeluaran;
      }
      return a.cardNumber.localeCompare(b.cardNumber);
    });

    const totalSaldoFleetCard = fleetCards.reduce(
      (acc, fc) => acc + (Number.isFinite(fc.balance) ? fc.balance : 0),
      0
    );
    const totalBbmAll = rows.reduce((acc, r) => acc + r.totalPengirimanBbm, 0);
    const totalTolAll = rows.reduce((acc, r) => acc + r.totalPengeluaranTol, 0);
    const totalExpenseAll = rows.reduce(
      (acc, r) => acc + r.totalPengeluaran,
      0
    );

    return {
      rows,
      totalSaldoFleetCard,
      totalBbmAll,
      totalTolAll,
      totalExpenseAll,
    };
  }, [fleetCards, driverExpenses]);

  const pdfPreviewMatchedCount = useMemo(
    () =>
      filterDriverExpensesForPdf(driverExpenses, {
        periodMode: pdfPeriodMode,
        selectedDate: pdfSelectedDate,
        selectedMonth: pdfSelectedMonth,
        fleetCardFilter: pdfCardFilter,
      }).length,
    [
      driverExpenses,
      pdfPeriodMode,
      pdfSelectedDate,
      pdfSelectedMonth,
      pdfCardFilter,
    ]
  );

  const selectableCardNumbers = useMemo(() => {
    const map = new Map<string, { cardNumber: string; id: string }>();
    for (const fc of fleetCards) {
      const cn = fc.cardNumber.trim();
      if (cn) map.set(cn.toUpperCase(), { cardNumber: cn, id: fc.id });
    }
    for (const r of summary.rows) {
      const cn = r.cardNumber.trim();
      if (cn && !map.has(cn.toUpperCase())) {
        map.set(cn.toUpperCase(), { cardNumber: cn, id: r.fleetCardId });
      }
    }
    return Array.from(map.values());
  }, [fleetCards, summary.rows]);

  const handleDownloadPdfClick = () => {
    const res = downloadFleetCardExpensePdfReport({
      expenses: driverExpenses,
      fleetCards,
      periodMode: pdfPeriodMode,
      selectedDate: pdfSelectedDate,
      selectedMonth: pdfSelectedMonth,
      fleetCardFilter: pdfCardFilter,
    });
    if (onPdfDownloaded) {
      onPdfDownloaded(res.fileName, res.rowCount);
    }
  };

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="flex items-center gap-2 text-sm sm:text-base font-bold text-slate-900">
            <CreditCard className="h-4 w-4 shrink-0 text-sky-700" />
            <span>
              Visualisasi Kalkulasi Pengeluaran Berdasarkan Nomor Kartu Fleet Card
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Akumulasi real-time Total Pembelian BBM, Total Pengeluaran Tol, dan sisa saldo per Nomor Kartu Fleet Card dari laporan harian Driver.
          </p>
        </div>

        {(onOpenFleetCardMenu || onOpenExpensesMenu) && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onOpenFleetCardMenu && (
              <button
                type="button"
                onClick={onOpenFleetCardMenu}
                className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Master Kartu Fleet Card ({fleetCards.length})
              </button>
            )}
            {onOpenExpensesMenu && (
              <button
                type="button"
                onClick={onOpenExpensesMenu}
                className="min-h-[38px] rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                Data_Pengeluaran Driver ({driverExpenses.length})
              </button>
            )}
          </div>
        )}
      </div>

      {/* PDF Report Filter & Unduh PDF Toolbar */}
      <div className="flex flex-col gap-2.5 border-b border-slate-200 bg-slate-50/90 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="text-xs text-slate-700">
          <span className="font-semibold text-slate-900">
            Unduh Laporan Detail Pengeluaran (PDF):
          </span>{' '}
          <span className="text-slate-600">
            Filter Harian atau Bulanan berdasarkan Nomor Kartu Fleet Card
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Pilih periode laporan PDF"
            className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5"
          >
            <button
              type="button"
              onClick={() => setPdfPeriodMode('DAILY')}
              className={`min-h-[34px] rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                pdfPeriodMode === 'DAILY'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              Harian
            </button>
            <button
              type="button"
              onClick={() => setPdfPeriodMode('MONTHLY')}
              className={`min-h-[34px] rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                pdfPeriodMode === 'MONTHLY'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              Bulanan
            </button>
          </div>

          {pdfPeriodMode === 'DAILY' ? (
            <input
              type="date"
              value={pdfSelectedDate}
              onChange={(e) => setPdfSelectedDate(e.target.value)}
              aria-label="Pilih tanggal laporan pengeluaran harian"
              className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
            />
          ) : (
            <input
              type="month"
              value={pdfSelectedMonth}
              onChange={(e) => setPdfSelectedMonth(e.target.value)}
              aria-label="Pilih bulan laporan pengeluaran bulanan"
              className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
            />
          )}

          <select
            value={pdfCardFilter}
            onChange={(e) => setPdfCardFilter(e.target.value)}
            aria-label="Filter Nomor Kartu Fleet Card untuk PDF"
            className="min-h-[38px] max-w-[240px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs font-semibold text-slate-800 tabular-nums focus:border-slate-900 focus:outline-none"
          >
            <option value="ALL">Semua Nomor Fleet Card</option>
            {selectableCardNumbers.map((c) => (
              <option key={c.cardNumber} value={c.cardNumber}>
                {c.cardNumber} ({c.id})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleDownloadPdfClick}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Unduh PDF</span>
            <span className="font-mono text-[11px] text-emerald-100 tabular-nums">
              ({pdfPreviewMatchedCount})
            </span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-4">
        <div className="bg-slate-50/75 p-3.5 sm:p-4">
          <p className="text-[11px] font-medium text-slate-500">
            Total Saldo Fleet Card ({fleetCards.length} Kartu)
          </p>
          <p
            className={`mt-1 font-mono text-base sm:text-lg font-bold tabular-nums ${
              summary.totalSaldoFleetCard < 0
                ? 'text-rose-700'
                : 'text-emerald-700'
            }`}
          >
            {formatIdrCurrency(summary.totalSaldoFleetCard)}
          </p>
        </div>

        <div className="bg-slate-50/75 p-3.5 sm:p-4">
          <p className="text-[11px] font-medium text-slate-500">
            Total Pembelian BBM
          </p>
          <p className="mt-1 font-mono text-base sm:text-lg font-bold text-sky-700 tabular-nums">
            {formatIdrCurrency(summary.totalBbmAll)}
          </p>
        </div>

        <div className="bg-slate-50/75 p-3.5 sm:p-4">
          <p className="text-[11px] font-medium text-slate-500">
            Total Pengeluaran Tol
          </p>
          <p className="mt-1 font-mono text-base sm:text-lg font-bold text-slate-900 tabular-nums">
            {formatIdrCurrency(summary.totalTolAll)}
          </p>
        </div>

        <div className="bg-slate-50/75 p-3.5 sm:p-4">
          <p className="text-[11px] font-medium text-slate-500">
            Akumulasi Pengeluaran ({driverExpenses.length} Laporan)
          </p>
          <p className="mt-1 font-mono text-base sm:text-lg font-bold text-slate-900 tabular-nums">
            {formatIdrCurrency(summary.totalExpenseAll)}
          </p>
        </div>
      </div>

      {summary.rows.length === 0 ? (
        <div className="px-6 py-9 text-center">
          <p className="text-sm font-semibold text-slate-900">
            Belum Ada Kartu Fleet Card atau Laporan Pengeluaran Driver
          </p>
          <p className="mx-auto mt-1 max-w-xl text-xs text-slate-500">
            Tambahkan data kartu pada menu Master Kartu Fleet Card. Saat Driver menyelesaikan Surat Tugas harian dan mengirim Form Input Pengeluaran, grafik serta kalkulasi pengeluaran per Nomor Kartu Fleet Card akan tampil otomatis di sini.
          </p>
          {onOpenFleetCardMenu && (
            <button
              type="button"
              onClick={onOpenFleetCardMenu}
              className="mt-4 inline-flex min-h-[40px] items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
            >
              Kelola Master Kartu Fleet Card
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {/* Recharts BarChart per Nomor Kartu Fleet Card */}
          <div className="p-4 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-800">
                Perbandingan Pembelian BBM &amp; Pengeluaran Tol per Nomor Kartu Fleet Card
              </span>
              <span className="font-mono tabular-nums">
                {summary.rows.length} Kartu Tercatat
              </span>
            </div>

            <div className="h-64 w-full sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={summary.rows}
                  margin={{ top: 10, right: 16, left: 8, bottom: 16 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e2e8f0"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="shortCardLabel"
                    tick={{ fill: '#334155', fontSize: 11 }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(val: number) => {
                      if (val >= 1_000_000) {
                        return `Rp ${(val / 1_000_000).toFixed(1)}Jt`;
                      }
                      if (val >= 1_000) {
                        return `Rp ${Math.round(val / 1_000)}Rb`;
                      }
                      return `Rp ${val}`;
                    }}
                    tick={{ fill: '#475569', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={76}
                  />
                  <Tooltip
                    formatter={(value: unknown, name: unknown) => [
                      formatIdrCurrency(Number(value) || 0),
                      String(name),
                    ]}
                    labelFormatter={(_label, payload) => {
                      const first = payload && payload[0]?.payload as
                        | FleetCardExpenseBreakdownRow
                        | undefined;
                      if (!first) return String(_label);
                      return `Kartu: ${first.cardNumber} (${first.fleetCardId})`;
                    }}
                    contentStyle={{
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar
                    dataKey="totalPengirimanBbm"
                    name="Total Pembelian BBM"
                    fill="#0284c7"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={44}
                  />
                  <Bar
                    dataKey="totalPengeluaranTol"
                    name="Total Pengeluaran Tol"
                    fill="#0f172a"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={44}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Breakdown Table by Nomor Kartu Fleet Card */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3">ID Fleet Card</th>
                  <th className="px-4 py-3">Nomor Kartu Fleet Card</th>
                  <th className="px-4 py-3 text-right">Laporan</th>
                  <th className="px-4 py-3 text-right">Total Pembelian BBM</th>
                  <th className="px-4 py-3 text-right">Total Pengeluaran Tol</th>
                  <th className="px-4 py-3 text-right">Total Pengeluaran</th>
                  <th className="px-4 py-3 text-right">Sisa Saldo Fleet Card</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.rows.map((row) => (
                  <tr
                    key={row.key}
                    className="transition-colors hover:bg-slate-50/70"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                      {row.fleetCardId}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
                      {row.cardNumber}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {row.txCount}x
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs sm:text-sm font-semibold text-sky-800 tabular-nums whitespace-nowrap">
                      {formatIdrCurrency(row.totalPengirimanBbm)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs sm:text-sm font-semibold text-slate-800 tabular-nums whitespace-nowrap">
                      {formatIdrCurrency(row.totalPengeluaranTol)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatIdrCurrency(row.totalPengeluaran)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs sm:text-sm font-bold tabular-nums whitespace-nowrap">
                      {row.currentBalance === null ? (
                        <span className="font-normal text-slate-400">
                          Belum Terdaftar
                        </span>
                      ) : (
                        <span
                          className={
                            row.currentBalance < 0
                              ? 'text-rose-700'
                              : 'text-emerald-700'
                          }
                        >
                          {formatIdrCurrency(row.currentBalance)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};


