// ============================================================
// CONFIGURAÇÃO DOS BARBEIROS
// ============================================================
// Troque os números de WhatsApp abaixo pelos números reais.
// Formato: código do país + DDD + número, SOMENTE DÍGITOS.
// Exemplo (Brasil, Teresina-PI): "5586999998888"
//   55   -> código do Brasil
//   86   -> DDD de Teresina-PI
//   999998888 -> número do barbeiro
// ============================================================

export const BARBEIROS = {
  geovane: {
    id: "geovane",
    nome: "Geovane",
    cargo: "Barbeiro",
    whatsapp: "5586995117272", // Brasil (55) + DDD (86) + número
    foto: null, // coloque o caminho da foto em src/assets/images/ e importe no componente Barbeiros.jsx
  },
  daniel: {
    id: "daniel",
    nome: "Daniel",
    cargo: "Barbeiro",
    whatsapp: "5586994365702", // Brasil (55) + DDD (86) + número
    foto: null, // coloque o caminho da foto em src/assets/images/ e importe no componente Barbeiros.jsx
  },
};

// WhatsApp geral da barbearia (usado no botão flutuante e na seção de contato)
export const WHATSAPP_BARBEARIA = "5586995117272"; // Brasil (55) + DDD (86) + número

// ============================================================
// HORÁRIO DE FUNCIONAMENTO
// ============================================================
// 0 = Domingo, 1 = Segunda, 2 = Terça ... 6 = Sábado
export const HORARIOS = [
  { dia: "Domingo", diaSemana: 0, turnos: [], fechado: true },
  { dia: "Segunda-feira", diaSemana: 1, turnos: [["09:00", "12:00"], ["14:00", "20:00"]] },
  { dia: "Terça-feira", diaSemana: 2, turnos: [["09:00", "12:00"], ["14:00", "20:00"]] },
  { dia: "Quarta-feira", diaSemana: 3, turnos: [["09:00", "12:00"], ["14:00", "20:00"]] },
  { dia: "Quinta-feira", diaSemana: 4, turnos: [["09:00", "12:00"], ["14:00", "20:00"]] },
  { dia: "Sexta-feira", diaSemana: 5, turnos: [["09:00", "12:00"], ["14:00", "20:00"]] },
  { dia: "Sábado", diaSemana: 6, turnos: [["09:00", "12:00"], ["14:00", "20:00"]] },
];

// Horários de agendamento disponíveis (intervalos de 30 min dentro do expediente)
export const HORARIOS_MANHA = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00",
];
export const HORARIOS_TARDE = [
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
  "17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00",
];

// ============================================================
// CONTATO E LOCALIZAÇÃO
// ============================================================
export const CONTATO = {
  endereco: "R. Rui Barbosa, 4499 — São Joaquim, Teresina - PI", // INSIRA AQUI O ENDEREÇO, se precisar corrigir
  instagram: "@georochabarbearia", // INSIRA AQUI O INSTAGRAM, se precisar corrigir
  instagramUrl: "https://www.instagram.com/georochabarbearia?stkn=MTgyb3lpODk3Ymt0aw==",
  googleMapsUrl: "https://maps.app.goo.gl/1a3R6uX6D5amg1Wp9", // ex: link gerado em maps.google.com > Compartilhar
};
