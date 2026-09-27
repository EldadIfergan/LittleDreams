export function birthTime(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Object.assign(new Error('יש להזין שעת לידה תקינה'),{status:400});
  return value;
}
