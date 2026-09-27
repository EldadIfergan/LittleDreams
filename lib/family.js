// A phone number is contact information, never a login credential or account key.
export const familyRelationships=Object.freeze({grandmother:'סבתא',grandfather:'סבא',aunt:'דודה',uncle:'דוד',sister:'אחות',brother:'אח',female_cousin:'בת דודה',male_cousin:'בן דוד',family_friend:'',other:''});
export const familySessionSeconds=90*24*60*60;
const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
export function inviteToken(value) {
  if(typeof value!=='string'||!/^[a-f0-9]{48}$/.test(value))invalid('קישור ההזמנה אינו תקין. בקשו מההורים קישור חדש.');
  return value;
}
export function familyDetails(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))invalid('יש למלא טלפון, שם וקרבה לילד או לילדה.');
  if(typeof value.name!=='string'||!value.name.trim()||value.name.trim().length>80)invalid('יש למלא שם, עד 80 תווים.');
  if(typeof value.relationship!=='string'||!Object.hasOwn(familyRelationships,value.relationship))invalid('יש לבחור את הקרבה לילד או לילדה.');
  if(typeof value.phone!=='string'||value.phone.length>30)invalid('יש למלא מספר טלפון תקין.');
  let phone=value.phone.trim().replace(/[\s()\-]/g,'');
  if(phone.startsWith('00'))phone='+'+phone.slice(2);
  if(/^0[2-9]\d{7,8}$/.test(phone))phone='+972'+phone.slice(1);
  if(!/^\+[1-9]\d{7,14}$/.test(phone))invalid('יש למלא טלפון ישראלי או מספר עם קידומת מדינה.');
  return {name:value.name.trim(),phone,relationship:value.relationship};
}
export function familyAuthor(name,relationship) {
  const label=Object.hasOwn(familyRelationships,relationship)?familyRelationships[relationship]:'';
  return label&&!name.startsWith(label+' ')?`${label} ${name}`:name;
}
