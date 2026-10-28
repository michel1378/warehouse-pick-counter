import { findSizeConflicts, FIT_LABELS, type SizeProduct } from "@/lib/sizes";

export function SizeConflicts({ product }: { product: Pick<SizeProduct, "sizes" | "examples"> }) {
  const conflicts = findSizeConflicts(product);
  if (!conflicts.length) return null;
  return <div className="size-conflicts" role="status">
    <b>Проверьте противоречащие рекомендации</b>
    <p>Для одинаковых роста, веса и посадки записаны разные размеры. Строки сохранены без изменений; верную рекомендацию должен подтвердить владелец.</p>
    <ul>{conflicts.map((c, i) => <li key={i}>
      Строка {c.firstRow}: {c.first.height} см / {c.first.weight} кг / {FIT_LABELS[c.first.fit]} → {c.first.size};
      {" "}строка {c.secondRow}: {c.second.height} см / {c.second.weight} кг / {FIT_LABELS[c.second.fit]} → {c.second.size}.
    </li>)}</ul>
  </div>;
}
