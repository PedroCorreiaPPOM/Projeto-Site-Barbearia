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
          {catalog.error && <div role="alert"><p>Não foi possível consultar os profissionais. {catalog.error}</p><button type="button" className="btn btn-outline" onClick={catalog.retry}>Tentar novamente</button></div>}
          {!catalog.loading && !catalog.error && !lista.length && <p>Nenhum barbeiro disponível para novos agendamentos.</p>}
          {lista.map((b) => (
            <div className="barber-card" key={b.id}>
              <div className="barber-avatar">
                {b.photo_url ? (
                  <img src={b.photo_url} alt={`Foto de ${b.name}`} />
                ) : (
                  <span aria-hidden="true">{b.name.charAt(0)}</span>
                )}
              </div>
              <h3 className="barber-name">{b.name}</h3>
              <p className="barber-role">Barbeiro</p>
              {b.description && <p>{b.description}</p>}
              <button className="btn btn-outline" onClick={() => onAgendarComBarbeiro(b.id)}>
                Agendar com {b.name}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
