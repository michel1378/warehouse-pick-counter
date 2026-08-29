import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDays, startOfMonth, subDays } from "date-fns";
import { env } from "@/lib/env";

export function warehouseToday() {
  return formatInTimeZone(new Date(), env().WAREHOUSE_TIMEZONE, "yyyy-MM-dd");
}

export function utcRange(from: string, to: string) {
  const zone = env().WAREHOUSE_TIMEZONE;
  return {
    fromUtc: fromZonedTime(`${from}T00:00:00`, zone).toISOString(),
    toUtc: fromZonedTime(`${formatInTimeZone(addDays(new Date(`${to}T12:00:00Z`), 1), "UTC", "yyyy-MM-dd")}T00:00:00`, zone).toISOString(),
  };
}

export function presetRange(preset: string) {
  const todayText = warehouseToday();
  const noon = new Date(`${todayText}T12:00:00Z`);
  const fmt = (d: Date) => formatInTimeZone(d, "UTC", "yyyy-MM-dd");
  if (preset === "yesterday") return { from: fmt(subDays(noon, 1)), to: fmt(subDays(noon, 1)) };
  if (preset === "7days") return { from: fmt(subDays(noon, 6)), to: todayText };
  if (preset === "month") return { from: fmt(startOfMonth(noon)), to: todayText };
  return { from: todayText, to: todayText };
}

export function formatWarehouseDateTime(value: string) {
  return formatInTimeZone(new Date(value), env().WAREHOUSE_TIMEZONE, "dd.MM.yyyy HH:mm:ss");
}
