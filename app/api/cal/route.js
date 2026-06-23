export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || "";
  const time = searchParams.get("time") || "20:00";
  const label = searchParams.get("label") || "";

  const [y, mo, d] = date.split("-");
  const [h, mi] = time.split(":");
  const p2 = (n) => String(parseInt(n)).padStart(2, "0");

  const start = `${y}${p2(mo)}${p2(d)}T${p2(h)}${p2(mi)}00`;
  const endH = String(parseInt(h) + 2).padStart(2, "0");
  const end = `${y}${p2(mo)}${p2(d)}T${endH}${p2(mi)}00`;
  const title = label ? `SHTER repetitie — ${label}` : "SHTER repetitie";

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SHTER//Bandplanning//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${title}`,
    `UID:shter-${date}-${time}@shter.app`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="repetitie.ics"`,
    },
  });
}
