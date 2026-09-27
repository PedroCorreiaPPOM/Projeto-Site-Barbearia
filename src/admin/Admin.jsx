import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import Dashboard from "./Dashboard.jsx";

async function check(session) {
  if (!session) return "login";
  try {
    const response = await fetch("/.netlify/functions/admin-status", {
      headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
    });
    if (response.status === 200) return "ready";
    const result = await response.json();
    return result.reason === "mfa_required" ? "mfa" : "denied";
  } catch { return "error"; }
}

export default function Admin() {
  const [mode, setMode] = useState("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) { setMode("unconfigured"); return; }
    supabase.auth.getSession().then(({ data }) => check(data.session).then(setMode));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") { setMode("new_password"); return; }
      // Schedule network work outside the auth callback to avoid lock contention.
      setTimeout(() => check(session).then(setMode), 0);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function run(operation) {
    setBusy(true); setMessage("");
    try { await operation(); } catch (error) { setMessage(error.message || "Não foi possível concluir."); }
    finally { setBusy(false); }
  }

  async function factors() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    return data.totp.find((item) => item.status === "verified");
  }

  if (mode === "ready") return <Dashboard />;

  return <main className="admin-shell"><div className="admin-card">
    <a href="/">← Voltar ao site</a>
    <h1>GEO'ROCHA · Administração</h1>
    {mode === "loading" && <p>Verificando acesso…</p>}
    {mode === "unconfigured" && <p>Configure o Supabase para ativar o acesso administrativo.</p>}
    {mode === "error" && <p>Não foi possível verificar o acesso. Tente recarregar a página.</p>}
    {mode === "denied" && <><p>Esta conta não está autorizada.</p><button onClick={() => supabase.auth.signOut()}>Sair</button></>}
    {mode === "login" && <>
      <form onSubmit={(event) => { event.preventDefault(); run(async () => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }); }}>
        <label>E-mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Senha<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button disabled={busy}>Entrar</button>
      </form>
      <button type="button" onClick={() => setMode("reset")}>Esqueci minha senha</button>
    </>}
    {mode === "reset" && <form onSubmit={(event) => { event.preventDefault(); run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin` });
      if (error) throw error;
      setMessage("Se o endereço estiver cadastrado, você receberá um link de recuperação.");
    }); }}><label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><button disabled={busy}>Enviar link</button></form>}
    {mode === "new_password" && <form onSubmit={(event) => { event.preventDefault(); run(async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword(""); setMessage("Senha atualizada. Confirme o segundo fator para acessar."); setMode("mfa");
    }); }}><label>Nova senha<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} required /></label><button disabled={busy}>Atualizar senha</button></form>}
    {mode === "mfa" && <>
      <p>Confirme o código do autenticador para continuar.</p>
      <button type="button" disabled={busy} onClick={() => run(async () => {
        const factor = await factors();
        if (factor) { setFactorId(factor.id); setMode("verify"); return; }
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "GEO'ROCHA" });
        if (error) throw error;
        setFactorId(data.id); setQr(data.totp.qr_code); setMode("enroll");
      })}>Continuar</button>
    </>}
    {(mode === "enroll" || mode === "verify") && <>
      {mode === "enroll" && <><p>Cadastre este QR no seu aplicativo autenticador.</p><img className="admin-qr" src={qr} alt="QR para configurar autenticação em duas etapas" /></>}
      <form onSubmit={(event) => { event.preventDefault(); run(async () => {
        const { data: challenge, error } = await supabase.auth.mfa.challenge({ factorId });
        if (error) throw error;
        const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
        if (verifyError) throw verifyError;
        const { data } = await supabase.auth.getSession();
        setMode(await check(data.session)); setCode("");
      }); }}><label>Código<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></label><button disabled={busy}>Verificar</button></form>
    </>}
    {message && <p role="status">{message}</p>}
  </div></main>;
}
