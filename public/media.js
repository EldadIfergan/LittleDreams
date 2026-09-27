const MiB=1024*1024;
export const isVideo=file=>file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(file.name);
const canceled=()=>new DOMException('הפעולה בוטלה','AbortError');
export async function prepareMedia(file,{compress=true,signal,onProgress=()=>{}}={}) {
  if(signal?.aborted) throw canceled();
  if(!file.type && /\.(mp4|webm)$/i.test(file.name)) file=new File([file],file.name,{type:/\.webm$/i.test(file.name)?'video/webm':'video/mp4'});
  const mov=file.type==='video/quicktime'||/\.(mov|m4v)$/i.test(file.name);
  if(!isVideo(file) || (!mov && (!compress || file.size<=20*MiB))) return file;
  if(file.size>1024*MiB) throw new Error('הסרטון גדול מ־1GB. יש לקצר אותו באפליקציית התמונות לפני העלאה');
  if(typeof VideoEncoder==='undefined'||typeof VideoDecoder==='undefined') throw new Error('הדפדפן הזה אינו תומך בהקטנת סרטונים. נסו Safari מעודכן באייפון או העלו עותק מוקטן עד 50MB');
  onProgress('מכינים את הסרטון להקטנה…');
  const m=await import('/vendor/mediabunny.mjs');
  const input=new m.Input({source:new m.BlobSource(file),formats:m.ALL_FORMATS});
  let conversion;
  const abort=()=>{void conversion?.cancel();};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    const track=await input.getPrimaryVideoTrack();
    if(!track) throw new Error('לא נמצא וידאו בקובץ');
    const duration=await input.computeDuration();
    if(!Number.isFinite(duration)||duration<=0) throw new Error('לא ניתן לקרוא את אורך הסרטון');
    const audio=await input.getPrimaryAudioTrack();
    const mp4=await m.canEncodeVideo('avc') && (!audio || await m.canEncodeAudio('aac'));
    if(!mp4 && !(await m.canEncodeVideo('vp8') && (!audio || await m.canEncodeAudio('opus')))) throw new Error('המכשיר אינו תומך בהמרת הסרטון הזה. נסו Safari מעודכן או עותק מוקטן מהתמונות');
    const bitrate=Math.min(2000000,Math.floor(40*MiB*8*0.85/duration)-(audio?96000:0));
    if(bitrate<180000) throw new Error('הסרטון ארוך מדי להקטנה באיכות סבירה. קצרו אותו או חלקו למספר סרטונים');
    const scale=Math.min(1,1280/Math.max(track.displayWidth,track.displayHeight));
    const target=new m.BufferTarget();
    const output=new m.Output({target,format:mp4?new m.Mp4OutputFormat():new m.WebMOutputFormat()});
    conversion=await m.Conversion.init({input,output,
      video:{codec:mp4?'avc':'vp8',width:Math.max(2,Math.floor(track.displayWidth*scale/2)*2),height:Math.max(2,Math.floor(track.displayHeight*scale/2)*2),fit:'contain',frameRate:30,quality:new m.Quality({bitrate}),forceTranscode:true},
      audio:{codec:mp4?'aac':'opus',quality:new m.Quality({bitrate:96000})}});
    if(!conversion.isValid || !conversion.utilizedTracks.includes(track) || (audio && !conversion.utilizedTracks.includes(audio))) throw new Error('קידוד הסרטון או הקול אינו נתמך בדפדפן הזה. נסו Safari מעודכן או ייצאו עותק תואם מהתמונות');
    if(signal?.aborted) throw canceled();
    conversion.onProgress=p=>onProgress(`מקטינים את הסרטון: ${Math.round(p*100)}% · השאירו את המסך פתוח`);
    await conversion.execute();
    if(signal?.aborted) throw canceled();
    const result=new File([target.buffer],file.name.replace(/\.[^.]+$/,'')+(mp4?'.mp4':'.webm'),{type:mp4?'video/mp4':'video/webm'});
    if(result.size>50*MiB) throw new Error('גם לאחר ההקטנה הסרטון גדול מ־50MB. קצרו אותו מעט ונסו שוב');
    return !mov && result.size>=file.size && file.size<=50*MiB ? file : result;
  } catch(error) {
    if(signal?.aborted) throw canceled();
    if(error.message?.includes('נתמך')||error.message?.includes('הסרטון')||error.message?.includes('המכשיר')) throw error;
    throw new Error('לא הצלחנו להקטין את הסרטון במכשיר הזה. נסו Safari מעודכן או שמרו עותק מוקטן מהתמונות');
  } finally {signal?.removeEventListener('abort',abort);await conversion?.cancel().catch(()=>{});input.dispose();}
}

export function uploadFile(url,file,{signal,onProgress=()=>{}}={}) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    const abort=()=>xhr.abort();
    xhr.open('PUT',url);xhr.setRequestHeader('Content-Type',file.type);xhr.setRequestHeader('x-upsert','false');
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
    const cleanup=()=>signal?.removeEventListener('abort',abort);
    xhr.onload=()=>{cleanup();xhr.status>=200&&xhr.status<300?resolve():reject(new Error('העלאת הקובץ נכשלה. אפשר לנסות שוב; האירוע עדיין לא השתנה'));};
    xhr.onerror=()=>{cleanup();reject(new Error('החיבור נקטע במהלך ההעלאה. בדקו את הרשת ונסו שוב'));};
    xhr.onabort=()=>{cleanup();reject(canceled());};
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted) {cleanup();reject(canceled());return;}
    xhr.send(file);
  });
}
