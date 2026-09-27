import { useEffect, useRef, useState } from "react";
import ambiente from "../assets/images/ambiente.jpg";

export default function About() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const obs = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { threshold: 0.15 }
    );
    if (el) obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="sobre" className="section" ref={ref}>
      <div className="container">
        <div className={`about-grid reveal ${visible ? "in" : ""}`}>
          <div className="about-text">
            <div className="section-head">
              <span className="eyebrow-rule" />
              <h2 className="section-title">Sobre a GEO'ROCHA</h2>
            </div>
            <p>
              Um espaço pensado para quem valoriza estilo, cuidado e uma experiência
              diferenciada. Na GEO'ROCHA BARBEARIA, cada atendimento é feito com atenção
              aos detalhes para entregar um resultado que combina com você.
            </p>
            <p style={{ fontSize: "0.85rem", color: "var(--muted-dim)", marginTop: 24 }}>
              (Texto institucional editável — atualize em src/components/About.jsx)
            </p>
          </div>
          <div className="about-media">
            <img src={ambiente} alt="Ambiente interno da GEO'ROCHA Barbearia" loading="lazy" />
          </div>
        </div>
      </div>
    </section>
  );
}
