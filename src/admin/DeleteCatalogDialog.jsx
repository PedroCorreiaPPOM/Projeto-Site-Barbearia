import { useEffect, useRef, useState } from "react";

export function TrashIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>;
}

export default function DeleteCatalogDialog({ target, api, onClose, onDeleted, onReview }) {
  const dialog = useRef(null), locked = useRef(false);
  const [preview, setPreview] = useState(null), [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const label = target.kind === "barber" ? "barbeiro" : "serviço";
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    let live = true;
    api("deletion_preview", {kind:target.kind, id:target.item.id})
      .then((result) => { if (live) setPreview(result); })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [target]);
  async function remove() {
    if (locked.current || checking || !preview || preview.count > 0) return;
    locked.current = true; setSaving(true); setError("");
    try {
      await api(target.kind === "barber" ? "delete_barber" : "delete_service", {id:target.item.id});
      await onDeleted();
    } catch (e) {
      setError(e.message);
      // Recheck if a booking was created after the dialog opened.
      try { setPreview(await api("deletion_preview", {kind:target.kind, id:target.item.id})); }
      catch { setPreview(null); }
    } finally { locked.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className="dash-delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-description" onCancel={(e) => { e.preventDefault(); if (!locked.current) onClose(); }}>
    <span className="dash-kicker">Gestão do catálogo</span><h2 id="delete-title">{target.kind === "barber" ? "Desativar" : "Excluir"} {label}?</h2>
    <div className="dash-delete-summary"><TrashIcon/><strong>{target.item.name}</strong>{target.kind === "service" && <span>{new Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL"}).format(target.item.price)}</span>}</div>
    <p id="delete-description">{target.kind === "barber" ? "Ele deixará de aparecer para novos agendamentos." : "O serviço deixará de aparecer nas opções de novos agendamentos e nos serviços ativos dos barbeiros."} A exclusão é lógica: o cadastro fica inativo e pode ser reativado.</p>
    <p>O histórico dos atendimentos, seus valores, durações e fotografias serão preservados. O cadastro inativo continua acessível no painel.</p>
    {checking && <p role="status">Verificando agendamentos relacionados…</p>}
    {preview?.count > 0 && <div className="dash-delete-warning" role="status"><strong>Exclusão bloqueada: {preview.count} atendimento(s).</strong><p>Existem agendamentos pendentes ou confirmados, futuros ou em andamento. Abra a lista para revisá-los e, quando apropriado, cancele com confirmação. Remarcar apenas a data mantém o vínculo e não libera a exclusão. Nenhum atendimento será alterado automaticamente.</p><button disabled={saving} onClick={() => onReview(target)}>Abrir agendamentos relacionados</button></div>}
    {error && <p className="dash-alert" role="alert">{error}</p>}
    <div className="dash-actions"><button autoFocus disabled={saving} onClick={onClose}>Voltar</button><button className="dash-delete-confirm" disabled={checking || saving || !preview || preview.count > 0} onClick={remove}><TrashIcon/>{saving ? "Excluindo…" : `Confirmar ${target.kind === "barber" ? "desativação" : "exclusão"} de ${label}`}</button></div>
  </dialog>;
}
