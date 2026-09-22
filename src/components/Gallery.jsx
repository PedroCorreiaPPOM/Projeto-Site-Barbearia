import { useEffect, useRef, useState } from "react";
import corte1 from "../assets/images/corte-1.jpg";
import corte2 from "../assets/images/corte-2.jpg";
import corte3 from "../assets/images/corte-3.jpg";
import corte4 from "../assets/images/corte-4.jpg";
import corte5 from "../assets/images/corte-5.jpg";

const FOTOS = [
  { src: corte1, alt: "Corte masculino finalizado na GEO'ROCHA", tall: true },
  { src: corte2, alt: "Corte infantil na GEO'ROCHA" },
  { src: corte4, alt: "Detalhe de corte na GEO'ROCHA" },
  { src: corte3, alt: "Atendimento infantil na GEO'ROCHA", tall: true },
  { src: corte5, alt: "Ferramentas e acabamento na GEO'ROCHA" },
];

export default function Gallery() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const el = ref.current;
    const obs = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { threshold: 0.1 }
    );
    if (el) obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <section id="cortes" className="section" ref={ref}>
      <div className="container">
        <div className="section-head center">
          <span className="eyebrow-rule" />
          <h2 className="section-title">Nossos Cortes</h2>
          <p className="section-sub">Confira alguns dos nossos trabalhos.</p>
        </div>

        <div className={`gallery-grid reveal ${visible ? "in" : ""}`}>
          {FOTOS.map((foto, i) => (
            <button
              key={i}
              className={`gallery-item ${foto.tall ? "tall" : ""}`}
              onClick={() => setOpen(i)}
              aria-label={`Ampliar imagem: ${foto.alt}`}
            >
              <img src={foto.src} alt={foto.alt} loading="lazy" />
              <span className="gallery-overlay">
                <span>Ver imagem</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {open !== null && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <button className="lightbox-close" aria-label="Fechar" onClick={() => setOpen(null)}>
            ✕
          </button>
          <img src={FOTOS[open].src} alt={FOTOS[open].alt} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </section>
  );
}
