import { localDate } from '../lib/booking.js';

export function barberPublication(barber, data, today = localDate()) {
  const reasons = [];
  if (!barber.active) reasons.push('Cadastro inativo.');
  if (!barber.booking_enabled) reasons.push('Receber agendamentos online está desabilitado.');
  if (!barber.public_booking_key) reasons.push('Vínculo público ainda não gerado: habilite o online e salve.');
  const hasHours = data.barber_hours.some(h => h.barber_id === barber.id)
    || (data.barber_date_overrides || []).some(d => d.barber_id === barber.id && d.local_date >= today && d.periods.length > 0);
  if (!hasHours) reasons.push('Sem expediente: configure e salve períodos semanais ou uma data futura. Sem isso, o barbeiro não aparece na página pública.');
  const listed = reasons.length === 0;
  const hasServices = data.barber_services.some(link => link.barber_id === barber.id && data.services.some(s => s.id === link.service_id && s.active));
  if (!hasServices) reasons.push('Nenhum serviço ativo vinculado. Selecione os serviços oferecidos abaixo para permitir reservas.');
  return { listed, ready: listed && hasServices, reasons };
}
