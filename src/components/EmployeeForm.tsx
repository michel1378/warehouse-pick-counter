import { saveEmployee } from "@/app/actions";
import { SubmitForm } from "@/components/SubmitForm";
import type { Employee } from "@/types";

export function EmployeeForm({ employee }: { employee?: Employee }) {
  const permissions = employee?.permissions ?? ["picking"];
  return <SubmitForm action={saveEmployee} className="employee-form">
    <input type="hidden" name="id" value={employee?.id ?? ""} />
    <label>Имя<input name="name" defaultValue={employee?.name} maxLength={120} required /></label>
    <label>{employee ? "Новый PIN (не заполняйте, чтобы не менять)" : "PIN"}<input name="pin" type="password" minLength={employee ? undefined : 4} maxLength={32} required={!employee} autoComplete="new-password" /></label>
    <label>Тип<select name="role" defaultValue={employee?.role ?? "warehouse"}><option value="warehouse">Склад</option><option value="online">Онлайн</option></select></label>
    <fieldset><legend>Доступы</legend><label><input type="checkbox" name="permissions" value="picking" defaultChecked={permissions.includes("picking")} /> Сборка заказов</label><label><input type="checkbox" name="permissions" value="attendance" defaultChecked={permissions.includes("attendance")} /> Отметки</label></fieldset>
  </SubmitForm>;
}
