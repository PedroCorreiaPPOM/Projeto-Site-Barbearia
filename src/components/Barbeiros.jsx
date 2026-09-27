export default function Barbeiros({ onAgendarComBarbeiro, catalog }) {
  const lista = catalog.barbers;

  return (
    <section id="barbeiros" className="section">
      <div className="container">
        <div className="section-head center">
          <span className="eyebrow-rule" />
          <h2 className="section-title">Nossos Barbeiros</h2>
        </div>

        <div className="barbers-grid">
          {catalog.loading && <p role="status">Consultando barbeiros disponíveis…</p>}
          {catalog.error && <p role="alert">{catalog.error}</p>}
          {!catalog.loading && !catalog.error && !lista.length && <p>Nenhum barbeiro disponível para novos agendamentos.</p>}
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
