export const REMINDER_OPTIONS = [15, 20, 30, 45, 60, 120, 180, 360, 720, 1440, 2880, 4320, 10080];
export function formatMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 0) return "—";
  const parts = [[Math.floor(minutes / 1440), "dia", "dias"], [Math.floor(minutes % 1440 / 60), "hora", "horas"], [minutes % 60, "minuto", "minutos"]];
  return parts.filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(" e ") || "0 minutos";
}
