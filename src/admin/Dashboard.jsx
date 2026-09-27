import { useEffect, useMemo, useState } from "react";
import Settings from "./Settings.jsx";
import ServicePhoto from "./ServicePhoto.jsx";
import { formatMinutes } from "./durations.js";
import logo from "../assets/images/logo.png";
import { supabase } from "../lib/supabase.js";

const SECTIONS = [["visao","Visão geral","◈"],["agenda","Agendamentos","▦"],["clientes","Clientes","◎"],["barbeiros","Barbeiros","♙"],["servicos","Serviços","✂"],["config","Configurações","⚙"]];
const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const STATUSES = { pending: "Pendente", confirmed: "Confirmado", completed: "Concluído", cancelled: "Cancelado", no_show: "Não compareceu" };
const money = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0));
const dateTime = (v) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" }).format(new Date(v));
const localDay = (v) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Fortaleza" }).format(new Date(v));
const today = () => localDay(new Date());
const empty = { barbers: [], services: [], barber_services: [], barber_hours: [], barber_breaks: [], schedule_blocks: [], clients: [], appointments: [], appointment_services: [], notification_settings: [], photo_urls: {} };

export default function Dashboard() {
  const [data, setData] = useState(empty), [tab, setTab] = useState("visao"), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [barber, setBarber] = useState(""), [status, setStatus] = useState(""), [period, setPeriod] = useState("day"), [focus, setFocus] = useState(today());
  const [search, setSearch] = useState(""), [editingBarber, setEditingBarber] = useState(null), [editingService, setEditingService] = useState(null);
  const [collapsed, setCollapsed] = useState(false), [adminName, setAdminName] = useState("Administrador");
  useEffect(() => { supabase.auth.getUser().then(({data}) => { const user = data?.user; setAdminName(user?.user_metadata?.full_name || user?.email || "Administrador"); }); }, []);
  const [selectedClient, setSelectedClient] = useState(null);
  const byId = (list, id) => list.find((item) => item.id === id);

  async function api(action, input) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Sessão expirada. Entre novamente.");
    const response = await fetch("/.netlify/functions/admin-api", {
      method: action === "bootstrap" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: action === "bootstrap" ? undefined : JSON.stringify({ action, input }), cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Falha na operação.");
    return result.data;
  }
  async function refresh() { setLoading(true); try { setData(await api("bootstrap")); setError(""); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, []);
  async function act(action, input, success = "Alteração salva.") {
    setBusy(true); setError(""); setNotice("");
    try { const result = await api(action, input); await refresh(); setNotice(success); return result; }
    catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  }
  const appointments = useMemo(() => data.appointments.filter((a) => {
    if (barber && a.barber_id !== barber || status && a.status !== status) return false;
    if (period === "day") return a.local_date === focus;
    const target = new Date(`${focus}T12:00:00-03:00`), current = new Date(`${a.local_date}T12:00:00-03:00`);
    if (period === "week") { const start = new Date(target); start.setDate(start.getDate() - start.getDay()); return current >= start && current < new Date(start.getTime() + 7 * 86400000); }
    return a.local_date.slice(0, 7) === focus.slice(0, 7);
  }).sort((a,b) => a.starts_at.localeCompare(b.starts_at)), [data, barber, status, period, focus]);
  const counts = Object.fromEntries(Object.keys(STATUSES).map((s) => [s, data.appointments.filter((a) => a.status === s).length]));
  const next = data.appointments.filter((a) => new Date(a.starts_at) >= new Date() && ["pending","confirmed"].includes(a.status)).sort((a,b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 5);
  const servicesFor = (appointment) => data.appointment_services.filter((s) => s.appointment_id === appointment.id).map((s) => s.service_name).join(", ") || "—";
  async function changeAppointment(a, nextStatus) {
    if (["cancelled","completed"].includes(nextStatus) && !window.confirm(`Deseja marcar este atendimento como ${STATUSES[nextStatus].toLowerCase()}?`)) return;
    await act("update_appointment", { id: a.id, status: nextStatus });
  }
  async function reschedule(a) {
    const value = window.prompt("Nova data e hora local (AAAA-MM-DD HH:MM):", `${a.local_date} ${dateTime(a.starts_at).slice(-5)}`);
    if (!value) return;
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) { setError("Use AAAA-MM-DD HH:MM."); return; }
    const start = new Date(value.replace(" ", "T") + ":00-03:00");
    if (Number.isNaN(start.getTime())) { setError("Data inválida."); return; }
    const end = new Date(start.getTime() + a.total_duration_minutes * 60000);
    await act("update_appointment", { id: a.id, status: a.status, barber_id: a.barber_id, starts_at: start.toISOString(), ends_at: end.toISOString() });
  }
  async function uploadPhoto(id, file) {
    if (!file || !["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) { setError("Use JPG, PNG ou WebP de até 2 MB."); return; }
    setBusy(true); setError("");
    try {
      const { path, token } = await api("photo_upload_url", { barber_id: id, type: file.type });
      const { error: uploadError } = await supabase.storage.from("barber-photos").uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      await api("save_photo_path", { barber_id: id, path }); await refresh(); setNotice("Foto salva.");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return <div className={`dash ${collapsed ? "dash-collapsed" : ""}`}>
    <aside className="dash-sidebar">
      <a className="dash-brand" href="/" aria-label="GEO'ROCHA — ver site"><img src={logo} alt=""/><span>GEO'ROCHA<small>BARBEARIA</small></span></a>
      <button className="dash-collapse" aria-expanded={!collapsed} aria-controls="admin-navigation" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expandir navegação" : "Recolher navegação"}>{collapsed ? "☰" : "←"}<span>{collapsed ? "" : "Recolher menu"}</span></button>
      <nav id="admin-navigation" className="dash-nav" aria-label="Seções do painel">{SECTIONS.map(([key,label,icon]) => <button key={key} title={label} aria-label={label} aria-current={tab === key ? "page" : undefined} className={tab === key ? "selected" : ""} onClick={() => { setTab(key); setError(""); setNotice(""); }}><span aria-hidden="true" className="dash-nav-icon">{icon}</span><span className="dash-nav-label">{label}</span></button>)}</nav>
      <div className="dash-sidebar-note">Cuidado em cada detalhe.<small>Gestão da barbearia</small></div>
    </aside>
    <div className="dash-workspace">
    <header className="dash-header"><div><span className="dash-kicker">Administração · GEO'ROCHA</span><h1>{SECTIONS.find(([key]) => key === tab)?.[1]}</h1><p>{new Date().toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "full" })}</p></div><div className="dash-header-actions"><div className="dash-user"><span className="dash-user-avatar" aria-hidden="true">{adminName[0].toUpperCase()}</span><span>{adminName}<small>Administrador</small></span></div><button onClick={async () => { const {error} = await supabase.auth.signOut(); if(error) setError(error.message); }}>Sair</button></div></header>
    <main id="admin-content" aria-busy={loading || busy}>
    {error && <div className="dash-alert" role="alert">{error} <button onClick={refresh}>Recarregar</button></div>}
    {notice && <div className="dash-notice" role="status">{notice}</div>}
    {loading ? <div className="dash-loading" role="status"><span className="dash-kicker">GEO'ROCHA</span><h2>Carregando seu painel…</h2><p>Aguarde enquanto consultamos os dados.</p></div> : <>
      {tab === "visao" && <><div className="dash-heading"><h2>O movimento da barbearia</h2><span>{new Date().toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "full" })}</span></div>
        <div className="dash-stats"><article><span>Hoje</span><strong>{data.appointments.filter((a) => a.local_date === today()).length}</strong></article>{Object.entries(STATUSES).slice(0,4).map(([key,label]) => <article key={key}><span>{label}s</span><strong>{counts[key]}</strong></article>)}</div>
        <h3>Próximos atendimentos</h3><AppointmentList items={next} data={data} servicesFor={servicesFor} change={changeAppointment} reschedule={reschedule} busy={busy} />
        <h3>Agendamentos de hoje</h3><AppointmentList items={data.appointments.filter((a) => a.local_date === today()).sort((a,b)=>a.starts_at.localeCompare(b.starts_at))} data={data} servicesFor={servicesFor} change={changeAppointment} reschedule={reschedule} busy={busy} /></>}
      {tab === "agenda" && <><div className="dash-heading"><h2>Agenda</h2><button onClick={() => setTab("barbeiros")}>Horários e bloqueios</button></div>
        <div className="dash-filters"><label>Visualização<select value={period} onChange={(e)=>setPeriod(e.target.value)}><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option></select></label><label>Data<input type="date" value={focus} onChange={(e)=>setFocus(e.target.value)} /></label><label>Barbeiro<select value={barber} onChange={(e)=>setBarber(e.target.value)}><option value="">Todos</option>{data.barbers.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Status<select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">Todos</option>{Object.entries(STATUSES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
        <AppointmentList items={appointments} data={data} servicesFor={servicesFor} change={changeAppointment} reschedule={reschedule} busy={busy} /></>}
      {tab === "barbeiros" && <><div className="dash-heading"><h2>Barbeiros</h2><button onClick={()=>setEditingBarber({ name:"", description:"", active:true })}>+ Novo barbeiro</button></div>
        {editingBarber && <Editor title={editingBarber.id ? "Editar barbeiro" : "Novo barbeiro"} initial={editingBarber} fields={["name","description"]} labels={["Nome","Descrição"]} onCancel={()=>setEditingBarber(null)} onSave={async (v)=>{ if (await act("save_barber",v)) setEditingBarber(null); }} busy={busy} />}
        {!data.barbers.length && <p className="dash-empty">Nenhum barbeiro cadastrado. Adicione o primeiro profissional.</p>}<div className="dash-grid">{data.barbers.map((b)=><article className="dash-panel" key={b.id}><div className="dash-barber-head">{data.photo_urls[b.id] ? <img src={data.photo_urls[b.id]} alt={b.name} /> : <div className="dash-avatar">{b.name[0]}</div>}<div><h3>{b.name}</h3><span>{b.active ? "Ativo" : "Inativo"}</span></div></div><p>{b.description || "Sem descrição"}</p>
          <label>Foto (JPG, PNG, WebP; até 2 MB)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e)=>uploadPhoto(b.id,e.target.files[0])} /></label>
          <div className="dash-actions"><button onClick={()=>setEditingBarber(b)}>Editar</button><button disabled={busy} onClick={()=>{if(window.confirm(`${b.active ? "Desativar" : "Ativar"} ${b.name}?`)) act("save_barber",{...b,active:!b.active});}}>{b.active ? "Desativar" : "Ativar"}</button></div>
          <h4>Serviços oferecidos</h4>{data.services.map((s)=><label className="dash-check" key={s.id}><input type="checkbox" disabled={busy} checked={data.barber_services.some((x)=>x.barber_id===b.id && x.service_id===s.id)} onChange={(e)=>act("set_barber_service",{barber_id:b.id,service_id:s.id,enabled:e.target.checked})} />{s.name}</label>)}
          <Hours data={data} barber={b} act={act} busy={busy} />
          </article>)}</div></>}
      {tab === "servicos" && <><div className="dash-heading"><h2>Serviços</h2><button onClick={()=>setEditingService({name:"", description:"",price:"", duration_minutes:30, active:true})}>+ Novo serviço</button></div>
        {editingService && <Editor title={editingService.id ? "Editar serviço" : "Novo serviço"} initial={editingService} fields={["name","description","price","duration_minutes"]} labels={["Nome","Descrição","Preço (R$)","Duração (minutos)"]} onCancel={()=>setEditingService(null)} onSave={async(v)=>{if(await act("save_service",v))setEditingService(null);}} busy={busy} />}
        {!data.services.length && <p className="dash-empty">Nenhum serviço cadastrado. Comece pelo seu catálogo.</p>}<div className="dash-grid">{data.services.map((s)=><article className="dash-panel" key={s.id}><ServicePhoto service={s} url={data.service_photo_urls?.[s.id]} api={api} refresh={refresh} busy={busy} setBusy={setBusy} setError={setError} setNotice={setNotice}/><span className="dash-kicker">{s.active?"ATIVO":"INATIVO"}</span><h3>{s.name}</h3><p>{s.description}</p><strong>{money(s.price)} · {formatMinutes(s.duration_minutes)}</strong><p>Barbeiros: {data.barber_services.filter((x)=>x.service_id===s.id).map((x)=>byId(data.barbers,x.barber_id)?.name).filter(Boolean).join(", ")||"Nenhum"}</p><div className="dash-actions"><button onClick={()=>setEditingService(s)}>Editar</button><button disabled={busy} onClick={()=>{if(window.confirm(`${s.active?"Desativar":"Ativar"} ${s.name}?`))act("save_service",{...s,active:!s.active});}}>{s.active?"Desativar":"Ativar"}</button></div></article>)}</div></>}
      {tab === "clientes" && <><div className="dash-heading"><h2>Clientes</h2><span>{data.clients.length} cadastrados</span></div><label className="dash-search">Pesquisar por nome ou telefone<input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Nome ou telefone" /></label>
        {!data.clients.some((c)=>`${c.full_name} ${c.phone_e164}`.toLowerCase().includes(search.toLowerCase())) && <p className="dash-empty">Nenhum cliente encontrado.</p>}<div className="dash-grid">{data.clients.filter((c)=>`${c.full_name} ${c.phone_e164}`.toLowerCase().includes(search.toLowerCase())).map((c)=><article className="dash-panel" key={c.id}><h3>{c.full_name}</h3><p>{c.phone_e164}</p><p>Último atendimento: {c.last_visit_at ? dateTime(c.last_visit_at) : "Nenhum registrado"}</p><p>Mensagens: {c.marketing_consent ? "Consentimento ativo" : "Sem consentimento"}</p><button onClick={()=>setSelectedClient(selectedClient===c.id?null:c.id)}>Histórico</button>{selectedClient===c.id && <ul>{data.appointments.filter((a)=>a.client_id===c.id).sort((a,b)=>b.starts_at.localeCompare(a.starts_at)).map((a)=><li key={a.id}>{dateTime(a.starts_at)} · {STATUSES[a.status]} · {servicesFor(a)} · {money(a.total_price)}</li>)}</ul>}</article>)}</div></>}
      {tab === "config" && <><h2>Configurações</h2><p>Os controles abaixo armazenam preferências. O envio de mensagens ainda não está ativo.</p><Settings settings={data.notification_settings[0]} act={act} busy={busy}/><h3>Funcionamento e folgas</h3><p>Defina o expediente individual e os bloqueios na seção Barbeiros.</p><button onClick={()=>setTab("barbeiros")}>Abrir barbeiros</button></>}
    </>}
    </main></div>
  </div>;
}

function AppointmentList({items,data,servicesFor,change,reschedule,busy}) {
  return items.length ? <div className="dash-appointments">{items.map((a)=>{const client=data.clients.find((x)=>x.id===a.client_id), barber=data.barbers.find((x)=>x.id===a.barber_id);return <article className="dash-appointment" key={a.id}><div><span className={`dash-status status-${a.status}`}>{STATUSES[a.status]}</span><span className="dash-appointment-barber">{barber?.name||"Barbeiro"}</span><h3>{client?.full_name||"Cliente"}</h3><p>{client?.phone_e164||""} · {servicesFor(a)}</p><strong>{dateTime(a.starts_at)} → {dateTime(a.ends_at)} · {money(a.total_price)}</strong></div><div className="dash-actions">{a.status==="pending"&&<button disabled={busy} onClick={()=>change(a,"confirmed")}>Confirmar</button>}{["pending","confirmed"].includes(a.status)&&<><button disabled={busy} onClick={()=>reschedule(a)}>Remarcar</button><button disabled={busy} onClick={()=>change(a,"completed")}>Concluir</button><button disabled={busy} onClick={()=>change(a,"cancelled")}>Cancelar</button></>}</div></article>})}</div> : <p className="dash-empty">Nenhum agendamento neste período.</p>;
}
function Editor({title,initial,fields,labels,onSave,onCancel,busy}) {
  const [value,setValue]=useState(initial);
  useEffect(()=>setValue(initial),[initial]);
  return <form className="dash-panel dash-editor" onSubmit={(e)=>{e.preventDefault();onSave(value);}}><h3>{title}</h3>{fields.map((f,i)=><label key={f}>{labels[i]}<input required={f==="name"||f==="price"||f==="duration_minutes"} type={["price","duration_minutes"].includes(f)?"number":"text"} min={f==="duration_minutes"?5:0} step={f==="price"?"0.01":undefined} value={value[f]??""} onChange={(e)=>setValue({...value,[f]:e.target.value})}/></label>)}<label className="dash-check"><input type="checkbox" checked={!!value.active} onChange={(e)=>setValue({...value,active:e.target.checked})}/>Ativo</label><div className="dash-actions"><button disabled={busy}>Salvar</button><button type="button" onClick={onCancel}>Voltar</button></div></form>;
}
function Hours({data,barber,act,busy}) {
  const [weekday,setWeekday]=useState(1), [open,setOpen]=useState("08:00"),[close,setClose]=useState("18:00"),[breakStart,setBreakStart]=useState("12:00"),[breakEnd,setBreakEnd]=useState("13:00"),[closed,setClosed]=useState(false);
  const [kind,setKind]=useState("time_off"),[start,setStart]=useState(""),[end,setEnd]=useState(""),[reason,setReason]=useState("");
  useEffect(()=>{const h=data.barber_hours.find((x)=>x.barber_id===barber.id && x.weekday===weekday), br=data.barber_breaks.find((x)=>x.barber_hour_id===h?.id);setClosed(!h);if(h){setOpen(h.opens_at.slice(0,5));setClose(h.closes_at.slice(0,5));}setBreakStart(br?.starts_at.slice(0,5)||"");setBreakEnd(br?.ends_at.slice(0,5)||"");},[weekday,data,barber.id]);
  return <div className="dash-hours"><h4>Horário individual</h4><form onSubmit={(e)=>{e.preventDefault();act("save_hours",{barber_id:barber.id,weekday,closed,opens_at:open,closes_at:close,break_start:breakStart,break_end:breakEnd});}}><label>Dia<select value={weekday} onChange={(e)=>setWeekday(Number(e.target.value))}>{DAYS.map((d,i)=><option key={d} value={i}>{d}</option>)}</select></label><label className="dash-check"><input type="checkbox" checked={closed} onChange={(e)=>setClosed(e.target.checked)}/>Folga</label>{!closed&&<div className="dash-time-grid">{[["Abre",open,setOpen],["Fecha",close,setClose],["Início almoço",breakStart,setBreakStart],["Fim almoço",breakEnd,setBreakEnd]].map(([label,v,set])=><label key={label}>{label}<input type="time" value={v} onChange={(e)=>set(e.target.value)}/></label>)}</div>}<button disabled={busy}>Salvar horário</button></form>
    <h4>Férias e bloqueios</h4><form onSubmit={(e)=>{e.preventDefault();act("save_block",{barber_id:barber.id,kind,starts_at:new Date(`${start}:00-03:00`).toISOString(),ends_at:new Date(`${end}:00-03:00`).toISOString(),reason}).then((result)=>{if(result){setStart("");setEnd("");}});}}><label>Tipo<select value={kind} onChange={(e)=>setKind(e.target.value)}><option value="time_off">Folga / férias</option><option value="block">Bloqueio</option><option value="exception">Exceção</option></select></label><label>Início<input type="datetime-local" value={start} onChange={(e)=>setStart(e.target.value)} required/></label><label>Fim<input type="datetime-local" value={end} onChange={(e)=>setEnd(e.target.value)} required/></label><label>Motivo<input value={reason} onChange={(e)=>setReason(e.target.value)}/></label><button disabled={busy}>Adicionar bloqueio</button></form><ul>{data.schedule_blocks.filter((x)=>x.barber_id===barber.id).map((x)=><li key={x.id}>{dateTime(x.starts_at)} → {dateTime(x.ends_at)} · {x.reason||x.kind} <button disabled={busy} onClick={()=>{if(window.confirm("Remover este bloqueio?"))act("delete_block",{id:x.id});}}>Remover</button></li>)}</ul>
  </div>;
}
