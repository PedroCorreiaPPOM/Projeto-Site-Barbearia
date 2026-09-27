import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import logo from "../assets/images/logo.png";

export default function ServicePhoto({ service, url, api, refresh, busy, setBusy, setError, setNotice }) {
  const [file, setFile] = useState(null), [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const objectUrl = URL.createObjectURL(file); setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  async function save(remove = false) {
    if (remove && !window.confirm(`Remover a fotografia de ${service.name}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      let path = null;
      if (!remove) {
        const upload = await api("service_photo_upload_url", { service_id: service.id, type: file.type, size: file.size });
        path = upload.path;
        const { error } = await supabase.storage.from("service-photos").uploadToSignedUrl(path, upload.token, file, { contentType: file.type });
        if (error) throw error;
      }
      await api("save_service_photo", { service_id: service.id, path });
      setFile(null); await refresh(); setNotice(remove ? "Foto removida do serviço." : "Foto do serviço salva.");
    } catch (error) { setError(error.message || "Não foi possível salvar a foto."); }
    finally { setBusy(false); }
  }
  return <div className="dash-service-photo">
    {preview || url ? <img className="dash-service-image" src={preview || url} alt={`Fotografia de ${service.name}${preview ? " — pré-visualização" : ""}`}/> : <div className="dash-photo-placeholder"><img src={logo} alt=""/><span>GEO'ROCHA<small>Serviço sem fotografia</small></span></div>}
    <label>{url ? "Trocar fotografia" : "Adicionar fotografia"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => {
      const selected = e.target.files?.[0]; e.target.value = "";
      if (!selected) return;
      if (!["image/jpeg","image/png","image/webp"].includes(selected.type) || selected.size <= 0 || selected.size > 2097152) { setError("Use JPG, PNG ou WebP de até 2 MB."); return; }
      setError(""); setFile(selected);
    }}/></label><small>JPEG, PNG ou WebP · até 2 MB · acesso privado</small>
    <div className="dash-actions">{file && <><button disabled={busy} onClick={() => save()}>Salvar foto</button><button disabled={busy} onClick={() => setFile(null)}>Descartar prévia</button></>}{service.photo_path && <button disabled={busy} onClick={() => save(true)}>Remover foto</button>}</div>
  </div>;
}
