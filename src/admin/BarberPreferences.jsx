export default function BarberPreferences({ value, setValue }) {
  return <fieldset className="dash-preferences"><legend>Agendamento individual</legend>
    <label>Intervalo da grade de horários<select value={value.slot_interval_minutes ?? 30} onChange={(e)=>setValue({...value,slot_interval_minutes:Number(e.target.value)})}>{[5,10,15,20,30,45,60].map(n=><option key={n} value={n}>{n} minutos</option>)}</select></label>
    <p>A grade define somente os horários de início. A duração é a soma dos serviços. Alterar a grade não modifica nem cancela atendimentos já marcados.</p>
    <label>Intervalo de preparação após cada atendimento (minutos)<input type="number" min="0" max="120" required value={value.buffer_minutes ?? 0} onChange={(e)=>setValue({...value,buffer_minutes:e.target.value})}/></label>
    <label>Antecedência mínima para reservar (minutos)<input type="number" min="0" max="10080" required value={value.minimum_notice_minutes ?? 60} onChange={(e)=>setValue({...value,minimum_notice_minutes:e.target.value})}/></label>
    <label>Permitir reservas nos próximos (dias)<input type="number" min="1" max="365" required value={value.booking_horizon_days ?? 60} onChange={(e)=>setValue({...value,booking_horizon_days:e.target.value})}/></label>
    <label className="dash-check"><input type="checkbox" checked={!!value.booking_enabled} onChange={(e)=>setValue({...value,booking_enabled:e.target.checked})}/>Receber agendamentos online</label>
    <small>Ao habilitar, nome, descrição e fotos do barbeiro e dos serviços oferecidos serão publicados. É necessário configurar expediente e serviços ativos. O vínculo público é gerado automaticamente quando estiver vazio.</small>
  </fieldset>;
}
