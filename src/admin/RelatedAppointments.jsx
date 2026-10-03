import { useEffect, useState } from "react";

export default function RelatedAppointments({ target, api, revision, children, onClose }) {
  const [items, setItems] = useState(null), [error, setError] = useState("");
  useEffect(() => {
    let live = true; setItems(null); setError("");
    api("deletion_preview", {kind:target.kind, id:target.item.id})
      .then((result) => { if(live) setItems(result.appointments); })
      .catch((e) => { if(live) setError(e.message); });
    return () => { live = false; };
  }, [target, revision]);
  return <section><div className="dash-heading"><h3>Atendimentos de {target.item.name}</h3><button onClick={onClose}>Voltar à agenda completa</button></div><p>Revise cada atendimento antes de cancelar. Depois de resolver os vínculos, volte ao cadastro para solicitar a exclusão.</p>{error ? <p role="alert" className="dash-alert">{error}</p> : items ? children(items) : <p role="status">Consultando todos os atendimentos relacionados…</p>}</section>;
}
