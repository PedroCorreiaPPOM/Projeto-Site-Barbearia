import { useEffect, useRef, useState } from 'react';

export default function PermanentDeleteBarberDialog({barber,api,onClose,onDeleted,onDeactivate}) {
  const dialog=useRef(null),locked=useRef(false);
  const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const previous=document.activeElement;dialog.current?.showModal();return()=>previous?.focus();},[]);
  async function submit(e) {
    e.preventDefault();if(locked.current || name!==barber.name)return;
    locked.current=true;setBusy(true);setError('');
    try {const result=await api('permanently_delete_barber',{id:barber.id,confirm_name:name});await onDeleted(result);}
    catch(e){setError(e.message);}finally{locked.current=false;setBusy(false);}
  }
  return <dialog ref={dialog} className="dash-delete-dialog" aria-labelledby="permanent-delete-title" onCancel={e=>{e.preventDefault();if(!locked.current)onClose();}}>
    <h2 id="permanent-delete-title">Excluir definitivamente?</h2>
    <p><strong>{barber.name}</strong> será removido do banco. Esta ação é <strong>irreversível</strong>.</p>
    <p>Agendamentos concluídos ou cancelados cujo horário já terminou serão preservados, com o nome do barbeiro e a identificação do administrador responsável pela exclusão. Atendimentos pendentes, confirmados, futuros, em andamento ou com outro status bloqueiam a exclusão até serem resolvidos.</p>
    <p>Serão removidos o cadastro, expediente, pausas, vínculos, exceções, bloqueios e fotos sem uso por outros barbeiros. Clientes, serviços e registros históricos serão preservados integralmente.</p>
    {error && <div className="dash-alert" role="alert">{error}</div>}
    <form onSubmit={submit}><label className="permanent-delete-name">Digite o nome exato para confirmar<input autoFocus autoComplete="off" value={name} onChange={e=>setName(e.target.value)} disabled={busy} required/></label>
      <div className="dash-actions"><button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
      {barber.active && <button type="button" disabled={busy} onClick={onDeactivate}>Desativar em vez de excluir</button>}
      <button className="dash-delete-confirm" type="submit" disabled={busy || name!==barber.name}>{busy?'Excluindo…':'Excluir definitivamente'}</button></div>
    </form>
  </dialog>;
}
