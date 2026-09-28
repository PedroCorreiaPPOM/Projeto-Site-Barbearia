export async function bookingApi(action, input, signal) {
  const response = await fetch("/.netlify/functions/booking", {method:action === "catalog" ? "GET" : "POST",headers:{"Content-Type":"application/json"},body:action === "catalog" ? undefined : JSON.stringify({action,input}),cache:"no-store",signal});
  const result = await response.json().catch(()=>({error:response.status===429 ? "Muitas consultas. Aguarde um minuto e tente novamente." : "Agendamento temporariamente indisponível."}));
  if(!response.ok) { const error=new Error(result.error || "Não foi possível consultar a agenda."); error.status=response.status; throw error; }
  return result.data;
}
export const localDate = (value=new Date())=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Fortaleza",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
export const localTime = (value)=>new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
export const money = (value)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(value);
export function normalizePhone(value) {
  const digits=value.replace(/\D/g,"");
  return digits.length === 10 || digits.length === 11 ? `+55${digits}` : `+${digits}`;
}
export function serviceTotals(services) {
  return {price:services.reduce((sum,s)=>sum+Math.round(Number(s.price)*100),0)/100,minutes:services.reduce((sum,s)=>sum+s.duration_minutes,0)};
}
