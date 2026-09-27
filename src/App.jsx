import { useCallback, useState } from "react";
import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import About from "./components/About.jsx";
import Gallery from "./components/Gallery.jsx";
import Barbeiros from "./components/Barbeiros.jsx";
import Horarios from "./components/Horarios.jsx";
import Agendamento from "./components/Agendamento.jsx";
import Contato from "./components/Contato.jsx";
import Footer from "./components/Footer.jsx";
import WhatsappFloat from "./components/WhatsappFloat.jsx";
import usePublicBarbers from "./lib/usePublicBarbers.js";

export default function App() {
  const publicCatalog = usePublicBarbers();
  // Barbeiro pré-selecionado quando o cliente clica em "Agendar com Geovane/Daniel"
  const [barbeiroPreSelecionado, setBarbeiroPreSelecionado] = useState(null);

  const irParaAgendamento = useCallback((barbeiroId) => {
    if (barbeiroId) setBarbeiroPreSelecionado(barbeiroId);
    const el = document.getElementById("agendamento");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <>
      <Header onAgendar={() => irParaAgendamento(null)} />
      <main>
        <Hero onAgendar={() => irParaAgendamento(null)} />
        <About />
        <Gallery />
        <Barbeiros onAgendarComBarbeiro={irParaAgendamento} catalog={publicCatalog} />
        <Horarios />
        <Agendamento barbeiroPreSelecionado={barbeiroPreSelecionado} catalog={publicCatalog} />
        <Contato />
      </main>
      <Footer />
      <WhatsappFloat />
    </>
  );
}
