import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { localDate, money } from '../lib/booking.js';
import { formatMinutes } from './durations.js';
import { barberPublication } from './barberPublication.js';
import { DAYS, draftFromSnapshot, copyWeek, noticeMinutes, periodsSummary, normalizeDraft } from './barberDraft.js';
import PermanentDeleteBarberDialog from './PermanentDeleteBarberDialog.jsx';

export default function BarberManager({data,api,onChanged,onDeactivate,guard}) {
  const [editor,setEditor]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const opening=useRef(false);
  const [deleteTarget,setDeleteTarget]=useState(null),[removed,setRemoved]=useState([]),[cleanup,setCleanup]=useState(null);
  const pendingPhotos=cleanup ?? data.barber_photo_cleanup?.pending;
  async function retryPhotos() {
    if(opening.current)return;
    opening.current=true;setLoading(true);
    try {const result=await api('cleanup_barber_photos');setCleanup(result.pending);setNotice(result.pending?'Ainda há fotos aguardando remoção. Tente novamente.':'Remoção de fotos concluída.');}
    catch(e){setError(e.message);}finally{opening.current=false;setLoading(false);}
  }
  async function edit(barber) {
    if(opening.current)return;
    opening.current=true;setLoading(true);setError('');setNotice('');
    try {
      const snapshot=await api('barber_editor_snapshot',{id:barber.id});
      if(!snapshot)throw new Error('Cadastro não encontrado. Atualize a listagem.');
      setEditor({id:barber.id,snapshot});
    } catch(e){setError(e.message);} finally {opening.current=false;setLoading(false);}
  }
  async function reactivate(b) {
    if(opening.current || !window.confirm(`Reativar ${b.name}? As configurações de agendamento serão mantidas.`))return;
    opening.current=true;setLoading(true);setError('');
    try {await api('save_barber',{...b,active:true});await onChanged();setNotice('Barbeiro reativado.');}
    catch(e){setError(e.message);}finally{opening.current=false;setLoading(false);}
  }
  if(editor)return <BarberForm key={editor.id} {...editor} data={data} api={api} guard={guard} onCancel={()=>setEditor(null)} onSaved={async()=>{
    setEditor(null);setNotice('Barbeiro salvo com sucesso.');
    try {await onChanged();} catch {setError('O cadastro foi salvo, mas a lista não pôde ser atualizada. Clique em Atualizar lista.');}
  }}/>;
  return <section className="dash-barbers" aria-busy={loading}>
    <div className="dash-heading"><div><h2>Seus profissionais</h2><p>Cadastros, serviços e agendas individuais.</p></div><button disabled={loading} onClick={()=>{setNotice('');setError('');setEditor({id:crypto.randomUUID(),snapshot:null});}}>+ Novo barbeiro</button></div>
    {error && <div className="dash-alert" role="alert">{error} <button onClick={async()=>{try{await onChanged();setError('');}catch(e){setError(e.message);}}}>Atualizar lista</button></div>}
    {notice && <p className="dash-notice" role="status">{notice}</p>}
    {pendingPhotos && <div className="dash-alert" role="status">Há fotos de cadastros excluídos aguardando remoção no Storage. A pendência está registrada.<button disabled={loading} onClick={retryPhotos}>Tentar remover fotos novamente</button></div>}
    {loading && <p role="status">Carregando cadastro…</p>}
    {!data.barbers.some(b=>!removed.includes(b.id)) && <p className="dash-empty">Nenhum barbeiro cadastrado. Adicione seu primeiro profissional.</p>}
    <div className="dash-grid barber-cards">{data.barbers.filter(b=>!removed.includes(b.id)).map(b=>{
      const state=barberPublication(b,data),hours=data.barber_hours.filter(h=>h.barber_id===b.id);
      return <article className="dash-panel barber-card-admin" key={b.id} onClick={e=>{if(!e.target.closest('button'))edit(b);}}>
        <div className="dash-barber-head">{data.photo_urls[b.id] ? <img src={data.photo_urls[b.id]} alt=""/> : <span className="dash-avatar">{b.name[0]}</span>}<div><h3>{b.name}</h3><span className="dash-status">{b.active?'Ativo':'Inativo'}</span></div></div>
        <p>Agendamento online: <strong>{b.booking_enabled?'Habilitado':'Desabilitado'}</strong></p>
        <p className="barber-publishing">{state.ready?'Configurado para reservas':state.listed?'Vincule serviços ativos para receber reservas':'Não publicado para agendamento'}</p>
        <dl className="barber-week-summary">{DAYS.map((day,i)=><div key={day}><dt>{day}</dt><dd>{periodsSummary(hours.filter(h=>h.weekday===i).sort((a,b)=>a.opens_at.localeCompare(b.opens_at)).map(h=>({opens_at:h.opens_at.slice(0,5),closes_at:h.closes_at.slice(0,5)})))}</dd></div>)}</dl>
        <small>{(data.barber_date_overrides || []).filter(d=>d.barber_id===b.id).length} exceção(ões) por data · {data.schedule_blocks.filter(d=>d.barber_id===b.id).length} bloqueio(s)</small>
        <div className="dash-actions"><button disabled={loading} onClick={()=>edit(b)} aria-label={`Editar ${b.name}`}>Editar</button>{b.active ? <button disabled={loading} onClick={()=>onDeactivate(b)}>Desativar</button> : <button disabled={loading} onClick={()=>reactivate(b)}>Ativar</button>}<button disabled={loading} className="dash-delete-button" onClick={()=>setDeleteTarget(b)} aria-label={`Excluir definitivamente ${b.name}`}>Excluir</button></div>
      </article>;
    })}</div>
    {deleteTarget && <PermanentDeleteBarberDialog barber={deleteTarget} api={api} onClose={()=>setDeleteTarget(null)} onDeactivate={()=>{onDeactivate(deleteTarget);setDeleteTarget(null);}} onDeleted={async result=>{
      setRemoved(ids=>[...ids,result.id]);setDeleteTarget(null);setCleanup(result.photo_cleanup.pending);
      setNotice(result.photo_cleanup.pending?'Barbeiro excluído. A remoção das fotos está pendente.':'Barbeiro excluído definitivamente.');
      try {await onChanged();}catch{setError('A exclusão foi concluída, mas não foi possível atualizar os demais dados.');}
    }}/>}
  </section>;
}

function BarberForm({id,snapshot,data,api,guard,onCancel,onSaved}) {
  const [initial]=useState(()=>draftFromSnapshot(snapshot));
  const [draft,setDraft]=useState(initial),[file,setFile]=useState(null),[preview,setPreview]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[day,setDay]=useState(1),[targets,setTargets]=useState([]);
  const [unit,setUnit]=useState(initial.minimum_notice_minutes && initial.minimum_notice_minutes%1440===0 ? 1440 : initial.minimum_notice_minutes && initial.minimum_notice_minutes%60===0 ? 60 : 1);
  const [amount,setAmount]=useState(initial.minimum_notice_minutes/unit);
  const saving=useRef(false),uploaded=useRef(null),heading=useRef(null);
  const dirty=JSON.stringify(draft)!==JSON.stringify(initial) || !!file || Number(amount)*unit!==initial.minimum_notice_minutes;
  const change=(patch)=>setDraft(d=>({...d,...patch}));
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    const leave=()=>!saving.current && (!dirty || window.confirm('Descartar as alterações não salvas deste barbeiro?'));
    guard.current=leave;
    const unload=e=>{if(dirty || saving.current){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    return ()=>{guard.current=()=>true;window.removeEventListener('beforeunload',unload);};
  },[dirty,guard]);
  useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  function cancel(){if(guard.current())onCancel();}
  function selectPhoto(e) {
    const chosen=e.target.files[0];if(!chosen)return;
    if(!['image/jpeg','image/png','image/webp'].includes(chosen.type) || !chosen.size || chosen.size>2097152){setError('Use JPG, PNG ou WebP de até 2 MB.');e.target.value='';return;}
    setFile(chosen);uploaded.current=null;setError('');
  }
  async function save(e) {
    e.preventDefault();if(saving.current)return;
    setError('');
    let profile;
    try {profile=normalizeDraft({...draft,minimum_notice_minutes:noticeMinutes(amount,unit)},data.services,localDate());}
    catch(e){setError(e.message);return;}
    saving.current=true;setBusy(true);
    try {
      if(file) {
        if(!uploaded.current){
          const result=await api('photo_upload_url',{barber_id:id,type:file.type,size:file.size});
          const {error}=await supabase.storage.from('barber-photos').uploadToSignedUrl(result.path,result.token,file,{contentType:file.type});
          if(error)throw error;
          uploaded.current=result.path;
        }
        profile.photo_path=uploaded.current;
      }
      await api('save_barber_profile',{id,profile,expected:snapshot});
      guard.current=()=>true;await onSaved();
    } catch(e){setError(e.message);}finally{saving.current=false;setBusy(false);}
  }
  const photo=preview || (draft.photo_path ? data.photo_urls[id] : '');
  return <section className="dash-barbers barber-editor-page">
    <div className="dash-heading"><div><span className="dash-kicker">{snapshot?'Editar profissional':'Novo profissional'}</span><h2 ref={heading} tabIndex={-1}>{snapshot?snapshot.barber.name:'Cadastrar barbeiro'}</h2></div><button type="button" disabled={busy} onClick={cancel}>← Voltar à listagem</button></div>
    <form onSubmit={save} aria-busy={busy} onInvalidCapture={e=>{let details=e.target.closest('details');while(details){details.open=true;details=details.parentElement?.closest('details');}}}>
      {error && <div className="dash-alert" role="alert">{error}</div>}
      <fieldset disabled={busy} className="barber-form-fields">
      <section className="dash-panel"><h3>1. Perfil do profissional</h3><div className="barber-profile-layout">
        <div className="barber-photo-editor">{photo ? <img src={photo} alt="Prévia da fotografia"/> : <span className="dash-avatar">{draft.name[0] || '✂'}</span>}<label>Fotografia<input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectPhoto}/></label><small>JPG, PNG ou WebP · até 2 MB</small>{(photo || draft.photo_path || file) && <button type="button" onClick={()=>{setFile(null);uploaded.current=null;change({photo_path:null});}}>Remover fotografia</button>}</div>
        <div><label>Nome<input required minLength={2} maxLength={120} value={draft.name} onChange={e=>change({name:e.target.value})}/></label><label>Descrição<textarea rows={4} maxLength={1000} value={draft.description} onChange={e=>change({description:e.target.value})}/></label></div>
      </div></section>
      <section className="dash-panel"><h3>Lembretes pelo WhatsApp</h3><label>Telefone de notificação<input type="tel" placeholder="+55 e DDD" value={draft.notification_phone} onChange={e=>change({notification_phone:e.target.value,notification_consent:false})}/></label><label className="dash-check"><input type="checkbox" checked={draft.notification_consent} onChange={e=>change({notification_consent:e.target.checked})}/>O barbeiro autoriza receber lembretes dos seus atendimentos pelo WhatsApp</label><p>A antecedência é definida na seção Lembretes. Este telefone não altera o vínculo público.</p></section>
      <section className="dash-panel"><h3>2. Agendamento online</h3><label className="dash-check"><input type="checkbox" checked={draft.booking_enabled} onChange={e=>change({booking_enabled:e.target.checked})}/>Receber agendamentos online</label><p>Para publicar, configure expediente e ao menos um serviço ativo. A foto é opcional. {snapshot?.barber.active===false && 'Este cadastro está inativo: reative-o na listagem para aparecer no site.'}</p>
        <div className="barber-fields-grid"><label>Intervalo da grade de horários<select value={draft.slot_interval_minutes} onChange={e=>change({slot_interval_minutes:Number(e.target.value)})}>{[5,10,15,20,30,45,60].map(n=><option key={n} value={n}>{n} minutos</option>)}</select><small>Define apenas os inícios. A duração continua sendo a soma dos serviços.</small></label>
        <label>Preparação após atendimento (minutos)<input type="number" min={0} max={120} required value={draft.buffer_minutes} onChange={e=>change({buffer_minutes:e.target.value})}/></label>
        <div><label>Antecedência mínima<input type="number" min={0} step="any" required value={amount} onChange={e=>{setAmount(e.target.value);change({minimum_notice_minutes:Number(e.target.value)*unit});}}/></label><label>Unidade da antecedência<select value={unit} onChange={e=>{const next=Number(e.target.value);setAmount(Number(amount)*unit/next);setUnit(next);}}><option value={1}>Minutos</option><option value={60}>Horas</option><option value={1440}>Dias</option></select></label><small>De zero a sete dias. Salvo em minutos inteiros.</small></div>
        <label>Até quantos dias no futuro o cliente pode reservar?<input type="number" min={1} max={365} required value={draft.booking_horizon_days} onChange={e=>change({booking_horizon_days:e.target.value})}/><small>De 1 a 365 dias, contados a partir de hoje.</small></label></div>
      </section>
      <section className="dash-panel"><h3>3. Serviços oferecidos</h3><div className="barber-services">{data.services.filter(s=>s.active || draft.services.includes(s.id)).map(s=><label className="dash-check" key={s.id}><input type="checkbox" checked={draft.services.includes(s.id)} onChange={e=>change({services:e.target.checked?[...draft.services,s.id]:draft.services.filter(id=>id!==s.id)})}/><span>{s.name} {!s.active && '(inativo — vínculo existente)'}<small>{money(s.price)} · {formatMinutes(s.duration_minutes)}</small></span></label>)}</div>{!data.services.some(s=>s.active) && <p>Cadastre um serviço ativo na seção Serviços antes de habilitar reservas online.</p>}</section>
      <section className="dash-panel"><h3>4. Expediente semanal</h3><p>Escolha um dia para editar. Dias sem períodos ficam fechados; mudanças na grade não alteram agendamentos existentes.</p>
        <div className="barber-week-tabs" role="group" aria-label="Dia para editar">{DAYS.map((name,i)=><button type="button" key={name} aria-pressed={day===i} onClick={()=>{setDay(i);setTargets([]);}}><strong>{name}</strong><small>{periodsSummary(draft.week[i])}</small></button>)}</div>
        <h4>{DAYS[day]}</h4><Periods value={draft.week[day]} onChange={periods=>change({week:draft.week.map((p,i)=>i===day?periods:p)})}/>
        <details className="barber-copy"><summary>Copiar horários para outros dias</summary><p>Copiar {DAYS[day].toLowerCase()} para:</p><div className="dash-actions">{DAYS.map((name,i)=>i!==day && <label className="dash-check" key={name}><input type="checkbox" checked={targets.includes(i)} onChange={e=>setTargets(e.target.checked?[...targets,i]:targets.filter(d=>d!==i))}/>{name}</label>)}</div><div className="dash-actions"><button type="button" onClick={()=>setTargets([1,2,3,4,5,6].filter(i=>i!==day))}>Selecionar segunda a sábado</button><button type="button" disabled={!targets.length} onClick={()=>{if(targets.some(i=>draft.week[i].length) && !window.confirm(`Substituir os horários de ${targets.map(i=>DAYS[i]).join(', ')}?`))return;change({week:copyWeek(draft.week,day,targets)});setTargets([]);}}>Copiar para dias selecionados</button></div></details>
      </section>
      <section className="dash-panel"><h3>5. Exceções, férias e bloqueios</h3><details><summary>Exceções por data ({draft.overrides.length})</summary><p>A data substitui o expediente semanal. Sem períodos, o dia fica fechado.</p>{draft.overrides.map((d,i)=><div className="barber-exception" key={i}><label>Data<input type="date" required value={d.local_date} onChange={e=>change({overrides:draft.overrides.map((x,j)=>j===i?{...x,local_date:e.target.value}:x)})}/></label><Periods value={d.periods} onChange={periods=>change({overrides:draft.overrides.map((x,j)=>j===i?{...x,periods}:x)})}/><button type="button" onClick={()=>{if(window.confirm('Remover esta exceção ao salvar?'))change({overrides:draft.overrides.filter((_,j)=>j!==i)});}}>Remover exceção</button></div>)}<button type="button" onClick={()=>change({overrides:[...draft.overrides,{local_date:'',periods:[]}]})}>Adicionar exceção por data</button></details>
        <details><summary>Férias e bloqueios ({draft.blocks.length})</summary>{draft.blocks.map((b,i)=><div className="barber-exception barber-fields-grid" key={b.id || i}><label>Tipo<select value={b.kind} onChange={e=>change({blocks:draft.blocks.map((x,j)=>j===i?{...x,kind:e.target.value}:x)})}><option value="time_off">Férias / folga</option><option value="block">Bloqueio</option><option value="exception">Exceção</option></select></label>{['starts_at','ends_at'].map((key,k)=><label key={key}>{k?'Fim':'Início'} (Fortaleza)<input type="datetime-local" required value={localInput(b[key])} onChange={e=>change({blocks:draft.blocks.map((x,j)=>j===i?{...x,[key]:e.target.value?`${e.target.value}:00-03:00`:''}:x)})}/></label>)}<label>Motivo<input maxLength={300} value={b.reason} onChange={e=>change({blocks:draft.blocks.map((x,j)=>j===i?{...x,reason:e.target.value}:x)})}/></label><button type="button" onClick={()=>{if(window.confirm('Remover este bloqueio ao salvar?'))change({blocks:draft.blocks.filter((_,j)=>j!==i)});}}>Remover bloqueio</button></div>)}<button type="button" onClick={()=>change({blocks:[...draft.blocks,{kind:'time_off',starts_at:'',ends_at:'',reason:''}]})}>Adicionar férias ou bloqueio</button></details>
      </section>
      {snapshot && <details className="dash-panel"><summary>Informações avançadas</summary><p>Vínculo público (gerado automaticamente)</p><output className="barber-key">{snapshot.barber.public_booking_key || 'Será gerado ao habilitar o online e salvar.'}</output><small>Usado para identificar o profissional no catálogo público. Nenhuma digitação é necessária.</small></details>}
      </fieldset>
      <div className="barber-save-bar"><p>{busy?'Salvando cadastro completo…':dirty?'Você tem alterações não salvas.':'As alterações serão confirmadas ao salvar.'}</p><div className="dash-actions"><button type="button" disabled={busy} onClick={cancel}>Cancelar</button><button className="barber-primary" disabled={busy} type="submit">{busy?'Salvando…':snapshot?'Salvar alterações':'Salvar barbeiro'}</button></div></div>
    </form>
  </section>;
}

function Periods({value,onChange}) {
  const change=(i,patch)=>onChange(value.map((p,j)=>i===j?{...p,...patch}:p));
  return <div className="barber-periods">{!value.length && <p className="dash-empty">Dia fechado.</p>}{value.map((p,i)=><div className="barber-period" key={i}><div className="dash-time-grid"><label>Abre<input type="time" required value={p.opens_at} onChange={e=>change(i,{opens_at:e.target.value})}/></label><label>Fecha<input type="time" required value={p.closes_at} onChange={e=>change(i,{closes_at:e.target.value})}/></label></div>{(p.breaks || []).map((b,j)=><div className="barber-break-row" key={j}>{['starts_at','ends_at'].map((key,k)=><label key={key}>{k?'Fim da pausa':'Início da pausa'}<input type="time" required value={b[key].slice(0,5)} onChange={e=>change(i,{breaks:p.breaks.map((x,n)=>n===j?{...x,[key]:e.target.value}:x)})}/></label>)}<button type="button" onClick={()=>change(i,{breaks:p.breaks.filter((_,n)=>n!==j)})}>Remover pausa</button></div>)}<div className="dash-actions"><button type="button" onClick={()=>change(i,{breaks:[...(p.breaks || []),{starts_at:'',ends_at:''}]})}>Adicionar pausa</button><button type="button" onClick={()=>onChange(value.filter((_,j)=>j!==i))}>Remover período</button></div></div>)}<div className="dash-actions"><button type="button" onClick={()=>onChange([...value,{opens_at:'',closes_at:'',breaks:[]}])}>Adicionar período</button>{value.length>0 && <button type="button" onClick={()=>{if(window.confirm('Marcar este dia como fechado e remover seus períodos?'))onChange([]);}}>Marcar dia fechado</button>}</div></div>;
}
function localInput(value) {
  if(!value || !Number.isFinite(Date.parse(value)))return '';
  const date=new Date(value);
  return localDate(date)+'T'+new Intl.DateTimeFormat('en-GB',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
}
