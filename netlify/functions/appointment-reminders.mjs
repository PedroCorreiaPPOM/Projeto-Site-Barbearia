import {createClient} from '@supabase/supabase-js';
import {processReminders} from '../lib/reminder-worker.mjs';

export default async function scheduledReminders() {
  const env=process.env;
  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY){console.info('REMINDERS_BACKEND_NOT_CONFIGURED');return;}
  const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  try {const result=await processReminders(db,env);console.info('REMINDERS_WORKER',result.state,result.processed);}
  catch {console.error('REMINDERS_WORKER_FAILED');}
}
export const config={schedule:'* * * * *'};
