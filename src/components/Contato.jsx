import { CONTATO, WHATSAPP_BARBEARIA } from "../data/barbeiros.js";

export default function Contato() {
  const numero = (WHATSAPP_BARBEARIA || "").replace(/\D/g, "");
  const waHref = numero
    ? `https://wa.me/${numero}?text=${encodeURIComponent("Olá! Vim pelo site da GEO'ROCHA Barbearia e quero agendar um horário.")}`
    : "#agendamento";

  return (
    <section id="contato" className="section">
      <div className="container">
        <div className="section-head center">
          <span className="eyebrow-rule" />
          <h2 className="section-title">Venha nos Visitar</h2>
        </div>

        <div className="contact-grid">
          <div className="contact-card">
            <span className="icon" aria-hidden="true">📍</span>
            <h3>Endereço</h3>
            <p>{CONTATO.endereco}</p>
          </div>
          <div className="contact-card">
            <span className="icon" aria-hidden="true">📱</span>
            <h3>WhatsApp</h3>
            <p>{numero ? numero : "Configure em src/data/barbeiros.js"}</p>
          </div>
          <a
            className="contact-card contact-card-link"
            href={CONTATO.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir o Instagram da GEO'ROCHA Barbearia"
          >
            <span className="icon" aria-hidden="true">📷</span>
            <h3>Instagram</h3>
            <p>{CONTATO.instagram}</p>
          </a>
        </div>

        <div className="contact-actions">
          <a
            className="btn btn-outline"
            href={CONTATO.googleMapsUrl && CONTATO.googleMapsUrl.startsWith("http") ? CONTATO.googleMapsUrl : "#"}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir no Google Maps
          </a>
        </div>
      </div>
    </section>
  );
}
