import { toggleEmployee } from "@/app/actions";
import { EmployeeForm } from "@/components/EmployeeForm";
import { createAdminClient } from "@/lib/supabase";
import type { Employee } from "@/types";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function EmployeesPage() {
  const session = await getSession(); if (!session || session.role !== "admin") redirect("/admin/login");
  const { data } = await createAdminClient().from("employees").select("id,name,active,created_at").order("name");
  const employees = (data ?? []) as Employee[];
  return <><p className="eyebrow">Управление</p><h1>Сотрудники</h1><section className="card section"><h2>Добавить сотрудника</h2><EmployeeForm /></section><section className="employee-list">{employees.map((employee) => <details className="card employee-card" key={employee.id}><summary><span>{employee.name}</span><span className={employee.active ? "badge active" : "badge"}>{employee.active ? "Активен" : "Отключен"}</span></summary><EmployeeForm employee={employee} /><form action={toggleEmployee}><input type="hidden" name="id" value={employee.id} /><input type="hidden" name="active" value={String(!employee.active)} /><button className={employee.active ? "danger" : "secondary"}>{employee.active ? "Отключить" : "Включить"}</button></form></details>)}</section></>;
}
