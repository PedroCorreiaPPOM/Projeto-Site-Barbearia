import {useEffect,useRef,useState} from 'react';
import {formatMinutes} from './durations.js';

const statuses={pending:'Pendente',processing:'Processando',sent:'Enviado',failed:'Falhou',cancelled:'Cancelado',retry:'Aguardando nova tentativa'};
const stamp=v=>v?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—';
export function minutesFrom(value,unit){const n=Number(value)*Number(unit);return Number.isInteger(n)&&n>=15&&n<=10080?n:null;}
function LeadTime({label,minutes,onChange}){
  const [unit,setUnit]=useState(1);
  return <label>{label}<div className="dash-actions"><input aria-label={`${label}: valor`} type="number" min="0.01" step="any" required value={minutes/unit} onChange={e=>onChange(Number(e.target.value)*unit)}/><select aria-label={`${label}: unidade`} value={unit} onChange={e=>setUnit(Number(e.target.value))}><option value="1">minutos</option><option value="60">horas</option><option value="1440">dias</option></select></div><small>{formatMinutes(minutes)} · de 15 minutos a 7 dias</small></label>;
}
export default function Reminders({api,data,onChanged}){
  const [overview,setOverview]=useState(null),[settings,setSettings]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [filters,setFilters]=useState({status:'',kind:'',from:'',to:'',offset:0});
  const [contact,setContact]=useState({kind:'barber',id:'',phone:'',consent:false});
  const locked=useRef(false),generation=useRef(0);
  async function load(){const g=++generation.current;try{const result=await api('reminder_overview',filters);if(g===generation.current){setOverview(result);setSettings(result.settings);setError('');}}catch(e){if(g===generation.current)setError(e.message);}}
  useEffect(()=>{load();return()=>{generation.current++;};},[filters]);
  async function save(action,input){if(locked.current)return;locked.current=true;setBusy(true);setNotice('');setError('');try{await api(action,input);await load();await onChanged();setNotice('Configuração salva. Nenhuma mensagem é enviada por este botão.');}catch(e){setError(e.message);}finally{locked.current=false;setBusy(false);}}
  const people=contact.kind==='barber'?data.barbers:data.clients;
  return <section><h2>Notificações e lembretes</h2>
    {error&&<p className="dash-alert" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!overview&&!error&&<p role="status">Carregando lembretes…</p>}
    {overview&&settings&&<>
      <p className="dash-panel">{overview.mode==='dry-run'?'Modo de teste: envios simulados, sem chamadas à Meta.':overview.configured?'Modo real configurado: requer templates aprovados e consentimento.':'Envio real bloqueado: configuração da Meta incompleta.'} {!overview.worker_configured&&'Processador automático ainda sem credencial do banco no backend.'} “Enviado” indica aceitação pelo provedor, sem confirmação de entrega. Simulações aparecem identificadas.</p>
      <form onSubmit={e=>{e.preventDefault();if(!minutesFrom(settings.client_minutes,1)||!minutesFrom(settings.barber_minutes,1)){setError('Use minutos inteiros entre 15 e 10080.');return;}save('save_reminder_settings',settings);}}>
        <div className="dash-grid">{[['client','Clientes'],['barber','Barbeiros']].map(([key,label])=><section className="dash-panel" key={key}><h3>{label}</h3><label className="dash-check"><input type="checkbox" checked={settings[`${key}_enabled`]} onChange={e=>setSettings({...settings,[`${key}_enabled`]:e.target.checked})}/>Ativar lembretes</label><LeadTime label={`Antecedência para ${label.toLowerCase()}`} minutes={settings[`${key}_minutes`]} onChange={n=>setSettings({...settings,[`${key}_minutes`]:n})}/></section>)}</div>
        <button disabled={busy}>{busy?'Salvando…':'Salvar lembretes'}</button>
      </form>
      <form className="dash-panel" onSubmit={e=>{e.preventDefault();save('save_reminder_contact',{...contact,phone:contact.phone||null});}}><h3>Destinatários e consentimento</h3><p>Registre a autorização específica do titular para lembretes pelo WhatsApp. O consentimento de marketing e o contato informado na reserva não são convertidos automaticamente.</p>
        <div className="dash-filters"><label>Tipo<select value={contact.kind} onChange={e=>setContact({kind:e.target.value,id:'',phone:'',consent:false})}><option value="barber">Barbeiro</option><option value="client">Cliente</option></select></label>
        <label>Destinatário<select required value={contact.id} onChange={e=>{const p=people.find(x=>x.id===e.target.value);setContact({...contact,id:e.target.value,phone:p?.notification_phone||'',consent:!!(contact.kind==='barber'?p?.notification_consent:p?.whatsapp_reminder_consent)});}}><option value="">Selecione</option>{people.map(p=><option value={p.id} key={p.id}>{p.name||p.full_name}</option>)}</select></label>
        {contact.kind==='barber'?<label>WhatsApp de notificação<input type="tel" placeholder="+55 e DDD" required={contact.consent} value={contact.phone} onChange={e=>setContact({...contact,phone:e.target.value,consent:false})}/></label>:<p>Telefone do cadastro: {people.find(p=>p.id===contact.id)?.phone_e164||'—'}</p>}</div>
        <label className="dash-check"><input type="checkbox" checked={contact.consent} onChange={e=>setContact({...contact,consent:e.target.checked})}/>O titular autorizou lembretes de agendamento pelo WhatsApp</label><button disabled={busy||!contact.id}>Salvar destinatário</button>
      </form>
      <h3>Histórico dos lembretes</h3><div className="dash-filters"><label>Status<select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value,offset:0})}><option value="">Todos</option>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Tipo<select value={filters.kind} onChange={e=>setFilters({...filters,kind:e.target.value,offset:0})}><option value="">Todos</option><option value="client">Cliente</option><option value="barber">Barbeiro</option></select></label>{[['from','De'],['to','Até']].map(([key,label])=><label key={key}>{label}<input type="date" value={filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value,offset:0})}/></label>)}<button onClick={load} disabled={busy}>Atualizar histórico</button></div>
      {!overview.history.length&&<p className="dash-empty">Nenhum lembrete neste filtro.</p>}
      <div className="dash-grid">{overview.history.map(q=><article className="dash-panel" key={q.id}><h4>{q.recipient_name} · {q.recipient_type==='client'?'Cliente':'Barbeiro'}</h4><p>{q.recipient_phone}</p><strong>{statuses[q.status]}{q.simulated?' · SIMULADO':''}</strong><p>Programado: {stamp(q.scheduled_at)}<br/>Envio{q.simulated?' simulado':''}: {stamp(q.sent_at)}<br/>Última tentativa: {stamp(q.last_attempt_at)}<br/>Próxima tentativa: {stamp(q.next_attempt_at)}</p><small>Tentativas: {q.attempts}/4 · {q.error_code||'Sem erro'}{q.provider_id&&` · Provedor: ${q.provider_id}`}</small></article>)}</div>
      <div className="dash-actions"><button disabled={!filters.offset} onClick={()=>setFilters({...filters,offset:Math.max(0,filters.offset-50)})}>Anterior</button><span>Página {filters.offset/50+1}</span><button disabled={overview.history.length<50} onClick={()=>setFilters({...filters,offset:filters.offset+50})}>Próxima</button></div>
    </>}
  </section>;
}
