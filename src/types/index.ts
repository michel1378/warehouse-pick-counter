export type SessionRole = "employee" | "admin";

export type AppSession = {
  sub: string;
  name: string;
  role: SessionRole;
  employeeRole?: "warehouse" | "online";
  permissions?: string[];
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
  role: "warehouse" | "online";
  permissions: string[];
};

export type StatsRow = {
  id: string;
  name: string;
  successful: number;
  amount: number;
  duplicates: number;
  too_fast: number;
};
