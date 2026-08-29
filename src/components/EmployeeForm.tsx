import { saveEmployee } from "@/app/actions";
import { SubmitForm } from "@/components/SubmitForm";
import type { Employee } from "@/types";

export function EmployeeForm({ employee }: { employee?: Employee }) {
  return <SubmitForm action={saveEmployee} className="employee-form"><input type="hidden" name="id" value={employee?.id ?? ""} /><label>Имя<input name="name" defaultValue={employee?.name} maxLength={120} required /></label><label>{employee ? "Новый PIN (оставьте пустым, чтобы не менять)" : "PIN"}<input name="pin" type="password" minLength={employee ? undefined : 4} maxLength={32} required={!employee} autoComplete="new-password" /></label></SubmitForm>;
}
