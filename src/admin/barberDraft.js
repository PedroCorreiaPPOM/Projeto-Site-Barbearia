export const DAYS=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
export function draftFromSnapshot(snapshot) {
  const b=snapshot?.barber;
  return {name:b?.name || '',description:b?.description || '',photo_path:b?.photo_path || null,
    booking_enabled:b?.booking_enabled || false,slot_interval_minutes:b?.slot_interval_minutes ?? 30,
    buffer_minutes:b?.buffer_minutes ?? 0,minimum_notice_minutes:b?.minimum_notice_minutes ?? 60,
    booking_horizon_days:b?.booking_horizon_days ?? 60,services:snapshot?.links.map(x=>x.service_id) || [],
    week:DAYS.map((_,day)=>(snapshot?.hours || []).filter(h=>h.weekday===day).sort((a,b)=>a.opens_at.localeCompare(b.opens_at)).map(h=>({
      opens_at:h.opens_at.slice(0,5),closes_at:h.closes_at.slice(0,5),breaks:(snapshot?.breaks || []).filter(b=>b.barber_hour_id===h.id).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)).map(b=>({starts_at:b.starts_at.slice(0,5),ends_at:b.ends_at.slice(0,5)}))}))),
    overrides:(snapshot?.overrides || []).map(d=>({local_date:d.local_date,periods:structuredClone(d.periods)})),
    blocks:(snapshot?.blocks || []).map(b=>({id:b.id,starts_at:b.starts_at,ends_at:b.ends_at,kind:b.kind,reason:b.reason}))};
}
export function copyWeek(week,source,targets) {
  return week.map((periods,day)=>targets.includes(day) && day!==source ? structuredClone(week[source]) : periods);
}
export function noticeMinutes(amount,unit) {
  const raw=Number(amount)*Number(unit),result=Math.round(raw);
  if(amount==='' || ![1,60,1440].includes(Number(unit)) || !Number.isFinite(raw) || Math.abs(raw-result)>1e-8 || result<0 || result>10080) throw new Error('Antecedência deve corresponder a 0 até 10080 minutos (7 dias).');
  return result;
}
export function periodsSummary(periods) {return periods.length ? periods.map(p=>`${p.opens_at}–${p.closes_at}`).join(' · ') : 'Fechado';}
export function validatePeriods(periods) {
  let previous='00:00';
  for(const p of [...periods].sort((a,b)=>a.opens_at.localeCompare(b.opens_at))) {
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.opens_at) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.closes_at) || p.opens_at>=p.closes_at || p.opens_at<previous) throw new Error('Revise os períodos: informe horários válidos, sem sobreposição.');
    previous=p.closes_at; let end=p.opens_at;
    for(const b of [...(p.breaks || [])].sort((a,b)=>a.starts_at.localeCompare(b.starts_at))) {
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.starts_at) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.ends_at) || b.starts_at>=b.ends_at || b.starts_at<end || b.ends_at>p.closes_at) throw new Error('Revise as pausas de cada período.');
      end=b.ends_at;
    }
  }
}
export function normalizeDraft(draft,services,today) {
  if(draft.name.trim().length<2 || draft.name.trim().length>120 || draft.description.length>1000) throw new Error('Informe nome de 2 a 120 caracteres e descrição de até 1000.');
  const result=structuredClone(draft);
  result.name=result.name.trim();
  for(const [key,min,max] of [['buffer_minutes',0,120],['minimum_notice_minutes',0,10080],['booking_horizon_days',1,365]]) {
    if(result[key]==='' || !Number.isInteger(Number(result[key])) || Number(result[key])<min || Number(result[key])>max) throw new Error('Revise as preferências e seus limites.');
    result[key]=Number(result[key]);
  }
  if(![5,10,15,20,30,45,60].includes(Number(result.slot_interval_minutes))) throw new Error('Grade inválida.');
  for(const p of [...result.week,...result.overrides.map(d=>d.periods)]) validatePeriods(p);
  // Weekly rows use the RPC's canonical representation. Existing date overrides
  // retain their JSON shape so an unrelated edit does not rewrite their schedule.
  for(const p of result.week) {p.sort((a,b)=>a.opens_at.localeCompare(b.opens_at));for(const period of p)period.breaks=(period.breaks || []).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));}
  if(new Set(result.overrides.map(d=>d.local_date)).size!==result.overrides.length || result.overrides.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d.local_date))) throw new Error('Informe datas de exceção válidas e sem repetições.');
  if(result.blocks.some(b=>!Number.isFinite(Date.parse(b.starts_at)) || !Number.isFinite(Date.parse(b.ends_at)) || Date.parse(b.starts_at)>=Date.parse(b.ends_at))) throw new Error('Informe início e fim válidos para cada bloqueio.');
  if(result.booking_enabled && (!result.services.some(id=>services.some(s=>s.id===id && s.active)) || (!result.week.some(p=>p.length) && !result.overrides.some(d=>d.local_date>=today && d.periods.length)))) throw new Error('Para receber reservas online, configure expediente e pelo menos um serviço ativo.');
  return result;
}
