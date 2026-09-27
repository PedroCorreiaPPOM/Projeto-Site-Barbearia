import { BARBEIROS } from "../data/barbeiros.js";

// Only explicit public contact keys are exposed by the database projection.
export async function fetchPublicBarbers(client) {
  if (!client) throw new Error("Não foi possível consultar os barbeiros disponíveis.");
  const { data, error } = await client.rpc("public_booking_barbers");
  if (error || !Array.isArray(data)) throw new Error("Não foi possível consultar os barbeiros disponíveis. Tente novamente.");
  const keys = new Set(data.map((row) => row.booking_key));
  return Object.values(BARBEIROS).filter((barber) => keys.has(barber.id));
}
