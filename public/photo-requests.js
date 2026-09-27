const $=selector=>document.querySelector(selector);
const types=['image/jpeg','image/png','image/webp','image/gif'];
let selected=[],moment,context,controller;
const uploaded=new WeakMap();
function node(tag,text,className) {const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;}
function clearSelection() {selected.forEach(item=>URL.revokeObjectURL(item.url));selected=[];}
function renderSelection() {
  $('#photo-selected').replaceChildren(...selected.map((item,index)=>{
    const row=node('div',null,'photo-selected-row');
    const img=node('img');img.src=item.url;img.alt='תמונה שנבחרה: '+item.file.name;
    const remove=node('button','הסרת התמונה','secondary');remove.type='button';
    remove.onclick=()=>{URL.revokeObjectURL(item.url);selected.splice(index,1);renderSelection();};
    row.append(img,node('span',item.file.name),remove);return row;
  }));
}
export function requestControl(event,requests,options) {
  const section=node('section',null,'photo-request-control');
  const button=node('button','יש לי תמונות מהרגע הזה','secondary');button.type='button';
  button.onclick=()=>{
    moment=event;context=options;clearSelection();$('#photo-request-form').reset();renderSelection();
    $('#photo-request-error').textContent='';$('#photo-request-progress').textContent='';
    $('#photo-request-moment').textContent='שליחת תמונות לרגע: '+event.title;$('#photo-request-dialog').showModal();
  };
  section.append(button,node('p','אפשר לשלוח תמונות משלכם לאישור ההורים.'));
  const own=requests.filter(r=>r.moment_id===event.id);
  for(const [status,label,singular] of [['pending','ממתינות לאישור ההורים','ממתינה לאישור ההורים'],['approved','אושרו על ידי ההורים','אושרה על ידי ההורים'],['rejected','לא אושרו להוספה לאלבום','לא אושרה להוספה לאלבום']]) {
    const count=own.filter(r=>r.status===status).length;
    if(count)section.append(node('p',count===1?`התמונה ששלחתם ${singular}.`:`${count} תמונות ששלחתם ${label}.`,'photo-request-state'));
  }
  return section;
}
export function renderQueue(requests,options) {
  $('#photo-review').hidden=!requests.length;
  $('#photo-review-title').textContent=`תמונות שממתינות לאישור (${requests.length})`;
  $('#photo-review-list').replaceChildren(...requests.map(request=>{
    const card=node('article',null,'photo-review-card');
    const img=node('img');img.src='/api/photo-requests/files/'+request.id;img.alt='תמונה שנשלחה על ידי '+request.author;img.loading='lazy';
    const enlarge=node('button','הגדלת התמונה','secondary');enlarge.type='button';enlarge.onclick=()=>options.preview(request);
    const error=node('p',null,'error');error.setAttribute('role','alert');
    const actions=node('div',null,'photo-review-actions');
    for(const [decision,label] of [['approved','אישור והוספה לרגע'],['rejected','דחיית התמונה']]) {
      const button=node('button',label,decision==='approved'?'primary':'secondary');button.type='button';
      button.onclick=async()=>{
        actions.querySelectorAll('button').forEach(b=>b.disabled=true);error.textContent='';
        try {
          await options.api('/api/photo-requests/review',{id:request.id,decision});
          card.remove();
          await options.onChange();
          $('#photo-status').textContent=decision==='approved'?'התמונה אושרה ונוספה לרגע.':'התמונה נדחתה ולא נוספה לאלבום.';
        } catch(e) {error.textContent=e.message;actions.querySelectorAll('button').forEach(b=>b.disabled=false);if(!card.isConnected)$('#page-error').textContent='הבקשה טופלה, אך הרענון נכשל. רעננו את הדף.';}
      };actions.append(button);
    }
    card.append(node('h3',request.moment_title),node('p',`נשלחה על ידי ${request.author}`),img,enlarge,actions,error);return card;
  }));
}
$('#photo-picker').onchange=event=>{
  const incoming=Array.from(event.target.files||[]);event.target.value='';
  if(!incoming.length)return;
  const pending=selected.length+incoming.length;
  if(pending>10){$('#photo-request-error').textContent='אפשר לבחור עד 10 תמונות. בחרו פחות תמונות.';return;}
  if(incoming.some(file=>!types.includes(file.type)||!file.size||file.size>10*1024*1024)) {$('#photo-request-error').textContent='בחרו תמונות JPG, PNG, WebP או GIF עד 10MB לתמונה.';return;}
  selected.push(...incoming.map(file=>({file,url:URL.createObjectURL(file)})));renderSelection();
  $('#photo-request-error').textContent='';$('#photo-request-progress').textContent=(selected.length===1?'נבחרה תמונה אחת.':`נבחרו ${selected.length} תמונות.`)+' לחצו על שליחת התמונות לאישור.';
};
$('#photo-request-dialog').addEventListener('cancel',event=>{if(controller)event.preventDefault();});
$('#photo-request-dialog').addEventListener('close',clearSelection);
$('#photo-cancel').onclick=()=>controller?.abort();
const base64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('לא ניתן לקרוא את התמונה'));reader.readAsDataURL(file);});
$('#photo-request-form').onsubmit=async event=>{
  event.preventDefault();if(controller)return;
  if(!selected.length){$('#photo-request-error').textContent='בחרו לפחות תמונה אחת לפני השליחה.';return;}
  controller=new AbortController();const signal=controller.signal;
  const controls=[...event.target.querySelectorAll('input,button')];controls.forEach(b=>b.disabled=true);
  $('#photo-cancel').hidden=false;$('#photo-cancel').disabled=false;$('#photo-request-error').textContent='';
  const progress=text=>$('#photo-request-progress').textContent=text;
  let sent=false;
  try {
    const config=await context.api('/api/config'),files=[];
    const {uploadFile}=await import('/media.js');
    for(const [index,{file}] of selected.entries()) {
      if(signal.aborted)throw new DOMException('בוטל','AbortError');
      if(config.directUploads) {
        let upload=uploaded.get(file);
        if(!upload || upload.moment!==moment.id || upload.expires<Date.now()) {
          upload=await context.api('/api/photo-requests/uploads',{moment:moment.id,name:file.name,type:file.type,size:file.size});
          await uploadFile(upload.url,file,{signal,onProgress:p=>progress(`שולחים תמונה ${index+1} מתוך ${selected.length}: ${p}%`)});
          upload={...upload,moment:moment.id,expires:Date.now()+3600000};uploaded.set(file,upload);
        }
        files.push({id:upload.id});
      } else {progress(`מכינים תמונה ${index+1} מתוך ${selected.length}…`);files.push({name:file.name,type:file.type,data:await base64(file)});}
    }
    if(signal.aborted)throw new DOMException('בוטל','AbortError');
    progress('שולחים להורים לאישור…');$('#photo-cancel').disabled=true;
    await context.api('/api/photo-requests',{moment:moment.id,files});sent=true;
    selected.forEach(({file})=>uploaded.delete(file));$('#photo-request-dialog').close();
    await context.onChange();$('#photo-status').textContent='התמונות נשלחו להורים לאישור. אחרי האישור הן יופיעו ברגע.';
    $('#photo-status').scrollIntoView({block:'nearest'});
  } catch(e) {
    if(sent)$('#page-error').textContent='התמונות נשלחו לאישור, אך הרענון נכשל. רעננו את הדף.';
    else $('#photo-request-error').textContent=e.name==='AbortError'?'השליחה בוטלה. אפשר לנסות שוב.':e.message;
  } finally {controller=null;controls.forEach(b=>b.disabled=false);$('#photo-cancel').hidden=true;progress('');}
};
