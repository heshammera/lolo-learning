/* Local in-app reminders only. No OS notifications, network or background timers. */
(()=>{
 function day(ms){
  const d=new Date(ms);if(!Number.isFinite(d.getTime()))return null;
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
 }
 function derive({enabled=false,daily=false,hour=17,now=Date.now(),due=[],practiceTimes=[],dismissedDay=null}={}){
  if(enabled!==true||!Number.isFinite(now)||!Array.isArray(due)||!Array.isArray(practiceTimes))return [];
  const today=day(now);if(!today)return [];
  const notices=[],ids=new Set();
  for(const item of due){
   if(!item||typeof item.lessonId!=='string'||!item.lessonId||typeof item.title!=='string'||!Number.isFinite(item.dueAt)||item.dueAt>now||ids.has(item.lessonId))continue;
   ids.add(item.lessonId);notices.push({kind:'review',lessonId:item.lessonId,title:item.title,dueAt:item.dueAt});
  }
  notices.sort((a,b)=>a.dueAt-b.dueAt||a.lessonId.localeCompare(b.lessonId));
  const reminders=notices.slice(0,3);
  const practiced=practiceTimes.some(t=>Number.isFinite(t)&&t<=now&&day(t)===today);
  if(daily===true&&Number.isInteger(hour)&&hour>=0&&hour<=23&&new Date(now).getHours()>=hour&&!practiced&&dismissedDay!==today)reminders.push({kind:'daily',day:today});
  return reminders;
 }
 const api=Object.freeze({derive,day});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof window!=='undefined')window.LoloLearningReminders=api;
})();