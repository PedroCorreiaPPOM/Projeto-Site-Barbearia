import { useEffect, useMemo, useState } from "react";
import { BARBEIROS, HORARIOS, HORARIOS_MANHA, HORARIOS_TARDE } from "../data/barbeiros.js";

function hojeISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

// Retorna a configuração de horário (HORARIOS) do dia da semana de uma data "YYYY-MM-DD"
function horarioDoDia(dataISO) {
  if (!dataISO) return null;
  // new Date("YYYY-MM-DD") é interpretado em UTC; usamos os componentes diretamente
  // para evitar problemas de fuso horário ao calcular o dia da semana.
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia);
  const diaSemana = data.getDay();
  return HORARIOS.find((h) => h.diaSemana === diaSemana) || null;
}

function montarMensagem({ nome, dataISO, horario, barbeiro }) {
  const [ano, mes, dia] = dataISO.split("-");
  const dataBR = `${dia}/${mes}/${ano}`;
  return (
    `Olá, ${barbeiro.nome}! Gostaria de agendar um horário na GEO'ROCHA BARBEARIA.\n\n` +
    `Nome: ${nome}\n` +
    `Data: ${dataBR}\n` +
    `Horário: ${horario}\n` +
    `Barbeiro: ${barbeiro.nome}\n\n` +
    `Aguardo a confirmação do horário. ✂️`
  );
}

export default function Agendamento({ barbeiroPreSelecionado }) {
  const [nome, setNome] = useState("");
  const [dataISO, setDataISO] = useState("");
  const [horario, setHorario] = useState("");
  const [barbeiroId, setBarbeiroId] = useState(barbeiroPreSelecionado || "");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const min = useMemo(() => hojeISO(), []);

  useEffect(() => {
    if (barbeiroPreSelecionado) setBarbeiroId(barbeiroPreSelecionado);
  }, [barbeiroPreSelecionado]);

  const configDia = horarioDoDia(dataISO);
  const fechado = configDia?.fechado ?? false;

  // Sempre que a data mudar, limpamos o horário selecionado se ele deixou de ser válido
  useEffect(() => {
    setHorario("");
  }, [dataISO]);

  function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    setEnviando(false);

    if (!nome.trim() || !dataISO || !horario || !barbeiroId) {
      setErro("Por favor, preencha todos os campos.");
      return;
    }

    // Impedir datas passadas
    if (dataISO < min) {
      setErro("Escolha uma data a partir de hoje.");
      return;
    }

    // Impedir domingo / horário fora do expediente
    const config = horarioDoDia(dataISO);
    if (!config || config.fechado) {
      setErro("Não atendemos aos domingos. Por favor, escolha outro dia.");
      return;
    }
    const horariosValidos = [...HORARIOS_MANHA, ...HORARIOS_TARDE];
    if (!horariosValidos.includes(horario)) {
      setErro("Selecione um horário disponível dentro do nosso expediente.");
      return;
    }

    const barbeiro = BARBEIROS[barbeiroId];
    if (!barbeiro) {
      setErro("Selecione um barbeiro.");
      return;
    }

    const mensagem = montarMensagem({ nome: nome.trim(), dataISO, horario, barbeiro });
    const numero = (barbeiro.whatsapp || "").replace(/\D/g, "");

    if (!numero) {
      setErro(
        `O número de WhatsApp de ${barbeiro.nome} ainda não foi configurado. Avise o administrador do site (src/data/barbeiros.js).`
      );
      return;
    }

    const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
    const whatsapp = window.open("", "_blank");

    if (!whatsapp) {
      setErro("Não foi possível abrir o WhatsApp. Verifique se o navegador bloqueou a nova aba.");
      return;
    }

    whatsapp.opener = null;
    setEnviando(true);
    window.setTimeout(() => {
      whatsapp.location.href = url;
    }, 250);
  }

  return (
    <section id="agendamento" className="section">
      <div className="container">
        <div className="section-head center">
          <span className="eyebrow-rule" />
          <h2 className="section-title">Agende seu Horário</h2>
          <p className="section-sub">
            Escolha o dia, horário e barbeiro. Seu agendamento será enviado diretamente pelo
            WhatsApp.
          </p>
        </div>

        <form className="booking-panel" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="nome">Nome</label>
            <input
              id="nome"
              type="text"
              placeholder="Digite seu nome"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setErro("");
              }}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="data">Data</label>
            <input
              id="data"
              type="date"
              min={min}
              value={dataISO}
              onChange={(e) => {
                setDataISO(e.target.value);
                setErro("");
              }}
              required
            />
            {fechado && (
              <p style={{ color: "#e0a89f", fontSize: "0.85rem", marginTop: 8 }}>
                Não atendemos aos domingos — escolha outra data.
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="horario">Horário</label>
            <select
              id="horario"
              value={horario}
              onChange={(e) => {
                setHorario(e.target.value);
                setErro("");
              }}
              required
              disabled={!dataISO || fechado}
            >
              <option value="" disabled>
                {dataISO ? "Selecione um horário" : "Escolha a data primeiro"}
              </option>
              {!fechado && (
                <>
                  <optgroup label="Manhã">
                    {HORARIOS_MANHA.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Tarde">
                    {HORARIOS_TARDE.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </optgroup>
                </>
              )}
            </select>
          </div>

          <div className="field">
            <label>Barbeiro</label>
            <div className="barber-select">
              {Object.values(BARBEIROS).map((b) => (
                <button
                  type="button"
                  key={b.id}
                  className={`barber-pill ${barbeiroId === b.id ? "active" : ""}`}
                  onClick={() => {
                    setBarbeiroId(b.id);
                    setErro("");
                  }}
                  aria-pressed={barbeiroId === b.id}
                >
                  <strong>{b.nome}</strong>
                  Barbeiro
                </button>
              ))}
            </div>
          </div>

          <p className="booking-note">
            O horário será confirmado pelo barbeiro através do WhatsApp.
          </p>

          {erro && (
            <p className="form-msg" role="alert">
              {erro}
            </p>
          )}

          {enviando && (
            <p className="form-msg form-msg-success" role="status" aria-live="polite">
              Abrindo o WhatsApp para confirmar seu horário...
            </p>
          )}

          <button type="submit" className="btn btn-solid btn-block">
            Confirmar Agendamento
          </button>
        </form>
      </div>
    </section>
  );
}
