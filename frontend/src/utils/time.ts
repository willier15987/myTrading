const TZ_OFFSET_SEC = 8 * 3600;

export function formatTimeTW(utcSec: number): string {
  const d = new Date((utcSec + TZ_OFFSET_SEC) * 1000);
  const yy = String(d.getUTCFullYear()).slice(2);
  const M = d.getUTCMonth() + 1;
  const D = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yy}/${M}/${D}-${hh}:${mm}`;
}
