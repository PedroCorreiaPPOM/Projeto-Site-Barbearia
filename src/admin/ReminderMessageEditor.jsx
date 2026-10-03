import {useRef} from 'react';
import {MESSAGE_VARIABLES,MESSAGE_EXAMPLE,renderMessage} from '../lib/reminder-messages.js';

export default function ReminderMessageEditor({label,value,onChange,disabled}){
  const input=useRef(null),selection=useRef({start:0,end:0});
  let preview='',error='';try{preview=renderMessage(value,MESSAGE_EXAMPLE);}catch(e){error=e.message;}
  function insert(key){
    const element=input.current;
    const start=element?.selectionStart??selection.current.start,end=element?.selectionEnd??selection.current.end;
    const token=`{${key}}`;
    onChange(value.slice(0,start)+token+value.slice(end));selection.current={start:start+token.length,end:start+token.length};
    requestAnimationFrame(()=>{element?.focus();element?.setSelectionRange(start+token.length,start+token.length);});
  }
  return <section className="dash-panel"><h3>{label}</h3><label>Texto da mensagem<textarea ref={input} rows={7} maxLength={1500} value={value} disabled={disabled} onSelect={e=>{selection.current={start:e.target.selectionStart,end:e.target.selectionEnd};}} onChange={e=>onChange(e.target.value)}/></label>
    <p>Insira uma variável na posição do cursor:</p><div className="dash-actions">{MESSAGE_VARIABLES.map(key=><button type="button" key={key} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>insert(key)}>{`{${key}}`}</button>)}</div>
    {error?<p role="alert">{error}</p>:<><h4>Prévia · dados fictícios de exemplo</h4><p className="reminder-message-preview">{preview}</p></>}
  </section>;
}
