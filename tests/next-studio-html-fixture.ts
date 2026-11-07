import type { HTMLApplication } from '../lib/studio/html-generation';

// Authored test app: arbitrary fields, real calculations, CRUD and native storage.
export const htmlApplication: HTMLApplication = {
  format: 'html', title: 'Presupuesto de viajes', description: 'Calcula el presupuesto por destino y número de noches.',
  features: ['Cálculo de presupuesto', 'Guardar y eliminar viajes', 'Exportar JSON'], limitations: ['Sin reserva externa'],
  theme: { accent: '#60A5FA', dark: false },
  html: `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Presupuesto</title><style>body{font:16px system-ui;padding:20px}label{display:block;margin:10px 0}</style></head><body>
<h1>Presupuesto de viajes</h1><form id="trip"><label>Destino<input id="destination" required></label><label>Noches<input id="nights" type="number" min="1" step="1" required></label><label>Coste por noche<input id="rate" type="number" min="0" step="0.01" required></label><button>Guardar viaje</button></form><p id="notice" role="status"></p><ul id="trips"></ul><output id="total">0</output><button id="export">Exportar JSON</button>
<script>
const KEY='travel-budget:v1';let rows=[];
const notice=document.getElementById('notice');
try{const saved=localStorage.getItem(KEY);if(saved!==null){const parsed=JSON.parse(saved);if(!Array.isArray(parsed))throw new Error('Invalid records');rows=parsed;}}catch{notice.textContent='No se pudo recuperar el estado guardado.';}
function render(){const list=document.getElementById('trips');list.replaceChildren();for(const row of rows){const li=document.createElement('li');li.textContent=row.destination+' · '+(row.nights*row.rate).toFixed(2)+' ';const remove=document.createElement('button');remove.textContent='Eliminar';remove.addEventListener('click',()=>{rows=rows.filter(item=>item.id!==row.id);save();render();});li.append(remove);list.append(li);}document.getElementById('total').textContent=rows.reduce((sum,row)=>sum+row.nights*row.rate,0).toFixed(2);}
function save(){try{localStorage.setItem(KEY,JSON.stringify(rows));notice.textContent='Guardado';}catch{notice.textContent='No se pudo guardar. Exporta los datos antes de salir.';}}
document.getElementById('trip').addEventListener('submit',event=>{event.preventDefault();const destination=document.getElementById('destination').value.trim();const nights=Number(document.getElementById('nights').value);const rate=Number(document.getElementById('rate').value);if(!destination||!Number.isInteger(nights)||nights<1||!Number.isFinite(rate)||rate<0)return;rows.push({id:Date.now().toString(),destination,nights,rate});save();render();event.target.reset();});
document.getElementById('export').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(rows)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='viajes.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});render();
</script></body></html>`,
};
export const htmlBrief = { summary: htmlApplication.description, audience: 'Viajeros', scope: 'focused' as const, workflows: ['Crear viajes y calcular costes'], features: [{ type: 'travel-budget-calculator', title: 'Presupuesto de viajes', purpose: 'Calcular por noches y precio' }], design: htmlApplication.theme, assumptions: ['El usuario introduce los costes'], acceptanceCriteria: ['Guardar y eliminar viajes recalcula el total'], limitations: htmlApplication.limitations };
