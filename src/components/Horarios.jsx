import { HORARIOS } from "../data/barbeiros.js";

// Reordena para exibir Segunda...Sábado, Domingo por último (mais natural para leitura)
const ORDEM = [1, 2, 3, 4, 5, 6, 0];

export default function Horarios() {
  const ordenado = ORDEM.map((dia) => HORARIOS.find((h) => h.diaSemana === dia));

  return (
    <section id="horarios" className="section">
      <div className="container">
        <div className="section-head center">
          <span className="eyebrow-rule" />
          <h2 className="section-title">Horários de Funcionamento</h2>
        </div>

        <div className="hours-panel">
          {ordenado.map((h) => (
            <div className={`hours-row ${h.fechado ? "closed" : ""}`} key={h.diaSemana}>
              <span className="hours-day">{h.dia}</span>
              <span className="hours-time">
                {h.fechado ? "Fechado" : h.turnos.map((t) => `${t[0]} – ${t[1]}`).join(" · ")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
