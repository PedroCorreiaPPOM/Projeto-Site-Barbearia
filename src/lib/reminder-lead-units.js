export const LEAD_UNITS={minutes:1,hours:60,days:1440};
export const unitFromFactor=factor=>Object.keys(LEAD_UNITS).find(key=>LEAD_UNITS[key]===Number(factor));
export const validLeadMinutes=n=>Number.isInteger(n)&&n>=15&&n<=10080;
export function inferLeadUnit(minutes){return minutes%1440===0?'days':minutes%60===0?'hours':'minutes';}

// Parse a bounded decimal as a rational number, never with floating-point multiplication.
export function leadMinutes(value,unit){
  if(!Object.hasOwn(LEAD_UNITS,unit)||!['string','number'].includes(typeof value))return null;
  const raw=String(value).replace(',','.');
  if(!/^\d{1,5}(?:\.\d{0,4})?$/.test(raw))return null;
  const [whole,fraction='']=raw.split('.');
  const scale=10n**BigInt(fraction.length);
  const numerator=BigInt(whole+fraction)*BigInt(LEAD_UNITS[unit]);
  if(numerator%scale!==0n)return null;
  const minutes=Number(numerator/scale);
  return validLeadMinutes(minutes)?minutes:null;
}

// Display only. The rounded result must never replace the canonical minutes on unit changes.
export function leadDisplay(minutes,unit){
  if(!validLeadMinutes(minutes)||!Object.hasOwn(LEAD_UNITS,unit))return '';
  const factor=BigInt(LEAD_UNITS[unit]),scale=10000n;
  const scaled=(BigInt(minutes)*scale*2n+factor)/(factor*2n);
  const whole=scaled/scale,fraction=String(scaled%scale).padStart(4,'0').replace(/0+$/,'');
  return `${whole}${fraction?'.'+fraction:''}`;
}
export function leadSettings(settings){
  const result={...settings};
  for(const key of ['client','barber']){
    const minutes=settings[`${key}_minutes`];
    const unit=Object.hasOwn(LEAD_UNITS,settings[`${key}_unit`])?settings[`${key}_unit`]:inferLeadUnit(minutes);
    result[`${key}_unit`]=unit;result[`${key}_value`]=leadDisplay(minutes,unit);
  }
  return result;
}
