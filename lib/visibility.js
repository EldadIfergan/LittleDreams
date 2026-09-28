export function visibility(value, fallback='family') {
  const result=value===undefined?fallback:value;
  if(!['family','parents'].includes(result))throw Object.assign(new Error('יש לבחור למי האירוע גלוי'),{status:400});
  return result;
}
export const canView=(role,moment)=>role==='parent'||moment.visibility==='family';
