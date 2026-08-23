// Local calendar day, not UTC -- toISOString() alone can land on yesterday
// or tomorrow depending on the user's timezone offset.
export function todayISO(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// Adds (or subtracts, for negative delta) whole days to an ISO "YYYY-MM-DD"
// date string, staying in local-calendar-day terms the same way todayISO()
// does -- never routes through a UTC-midnight Date for the input.
export function addDaysISO(dateISO: string, delta: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const d = new Date(year, month - 1, day + delta);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
