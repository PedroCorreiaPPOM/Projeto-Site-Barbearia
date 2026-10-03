export const MESSAGE_VARIABLES=['cliente','barbeiro','data','horario','servicos','duracao'];
export const CLIENT_MESSAGE="Olá, {cliente}! 👋 Seu horário na GEO'ROCHA está chegando.\nSeu atendimento com {barbeiro} está marcado para {data}, às {horario}.\nServiços: {servicos}. Te esperamos! 💈";
export const BARBER_MESSAGE='Olá, {barbeiro}! Você tem um atendimento às {horario}.\nCliente: {cliente}.\nServiços: {servicos}.\nDuração prevista: {duracao} minutos.';
export const MESSAGE_EXAMPLE={cliente:'Pedro (exemplo)',barbeiro:'Geovane (exemplo)',data:'30/09/2026',horario:'16:30',servicos:'Corte e barba',duracao:'60'};
export function validateMessage(text){
  if(typeof text!=='string'||!text.trim()||[...text].length>1500)throw new Error('Informe uma mensagem de 1 a 1500 caracteres.');
  if(/[{}]/.test(text.replace(/\{(cliente|barbeiro|data|horario|servicos|duracao)\}/g,'')))throw new Error('Variável inválida. Use somente as variáveis apresentadas, entre chaves.');
  return text;
}
export function renderMessage(text,values){
  validateMessage(text);
  return text.replace(/\{([^{}]+)\}/g,(_,key)=>{if(values[key]===undefined||values[key]===null)throw new Error('Não foi possível resolver a variável '+key);return String(values[key]);});
}
