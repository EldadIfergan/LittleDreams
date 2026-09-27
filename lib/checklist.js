export const milestones = [
  ['smile','החיוך הראשון'], ['head','הרמת הראש'],
  ['reach','הושטת יד לצעצוע'], ['roll','ההתהפכות הראשונה'],
  ['transfer','העברת צעצוע מיד ליד'], ['sit','ישיבה עצמאית'],
  ['crawl','הזחילה הראשונה'], ['wave','נפנוף לשלום'],
  ['stand','עמידה ראשונה'], ['steps','הצעדים הראשונים'],
  ['word','המילה הראשונה'], ['spoon','אכילה בכפית לבד']
].map(([key,title])=>({key,title}));
export function milestoneKey(key) {
  if(!milestones.some(item=>item.key===key)) throw Object.assign(new Error('אבן הדרך אינה מוכרת'),{status:400});
  return key;
}
export function checklist(rows) {
  return milestones.map(item=>{const row=rows.find(row=>row.key===item.key);return {...item,completed:!!row?.completed,momentId:row?.moment_id || null};});
}
