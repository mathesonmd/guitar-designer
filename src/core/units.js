// Unit handling. The design is stored in millimeters; inches are a display/input choice.
export const MM_PER_IN = 25.4;
export const inch = (v) => v * MM_PER_IN;

// "2-3/16" for values that sit on a 64th of an inch, otherwise null.
export function fractionLabel(inches, tolIn = 0.0006) {
  const sign = inches < 0 ? '-' : '';
  const v = Math.abs(inches);
  const n = Math.round(v * 64);
  if (Math.abs(v - n / 64) > tolIn || n === 0) return null;
  let num = n % 64, den = 64;
  const whole = (n - num) / 64;
  while (num && num % 2 === 0) { num /= 2; den /= 2; }
  if (!num) return `${sign}${whole}`;
  return `${sign}${whole ? whole + '-' : ''}${num}/${den}`;
}

// Format a millimeter value for display in the chosen unit.
export function fmtLen(mm, units = 'in', digits) {
  if (!isFinite(mm)) return '—';
  if (units === 'mm') return mm.toFixed(digits ?? 2);
  return (mm / MM_PER_IN).toFixed(digits ?? 3);
}
export const unitLabel = (units) => (units === 'mm' ? 'mm' : 'in');
export const fmtWithUnit = (mm, units, digits) => `${fmtLen(mm, units, digits)} ${unitLabel(units)}`;

// Parse what someone types: 55.5, 2.1875, 2-3/16, 2 3/16, 3/16, with optional in / " / mm suffix.
// Returns millimeters, or NaN when the text is not a length.
export function parseLen(text, units = 'in') {
  if (typeof text === 'number') return units === 'mm' ? text : text * MM_PER_IN;
  let s = String(text).trim().toLowerCase();
  if (!s) return NaN;
  let u = units;
  const m = s.match(/(mm|in|inch|inches|")\s*$/);
  if (m) { u = m[1] === 'mm' ? 'mm' : 'in'; s = s.slice(0, m.index).trim(); }
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1).trim(); }
  let v;
  const mixed = s.match(/^(\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (mixed) v = +mixed[1] + +mixed[2] / +mixed[3];
  else if (frac) v = +frac[1] / +frac[2];
  else if (/^\d*\.?\d+$/.test(s) || /^\d+\.$/.test(s)) v = parseFloat(s);
  else return NaN;
  if (!isFinite(v)) return NaN;
  if (neg) v = -v;
  return u === 'mm' ? v : v * MM_PER_IN;
}
