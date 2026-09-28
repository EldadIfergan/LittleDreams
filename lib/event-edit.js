export function planEdit(body, moment, files) {
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  if (!moment || moment.album_id !== body.album) fail(404,'האירוע לא נמצא באלבום');
  const original=body.original;
  if (!original || !Array.isArray(original.files) || !Array.isArray(body.keepFiles) || body.keepFiles.some(x=>typeof x!=='string') || new Set(body.keepFiles).size!==body.keepFiles.length) fail(400,'פרטי העריכה אינם תקינים');
  if ((original.visibility??'family')!==(moment.visibility??'family') || original.title!==moment.title || original.date!==moment.date || original.description!==moment.description || [...original.files].sort().join(',')!==files.map(f=>f.id).sort().join(',')) fail(409,'האירוע השתנה מאז שפתחתם אותו. סגרו את החלון ופתחו את האירוע מחדש');
  if (body.keepFiles.some(id=>!files.some(f=>f.id===id))) fail(400,'אחד הקבצים אינו שייך לאירוע');
  return {kept:files.filter(f=>body.keepFiles.includes(f.id)),removed:files.filter(f=>!body.keepFiles.includes(f.id))};
}
