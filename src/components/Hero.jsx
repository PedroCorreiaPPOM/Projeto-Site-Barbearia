import logo from "../assets/images/logo.png";

export default function Hero({ onAgendar }) {
  return (
    <section id="inicio" className="hero">
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-vignette" aria-hidden="true" />

      <div className="hero-content">
        <img src={logo} alt="" className="hero-logo" />
        <h1 className="hero-title">GEO'ROCHA BARBEARIA</h1>
        <p className="hero-tagline">Seu estilo começa aqui.</p>
        <p className="hero-text">Experiência, estilo e cuidado em cada corte.</p>

        <div className="hero-actions">
          <button className="btn btn-solid" onClick={onAgendar}>
            Agendar Horário
          </button>
          <a href="#sobre" className="btn btn-outline">
            Conhecer a Barbearia
          </a>
        </div>
      </div>

      <a href="#sobre" className="scroll-cue" aria-label="Rolar para baixo">
        <span className="line" aria-hidden="true" />
        ROLAR
      </a>
    </section>
  );
}
