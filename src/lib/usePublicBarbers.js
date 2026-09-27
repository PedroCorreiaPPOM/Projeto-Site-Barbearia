import { useEffect, useState } from "react";
import { supabase } from "./supabase.js";
import { fetchPublicBarbers } from "./publicCatalog.js";

export default function usePublicBarbers() {
  const [state, setState] = useState({barbers:[], loading:true, error:""});
  useEffect(() => {
    let live = true, sequence = 0;
    async function refresh() {
      const request = ++sequence;
      try {
        const barbers = await fetchPublicBarbers(supabase);
        if (live && request === sequence) setState({barbers, loading:false, error:""});
      } catch (e) {
        if (live && request === sequence) setState({barbers:[], loading:false, error:e.message});
      }
    }
    refresh();
    const interval = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { live = false; clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, []);
  return state;
}
