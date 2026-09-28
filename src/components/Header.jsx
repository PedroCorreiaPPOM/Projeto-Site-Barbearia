import { useEffect, useState } from "react";
import logo from "../assets/images/logo.png";

const LINKS = [
  { href: "#inicio", label: "Início" },
  { href: "#sobre", label: "Sobre" },
  { href: "#cortes", label: "Cortes" },
  { href: "#barbeiros", label: "Barbeiros" },
  { href: "#agendamento", label: "Agendamento" },
];

export default function Header({ onAgendar }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
  }, [menuOpen]);

  return (
    <header className={`header ${scrolled ? "scrolled" : ""}`}>
      <div className="container">
        <a href="#inicio" className="brand" aria-label="GEO'ROCHA Barbearia — início">
          <img src={logo} alt="Logo GEO'ROCHA Barbearia" />
          <span className="brand-name">
            GEO'ROCHA
            <span>BARBEARIA</span>
          </span>
        </a>

        <nav className="nav-desktop" aria-label="Navegação principal">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="header-actions">
          <button className="btn btn-solid" onClick={onAgendar}>
            Agendar Agora
          </button>
          <button
            className="burger"
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            ☰
          </button>
        </div>
      </div>

      <div className={`mobile-menu ${menuOpen ? "open" : ""}`}>
        <button className="mobile-close" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}>
          Fechar ✕
        </button>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>
            {l.label}
          </a>
        ))}
        <button
          className="btn btn-solid"
          onClick={() => {
            setMenuOpen(false);
            onAgendar();
          }}
        >
          Agendar Agora
        </button>
      </div>
    </header>
  );
}
