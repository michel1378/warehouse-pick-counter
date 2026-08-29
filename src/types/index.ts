export type SessionRole = "employee" | "admin";

export type AppSession = {
  sub: string;
  name: string;
  role: SessionRole;
};

export type ScanResult =
  | { success: true; scannedAt: string }
  | { success: false; reason: "duplicate"; scannedAt: string; employeeName: string }
  | { success: false; reason: "manual" };

export type Employee = {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
};

export type StatsRow = {
  id: string;
  name: string;
  successful: number;
  amount: number;
  duplicates: number;
};
