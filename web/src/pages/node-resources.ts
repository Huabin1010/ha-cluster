/** Host RAM/disk meters for the nodes table. Ledger used_* is workspace allocation, not OS usage. */

export type NodeResourceFields = {
  mem_total_bytes?: number;
  mem_available_bytes?: number;
  used_mem_bytes?: number;
  allocatable_mem_bytes?: number;
  disk_total_bytes?: number;
  disk_free_bytes?: number;
  used_disk_bytes?: number;
  allocatable_disk_bytes?: number;
};

export type ResourceMeterModel = {
  used: number;
  total: number;
  free: number;
  ledgerUsed: number;
  ledgerTotal: number;
  source: "host" | "ledger";
};

function hostMeter(total: number, free: number | undefined, ledgerUsed: number, ledgerTotal: number): ResourceMeterModel {
  if (total > 0 && free != null && free >= 0) {
    return {
      used: Math.max(0, total - free),
      total,
      free,
      ledgerUsed,
      ledgerTotal,
      source: "host",
    };
  }
  return {
    used: ledgerUsed,
    total: ledgerTotal,
    free: free ?? 0,
    ledgerUsed,
    ledgerTotal,
    source: "ledger",
  };
}

export function hostMemMeter(n: NodeResourceFields): ResourceMeterModel {
  return hostMeter(
    n.mem_total_bytes ?? 0,
    n.mem_available_bytes,
    n.used_mem_bytes ?? 0,
    n.allocatable_mem_bytes ?? 0,
  );
}

export function hostDiskMeter(n: NodeResourceFields): ResourceMeterModel {
  return hostMeter(
    n.disk_total_bytes ?? 0,
    n.disk_free_bytes,
    n.used_disk_bytes ?? 0,
    n.allocatable_disk_bytes ?? 0,
  );
}

export function isHostPressure(meter: ResourceMeterModel, ratio = 0.1): boolean {
  if (meter.source !== "host" || meter.total <= 0) return false;
  return meter.free < meter.total * ratio;
}
