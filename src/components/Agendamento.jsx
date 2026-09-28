import { useEffect, useRef, useState } from "react";
import { bookingApi, localDate, localTime, money, normalizePhone, serviceTotals } from "../lib/booking.js";
import { formatMinutes } from "../admin/durations.js";
import { BARBEIROS, WHATSAPP_BARBEARIA } from "../data/barbeiros.js";
import logo from "../assets/images/logo.png";
import "./booking.css";

const STEPS=["Barbeiro","Serviços","Data","Horário","Confirmação"];
export default function Agendamento({barbeiroPreSelecionado,catalog}) {
  const [step,setStep]=useState(0),[barberId,setBarberId]=useState(""),[serviceIds,setServiceIds]=useState([]),[date,setDate]=useState(""),[slot,setSlot]=useState(null);
  const [slots,setSlots]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[reload,setReload]=useState(0);
  const [name,setName]=useState(""),[phone,setPhone]=useState(""),[consent,setConsent]=useState(false),[website,setWebsite]=useState("");
  const [saving,setSaving]=useState(false),[receipt,setReceipt]=useState(null);
  const lock=useRef(false),request=useRef(null),heading=useRef(null), firstRender=useRef(true);
  const barber=catalog.barbers.find(b=>b.id===barberId);
  const services=(barber?.services || []).filter(s=>serviceIds.includes(s.id));
  const total=serviceTotals(services);
  const serviceKey=serviceIds.join(",");
  const catalogFingerprint=JSON.stringify(barber?.services.map(s=>[s.id,s.price,s.duration_minutes]));
  const previousCatalog=useRef(null);

  useEffect(()=>{if(firstRender.current){firstRender.current=false;return;} heading.current?.focus();},[step,receipt]);
  useEffect(()=>{if(barbeiroPreSelecionado){setBarberId(barbeiroPreSelecionado);setServiceIds([]);setSlot(null);setStep(1);setReceipt(null);}},[barbeiroPreSelecionado]);
  useEffect(()=>{
    if(receipt || catalog.loading || catalog.error || saving) return;
    if(barberId && !barber){setBarberId("");setServiceIds([]);setSlot(null);setStep(0);setError("O barbeiro selecionado não está disponível. Escolha outro profissional.");}
    if(barber && serviceIds.some(id=>!barber.services.some(s=>s.id===id))){setServiceIds(ids=>ids.filter(id=>barber.services.some(s=>s.id===id)));setSlot(null);setStep(1);setError("Um serviço deixou de ser oferecido. Revise sua seleção.");}
    if(previousCatalog.current && previousCatalog.current.id===barberId && previousCatalog.current.value!==catalogFingerprint && serviceIds.length){setSlot(null);setStep(1);setError("O catálogo foi atualizado. Revise os serviços e valores antes de continuar.");}
    previousCatalog.current={id:barberId,value:catalogFingerprint};
  },[catalog,barberId,catalogFingerprint,receipt,saving]);
  useEffect(()=>{setSlot(null);setSlots([]);request.current=null;},[barberId,serviceKey,date]);
  useEffect(()=>{
    if(!barberId || !serviceIds.length || !date || step<3 || receipt) return;
    const controller=new AbortController();setLoading(true);setSlots([]);
    bookingApi("availability",{barber_id:barberId,service_ids:serviceIds,date},controller.signal)
      .then(result=>{if(controller.signal.aborted)return;setSlots(result.slots);if(Number(result.total_price)!==total.price || result.total_duration_minutes!==total.minutes){setSlot(null);setStep(1);setError("Os valores foram atualizados. Aguarde a atualização do catálogo e revise sua seleção.");}})
      .catch(e=>{if(e.name!=="AbortError"){setError(e.message);setSlot(null);}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[barberId,serviceKey,date,reload,step>=3,receipt,catalogFingerprint]);
  useEffect(()=>{if(step!==3 || receipt)return;const timer=setInterval(()=>setReload(n=>n+1),30000);return ()=>clearInterval(timer);},[step,receipt]);
  function chooseBarber(id){if(id!==barberId){setBarberId(id);setServiceIds([]);setSlot(null);}setError("");setStep(1);}
  function toggleService(id){setServiceIds(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);setSlot(null);setError("");}
  function next(){setError("");setStep(s=>Math.min(4,s+1));}
  async function confirm(e){
    e.preventDefault();if(lock.current || !slot)return;
    const normalized=normalizePhone(phone);
    if(!/^\S+\s+\S/.test(name.trim()) || !/^\+55[1-9]\d{9,10}$/.test(normalized) || !consent){setError("Informe nome completo, telefone com DDD e autorize o contato sobre esta reserva.");return;}
    lock.current=true;setSaving(true);setError("");
    const payload={barber_id:barberId,service_ids:serviceIds,starts_at:slot.starts_at,full_name:name.trim(),phone:normalized,contact_consent:consent,website};
    const fingerprint=JSON.stringify(payload);
    if(!request.current || request.current.fingerprint!==fingerprint) request.current={id:crypto.randomUUID(),fingerprint};
    try {setReceipt(await bookingApi("create",{...payload,request_id:request.current.id}));}
    catch(e){setError(e.message);if(e.status===409){setSlot(null);setStep(3);setReload(n=>n+1);request.current=null;}}
    finally{lock.current=false;setSaving(false);}
  }
  const maxDate=barber ? localDate(new Date(Date.now()+barber.booking_horizon_days*86400000)) : undefined;
  const whatsapp=(receipt && (BARBEIROS[receipt.booking_key]?.whatsapp || WHATSAPP_BARBEARIA) || "").replace(/\D/g,"");
  return <section id="agendamento" className="section"><div className="container">
    <div className="section-head center"><span className="eyebrow-rule"/><h2 className="section-title">Seu próximo cuidado começa aqui</h2><p className="section-sub">Escolha seu profissional, os serviços e um horário disponível.</p></div>
    <div className="booking-flow" aria-busy={saving}>
      {receipt ? <div className="booking-success" role="status"><span className="eyebrow-rule"/><h3 ref={heading} tabIndex={-1}>Agendamento registrado</h3><p>Seu horário foi reservado com status pendente. Nenhuma mensagem automática foi enviada.</p><h4>{receipt.barber_name}</h4><p>{receipt.services.map(s=>s.name).join(" + ")}</p><p>{localDate(new Date(receipt.starts_at)).split("-").reverse().join("/")} · {localTime(receipt.starts_at)}–{localTime(receipt.ends_at)}</p><strong>{money(receipt.total_price)} · {formatMinutes(receipt.total_duration_minutes)}</strong><p>Protocolo: {receipt.id}</p>{/^\d{12,13}$/.test(whatsapp) && <a className="btn btn-outline" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Olá! Registrei o agendamento ${receipt.id} com ${receipt.barber_name}, em ${localDate(new Date(receipt.starts_at))} às ${localTime(receipt.starts_at)}.`)}`} target="_blank" rel="noopener noreferrer">Conversar pelo WhatsApp</a>}<button className="btn btn-solid" onClick={()=>{setReceipt(null);setSlot(null);setServiceIds([]);setStep(0);request.current=null;}}>Novo agendamento</button></div> : <>
      <nav aria-label="Etapas do agendamento"><ol className="booking-progress">{STEPS.map((label,i)=><li key={label} aria-current={step===i?"step":undefined}><button type="button" disabled={i>step || saving} onClick={()=>setStep(i)}><span>{i+1}</span>{label}</button></li>)}</ol></nav>
      <div className="booking-layout"><div className="booking-stage">
      <h3 ref={heading} tabIndex={-1}>{["Escolha seu barbeiro","Selecione seus serviços","Escolha a data","Escolha um horário disponível","Revise e confirme"][step]}</h3>
      {catalog.loading && <p role="status">Carregando profissionais…</p>}{catalog.error && <div role="alert"><p className="form-msg">Não foi possível consultar os profissionais. {catalog.error}</p><button type="button" className="btn btn-outline" onClick={catalog.retry}>Tentar novamente</button></div>}
      {error && <p className="form-msg" role="alert">{error}</p>}
      {step===0 && <div className="booking-choices">{catalog.barbers.map(b=><button className={`booking-choice ${barberId===b.id?"chosen":""}`} key={b.id} onClick={()=>chooseBarber(b.id)}><img src={b.photo_url || logo} alt=""/><span><strong>{b.name}</strong>{b.description && <small>{b.description}</small>}</span></button>)}{!catalog.loading && !catalog.error && !catalog.barbers.length && <p>Nenhum profissional está recebendo agendamentos online no momento.</p>}</div>}
      {step===1 && <><div className="booking-choices">{barber?.services.map(s=><button type="button" className={`booking-choice ${serviceIds.includes(s.id)?"chosen":""}`} key={s.id} aria-pressed={serviceIds.includes(s.id)} onClick={()=>toggleService(s.id)}><img src={s.photo_url || logo} alt=""/><span><strong>{s.name}</strong><small>{s.description}</small><span>{money(s.price)} · {formatMinutes(s.duration_minutes)}</span><small>{serviceIds.includes(s.id)?"Selecionado ✓":"Adicionar serviço"}</small></span></button>)}</div>{!barber?.services.length && <p>Nenhum serviço disponível para este profissional.</p>}<button className="btn btn-solid" disabled={!services.length} onClick={next}>Escolher data</button></>}
      {step===2 && <><div className="field"><label htmlFor="booking-date">Data do atendimento</label><input id="booking-date" type="date" min={localDate()} max={maxDate} value={date} onChange={e=>{setDate(e.target.value);setSlot(null);}}/></div><p>A disponibilidade considera o expediente individual, as pausas e os agendamentos existentes.</p><button className="btn btn-solid" disabled={!date || date<localDate() || date>maxDate} onClick={next}>Consultar horários</button></>}
      {step===3 && <>{loading ? <p role="status">Consultando horários para {formatMinutes(total.minutes)} de atendimento…</p> : <div className="booking-slots">{slots.map(s=><button type="button" key={s.starts_at} className={slot?.starts_at===s.starts_at?"chosen":""} onClick={()=>{setSlot(s);setError("");setStep(4);}} aria-label={`Das ${localTime(s.starts_at)} às ${localTime(s.ends_at)}`}>{localTime(s.starts_at)}<small>até {localTime(s.ends_at)}</small></button>)}</div>}{!loading && !error && !slots.length && <p role="status">Não há horários disponíveis para esta seleção. Escolha outra data ou revise os serviços.</p>}<button className="btn btn-outline" onClick={()=>{setSlot(null);setStep(2);}}>Escolher outra data</button></>}
      {step===4 && <form onSubmit={confirm}><div className="field"><label htmlFor="booking-name">Nome completo</label><input id="booking-name" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} minLength={3} maxLength={200} required disabled={saving}/></div><div className="field"><label htmlFor="booking-phone">Telefone com DDD</label><input id="booking-phone" type="tel" autoComplete="tel" placeholder="(85) 99999-9999" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={22} required disabled={saving}/></div><div className="booking-honeypot" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></label></div><label className="booking-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required disabled={saving}/>Autorizo o uso do meu nome e telefone para registrar e tratar este agendamento. Isso não autoriza mensagens de marketing.</label><p>Ao confirmar, o horário será reservado. O envio automático de mensagens ainda não está ativo.</p><button className="btn btn-solid" disabled={saving || !slot}>{saving?"Registrando agendamento…":"Confirmar agendamento"}</button></form>}
      {step>0 && <button className="btn btn-outline booking-back" disabled={saving} onClick={()=>setStep(s=>s-1)}>← Voltar</button>}
      </div><aside className="booking-summary" aria-label="Resumo da seleção"><span className="booking-eyebrow">Seu atendimento</span><h3>{barber?.name || "Escolha um profissional"}</h3><ul>{services.map(s=><li key={s.id}><span>{s.name}</span><span>{money(s.price)}</span></li>)}</ul><div className="booking-total"><span>{services.length} serviço(s)</span><strong>{money(total.price)}</strong></div><p>Duração do atendimento: <strong>{formatMinutes(total.minutes)}</strong></p>{date && <p>{date.split("-").reverse().join("/")}</p>}{slot && <p><strong>{localTime(slot.starts_at)}–{localTime(slot.ends_at)}</strong> · Horário de Fortaleza</p>}<small>O horário é garantido após o registro. Alterações de disponibilidade serão verificadas na confirmação.</small></aside></div>
      </>}
    </div>
  </div></section>;
}
