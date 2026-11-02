export async function preparePhoto(file: File): Promise<string> {
  if (!/image\/(jpeg|png|webp)/.test(file.type) || file.size > 15 * 1024 * 1024) throw new Error("Выберите JPEG, PNG или WebP до 15 МБ.");
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error("Не удалось открыть фотографию.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Браузер не смог обработать фото.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.68, 0.5, 0.35]) {
      const result = canvas.toDataURL("image/jpeg", quality);
      if (result.length <= 400000) return result;
    }
    throw new Error("Фото слишком сложное для сжатия. Выберите уменьшенную копию.");
  } finally { bitmap.close(); }
}
