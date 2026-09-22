import { BARBEIROS } from "../data/barbeiros.js";

export default function Barbeiros({ onAgendarComBarbeiro }) {
  const lista = Object.values(BARBEIROS);

  return (
    <section id="barbeiros" className="section">
      <div className="container">
        <div className="section-head center">
          <span className="eyebrow-rule" />
          <h2 className="section-title">Nossos Barbeiros</h2>
        </div>

        <div className="barbers-grid">
          {lista.map((b) => (
            <div className="barber-card" key={b.id}>
              <div className="barber-avatar">
                {b.foto ? (
                  <img src={b.foto} alt={`Foto de ${b.nome}`} />
                ) : (
                  <span aria-hidden="true">{b.nome.charAt(0)}</span>
                )}
              </div>
              <h3 className="barber-name">{b.nome}</h3>
              <p className="barber-role">{b.cargo}</p>
              <button className="btn btn-outline" onClick={() => onAgendarComBarbeiro(b.id)}>
                Agendar com {b.nome}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
