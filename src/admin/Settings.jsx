import { useEffect, useState } from "react";
import { formatMinutes, REMINDER_OPTIONS } from "./durations.js";

const defaults = { enabled: false, reminder_minutes: 1440, inactivity_days: 30 };
export default function Settings({ settings, act, busy }) {
  const [value, setValue] = useState(settings || defaults);
  const [custom, setCustom] = useState(false);
  useEffect(() => { setValue(settings || defaults); setCustom(false); }, [settings]);
  const days = [15, 30, 45, 60, 90];
  const customDays = custom || !days.includes(Number(value.inactivity_days));
  const reminders = [...new Set([...REMINDER_OPTIONS, Number(value.reminder_minutes)])].sort((a,b) => a-b);
  return <form className="dash-settings" onSubmit={(e) => { e.preventDefault(); act("save_settings", value); }}>
    <div className="dash-grid">
      <section className="dash-panel"><span className="dash-kicker">01 · Antes do atendimento</span><h3>Preferência anterior de lembrete</h3><p>Os lembretes automáticos agora são configurados na seção Lembretes. Esta preferência anterior permanece armazenada e não controla os envios.</p>
        <label>Enviar com antecedência de<select value={value.reminder_minutes} onChange={(e) => setValue({...value, reminder_minutes: Number(e.target.value)})}>{reminders.map((n) => <option key={n} value={n}>{formatMinutes(n)}</option>)}</select></label>
        <small>Limite atual: 15 minutos a 7 dias. Preferência anterior, sem efeito sobre a fila atual.</small>
      </section>
      <section className="dash-panel"><span className="dash-kicker">02 · Relacionamento</span><h3>Ausência e retorno</h3><p>Período desde o término do último atendimento marcado como concluído. Cancelamentos e faltas não contam como atendimento.</p>
        <label>Período de ausência<select value={customDays ? "custom" : value.inactivity_days} onChange={(e) => { setCustom(e.target.value === "custom"); if(e.target.value !== "custom") setValue({...value, inactivity_days: Number(e.target.value)}); }}>{days.map((n) => <option key={n} value={n}>{n} dias</option>)}<option value="custom">Personalizado</option></select></label>
        {customDays && <label>Quantidade de dias<input required type="number" min="1" max="365" step="1" value={value.inactivity_days} onChange={(e) => setValue({...value, inactivity_days:e.target.value})}/></label>}
        <small>De 1 a 365 dias. Clientes sem atendimento concluído não possuem uma data de referência. Campanhas futuras exigirão consentimento de marketing.</small>
      </section>
    </div>
    <div className="dash-panel"><span className="dash-kicker">Preparação · envio indisponível</span><label className="dash-check"><input type="checkbox" checked={!!value.enabled} onChange={(e) => setValue({...value, enabled:e.target.checked})}/>Guardar preferência anterior de notificações (não ativa a fila de lembretes)</label><p>Salvar estas preferências não envia mensagens nem inicia campanhas.</p><button disabled={busy}>{busy ? "Salvando…" : "Salvar configurações"}</button></div>
  </form>;
}
