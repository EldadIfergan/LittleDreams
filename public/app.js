const $ = selector => document.querySelector(selector);
let mode = 'register', albums = [], current;
let creatingAlbum = false;
let invite = new URLSearchParams(location.search).get('invite');
if (invite) history.replaceState(null,'', '/');
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error),{status:response.status});
  return result;
}
function setMode(value) {
  mode = value;
  const register = mode === 'register';
  $('#register-tab').setAttribute('aria-pressed',register);
  $('#login-tab').setAttribute('aria-pressed',!register);
  document.querySelectorAll('.register-field').forEach(el => { el.hidden = !register; el.querySelector('input').required = register; });
  $('#album-field').hidden = !register || !!invite;
  $('[name=albumName]').required = register && !invite;
  $('#child-registration').hidden = !register || !!invite;
  $('#child-registration').disabled = !register || !!invite;
  $('[name=password]').autocomplete = register ? 'new-password' : 'current-password';
  $('#invite-note').hidden = !invite;
  $('#auth-title').textContent = register ? invite ? 'מצטרפים לאלבום המשפחתי' : 'מתחילים לאסוף זיכרונות' : 'איזה כיף שחזרתם';
  $('#auth-submit').textContent = register ? invite ? 'יצירת חשבון והצטרפות' : 'יצירת אלבום' : 'כניסה לאלבום';
  $('#auth-error').textContent = '';
}
$('#register-tab').onclick = () => setMode('register');
$('#login-tab').onclick = () => setMode('login');
async function busy(form, error, fn) {
  const button = form.querySelector('button.primary'); button.disabled = true; error.textContent = '';
  try { await fn(); } catch(e) { error.textContent = e.message; } finally { button.disabled = false; }
}
$('#auth-form').onsubmit = event => {
  event.preventDefault(); busy(event.target,$('#auth-error'),async () => {
    const data = Object.fromEntries(new FormData(event.target));
    if (mode === 'register' && invite) data.invite = invite;
    await api(`/api/${mode}`,data);
    if (mode === 'register') invite = null;
    event.target.reset(); await load();
  });
};
async function load() {
  try {
    const result = await api('/api/me');
    if (invite) {
      try { await api('/api/accept',{token:invite}); invite = null; return load(); }
      catch(e) { $('#page-error').textContent = e.message; invite = null; }
    }
    albums = result.albums; current = albums.find(a => a.id === current?.id) || albums[0];
    $('#auth').hidden = true; $('#album').hidden = false; $('#logout').hidden = false;
    $('#my-albums-button').hidden = false;
    $('#album-hub').hidden = true;
    $('#album-picker').replaceChildren(...albums.map(a => { const option = new Option(a.name,a.id); option.selected = a.id === current.id; return option; }));
    $('#album-picker-label').hidden = albums.length < 2;
    await showAlbum();
  } catch(e) {
    if (e.status === 401) { document.documentElement.dataset.theme = 'unspecified'; $('#auth').hidden = false; $('#album').hidden = true; $('#album-hub').hidden = true; $('#my-albums-button').hidden = true; $('#logout').hidden = true; setMode(mode); }
    else $('#page-error').textContent = e.message;
  }
}
let albumRender=0;
async function showAlbum() {
  const render=++albumRender,album=current.id;
  showProfile();
  $('#album-name').textContent = current.name;
  const parent = current.role === 'parent';
  for (const name of ['add-button','invite-button','first-moment']) $(`#${name}`).hidden = !parent;
  $('#album-description').textContent = parent ? 'המקומות, הפעמים הראשונות, וכל מה שביניהם.' : 'מוזמנים לצפות ברגעים המשפחתיים ולהוסיף תגובות';
  $('#moments').replaceChildren(); $('#empty').hidden = true; $('#count').textContent = 'טוענים רגעים…';
  $('#checklist-items').replaceChildren();$('#checklist-count').textContent='';$('#checklist-error').textContent='';$('#checklist-status').textContent='';
  const [moments,items] = await Promise.all([api('/api/moments?album='+album),api('/api/checklist?album='+album)]);
  if(render!==albumRender || current?.id!==album)return;
  renderChecklist(items,album,parent);
  let month='';
  $('#count').textContent = moments.length === 1 ? 'רגע אחד באלבום' : `${moments.length} רגעים באלבום`;
  $('#empty').hidden = !!moments.length;
  moments.forEach(moment => {
    const key=moment.date.slice(0,7);
    if(key!==month) {const heading=document.createElement('h3');heading.className='timeline-month';heading.textContent=new Date(moment.date+'T12:00:00').toLocaleDateString('he-IL',{month:'long',year:'numeric'});$('#moments').append(heading);month=key;}
    const card = document.createElement('article'); card.className = 'card';card.id='moment-'+moment.id;
    const content = document.createElement('div'); content.className = 'card-content';
    const date = document.createElement('time'); date.dateTime = moment.date;
    date.textContent = new Date(moment.date + 'T12:00:00').toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric'});
    const title = document.createElement('h2'); title.textContent = moment.title;
    const description = document.createElement('p'); description.textContent = moment.description;
    content.append(date,title);
    if (parent) {
      const edit=document.createElement('button');edit.type='button';edit.className='edit-event';
      edit.setAttribute('aria-label',`עריכת האירוע: ${moment.title}`);edit.title='עריכת אירוע';
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','m16 4 4 4M4 20l4-1L20 7a2.83 2.83 0 0 0-4-4L4 15l-1 6 5-2');svg.append(path);edit.append(svg);
      edit.onclick=()=>openMoment(moment);card.append(edit);card.classList.add('editable');
    }
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'הסיפור והקבצים';
    details.append(summary,description);
    let coverShown = false;
    moment.files.forEach(file => {
      const src = `/api/files/${file.id}`;
      if (file.type.startsWith('image/')) { const img = document.createElement('img'); img.src = src; img.alt = file.name; img.loading = 'lazy'; if (!coverShown) { card.append(img); coverShown = true; } else details.append(img); }
      else if (file.type.startsWith('video/')) { const video = document.createElement('video'); video.src = src; video.controls = true; video.preload = 'metadata'; video.setAttribute('playsinline',''); if (!coverShown) { card.append(video); coverShown = true; } else details.append(video); }
      const link = document.createElement('a'); link.href = src; link.textContent = `הורדת ${file.name}`; link.download = file.name; link.className = 'file-link'; details.append(link);
    });
    if (moment.description || moment.files.length) content.append(details);
    content.append(commentSection(moment));
    card.append(content);const item=document.createElement('div');item.className='timeline-item';item.append(card);$('#moments').append(item);
  });
}
function renderChecklist(items,album,parent) {
  if(current?.id!==album)return;
  const completedCount=items.filter(i=>i.completed).length;
  $('#checklist-count').textContent=completedCount===1?'רגע אחד שסומן':completedCount+' רגעים שסומנו';
  const list=$('#checklist-items');
  const opened=new Set([...list.querySelectorAll('details[open]')].map(el=>el.dataset.group));
  const firstRender=list.children.length===0;
  list.replaceChildren();
  const groups=new Map();
  for(const item of items) {
    if(groups.has(item.group))continue;
    const section=document.createElement('details');section.className='checklist-group';section.dataset.group=item.group;
    section.open=opened.has(item.group)||(firstRender&&item.group==='arrival');
    const summary=document.createElement('summary');summary.textContent=item.groupTitle;
    const count=document.createElement('span');const n=items.filter(i=>i.group===item.group&&i.completed).length;count.textContent=n===1?' · רגע אחד סומן':' · '+n+' סומנו';summary.append(count);
    const description=document.createElement('p');description.textContent=item.groupDescription;
    const rows=document.createElement('div');rows.className='checklist-group-items';
    section.append(summary,description,rows);list.append(section);groups.set(item.group,rows);
  }
  for(const item of items) {
    const row=document.createElement('div');row.className='checklist-row';
    const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=item.completed;input.disabled=!parent;
    const name=document.createElement('span');name.textContent=item.title;label.append(input,name);row.append(label);
    const action=document.createElement('button');action.type='button';action.className='quiet';
    if(item.momentId) {action.textContent='לצפייה ברגע';action.onclick=()=>{const card=document.getElementById('moment-'+item.momentId);card?.scrollIntoView({behavior:'smooth',block:'center'});card?.setAttribute('tabindex','-1');card?.focus({preventScroll:true});};row.append(action);}
    else if(item.completed&&parent) {action.textContent='תיעוד רגע';action.onclick=()=>openMoment(null,item);row.append(action);}
    input.onchange=async()=>{
      const completed=input.checked;const controls=[...list.querySelectorAll('input,button')];controls.forEach(control=>control.disabled=true);$('#checklist-error').textContent='';
      try {
        const updated=await api('/api/checklist',{album,key:item.key,completed});
        if(current?.id!==album)return;
        renderChecklist(updated,album,parent);$('#checklist-status').textContent=completed?'אבן הדרך סומנה ונשמרה':'הסימון הוסר. אירוע שכבר תועד נשאר באלבום.';
        const saved=updated.find(i=>i.key===item.key);
        if(completed&&!saved.momentId) {
          $('#milestone-saved').textContent=item.title+' — הסימון נשמר באלבום של '+current.child_name+'.';
          $('#milestone-create').onclick=()=>{$('#milestone-dialog').close();if(current?.id===album)openMoment(null,item);};
          $('#milestone-dialog').showModal();
        }
      }catch(error){input.checked=!completed;controls.forEach(control=>control.disabled=false);if(current?.id===album)$('#checklist-error').textContent=error.message;}
    };
    groups.get(item.group).append(row);
  }
}
function commentSection(moment) {
  const section = document.createElement('details'); section.className = 'comments';
  const summary = document.createElement('summary');
  let count = moment.comments.length;
  const updateCount = () => { summary.textContent = count ? `תגובות המשפחה (${count})` : 'תגובות המשפחה · הוספת תגובה'; };
  updateCount();
  const list = document.createElement('div'); list.className = 'comment-list';
  const empty = document.createElement('p'); empty.className = 'comment-empty'; empty.textContent = 'עוד אין תגובות. אפשר להשאיר כאן כמה מילים חמות.'; empty.hidden = count > 0;
  function appendComment(comment) {
    const item = document.createElement('article'); item.className = 'comment';
    const author = document.createElement('strong'); author.textContent = comment.author;
    const date = document.createElement('time'); date.dateTime = new Date(comment.created).toISOString(); date.textContent = new Date(comment.created).toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'});
    const message = document.createElement('p'); message.textContent = comment.body;
    item.append(author,date,message); list.append(item);
  }
  moment.comments.forEach(appendComment);
  const form = document.createElement('form'); form.className = 'comment-form';
  const label = document.createElement('label'); label.textContent = 'כמה מילים מהלב';
  const input = document.createElement('textarea'); input.rows = 2; input.maxLength = 2000; input.required = true; input.placeholder = 'איזה רגע מתוק…'; label.append(input);
  const error = document.createElement('p'); error.className = 'error'; error.setAttribute('role','alert');
  const status = document.createElement('p'); status.className = 'comment-status'; status.setAttribute('role','status');
  const button = document.createElement('button'); button.className = 'primary'; button.textContent = 'שליחת תגובה';
  form.append(label,error,button,status);
  form.onsubmit = event => {
    event.preventDefault(); status.textContent = '';
    if (!input.value.trim()) { error.textContent = 'יש לכתוב תגובה לפני השליחה'; input.focus(); return; }
    input.disabled = true;
    busy(form,error,async()=>{
      const comment = await api('/api/comments',{moment:moment.id,body:input.value});
      appendComment(comment); count++; updateCount(); empty.hidden = true; input.value = ''; status.textContent = 'התגובה נוספה';
    }).finally(()=>{ input.disabled = false; });
  };
  section.append(summary,empty,list,form); return section;
}
$('#album-picker').onchange = async event => { current = albums.find(a => a.id === event.target.value); try { await showAlbum(); } catch(e) { $('#page-error').textContent = e.message; } };
$('#logout').onclick = async () => { try { await api('/api/logout',{}); current = null; await load(); } catch(e) { $('#page-error').textContent = e.message; } };
let selectedMilestone=null, editingMoment=null, selectedFiles=[], removedFiles=new Set(), uploadController=null;
const preparedFiles=new WeakMap(), uploadedFiles=new WeakMap();
function openMoment(moment=null,milestone=null) {
  selectedMilestone=milestone;
  editingMoment=moment?.id ? moment : null; selectedFiles=[];removedFiles=new Set();
  $('#moment-form').reset(); $('#file-selection-status').textContent=''; $('#moment-error').textContent='';$('#upload-progress').textContent='';
  $('#moment-title').textContent=editingMoment?'עריכת האירוע':'רגע קטן, זיכרון גדול';
  const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());
  const form=$('#moment-form');form.elements.date.value=editingMoment?.date || now.toISOString().slice(0,10);
  form.elements.title.value=editingMoment?.title || milestone?.title || '';form.elements.description.value=editingMoment?.description || '';
  renderFileList();$('#moment-dialog').showModal();
}
function renderFileList() {
  const list=$('#file-list');list.replaceChildren();
  for(const file of editingMoment?.files || []) {
    const row=document.createElement('div');row.className='attachment-row';
    const removed=removedFiles.has(file.id);
    if(file.type.startsWith('image/')) { const img=document.createElement('img');img.src=`/api/files/${file.id}`;img.alt=file.name;row.append(img); }
    const name=document.createElement('span');name.textContent=file.name+(removed?' · יוסר בשמירה':'');
    const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent=removed?'ביטול הסרה':'הסרה';
    button.onclick=()=>{removed?removedFiles.delete(file.id):removedFiles.add(file.id);renderFileList();};
    row.append(name,button);list.append(row);
  }
  selectedFiles.forEach((file,index)=>{
    const row=document.createElement('div');row.className='attachment-row';const name=document.createElement('span');name.textContent=`${file.name} · ${(file.size/1024/1024).toFixed(1)}MB · חדש`;
    const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent='הסרה';button.onclick=()=>{selectedFiles.splice(index,1);renderFileList();};row.append(name,button);list.append(row);
  });
}
$('#add-button').onclick=()=>openMoment();$('#first-moment').onclick=()=>openMoment();
document.querySelectorAll('.close').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('#moment-dialog').addEventListener('cancel',event=>{if(uploadController)event.preventDefault();});
$('#cancel-upload').onclick=()=>uploadController?.abort();
for(const name of ['files','videoFile','fallbackFile']) {
  const picker=$('#moment-form [name='+name+']');
  picker.onchange=event=>{
    const incoming=Array.from(event.target.files||[]);event.target.value='';
    if(!incoming.length)return;
    const existing=(editingMoment?.files||[]).filter(file=>!removedFiles.has(file.id)).length;
    if(existing+selectedFiles.length+incoming.length>10) {$('#moment-error').textContent='אפשר לצרף עד 10 קבצים לאירוע. בחרו פחות קבצים או הסירו קובץ מהרשימה.';return;}
    selectedFiles.push(...incoming);renderFileList();$('#moment-error').textContent='';
    $('#file-selection-status').textContent=incoming.length===1?'הקובץ התקבל: '+incoming[0].name+' · לחצו על שמירת הרגע כדי להעלות אותו.':incoming.length+' קבצים התקבלו · לחצו על שמירת הרגע כדי להעלות אותם.';
    $('#file-selection-status').scrollIntoView({block:'nearest'});
  };
}
const base64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('לא ניתן לקרוא את הקובץ'));reader.readAsDataURL(file);});
$('#moment-form').onsubmit=async event=>{
  event.preventDefault();if(uploadController)return;
  const element=event.target,form=new FormData(element),album=current.id,moment=editingMoment,milestone=selectedMilestone;
  const kept=(moment?.files || []).filter(f=>!removedFiles.has(f.id)).map(f=>f.id);
  const controller=new AbortController();uploadController=controller;
  const controls=[...element.querySelectorAll('input,textarea,button')];controls.forEach(c=>c.disabled=true);
  $('#cancel-upload').hidden=false;$('#cancel-upload').disabled=false;$('#moment-error').textContent='';
  const progress=message=>$('#upload-progress').textContent=message;
  try {
    if(kept.length+selectedFiles.length>10)throw new Error('אפשר לשמור עד 10 קבצים באירוע. הסירו קובץ מהרשימה ונסו שוב');
    const {prepareMedia,uploadFile}=await import('/media.js');
    const files=[];let total=0;
    const compress=$('#compress-videos').checked;
    for(const source of selectedFiles) {
      const cached=preparedFiles.get(source);
      const file=cached?.compress===compress?cached.file:await prepareMedia(source,{compress,signal:controller.signal,onProgress:message=>progress(`${source.name}: ${message}`)});
      preparedFiles.set(source,{compress,file});total+=file.size;
      if(file.size>50*1024*1024)throw new Error(`${source.name}: הקובץ גדול מ־50MB. הפעילו הקטנת סרטונים או בחרו קובץ קטן יותר`);
      if(total>100*1024*1024)throw new Error('הקבצים לאחר ההקטנה גדולים מ־100MB. פצלו למספר אירועים');
      files.push(file);
    }
    const config=await api('/api/config'),attachments=[];
    for(const [index,file] of files.entries()) {
      if(controller.signal.aborted)throw new DOMException('הפעולה בוטלה','AbortError');
      if(config.directUploads) {
        let upload=uploadedFiles.get(file);
        if(!upload || upload.album!==album || upload.expires<Date.now()) {
          upload=await api('/api/uploads',{album,name:file.name,type:file.type,size:file.size});
          await uploadFile(upload.url,file,{signal:controller.signal,onProgress:p=>progress(`מעלים קובץ ${index+1} מתוך ${files.length}: ${p}%`)});
          upload={...upload,album,expires:Date.now()+3600000};uploadedFiles.set(file,upload);
        }
        attachments.push({id:upload.id});
      } else attachments.push({name:file.name,type:file.type,data:await base64(file)});
    }
    if(controller.signal.aborted)throw new DOMException('הפעולה בוטלה','AbortError');
    progress('שומרים את האירוע…');$('#cancel-upload').disabled=true;
    await api('/api/moments',{album,title:form.get('title'),date:form.get('date'),description:form.get('description'),files:attachments,...(milestone?{milestoneKey:milestone.key}:{}),...(moment?{id:moment.id,keepFiles:kept,original:{title:moment.title,date:moment.date,description:moment.description,files:moment.files.map(f=>f.id)}}:{})});
    files.forEach(file=>uploadedFiles.delete(file));$('#moment-dialog').close();await showAlbum();
  } catch(error) {$('#moment-error').textContent=error.name==='AbortError'?'הפעולה בוטלה. האירוע לא השתנה ואפשר לנסות שוב.':error.message;}
  finally {uploadController=null;controls.forEach(c=>c.disabled=false);$('#cancel-upload').hidden=true;progress('');}
};
$('#invite-button').onclick = () => { $('#invite-result').hidden = true; $('#invite-error').textContent = ''; $('#invite-result small').textContent = location.hostname === 'localhost' ? 'בסביבה המקומית הקישור פועל רק במחשב הזה.' : 'אפשר לשלוח את הקישור באופן פרטי לאדם שהזמנתם.'; $('#invite-dialog').showModal(); };
$('#invite-form').onsubmit = event => {
  event.preventDefault(); busy(event.target,$('#invite-error'),async () => {
    const result = await api('/api/invites',{album:current.id,role:event.target.elements.role.value});
    $('#invite-link').value = `${location.origin}/?invite=${result.token}`; $('#invite-result').hidden = false; $('#invite-link').select();
  });
};
load();

function ageInfo(date, today = new Date()) {
  const born = new Date(date + 'T00:00:00');
  const days = Math.floor((Date.UTC(today.getFullYear(),today.getMonth(),today.getDate())-Date.UTC(born.getFullYear(),born.getMonth(),born.getDate()))/86400000);
  let months = (today.getFullYear()-born.getFullYear())*12+today.getMonth()-born.getMonth();
  const anniversary = Math.min(born.getDate(),new Date(today.getFullYear(),today.getMonth()+1,0).getDate());
  if (today.getDate()<anniversary) months--;
  return {days,months,label:months < 1 ? `${days} ימים` : `${months} חודשים`};
}
const stages = [
  {label:'6 שבועות עד 3 חודשים',slug:'6-12-weeks',title:'חיוך בתגובה אליכם',moment:'החיוך הראשון אלינו',body:'בתקופה הזאת אפשר לראות חיוך בתגובה לפנים ולקול מוכרים. זו הזדמנות לתעד את הקשר שנוצר, בלי לחכות ליום מסוים.',activity:'אפשר לחייך, לדבר ברכות ולהמתין לתגובה. שימו לב לקולות, למבט ולחיוך, והגיבו אליהם.'},
  {label:'3 עד 6 חודשים',slug:'3-6-months',title:'מגלים את הידיים ואת הקול',moment:'הושטת היד הראשונה לצעצוע',body:'הושטת יד לחפצים ומגוון קולות הם חלק מאבני הדרך בתקופה הזאת. אפשר לשמור רגע קטן של סקרנות באלבום.',activity:'דברו ושירו יחד, ועצרו כדי לאפשר תגובה. אפשר להציע צעצוע בטיחותי המותאם לגיל, בהשגחה.'},
  {label:'6 עד 9 חודשים',slug:'6-9-months',title:'משחקים מיד ליד',moment:'העברתי צעצוע מיד ליד',body:'העברת חפץ בין הידיים והברות חוזרות הן דוגמאות ליכולות המתפתחות בטווח הזה. כל ילד וילדה מתקדמים בקצב משלהם.',activity:'אפשר לקרוא ספר יחד בחיקכם, להצביע על האיורים ולעצור כדי להקשיב לקולות ולתגובה.'},
  {label:'9 עד 12 חודשים',slug:'9-12-months',title:'מחוות קטנות, קשר גדול',moment:'עשינו שלום בפעם הראשונה',body:'חיקוי מחוות, תגובה לשם ושיחה בקולות הם חלק מההתפתחות בתקופה הזאת. אפשר לתעד משחק משותף או מחווה חדשה.',activity:'אפשר לשלב מחוות פשוטות כמו נפנוף לשלום במשחק ובשיחה, ולתת זמן לתגובה בלי ללחוץ.'}
];
function sourceFor(stage) { return `https://me.health.gov.il/parenting/age-menu/${stage.slug}/grow-${stage.slug}/`; }
function showProfile() {
  $('#child-avatar').hidden = !current.avatar;
  if (current.avatar) $('#child-avatar').src = current.avatar;
  document.documentElement.dataset.theme = current.sex || 'unspecified';
  const parent = current.role === 'parent';
  $('#edit-profile').hidden = !parent;
  $('#parent-guide').hidden = !parent;
  $('#child-heading').textContent = current.child_name || 'נכיר את הילד או הילדה?';
  const info = current.birth_date ? ageInfo(current.birth_date) : null;
  const facts = info ? [`גיל: ${info.label}`,`נולד/ה ב־${new Date(current.birth_date+'T12:00:00').toLocaleDateString('he-IL')}`] : ['השלימו תאריך לידה כדי לראות הצעות לפי גיל.'];
  if (current.birth_time) facts.push(`שעת לידה: ${current.birth_time}`);
  if (current.birth_weight) facts.push(`משקל לידה: ${current.birth_weight.toLocaleString('he-IL')} גרם`);
  if (current.birth_length) facts.push(`אורך בלידה: ${current.birth_length} ס״מ`);
  $('#child-facts').textContent = facts.join(' · ');
  const stage = !info || info.days < 42 || info.months >= 12 ? null : stages[info.months < 3 ? 0 : info.months < 6 ? 1 : info.months < 9 ? 2 : 3];
  $('#guide-age').textContent = stage ? `מתאים לתקופה שלכם · ${stage.label}` : !info ? 'להתאמה לפי גיל, השלימו את פרטי הילד או הילדה.' : info.days < 42 ? 'השבועות הראשונים · זמן להיכרות ולתיעוד רגעים משותפים.' : 'הספרייה הראשונית מתמקדת בשנה הראשונה. מידע לגילים נוספים זמין במקור המקושר בהמשך.';
  $('#suggestion').replaceChildren();
  if (stage) {
    const heading = document.createElement('h3'); heading.textContent = stage.title;
    const p = document.createElement('p'); p.textContent = stage.body;
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'קרה אצלנו · נוסיף רגע';
    button.onclick = () => { openMoment(); $('#moment-form [name=title]').value = stage.moment; };
    $('#suggestion').append(heading,p,button);
  }
  $('#articles').replaceChildren();
  const ordered = stage ? [stage,...stages.filter(s=>s!==stage)] : stages;
  for (const item of ordered) {
    const article = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = `${item.label} · ${item.title}`;
    const p = document.createElement('p'); p.textContent = item.body;
    const activity = document.createElement('p'); activity.textContent = 'רעיון לזמן יחד: '+item.activity;
    const a = document.createElement('a'); a.href = sourceFor(item); a.target='_blank'; a.rel='noopener noreferrer'; a.textContent='למאמר המלא במשרד הבריאות ↗';
    article.append(summary,p,activity,a); $('#articles').append(article);
  }
  const more = document.createElement('a'); more.href='https://www.cdc.gov/act-early/milestones/index.html'; more.target='_blank'; more.rel='noopener noreferrer'; more.textContent='אבני דרך לפי גיל עד גיל 5 · CDC (באנגלית) ↗'; $('#articles').append(more);
}
$('#edit-profile').onclick = () => {
  creatingAlbum = false;
  $('#profile-title').textContent = 'פרטי הילד או הילדה';
  $('#new-album-name').hidden = false; $('#new-album-name input').required = true;
  const form = $('#profile-form');
  form.reset(); form.elements.albumName.value = current.name;
  $('#avatar-preview').hidden = !current.avatar;
  if (current.avatar) $('#avatar-preview').src = current.avatar;
  for (const [field,column] of [['childName','child_name'],['birthDate','birth_date'],['birthTime','birth_time'],['birthWeight','birth_weight'],['birthLength','birth_length'],['sex','sex']]) form.elements[field].value = current[column] ?? (field === 'sex' ? 'unspecified' : '');
  $('#profile-error').textContent=''; $('#profile-dialog').showModal();
};
$('#profile-form').onsubmit = event => {
  event.preventDefault(); busy(event.target,$('#profile-error'),async()=>{
    const data = {album:current?.id,...Object.fromEntries(new FormData(event.target))};
    delete data.avatarFile;
    const file = event.target.elements.avatarFile.files[0];
    if (file) data.avatar = await avatarImage(file);
    const result = await api(creatingAlbum ? '/api/albums' : '/api/profile',data);
    if (creatingAlbum) current = {id:result.id};
    $('#profile-dialog').close(); await load();
  });
};
$('#my-albums-button').onclick = async () => {
  try {
    const result = await api('/api/me'); albums = result.albums;
    $('#album').hidden = true; $('#album-hub').hidden = false;
    document.documentElement.dataset.theme = 'unspecified';
    const list = $('#album-list'); list.replaceChildren();
    for (const album of albums) {
      const button = document.createElement('button'); button.className = 'album-tile'; button.dataset.sex = album.sex || 'unspecified';
      const name = document.createElement('strong'); name.textContent = album.name;
      if (album.avatar) { const img = document.createElement('img'); img.className='child-avatar'; img.src=album.avatar; img.alt=album.child_name || 'תמונת פרופיל'; button.append(img); }
      const child = document.createElement('span'); child.textContent = album.child_name || 'פרטי הילד טרם הושלמו';
      const role = document.createElement('small'); role.textContent = album.role === 'parent' ? 'הורה · ניהול והוספת רגעים' : 'משפחה · צפייה ותגובות';
      button.append(name,child,role);
      button.onclick = async () => { current = album; try { await showAlbum(); $('#album-hub').hidden = true; $('#album').hidden = false; } catch(e) { $('#page-error').textContent = e.message; } };
      list.append(button);
    }
  } catch(e) { $('#page-error').textContent = e.message; }
};
$('#new-album-button').onclick = () => {
  creatingAlbum = true; $('#profile-form').reset(); $('#profile-error').textContent = '';
  $('#avatar-preview').hidden = true;
  $('#profile-title').textContent = 'אלבום לילד נוסף';
  $('#new-album-name').hidden = false; $('#new-album-name input').required = true;
  $('#profile-dialog').showModal();
};
async function avatarImage(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10*1024*1024) throw new Error('בחרו תמונת JPG, PNG או WebP עד 10MB');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas'); canvas.width=160; canvas.height=160;
  const size=Math.min(bitmap.width,bitmap.height);
  canvas.getContext('2d').drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,160,160);
  bitmap.close(); return canvas.toDataURL('image/jpeg',0.75);
}
$('#profile-form [name=avatarFile]').onchange = async event => {
  try { const file=event.target.files[0]; if (!file) return; $('#avatar-preview').src=await avatarImage(file); $('#avatar-preview').hidden=false; $('#profile-error').textContent=''; }
  catch(e) { $('#profile-error').textContent=e.message; }
};
