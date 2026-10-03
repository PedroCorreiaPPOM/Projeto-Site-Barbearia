import ReminderMessageEditor from "./ReminderMessageEditor.jsx";
import {CLIENT_MESSAGE,BARBER_MESSAGE,validateMessage} from "../lib/reminder-messages.js";
import {useEffect,useRef,useState} from 'react';
import {formatMinutes} from './durations.js';
import {LEAD_UNITS,unitFromFactor,leadMinutes,leadDisplay,leadSettings,validLeadMinutes} from '../lib/reminder-lead-units.js';

const statuses={pending:'Pendente',processing:'Processando',sent:'Enviado',failed:'Falhou',cancelled:'Cancelado',retry:'Aguardando nova tentativa'};
const stamp=v=>v?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—';
export function minutesFrom(value,unit){return leadMinutes(value,unitFromFactor(unit));}
function LeadTime({label,minutes,unit,value,onValue,onUnit}){
  const valid=validLeadMinutes(minutes),approximate=valid&&leadMinutes(value,unit)!==minutes;
  return <label>{label}<div className="dash-actions"><input aria-label={`${label}: valor`} aria-invalid={!valid} type="number" min="0" max={10080/LEAD_UNITS[unit]} step="any" required value={value} onChange={e=>onValue(e.target.value)}/><select aria-label={`${label}: unidade`} value={LEAD_UNITS[unit]} disabled={!valid} onChange={e=>onUnit(unitFromFactor(e.target.value))}><option value="1">minutos</option><option value="60">horas</option><option value="1440">dias</option></select></div><small>{valid?`${approximate?'Valor exibido aproximado. Duração exata: ':''}${formatMinutes(minutes)} (${minutes} minutos)`:'Informe um valor válido, com até 4 casas decimais, equivalente a minutos inteiros.'} · de 15 minutos a 7 dias</small></label>;
}
export default function Reminders({api,data,onChanged}){
  const [overview,setOverview]=useState(null),[settings,setSettings]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [filters,setFilters]=useState({status:'',kind:'',from:'',to:'',offset:0});
  const locked=useRef(false),generation=useRef(0);
  async function load(){const g=++generation.current;try{const result=await api('reminder_overview',filters);if(g===generation.current){setOverview(result);setSettings(leadSettings({client_message:CLIENT_MESSAGE,barber_message:BARBER_MESSAGE,...result.settings}));setError('');}}catch(e){if(g===generation.current)setError(e.message);}}
  useEffect(()=>{load();return()=>{generation.current++;};},[filters]);
  async function save(action,input){if(locked.current)return;locked.current=true;setBusy(true);setNotice('');setError('');try{await api(action,input);await load();await onChanged();setNotice('Configuração salva. Nenhuma mensagem é enviada por este botão.');}catch(e){setError(e.message);}finally{locked.current=false;setBusy(false);}}
  return <section><h2>Notificações e lembretes</h2>
    {error&&<p className="dash-alert" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!overview&&!error&&<p role="status">Carregando lembretes…</p>}
    {overview&&settings&&<>
      <p className="dash-panel">{overview.mode==='dry-run'?'Modo de teste: envios simulados, sem chamadas à Meta.':overview.configured?'Modo real configurado: requer templates aprovados e consentimento.':'Envio real bloqueado: configuração da Meta incompleta.'} {!overview.worker_configured&&'Processador automático ainda sem credencial do banco no backend.'} “Enviado” indica aceitação pelo provedor, sem confirmação de entrega. Simulações aparecem identificadas.</p>
      <h3>Quando enviar</h3><form onSubmit={e=>{e.preventDefault();if(!minutesFrom(settings.client_minutes,1)||!minutesFrom(settings.barber_minutes,1)){setError('Use minutos inteiros entre 15 e 10080.');return;}save('save_reminder_settings',settings);}}>
        <div className="dash-grid">{[['client','Clientes'],['barber','Barbeiros']].map(([key,label])=><section className="dash-panel" key={key}><h3>{label}</h3><label className="dash-check"><input type="checkbox" checked={settings[`${key}_enabled`]} onChange={e=>setSettings({...settings,[`${key}_enabled`]:e.target.checked})}/>Ativar lembretes</label><LeadTime label={`Antecedência para ${label.toLowerCase()}`} minutes={settings[`${key}_minutes`]} unit={settings[`${key}_unit`]} value={settings[`${key}_value`]} onValue={value=>setSettings({...settings,[`${key}_value`]:value,[`${key}_minutes`]:leadMinutes(value,settings[`${key}_unit`])})} onUnit={unit=>setSettings({...settings,[`${key}_unit`]:unit,[`${key}_value`]:leadDisplay(settings[`${key}_minutes`],unit)})}/></section>)}</div>
        <button disabled={busy}>{busy?'Salvando…':'Salvar lembretes'}</button>
      </form>
      <h3>Personalizar mensagens</h3><p>Estes textos são usados no modo de teste. Editar aqui não cria nem aprova um template da Meta. O envio real continua usando o template oficial configurado no backend; mudanças de texto e parâmetros exigem revisão e aprovação antes da ativação.</p>
      <form onSubmit={e=>{e.preventDefault();try{validateMessage(settings.client_message);validateMessage(settings.barber_message);save('save_reminder_messages',{client_message:settings.client_message,barber_message:settings.barber_message});}catch(e){setError(e.message);}}}>
        <div className="dash-grid"><ReminderMessageEditor label="Mensagem do cliente" value={settings.client_message} onChange={value=>setSettings({...settings,client_message:value})} disabled={busy}/><ReminderMessageEditor label="Mensagem do barbeiro" value={settings.barber_message} onChange={value=>setSettings({...settings,barber_message:value})} disabled={busy}/></div>
        <button disabled={busy}>{busy?'Salvando…':'Salvar mensagens de teste'}</button>
      </form>
      <p>Clientes autorizam lembretes na confirmação do agendamento. O telefone e a autorização do barbeiro ficam no cadastro dele.</p>
      <h3>Histórico dos lembretes</h3><div className="dash-filters"><label>Status<select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value,offset:0})}><option value="">Todos</option>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Tipo<select value={filters.kind} onChange={e=>setFilters({...filters,kind:e.target.value,offset:0})}><option value="">Todos</option><option value="client">Cliente</option><option value="barber">Barbeiro</option></select></label>{[['from','De'],['to','Até']].map(([key,label])=><label key={key}>{label}<input type="date" value={filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value,offset:0})}/></label>)}<button onClick={load} disabled={busy}>Atualizar histórico</button></div>
      {!overview.history.length&&<p className="dash-empty">Nenhum lembrete neste filtro.</p>}
      <div className="dash-grid">{overview.history.map(q=><article className="dash-panel" key={q.id}><h4>{q.recipient_name} · {q.recipient_type==='client'?'Cliente':'Barbeiro'}</h4><p>{q.recipient_phone}</p><strong>{statuses[q.status]}{q.simulated?' · SIMULADO':''}</strong><p>Programado: {stamp(q.scheduled_at)}<br/>Envio{q.simulated?' simulado':''}: {stamp(q.sent_at)}<br/>Última tentativa: {stamp(q.last_attempt_at)}<br/>Próxima tentativa: {stamp(q.next_attempt_at)}</p>{q.simulated&&q.rendered_message&&<details><summary>Ver mensagem simulada</summary><p className="reminder-message-preview">{q.rendered_message}</p></details>}<small>Tentativas: {q.attempts}/4 · {q.error_code||'Sem erro'}{q.provider_id&&` · Provedor: ${q.provider_id}`}</small></article>)}</div>
      <div className="dash-actions"><button disabled={!filters.offset} onClick={()=>setFilters({...filters,offset:Math.max(0,filters.offset-50)})}>Anterior</button><span>Página {filters.offset/50+1}</span><button disabled={overview.history.length<50} onClick={()=>setFilters({...filters,offset:filters.offset+50})}>Próxima</button></div>
    </>}
  </section>;
}
