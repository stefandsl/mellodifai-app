export function nextPacificQuotaTime(now = new Date()): string {
  const day = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  // Search the UTC minute grid for the next local day; this also handles DST.
  const today = day(now);
  let time = Math.floor(now.getTime() / 60000) * 60000 + 60000;
  while (day(new Date(time)) === today) time += 60000;
  return new Date(time + 5 * 60000).toISOString();
}
