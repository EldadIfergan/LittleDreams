export const photoTypes = ['image/jpeg','image/png','image/webp','image/gif'];
export const photoLimit = 10 * 1024 * 1024;
const fail = message => { throw Object.assign(new Error(message),{status:400}); };
export function photoDetails(file) {
  if(!file || !photoTypes.includes(file.type) || !Number.isInteger(file.size) || file.size<=0 || file.size>photoLimit) fail('בחרו תמונות JPG, PNG, WebP או GIF עד 10MB לתמונה');
  if(typeof file.name!=='string' || !file.name.trim() || file.name.trim().length>200) fail('שם התמונה אינו תקין');
  return {name:file.name.trim(),type:file.type,size:file.size};
}
export function requestFiles(files) {
  if(!Array.isArray(files) || !files.length || files.length>10 || files.some(f=>!f || typeof f!=='object')) fail('בחרו בין תמונה אחת ל־10 תמונות');
}
export function reviewDecision(decision) {
  if(!['approved','rejected'].includes(decision)) fail('יש לבחור אישור או דחייה');
}
export function approvalCapacity(count,size) {
  if(count>10) fail('באירוע כבר יש 10 קבצים. הסירו קובץ בעריכת האירוע ואז נסו לאשר שוב');
  if(!Number.isFinite(size) || size>100*1024*1024) fail('התמונה תחרוג ממגבלת 100MB באירוע. פנו מקום ונסו שוב');
}
