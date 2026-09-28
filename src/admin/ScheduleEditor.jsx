import { useEffect, useState } from "react";
const DAYS = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];

export default function ScheduleEditor({data,barber,act,busy}) {
  const [weekday,setWeekday] = useState(1), [date,setDate] = useState(""), [specific,setSpecific] = useState(false), [periods,setPeriods] = useState([]);
  useEffect(()=>{
    if(specific) setPeriods((data.barber_date_overrides || []).find(d=>d.barber_id===barber.id && d.local_date===date)?.periods || []);
    else setPeriods(data.barber_hours.filter(h=>h.barber_id===barber.id && h.weekday===weekday).sort((a,b)=>a.opens_at.localeCompare(b.opens_at)).map(h=>({opens_at:h.opens_at.slice(0,5),closes_at:h.closes_at.slice(0,5),breaks:data.barber_breaks.filter(b=>b.barber_hour_id===h.id).map(b=>({starts_at:b.starts_at.slice(0,5),ends_at:b.ends_at.slice(0,5)}))})));
  },[data,barber.id,weekday,date,specific]);
  const change = (index,patch)=>setPeriods(periods.map((p,i)=>i===index ? {...p,...patch} : p));
  return <section className="dash-hours"><h4>Expediente individual</h4><p>Configure os períodos de trabalho e as pausas deste profissional. Sem períodos, o dia fica fechado.</p>
    {barber.public_booking_key === "geovane" && <button type="button" disabled={busy} onClick={()=>{if(window.confirm("Aplicar o modelo de Geovane: segunda a sábado, 09h–12h e 14h–20h, domingo fechado? Só é permitido quando ainda não existem horários.")) act("apply_geovane_schedule",{id:barber.id},"Horários iniciais aplicados.");}}>Aplicar horários iniciais de Geovane</button>}
    <label className="dash-check"><input type="checkbox" checked={specific} onChange={e=>setSpecific(e.target.checked)}/>Configurar uma data específica</label>
    <form onSubmit={async(e)=>{e.preventDefault();await act("save_schedule",{barber_id:barber.id,weekday,periods,date:specific?date:null},"Expediente salvo.");}}>
      {specific ? <label>Data da exceção<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label> : <label>Dia da semana<select value={weekday} onChange={e=>setWeekday(Number(e.target.value))}>{DAYS.map((d,i)=><option key={d} value={i}>{d}</option>)}</select></label>}
      {specific && <p>Esta data substitui o expediente semanal. Salve sem períodos para uma folga; remova a exceção para voltar à jornada semanal.</p>}
      {!periods.length && <p className="dash-empty">Dia fechado. Adicione períodos para abrir.</p>}
      {periods.map((p,i)=><fieldset className="dash-preferences" key={i}><legend>Período {i+1}</legend><div className="dash-time-grid"><label>Abre<input type="time" required value={p.opens_at} onChange={e=>change(i,{opens_at:e.target.value})}/></label><label>Fecha<input type="time" required value={p.closes_at} onChange={e=>change(i,{closes_at:e.target.value})}/></label></div>
        {(p.breaks || []).map((b,j)=><div key={j} className="dash-break"><div className="dash-time-grid"><label>Início da pausa<input type="time" required value={b.starts_at} onChange={e=>change(i,{breaks:p.breaks.map((x,k)=>k===j?{...x,starts_at:e.target.value}:x)})}/></label><label>Fim da pausa<input type="time" required value={b.ends_at} onChange={e=>change(i,{breaks:p.breaks.map((x,k)=>k===j?{...x,ends_at:e.target.value}:x)})}/></label></div><button type="button" disabled={busy} onClick={()=>change(i,{breaks:p.breaks.filter((_,k)=>k!==j)})}>Remover pausa</button></div>)}
        <div className="dash-actions"><button type="button" disabled={busy} onClick={()=>change(i,{breaks:[...(p.breaks || []),{starts_at:"",ends_at:""}]})}>Adicionar pausa</button><button type="button" disabled={busy} onClick={()=>setPeriods(periods.filter((_,j)=>j!==i))}>Remover período</button></div>
      </fieldset>)}
      <div className="dash-actions"><button type="button" disabled={busy} onClick={()=>setPeriods([...periods,{opens_at:"",closes_at:"",breaks:[]}])}>Adicionar período</button><button disabled={busy}>{busy?"Salvando…":"Salvar expediente"}</button></div>
    </form>
    {!!(data.barber_date_overrides || []).filter(d=>d.barber_id===barber.id).length && <><h4>Datas específicas</h4><ul>{data.barber_date_overrides.filter(d=>d.barber_id===barber.id).sort((a,b)=>a.local_date.localeCompare(b.local_date)).map(d=><li key={d.id}>{d.local_date.split("-").reverse().join("/")} · {d.periods.length ? d.periods.map(p=>`${p.opens_at}–${p.closes_at}`).join(", ") : "Fechado"} <button disabled={busy} onClick={()=>{if(window.confirm("Remover esta exceção e usar o expediente semanal?")) act("remove_date_override",{id:d.id});}}>Remover exceção</button></li>)}</ul></>}
  </section>;
}
