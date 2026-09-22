import { WHATSAPP_BARBEARIA } from "../data/barbeiros.js";

export default function WhatsappFloat() {
  const numero = (WHATSAPP_BARBEARIA || "").replace(/\D/g, "");
  const href = numero
    ? `https://wa.me/${numero}?text=${encodeURIComponent("Olá! Vim pelo site da GEO'ROCHA Barbearia.")}`
    : "#agendamento";

  return (
    <a
      className="wa-float"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar no WhatsApp"
      title="Falar no WhatsApp"
    >
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path
          d="M16 2C8.3 2 2 8.3 2 16c0 2.6.7 5.1 2 7.3L2 30l6.9-1.8c2.1 1.1 4.5 1.8 7.1 1.8 7.7 0 14-6.3 14-14S23.7 2 16 2z"
          fill="#0b0908"
        />
        <path
          d="M23.4 19.5c-.4-.2-2.2-1.1-2.5-1.2-.3-.1-.6-.2-.8.2-.2.3-.9 1.2-1.1 1.5-.2.2-.4.3-.8.1-.4-.2-1.6-.6-3-1.9-1.1-1-1.9-2.2-2.1-2.6-.2-.4 0-.6.2-.8.2-.2.4-.4.5-.6.2-.2.2-.4.3-.6.1-.2.1-.5 0-.7-.1-.2-.8-1.9-1.1-2.6-.3-.7-.6-.6-.8-.6h-.7c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.1.8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 2.2-.9 2.5-1.7.3-.8.3-1.5.2-1.7-.1-.2-.3-.3-.6-.4z"
          fill="#25D366"
        />
      </svg>
    </a>
  );
}
