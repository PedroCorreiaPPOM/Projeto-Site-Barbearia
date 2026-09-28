import logo from "../assets/images/logo.png";
import { CONTATO, WHATSAPP_BARBEARIA } from "../data/barbeiros.js";

const LINKS = [
  { href: "#inicio", label: "Início" },
  { href: "#sobre", label: "Sobre" },
  { href: "#cortes", label: "Cortes" },
  { href: "#barbeiros", label: "Barbeiros" },
  { href: "#agendamento", label: "Agendamento" },
];

export default function Footer() {
  const numero = (WHATSAPP_BARBEARIA || "").replace(/\D/g, "");

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="footer-brand">
              <img src={logo} alt="" />
              <span>GEO'ROCHA BARBEARIA</span>
            </div>
            <p>Estilo, cuidado e tradição em cada atendimento.</p>
          </div>

          <div>
            <h4>Links rápidos</h4>
            <ul>
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href}>{l.label}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4>Contato</h4>
            <ul>
              <li>{numero ? numero : "WhatsApp: configure em src/data/barbeiros.js"}</li>
              <li>
                <a href={CONTATO.instagramUrl} target="_blank" rel="noopener noreferrer">
                  {CONTATO.instagram}
                </a>
              </li>
              <li>{CONTATO.endereco}</li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">© 2026 GEO'ROCHA BARBEARIA. Todos os direitos reservados.</div>
      </div>
    </footer>
  );
}
