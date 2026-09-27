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
    whatsapp: "COLOCAR_NUMERO_DO_GEOVANE_AQUI", // ex: "5586999998888"
    foto: null, // coloque o caminho da foto em src/assets/images/ e importe no componente Barbeiros.jsx
  },
  daniel: {
    id: "daniel",
    nome: "Daniel",
    cargo: "Barbeiro",
    whatsapp: "COLOCAR_NUMERO_DO_DANIEL_AQUI", // ex: "5586999997777"
    foto: null, // coloque o caminho da foto em src/assets/images/ e importe no componente Barbeiros.jsx
  },
};

// WhatsApp geral da barbearia (usado no botão flutuante e na seção de contato)
export const WHATSAPP_BARBEARIA = "COLOCAR_NUMERO_DO_WHATSAPP_DA_BARBEARIA_AQUI";

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
  instagramUrl: "https://instagram.com/georochabarbearia",
  googleMapsUrl: "COLOCAR_LINK_DO_GOOGLE_MAPS_AQUI", // ex: link gerado em maps.google.com > Compartilhar
};
