export function barberHistoryFor(appointment,data) {
  const deletion=(data.barber_deletions || []).find(d=>d.barber_id===appointment.barber_id);
  const name=deletion?.barber_name || appointment.barber_name || data.barbers.find(b=>b.id===appointment.barber_id)?.name || 'Barbeiro';
  if(!deletion)return {name,deletion:null,message:''};
  const administrator=deletion.deleted_by_name?.trim() || `UUID ${deletion.deleted_by}`;
  return {name,deletion,message:`Este agendamento foi realizado pelo barbeiro ${name}, que foi excluído do sistema pelo administrador ${administrator}.`};
}

export function historicalBarberOptions(data) {
  return [...data.barbers.map(b=>({id:b.id,name:b.name})),...(data.barber_deletions || [])
    .filter(d=>!data.barbers.some(b=>b.id===d.barber_id))
    .map(d=>({id:d.barber_id,name:`${d.barber_name} (excluído)`}))];
}
