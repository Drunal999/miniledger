/**
 * Rupee strings like "1500" or "1500.5" become integer paise (150000, 150050).
 * Parsing the string ourselves avoids floating point: 19.99 * 100 is 1998.9999999999998 in JS.
 */
export function rupeesToPaise(rupees: string): number {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(rupees.trim())
  if (!m) throw new Error('Amount must be a positive number with at most 2 decimals')
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}
