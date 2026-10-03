import { barberHistoryFor } from './barberHistory.js';

export default function BarberHistoryNote({appointment,data}) {
  const {deletion,message}=barberHistoryFor(appointment,data);
  if(!deletion)return null;
  return <div className="barber-history-note"><p>{message}</p><small>
    Identificação do administrador: <code>{deletion.deleted_by}</code> · Exclusão registrada em{' '}
    <time dateTime={deletion.deleted_at}>{new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',dateStyle:'short',timeStyle:'medium'}).format(new Date(deletion.deleted_at))}</time>
  </small></div>;
}
