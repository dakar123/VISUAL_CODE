/* DATASTORE S.A.C. — Dashboard Empresarial v2.1
   - Carga FOCALIZADA: filtros detallados solo re-renderizan los 9 cuadros (nunca recargan la página)
   - 9 cuadros fijos con scroll interno + Solo / Ampliar / Contraer
   - Reportes por tipo con cuadros de colores + exportación HTML/PDF con diseño
   - Botón limpieza de datos para subir otro archivo
*/
const state={
  rows:[],filtered:[],charts:{},panelCharts:{},mapping:{},headers:[],
  liveTimer:null,lastPanelRows:[],
  selection:{product:null,category:null,location:null,month:null},
  panelRenderId:0,globalRenderId:0,isPanelRendering:false,isGlobalRendering:false,
  lastMR:null,
  mrCharts:{},spkCharts:{},flkCharts:{},
  flk:{timer:null,events:[],idx:0,agg:new Map(),queue:[],processed:0,t0:0,checks:0,running:false}
};
const months=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const weekdayNames=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const aliases={
 date:["fecha","date","fecha venta","fecha_venta","datetime"],
 product:["producto","product","nombre producto","nombre_producto","articulo","artículo"],
 category:["categoria","categoría","category","tipo","linea","línea","familia"],
 quantity:["cantidad","quantity","unidades","units","cantidad vendida","cantidad_vendida","qty"],
 amount:["venta","ventas","importe","monto","total","precio total","precio_total","amount","sales","valor venta","valor_venta","precio","price"],
 location:["ciudad","city","sede","sede ciudad","sede_ciudad","local","ubicacion","ubicación","location"]
};
function norm(v){return String(v??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
function parseNumber(v){
 if(v===null||v===undefined||v==="")return 0;
 if(typeof v==="number")return v;
 let s=String(v).trim().replace(/S\/|S\\|\$|\s/g,"");
 if(s.includes(",")&&s.includes(".")){
   if(s.lastIndexOf(",")>s.lastIndexOf("."))s=s.replace(/\./g,"").replace(",",".");
   else s=s.replace(/,/g,"");
 }else if(s.includes(",")){
   const p=s.split(",");
   s=p[p.length-1].length<=2?p.slice(0,-1).join("")+"."+p[p.length-1]:s.replace(/,/g,"");
 }
 return Number(s)||0;
}
function parseDate(v){
 const s=String(v??"").trim();
 if(!s)return null;
 let d=new Date(s);
 if(!isNaN(d))return d;
 const m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
 return m?new Date(+m[3],+m[2]-1,+m[1]):null;
}
function detect(headers,key){
 const ns=headers.map(h=>({raw:h,n:norm(h)}));
 for(const a of aliases[key]){const hit=ns.find(x=>x.n===norm(a));if(hit)return hit.raw}
 for(const a of aliases[key]){const hit=ns.find(x=>x.n.includes(norm(a))||norm(a).includes(x.n));if(hit)return hit.raw}
 return null;
}
function prepare(rows){
 const headers=Object.keys(rows[0]||{});
 const mapping={};
 Object.keys(aliases).forEach(k=>mapping[k]=detect(headers,k));
 state.mapping=mapping;state.headers=headers;
 const required=["date","product","category","quantity","amount","location"];
 if(required.some(k=>!mapping[k])){
   alert("No se pudieron detectar todas las columnas. Se necesitan: fecha, producto, categoría, cantidad, venta/importe y ciudad/sede.");
   return false;
 }
 const hasAmountColumn=mapping.amount&&norm(mapping.amount)!=="precio"&&norm(mapping.amount)!=="price";
 state.rows=rows.map(r=>{
   const qty=parseNumber(r[mapping.quantity]);
   const raw=parseNumber(r[mapping.amount]);
   const priceUnit = hasAmountColumn ? (qty? raw/qty : raw) : raw;
   const amount = hasAmountColumn ? raw : qty*raw;
   return {
   date:parseDate(r[mapping.date]),
   product:String(r[mapping.product]??"Sin producto").trim(),
   category:String(r[mapping.category]??"Sin categoría").trim(),
   quantity:qty,
   amount:amount,
   price: priceUnit,
   location:String(r[mapping.location]??"Sin sede").trim()
 } }).filter(r=>r.date&&!isNaN(r.date));
 return true;
}
function group(rows,key,metric){
 const m=new Map();
 rows.forEach(r=>m.set(r[key],(m.get(r[key])||0)+r[metric]));
 return [...m.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);
}
function groupAvg(rows,key,field){
 const m=new Map();
 rows.forEach(r=>{
   const cur=m.get(r[key])||{sum:0,count:0};
   cur.sum+=r[field];cur.count++;
   m.set(r[key],cur);
 });
 return [...m.entries()].map(([label,{sum,count}])=>({label,value:sum/count})).sort((a,b)=>b.value-a.value);
}
function money(v){return "S/ "+Number(v).toLocaleString("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2})}
function num(v){return Number(v).toLocaleString("es-PE")}
function set(id,v){const el=document.getElementById(id); if(el) el.textContent=v}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function toast(msg){
  const t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0F172A;color:#fff;padding:9px 16px;border-radius:999px;font-size:12px;font-weight:700;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:90vw;text-align:center';
  document.body.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='.3s';setTimeout(()=>t.remove(),320)},2200);
}
function parseCsv(text){
 const records=[];let record=[],field="",quoted=false;
 for(let i=0;i<text.length;i++){
  const char=text[i],next=text[i+1];
  if(char==='"'&&quoted&&next==='"'){field+='"';i++;continue}
  if(char==='"'){quoted=!quoted;continue}
  if(char===','&&!quoted){record.push(field);field="";continue}
  if((char==='\n'||char==='\r')&&!quoted){
   if(char==='\r'&&next==='\n')i++;
   record.push(field);field="";
   if(record.some(value=>value.trim()!=="")){records.push(record)}
   record=[];continue;
  }
  field+=char;
 }
 if(field!==""||record.length){record.push(field);records.push(record)}
 const headers=(records.shift()||[]).map(header=>header.replace(/^\uFEFF/,""));
 return records.map(values=>headers.reduce((row,header,index)=>{row[header]=values[index]??"";return row},{}));
}
function destroyCharts(){Object.values(state.charts).forEach(c=>{try{c.destroy()}catch{}});state.charts={}}
function destroyPanelCharts(){Object.values(state.panelCharts).forEach(c=>{try{c.destroy()}catch{}});state.panelCharts={}}
function clearData(opts={}){
 state.rows=[];state.filtered=[];destroyCharts();destroyPanelCharts();
 flkStop(true);
 ["mrCharts","spkCharts","flkCharts"].forEach(reg=>{Object.values(state[reg]).forEach(c=>{try{c.destroy()}catch{}});state[reg]={};});
 state.selection={product:null,category:null,location:null,month:null};
 state.lastPanelRows=[];
 ["totalSales","transactions","productsSold","topProduct","topLocation","topProductShare","topLocationShare"].forEach(id=>set(id,["topProduct","topLocation","topProductShare","topLocationShare"].includes(id)?"—":id==="totalSales"?"S/ 0.00":"0"));
 const fs=document.getElementById("fileStatus"); if(fs) fs.textContent="Sin archivo cargado — sube otro CSV";
 const csvInput=document.getElementById("csvFile"); if(csvInput) csvInput.value="";
 const rc=document.getElementById("reportContent"); if(rc) rc.innerHTML='<p class="empty">Datos limpiados. Carga un nuevo CSV y genera un reporte.</p>';
 clearMapReduce(true);
 refreshMrDatasetInfo();
 const fc=document.getElementById("filterCount"); if(fc) fc.textContent="0 registros filtrados";
 ["pTotalSales","pTransactions","pAvgSale","pQty","pAvgPrice","pCities"].forEach(id=>set(id,"—"));
 ["pTotalSalesDelta","pTransDelta","pAvgDelta","pQtyDelta","pPriceDelta"].forEach(id=>set(id,"—"));
 ["rankingTable","geoTable","priceStats","paretoTable","weekdayTable","ticketStats","riskList"].forEach(id=>{const e=document.getElementById(id); if(e) e.innerHTML='<p class="empty" style="padding:12px">Sin datos. Carga un CSV.</p>';});
 const pi=document.getElementById("panelInsights"); if(pi) pi.innerHTML='<p class="empty">Carga datos para ver insights.</p>';
 ["kpiInsight","paretoInsight","calInsight","ticketInsight"].forEach(id=>set(id,"Carga datos para ver insights empresariales."));
 ["trendBestMonth"].forEach(id=>set(id,"Mejor mes: —"));
 ["trendProjection"].forEach(id=>set(id,"Proyección próximo mes: —"));
 // reset filtros
 ["fText","fDateFrom","fDateTo"].forEach(id=>{const e=document.getElementById(id); if(e) e.value="";});
 ["fCategory","fCity","fProduct","fMonth","fYear","fQuarter","fWeekday","yearFilter","monthFilter","locationFilter","reportMonthFilter"].forEach(id=>{const e=document.getElementById(id); if(e) e.value="all";});
 ["reportYearFilter","reportLocationFilter"].forEach(id=>{const e=document.getElementById(id); if(e) e.value="all";});
 const rt=document.getElementById("reportType"); if(rt) rt.value="ejecutivo";
 document.querySelectorAll('[data-touched]').forEach(e=>{delete e.dataset.touched});
 const lu=document.getElementById("lastUpdate"); if(lu) lu.textContent="—";
 renderActiveChips();
 // avisar backend (no bloquea): borra Mongo para subir otros datos
 fetch("/api/data",{method:"DELETE",credentials:"same-origin"}).catch(()=>{});
 if(!opts.silent) toast("🧹 Datos limpiados. Ya puedes subir otro archivo CSV.");
}
function makeChart(id,type,labels,data,label,extra={}){
 const ctx=document.getElementById(id);
 if(!ctx) return null;
 if(state.charts[id]){try{state.charts[id].destroy()}catch{}}
 state.charts[id]=new Chart(ctx,{type,data:{labels,datasets:[{label,data,borderWidth:2,fill:type==="line",tension:.3,backgroundColor:["#2563EB","#7C3AED","#10B981","#F59E0B","#64748B","#EC4899","#06B6D4","#EF4444","#14B8A6"],borderColor:"#2563EB"}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:type==="doughnut"}},scales:type==="doughnut"||type==="pie"?{}:{y:{beginAtZero:true}},...extra}});
 return state.charts[id];
}
function makePanelChart(id,type,labels,data,label,extra={}){
 const ctx=document.getElementById(id);
 if(!ctx) return null;
 if(state.panelCharts[id]){try{state.panelCharts[id].destroy()}catch{}}
 // paleta corporativa por cuadro
 const palettes={
   kpiSpark:["#06B6D4"],panelTrendChart:["#2563EB"],panelRankingChart:["#F59E0B"],
   panelGeoChart:["#10B981","#2563EB","#7C3AED","#F59E0B","#EC4899","#06B6D4","#64748B"],
   panelPriceChart:["#7C3AED"],panelParetoChart:["#EC4899"],panelWeekdayChart:["#14B8A6"],
   panelTicketChart:["#F97316"],panelRiskChart:["#EF4444","#F59E0B","#10B981"]
 };
 const bg=palettes[id]||["#2563EB","#7C3AED","#10B981","#F59E0B","#64748B","#EC4899","#06B6D4","#EF4444","#14B8A6","#A78BFA"];
 state.panelCharts[id]=new Chart(ctx,{type,data:{labels,datasets:[{label,data,borderWidth:2,fill:type==="line",tension:.35,backgroundColor:type==="line"?bg[0]+"55":bg,borderColor:bg[0]}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:type==="doughnut"||type==="pie"}},scales:(type==="doughnut"||type==="pie")?{}:{y:{beginAtZero:true}},...extra}});
 return state.panelCharts[id];
}
// ===== SELECCIÓN DE TABLAS (focalizada: no recarga página, solo re-render) =====
function toggleSelection(type,value){
 if(state.selection[type]===value) state.selection[type]=null;
 else state.selection[type]=value;
 toast(state.selection[type] ? `Filtrado por ${type}: ${value}` : `Filtro ${type} eliminado`);
 scheduleGlobal();
}
function bindTableSelection(){
 document.querySelectorAll('.data-table tbody tr.selectable').forEach(tr=>{
   if(tr.dataset.bound) return; tr.dataset.bound="1";
   tr.addEventListener('click',()=>{
     const type=tr.dataset.type, value=tr.dataset.value;
     if(type && value) toggleSelection(type,value);
   });
 });
 document.querySelectorAll('.mini-table tbody tr.selectable').forEach(tr=>{
   if(tr.dataset.bound) return; tr.dataset.bound="1";
   tr.addEventListener('click',()=>{
     const type=tr.dataset.type, value=tr.dataset.value;
     if(type && value) toggleSelection(type,value);
   });
 });
}
// ===== FILTROS =====
function populateFilters(){
 const years=[...new Set(state.rows.map(r=>r.date.getFullYear()))].sort();
 const locations=[...new Set(state.rows.map(r=>r.location))].sort();
 const categories=[...new Set(state.rows.map(r=>r.category))].sort();
 const products=[...new Set(state.rows.map(r=>r.product))].sort();
 const setHTML=(id,html)=>{const el=document.getElementById(id); if(el) el.innerHTML=html;};
 const yearOpts='<option value="all">Todos</option>'+years.map(y=>`<option>${y}</option>`).join("");
 const locOpts='<option value="all">Todas</option>'+locations.map(x=>`<option>${escapeHtml(x)}</option>`).join("");
 const catOpts='<option value="all">Todas</option>'+categories.map(x=>`<option>${escapeHtml(x)}</option>`).join("");
 const prodOpts='<option value="all">Todos</option>'+products.map(x=>`<option>${escapeHtml(x)}</option>`).join("");
 setHTML("yearFilter",yearOpts);
 setHTML("locationFilter",locOpts);
 setHTML("reportYearFilter",yearOpts);
 setHTML("reportLocationFilter",'<option value="all">Todos</option>'+locations.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join(""));
 setHTML("fYear",yearOpts);
 setHTML("fCity",locOpts);
 setHTML("fCategory",catOpts);
 setHTML("fProduct",prodOpts);
 if(state.rows.length){
   const prices=state.rows.map(r=>r.price).filter(v=>v>0);
   if(prices.length){
     const minP=Math.floor(Math.min(...prices));
     const maxP=Math.ceil(Math.max(...prices));
     const setRange=(minId,maxId,min,max)=>{const a=document.getElementById(minId),b=document.getElementById(maxId); if(a){a.min=min;a.max=max;if(!a.dataset.touched) a.value=min;} if(b){b.min=min;b.max=max;if(!b.dataset.touched) b.value=max;}};
     setRange("fPriceMin","fPriceMax",Math.max(0,minP-10),maxP+10);
     const pMinN=document.getElementById("fPriceMinNum"), pMaxN=document.getElementById("fPriceMaxNum");
     if(pMinN) { pMinN.min=Math.max(0,minP-10); pMinN.max=maxP+10; if(!pMinN.dataset.touched) pMinN.value=document.getElementById("fPriceMin").value; }
     if(pMaxN) { pMaxN.min=Math.max(0,minP-10); pMaxN.max=maxP+10; if(!pMaxN.dataset.touched) pMaxN.value=document.getElementById("fPriceMax").value; }
   }
   const qtys=state.rows.map(r=>r.quantity);
   if(qtys.length){
     const qtyMin=Math.min(...qtys), qtyMax=Math.max(...qtys);
     const a=document.getElementById("fQtyMin"),b=document.getElementById("fQtyMax");
     if(a){a.min=qtyMin;a.max=qtyMax;if(!a.dataset.touched)a.value=qtyMin}
     if(b){b.min=qtyMin;b.max=qtyMax;if(!b.dataset.touched)b.value=qtyMax}
     const qMinN=document.getElementById("fQtyMinNum"), qMaxN=document.getElementById("fQtyMaxNum");
     if(qMinN) {qMinN.min=qtyMin; qMinN.max=qtyMax; if(!qMinN.dataset.touched) qMinN.value=qtyMin;}
     if(qMaxN) {qMaxN.min=qtyMin; qMaxN.max=qtyMax; if(!qMaxN.dataset.touched) qMaxN.value=qtyMax;}
   }
   const amtMax=Math.ceil(Math.max(...state.rows.map(r=>r.amount)));
   const am1=document.getElementById("fAmountMin"),am2=document.getElementById("fAmountMax");
   if(am1){am1.min=0;am1.max=amtMax;if(!am1.dataset.touched)am1.value=0}
   if(am2){am2.min=0;am2.max=amtMax;if(!am2.dataset.touched)am2.value=amtMax}
   const aMinN=document.getElementById("fAmountMinNum"), aMaxN=document.getElementById("fAmountMaxNum");
   if(aMinN) {aMinN.min=0; aMinN.max=amtMax; if(!aMinN.dataset.touched) aMinN.value=0;}
   if(aMaxN) {aMaxN.min=0; aMaxN.max=amtMax; if(!aMaxN.dataset.touched) aMaxN.value=amtMax;}
   syncRangeLabels();
 }
 if(state.rows.length){
   const dates=state.rows.map(r=>r.date).sort((a,b)=>a-b);
   const minD=dates[0].toISOString().slice(0,10), maxD=dates[dates.length-1].toISOString().slice(0,10);
   const fromEl=document.getElementById("fDateFrom"), toEl=document.getElementById("fDateTo");
   if(fromEl && !fromEl.value) {fromEl.min=minD; fromEl.max=maxD; fromEl.placeholder=minD;}
   if(toEl && !toEl.value) {toEl.min=minD; toEl.max=maxD; toEl.placeholder=maxD;}
 }
}
function syncRangeLabels(){
 const pMin=document.getElementById("fPriceMin")?.value, pMax=document.getElementById("fPriceMax")?.value;
 const qMin=document.getElementById("fQtyMin")?.value, qMax=document.getElementById("fQtyMax")?.value;
 const aMin=document.getElementById("fAmountMin")?.value, aMax=document.getElementById("fAmountMax")?.value;
 const setL=(id,val)=>{const e=document.getElementById(id); if(e) e.textContent=val};
 if(pMin!==undefined) setL("fPriceLabel", `${num(pMin)} — ${num(pMax)}`);
 if(qMin!==undefined) setL("fQtyLabel", `${qMin} — ${qMax}`);
 if(aMin!==undefined) setL("fAmountLabel", `${num(aMin)} — ${num(aMax)}`);
}
function getPanelFilteredRows(){
 if(!state.rows.length) return [];
 let rows=[...state.rows];
 const gYear=document.getElementById("yearFilter")?.value;
 const gMonth=document.getElementById("monthFilter")?.value;
 const gLoc=document.getElementById("locationFilter")?.value;
 if(gYear&&gYear!=="all") rows=rows.filter(r=>String(r.date.getFullYear())===String(gYear));
 if(gMonth&&gMonth!=="all") rows=rows.filter(r=>String(r.date.getMonth()+1)===String(gMonth));
 if(gLoc&&gLoc!=="all") rows=rows.filter(r=>r.location===gLoc);
 const fText=document.getElementById("fText")?.value.trim().toLowerCase();
 const fCat=document.getElementById("fCategory")?.value;
 const fCity=document.getElementById("fCity")?.value;
 const fProduct=document.getElementById("fProduct")?.value;
 const fMonth=document.getElementById("fMonth")?.value;
 const fYear=document.getElementById("fYear")?.value;
 const fQuarter=document.getElementById("fQuarter")?.value;
 const fWeekday=document.getElementById("fWeekday")?.value;
 const fDateFrom=document.getElementById("fDateFrom")?.value;
 const fDateTo=document.getElementById("fDateTo")?.value;
 const pMin=Number(document.getElementById("fPriceMin")?.value||0);
 const pMax=Number(document.getElementById("fPriceMax")?.value||9999999);
 const qMin=Number(document.getElementById("fQtyMin")?.value||0);
 const qMax=Number(document.getElementById("fQtyMax")?.value||9999999);
 const aMin=Number(document.getElementById("fAmountMin")?.value||0);
 const aMax=Number(document.getElementById("fAmountMax")?.value||99999999);
 if(fText) rows=rows.filter(r=> r.product.toLowerCase().includes(fText) || r.category.toLowerCase().includes(fText) || r.location.toLowerCase().includes(fText));
 if(fCat&&fCat!=="all") rows=rows.filter(r=>r.category===fCat);
 if(fCity&&fCity!=="all") rows=rows.filter(r=>r.location===fCity);
 if(fProduct&&fProduct!=="all") rows=rows.filter(r=>r.product===fProduct);
 if(fYear&&fYear!=="all") rows=rows.filter(r=>String(r.date.getFullYear())===String(fYear));
 if(fMonth&&fMonth!=="all") rows=rows.filter(r=>String(r.date.getMonth()+1)===String(fMonth));
 if(fQuarter&&fQuarter!=="all"){
   const q=Number(fQuarter);
   rows=rows.filter(r=> (Math.floor(r.date.getMonth()/3)+1)===q);
 }
 if(fWeekday&&fWeekday!=="all") rows=rows.filter(r=>String(r.date.getDay())===String(fWeekday));
 if(fDateFrom) rows=rows.filter(r=> r.date >= new Date(fDateFrom+'T00:00:00'));
 if(fDateTo) rows=rows.filter(r=> r.date <= new Date(fDateTo+'T23:59:59'));
 rows=rows.filter(r=> r.price>=pMin && r.price<=pMax);
 rows=rows.filter(r=> r.quantity>=qMin && r.quantity<=qMax);
 rows=rows.filter(r=> r.amount>=aMin && r.amount<=aMax);
 if(state.selection.product) rows=rows.filter(r=>r.product===state.selection.product);
 if(state.selection.category) rows=rows.filter(r=>r.category===state.selection.category);
 if(state.selection.location) rows=rows.filter(r=>r.location===state.selection.location);
 if(state.selection.month) rows=rows.filter(r=> months[r.date.getMonth()]===state.selection.month);
 return rows;
}
function renderActiveChips(){
 const cont=document.getElementById("activeChips");
 if(!cont) return;
 const chips=[];
 const fText=document.getElementById("fText")?.value.trim();
 if(fText) chips.push(`<span class="chip active">Búsqueda: ${escapeHtml(fText)} <i onclick="document.getElementById('fText').value='';schedulePanel()">×</i></span>`);
 const fCat=document.getElementById("fCategory")?.value;
 if(fCat&&fCat!=="all") chips.push(`<span class="chip active">Categoría: ${escapeHtml(fCat)} <i onclick="document.getElementById('fCategory').value='all';schedulePanel()">×</i></span>`);
 const fCity=document.getElementById("fCity")?.value;
 if(fCity&&fCity!=="all") chips.push(`<span class="chip active">Ciudad: ${escapeHtml(fCity)} <i onclick="document.getElementById('fCity').value='all';schedulePanel()">×</i></span>`);
 const fProd=document.getElementById("fProduct")?.value;
 if(fProd&&fProd!=="all") chips.push(`<span class="chip active">Producto: ${escapeHtml(fProd)} <i onclick="document.getElementById('fProduct').value='all';schedulePanel()">×</i></span>`);
 const fQ=document.getElementById("fQuarter")?.value;
 if(fQ&&fQ!=="all") chips.push(`<span class="chip active">Trimestre: Q${fQ} <i onclick="document.getElementById('fQuarter').value='all';schedulePanel()">×</i></span>`);
 const fW=document.getElementById("fWeekday")?.value;
 if(fW&&fW!=="all") chips.push(`<span class="chip active">Día: ${weekdayNames[Number(fW)]} <i onclick="document.getElementById('fWeekday').value='all';schedulePanel()">×</i></span>`);
 const fFrom=document.getElementById("fDateFrom")?.value;
 if(fFrom) chips.push(`<span class="chip active">Desde: ${fFrom} <i onclick="document.getElementById('fDateFrom').value='';schedulePanel()">×</i></span>`);
 const fTo=document.getElementById("fDateTo")?.value;
 if(fTo) chips.push(`<span class="chip active">Hasta: ${fTo} <i onclick="document.getElementById('fDateTo').value='';schedulePanel()">×</i></span>`);
 if(state.selection.product) chips.push(`<span class="chip active" style="background:#0F172A">Sel. Producto: ${escapeHtml(state.selection.product)} <i onclick="toggleSelection('product',&quot;${escapeHtml(state.selection.product)}&quot;)">×</i></span>`);
 if(state.selection.category) chips.push(`<span class="chip active" style="background:#0F172A">Sel. Categoría: ${escapeHtml(state.selection.category)} <i onclick="toggleSelection('category',&quot;${escapeHtml(state.selection.category)}&quot;)">×</i></span>`);
 if(state.selection.location) chips.push(`<span class="chip active" style="background:#0F172A">Sel. Ciudad: ${escapeHtml(state.selection.location)} <i onclick="toggleSelection('location',&quot;${escapeHtml(state.selection.location)}&quot;)">×</i></span>`);
 if(state.selection.month) chips.push(`<span class="chip active" style="background:#0F172A">Sel. Mes: ${escapeHtml(state.selection.month)} <i onclick="toggleSelection('month',&quot;${escapeHtml(state.selection.month)}&quot;)">×</i></span>`);
 cont.innerHTML=chips.join('') || '<span style="font-size:11px;color:#94A3B8">Sin filtros activos — prueba precio, fecha o clic en tablas</span>';
 window.toggleSelection=toggleSelection;
 window.schedulePanel=schedulePanel;
 window.scheduleGlobal=scheduleGlobal;
}
/* ================= PANEL FOCALIZADO (9 cuadros, sin recargar página) ================= */
function setPanelLoading(on){
  const el=document.getElementById("panelLoading");
  if(el) el.hidden=!on;
}
function renderCuadroSafe(name,fn){
  try{ fn(); }
  catch(e){ console.warn("Cuadro "+name+" omitido:",e?.message); }
}
// --- Cuadro 1 ---
function renderCuadroKPI(rows,total,qty,avgSale,avgPrice,cities){
  set("pTotalSales",money(total));
  set("pTransactions",num(rows.length));
  set("pAvgSale",money(avgSale));
  set("pQty",num(Math.round(qty)));
  set("pAvgPrice",money(avgPrice));
  set("pCities",String(cities));
  if(state.rows.length){
    const totalAll=state.rows.reduce((s,r)=>s+r.amount,0);
    const share=((total/(totalAll||1))*100).toFixed(1);
    const te=document.getElementById("pTotalSalesDelta"); if(te) te.textContent=`${share}% del total`;
    const transShare=((rows.length/state.rows.length)*100).toFixed(1);
    const tr=document.getElementById("pTransDelta"); if(tr) tr.textContent=`${transShare}% registros`;
    const avgAll= totalAll/state.rows.length;
    const avgDelta= avgAll?(((avgSale-avgAll)/avgAll*100).toFixed(1)):"0.0";
    const ae=document.getElementById("pAvgDelta"); if(ae) ae.textContent=`${Number(avgDelta)>0?"+":""}${avgDelta}% vs histórico`;
    const qtyAll=state.rows.reduce((s,r)=>s+r.quantity,0);
    const qtyShare=((qty/(qtyAll||1))*100).toFixed(1);
    const qe=document.getElementById("pQtyDelta"); if(qe) qe.textContent=`${qtyShare}% unidades`;
    const priceAll= state.rows.reduce((s,r)=>s+r.price,0)/state.rows.length;
    const priceDelta= priceAll?(((avgPrice-priceAll)/priceAll*100).toFixed(1)):"0.0";
    const pe=document.getElementById("pPriceDelta"); if(pe) pe.textContent=`${Number(priceDelta)>0?"+":""}${priceDelta}% vs media`;
  }
  const topProd=group(rows,"product","quantity")[0];
  const topCat=group(rows,"category","amount")[0];
  const topCity=group(rows,"location","amount")[0];
  const kpiIns=document.getElementById("kpiInsight");
  if(kpiIns){
    if(topProd && topCat && topCity){
      const pMin=document.getElementById("fPriceMin")?.value||"0", pMax=document.getElementById("fPriceMax")?.value||"—";
      kpiIns.innerHTML=`<b>${escapeHtml(topProd.label)}</b> lidera con ${num(topProd.value)} u. · <b>${escapeHtml(topCat.label)}</b> ${money(topCat.value)} · <b>${escapeHtml(topCity.label)}</b> top ${money(topCity.value)}. <span style="color:#059669">Filtros: S/ ${pMin}–${pMax} · ${document.getElementById("fDateFrom")?.value||'—'} → ${document.getElementById("fDateTo")?.value||'—'}</span> ${state.selection.product?`· <b style="color:#0F172A">Sel: ${escapeHtml(state.selection.product)}</b>`:''}`;
    }
  }
  const monthly=Array.from({length:12},(_,i)=>({label:months[i].slice(0,3),value:0}));
  rows.forEach(r=>monthly[r.date.getMonth()].value+=r.amount);
  makePanelChart("kpiSpark","line",monthly.map(x=>x.label),monthly.map(x=>x.value),"Ventas",{plugins:{legend:{display:false}},scales:{y:{display:false},x:{grid:{display:false}}}});
  return {topProd,topCat,topCity,monthly};
}
// --- Cuadro 2 ---
function renderCuadroTrend(rows,monthly){
  const trendMode=document.getElementById("trendMode")?.value||"month";
  if(trendMode==="month"){
    makePanelChart("panelTrendChart","line",monthly.map(x=>x.label),monthly.map(x=>x.value),"Ventas (S/)",{plugins:{legend:{display:false}}});
  }else{
    const cats=group(rows,"category","amount");
    makePanelChart("panelTrendChart","bar",cats.map(x=>x.label),cats.map(x=>x.value),"Ventas por categoría",{plugins:{legend:{display:false}}});
  }
  const monthlyVals=monthly.map(x=>x.value);
  const maxIdx=monthlyVals.indexOf(Math.max(...monthlyVals));
  const bestMonth= monthlyVals[maxIdx]>0 ? months[maxIdx] : "—";
  const tb=document.getElementById("trendBestMonth"); if(tb) tb.textContent=`Mejor mes: ${bestMonth} (${money(monthlyVals[maxIdx]||0)})`;
  const observed=monthlyVals.filter(v=>v>0);
  let projection="—";
  if(observed.length>=2){
    const n=observed.length;
    const xMean=(n-1)/2, yMean=observed.reduce((a,b)=>a+b,0)/n;
    const numSlope=observed.reduce((s,val,i)=>s+(i-xMean)*(val-yMean),0);
    const den=observed.reduce((s,val,i)=>s+(i-xMean)**2,0);
    const slope= den? numSlope/den : 0;
    const next=Math.max(0, yMean + slope*(n - xMean));
    projection=money(next);
  }
  const tp=document.getElementById("trendProjection"); if(tp) tp.textContent=`Proyección próximo mes: ${projection}`;
  return {bestMonth,projection,monthlyVals};
}
// --- Cuadro 3 ---
function renderCuadroRanking(rows){
  const fSort=document.getElementById("fSort")?.value||"mas_ventas";
  const fTopN=Number(document.getElementById("fTopN")?.value||10);
  const fRankMode=document.getElementById("fRankMode")?.value||"mas";
  let ranking=[];
  if(fSort==="mas_ventas"||fSort==="menos_ventas") ranking=group(rows,"product","amount");
  else if(fSort==="mas_unidades"||fSort==="menos_unidades") ranking=group(rows,"product","quantity");
  else if(fSort==="mayor_precio"||fSort==="menor_precio") ranking=groupAvg(rows,"product","price");
  else if(fSort==="az"){const m=new Map(); rows.forEach(r=>m.set(r.product,(m.get(r.product)||0)+r.amount)); ranking=[...m.entries()].map(([label,value])=>({label,value})).sort((a,b)=>a.label.localeCompare(b.label));}
  let sorted=[...ranking];
  if(fSort==="menos_ventas"||fSort==="menos_unidades"||fSort==="menor_precio") sorted.sort((a,b)=>a.value-b.value);
  else if(fSort==="mas_ventas"||fSort==="mas_unidades"||fSort==="mayor_precio") sorted.sort((a,b)=>b.value-a.value);
  if(fRankMode==="menos") sorted=[...sorted].reverse();
  sorted=sorted.slice(0,fTopN);
  const rankLabelMap={mas_ventas:"Ventas (S/)",menos_ventas:"Ventas (S/)",mas_unidades:"Unidades",menos_unidades:"Unidades",mayor_precio:"Precio prom.",menor_precio:"Precio prom.",az:"Ventas (S/)"};
  const subtitle=document.getElementById("rankingSubtitle");
  const sortSel=document.getElementById("fSort");
  if(subtitle) subtitle.textContent=`${fRankMode==="mas"?"Más":"Menos"} · ${fTopN} · ${sortSel?.selectedOptions?.[0]?.text||fSort}`;
  makePanelChart("panelRankingChart","bar",sorted.map(x=>x.label),sorted.map(x=>x.value),rankLabelMap[fSort]||"Valor",{indexAxis:"y",plugins:{legend:{display:false}}});
  const rankTable=document.getElementById("rankingTable");
  if(rankTable){
    const totalMetric= ranking.reduce((s,r)=>s+r.value,0);
    rankTable.innerHTML=`<table><thead><tr><th>#</th><th>Producto</th><th>${rankLabelMap[fSort]}</th><th>%</th></tr></thead><tbody>${sorted.map((r,i)=>`<tr class="selectable ${state.selection.product===r.label?'selected':''}" data-type="product" data-value="${escapeHtml(r.label)}"><td>${i+1}</td><td>${escapeHtml(r.label)} ${state.selection.product===r.label?'●':''}</td><td>${fSort.includes("precio")? money(r.value) : fSort.includes("unidades")? num(Math.round(r.value)) : money(r.value)}</td><td>${totalMetric? ((r.value/totalMetric)*100).toFixed(1):0}%</td></tr>`).join("")}</tbody></table>`;
  }
  return sorted;
}
// --- Cuadro 4 ---
function renderCuadroGeo(rows){
  const geoMode=document.getElementById("geoMode")?.value||"city";
  let geoData=[];
  if(geoMode==="city"){
    geoData=group(rows,"location","amount");
    makePanelChart("panelGeoChart","bar",geoData.map(x=>x.label),geoData.map(x=>x.value),"Ventas por ciudad",{plugins:{legend:{display:false}}});
  }else{
    geoData=group(rows,"category","amount");
    makePanelChart("panelGeoChart","doughnut",geoData.map(x=>x.label),geoData.map(x=>x.value),"Ventas",{});
  }
  const geoTable=document.getElementById("geoTable");
  if(geoTable){
    const totalGeo=geoData.reduce((s,r)=>s+r.value,0);
    const type= geoMode==="city"?"location":"category";
    geoTable.innerHTML=`<table><thead><tr><th>${geoMode==="city"?"Ciudad":"Categoría"}</th><th>Ventas</th><th>%</th></tr></thead><tbody>${geoData.slice(0,8).map(r=>`<tr class="selectable ${state.selection[type]===r.label?'selected':''}" data-type="${type}" data-value="${escapeHtml(r.label)}"><td>${escapeHtml(r.label)} ${state.selection[type]===r.label?'●':''}</td><td>${money(r.value)}</td><td>${totalGeo?((r.value/totalGeo)*100).toFixed(1):0}%</td></tr>`).join("")}</tbody></table>`;
  }
  return geoData;
}
// --- Cuadro 5 ---
function renderCuadroPrice(rows){
  const buckets=[
    {label:"0-100",min:0,max:100},
    {label:"100-300",min:100,max:300},
    {label:"300-700",min:300,max:700},
    {label:"700-1500",min:700,max:1500},
    {label:"1500-3000",min:1500,max:3000},
    {label:"3000+",min:3000,max:99999999},
  ];
  const hist=buckets.map(b=>({label:b.label,value:rows.filter(r=>r.price>=b.min && r.price < b.max).length}));
  makePanelChart("panelPriceChart","bar",hist.map(x=>x.label),hist.map(x=>x.value),"Tickets por rango de precio",{plugins:{legend:{display:false}}});
  const sample=rows.slice(0,400).filter((_,i)=>i%2===0).slice(0,200);
  const scatterData=sample.map(r=>({x:Number(r.price.toFixed(2)),y:r.quantity}));
  if(state.panelCharts["panelScatterChart"]) {try{state.panelCharts["panelScatterChart"].destroy()}catch{}}
  const ctxScatter=document.getElementById("panelScatterChart");
  if(ctxScatter){
    state.panelCharts["panelScatterChart"]=new Chart(ctxScatter,{type:"scatter",data:{datasets:[{label:"Precio vs Cantidad",data:scatterData,backgroundColor:"#7C3AED",borderColor:"#7C3AED"}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{title:{display:true,text:"Precio unitario (S/)"}},y:{title:{display:true,text:"Cantidad"}}}}});
  }
  const priceStats=document.getElementById("priceStats");
  let avgPrice=0;
  if(priceStats){
    const prices=rows.map(r=>r.price);
    const minP=Math.min(...prices), maxP=Math.max(...prices), avg=prices.reduce((a,b)=>a+b,0)/prices.length;
    avgPrice=avg;
    const median=[...prices].sort((a,b)=>a-b)[Math.floor(prices.length/2)];
    priceStats.innerHTML=`<div><small>Precio mínimo</small><b>${money(minP)}</b></div><div><small>Precio máximo</small><b>${money(maxP)}</b></div><div><small>Precio promedio</small><b>${money(avg)}</b></div><div><small>Mediana</small><b>${money(median)}</b></div>`;
  }
  const priceBadge=document.getElementById("priceBadge");
  if(priceBadge){
    const avgB= rows.reduce((s,r)=>s+r.price,0)/rows.length;
    priceBadge.textContent= avgB>1000? "Precio alto" : avgB>300? "Precio medio":"Precio accesible";
  }
  return {hist,avgPrice};
}
// --- Cuadro 6 Pareto ---
function renderCuadroPareto(rows,total){
  const byProd=group(rows,"product","amount").slice(0,12);
  const acc=[]; let run=0;
  byProd.forEach(p=>{run+=p.value; acc.push({label:p.label,value:p.value,cum:(run/(total||1))*100})});
  makePanelChart("panelParetoChart","bar",byProd.map(x=>x.label.length>14?x.label.slice(0,14)+"…":x.label),byProd.map(x=>Math.round(x.value)),"Ventas (S/)",{indexAxis:"y",plugins:{legend:{display:false}}});
  const top3=acc.slice(0,3).reduce((s,a)=>s+a.value,0);
  const top3Pct=((top3/(total||1))*100).toFixed(1);
  const pb=document.getElementById("paretoBadge"); if(pb) pb.textContent=`Top3 ${top3Pct}%`;
  const pt=document.getElementById("paretoTable");
  if(pt){
    pt.innerHTML=`<table><thead><tr><th>#</th><th>Producto</th><th>Ventas</th><th>Acum.</th></tr></thead><tbody>${acc.slice(0,8).map((r,i)=>`<tr class="selectable ${state.selection.product===r.label?'selected':''}" data-type="product" data-value="${escapeHtml(r.label)}"><td>${i+1}</td><td>${escapeHtml(r.label)}</td><td>${money(r.value)}</td><td>${r.cum.toFixed(1)}%</td></tr>`).join("")}</tbody></table>`;
  }
  const pi=document.getElementById("paretoInsight");
  if(pi && acc.length) pi.innerHTML=`<b>${escapeHtml(acc[0].label)}</b> + <b>${escapeHtml(acc[1]?.label||"—")}</b> + <b>${escapeHtml(acc[2]?.label||"—")}</b> = <b>${top3Pct}%</b> de ventas. <span style="color:#059669">Decisión:</span> protege stock del Top3 y crea packs con la cola.`;
  return acc;
}
// --- Cuadro 7 Calendario ---
function renderCuadroCalendar(rows){
  const wd=Array.from({length:7},(_,i)=>({label:weekdayNames[i].slice(0,3),value:0,day:i}));
  rows.forEach(r=>{wd[r.date.getDay()].value+=r.amount});
  makePanelChart("panelWeekdayChart","bar",wd.map(x=>x.label),wd.map(x=>Math.round(x.value)),"Ventas por día (S/)",{plugins:{legend:{display:false}}});
  const best=[...wd].sort((a,b)=>b.value-a.value)[0];
  const cb=document.getElementById("calBadge"); if(cb) cb.textContent=`Top: ${weekdayNames[best.day]}`;
  // trimestre
  const q=[1,2,3,4].map(n=>({label:"Q"+n,value:rows.filter(r=>Math.floor(r.date.getMonth()/3)+1===n).reduce((s,r)=>s+r.amount,0)}));
  const wt=document.getElementById("weekdayTable");
  if(wt){
    const tot=wd.reduce((s,x)=>s+x.value,0);
    wt.innerHTML=`<table><thead><tr><th>Día</th><th>Ventas</th><th>%</th></tr></thead><tbody>${[...wd].sort((a,b)=>b.value-a.value).map(r=>`<tr><td>${weekdayNames[r.day]}</td><td>${money(r.value)}</td><td>${tot?((r.value/tot)*100).toFixed(1):0}%</td></tr>`).join("")}</tbody></table>`;
  }
  const ci=document.getElementById("calInsight");
  if(ci){
    const bestQ=[...q].sort((a,b)=>b.value-a.value)[0];
    ci.innerHTML=`Mejor día <b>${weekdayNames[best.day]}</b> (${money(best.value)}) · Mejor trimestre <b>${bestQ.label}</b> (${money(bestQ.value)}). <span style="color:#059669">Decisión:</span> refuerza personal y promos esos picos.`;
  }
  return {wd,q,best};
}
// --- Cuadro 8 Ticket ---
function renderCuadroTicket(rows){
  const buckets=[
    {label:"0-200",min:0,max:200},{label:"200-500",min:200,max:500},
    {label:"500-1k",min:500,max:1000},{label:"1k-2.5k",min:1000,max:2500},
    {label:"2.5k-5k",min:2500,max:5000},{label:"5k+",min:5000,max:99999999}
  ];
  const hist=buckets.map(b=>({label:b.label,value:rows.filter(r=>r.amount>=b.min&&r.amount<b.max).length}));
  makePanelChart("panelTicketChart","bar",hist.map(x=>x.label),hist.map(x=>x.value),"Tickets por valor (n)",{plugins:{legend:{display:false}}});
  const amounts=rows.map(r=>r.amount).sort((a,b)=>a-b);
  const minA=amounts[0]||0, maxA=amounts[amounts.length-1]||0;
  const avgA=amounts.length?amounts.reduce((a,b)=>a+b,0)/amounts.length:0;
  const medA=amounts.length?amounts[Math.floor(amounts.length/2)]:0;
  const ts=document.getElementById("ticketStats");
  if(ts) ts.innerHTML=`<div><small>Ticket mínimo</small><b>${money(minA)}</b></div><div><small>Ticket máximo</small><b>${money(maxA)}</b></div><div><small>Ticket promedio</small><b>${money(avgA)}</b></div><div><small>Mediana</small><b>${money(medA)}</b></div>`;
  const tb=document.getElementById("ticketBadge"); if(tb) tb.textContent=`Prom ${money(avgA)}`;
  const ti=document.getElementById("ticketInsight");
  if(ti){
    const top=[...hist].sort((a,b)=>b.value-a.value)[0];
    ti.innerHTML=`Rango dominante <b>${top.label}</b> con <b>${num(top.value)}</b> tickets. <span style="color:#059669">Decisión:</span> si el grueso es bajo, sube ticket con packs; si es alto, ofrece cuotas.`;
  }
  return {hist,avgA,medA};
}
// --- Cuadro 9 Riesgo ---
function renderCuadroRisk(rows,total){
  const byQty=group(rows,"product","quantity");
  const low=[...byQty].reverse().slice(0,5);
  const byCity=group(rows,"location","amount");
  const weak=[...byCity].reverse().slice(0,4);
  const cats=group(rows,"category","amount");
  const conc=cats.length?((cats[0].value/(total||1))*100):0;
  makePanelChart("panelRiskChart","doughnut",["Top ciudad","Resto"],[byCity[0]?.value||0,Math.max(0,total-(byCity[0]?.value||0))],"Concentración",{});
  const riskCount=(conc>50?1:0)+(weak.length?1:0)+(low.length?1:0);
  const rb=document.getElementById("riskBadge"); if(rb) rb.textContent=`${riskCount} focos · Conc ${conc.toFixed(0)}%`;
  const rl=document.getElementById("riskList");
  if(rl){
    const items=[];
    if(conc>50) items.push({cls:"risk-bad",t:`<b>Alta concentración:</b> ${escapeHtml(cats[0]?.label||"—")} = ${conc.toFixed(1)}% de ventas. Diversifica con 2ª categoría (${escapeHtml(cats[1]?.label||"—")}).`});
    else items.push({cls:"risk-ok",t:`<b>Concentración sana:</b> categoría líder ${conc.toFixed(1)}%. Mantén portafolio.`});
    if(weak.length) items.push({cls:"risk-warn",t:`<b>Sede débil:</b> ${escapeHtml(weak[0]?.label||"—")} solo ${money(weak[0]?.value||0)}. Replica plays de <b>${escapeHtml(byCity[0]?.label||"—")}</b>.`});
    if(low.length) items.push({cls:"risk-warn",t:`<b>Cola de demanda:</b> ${escapeHtml(low[0]?.label||"—")} (${num(low[0]?.value||0)} u.). Liquida con pack o 2x1.`});
    else items.push({cls:"risk-ok",t:`<b>Demanda pareja:</b> sin quiebres críticos.`});
    rl.innerHTML=items.map(i=>`<div class="risk-item ${i.cls}"><span class="dot"></span><span>${i.t}</span></div>`).join("");
  }
  return {low,weak,conc};
}
function updatePanel(){
  // FOCALIZADO: solo cuadros del panel. Nunca toca charts/tablas globales ni recarga la página.
  const myId=++state.panelRenderId;
  if(document.hidden){ return; }
  if(!state.rows.length){
    setPanelLoading(false);
    return;
  }
  setPanelLoading(true);
  // requestAnimationFrame evita bloquear el hilo y que el navegador "reinicie" la pestaña
  requestAnimationFrame(()=>{
    if(myId!==state.panelRenderId) return; // descartar renders viejos (filtros rápidos)
    try{
      const rows=getPanelFilteredRows();
      state.lastPanelRows=rows;
      const countEl=document.getElementById("filterCount");
      if(countEl) countEl.innerHTML=`<b>${num(rows.length)}</b> registros · ${state.rows.length? ((rows.length/state.rows.length)*100).toFixed(1):0}% del total`;
      const lastEl=document.getElementById("lastUpdate");
      if(lastEl) lastEl.textContent=new Date().toLocaleTimeString("es-PE");
      renderActiveChips();
      if(!rows.length){
        set("pTotalSales","S/ 0.00"); set("pTransactions","0"); set("pAvgSale","S/ 0.00"); set("pQty","0"); set("pAvgPrice","S/ 0.00"); set("pCities","0");
        ["pTotalSalesDelta","pTransDelta","pAvgDelta","pQtyDelta","pPriceDelta"].forEach(id=>set(id,"—"));
        const kpiIns=document.getElementById("kpiInsight"); if(kpiIns) kpiIns.textContent="Sin datos para los filtros actuales. Ajusta precio, fecha, ciudad o limpia selección ●";
        ["rankingTable","geoTable","priceStats","paretoTable","weekdayTable","ticketStats","riskList"].forEach(id=>{const e=document.getElementById(id); if(e) e.innerHTML='<p class="empty" style="padding:12px">Sin datos filtrados.</p>';});
        const pi=document.getElementById("panelInsights"); if(pi) pi.innerHTML='<p class="empty">Ajusta los filtros para ver insights.</p>';
        set("trendBestMonth","Mejor mes: —"); set("trendProjection","Proyección: —");
        setPanelLoading(false);
        return;
      }
      const total=rows.reduce((s,r)=>s+r.amount,0);
      const qty=rows.reduce((s,r)=>s+r.quantity,0);
      const avgSale= total/rows.length;
      const avgPrice= rows.reduce((s,r)=>s+r.price,0)/rows.length;
      const cities=new Set(rows.map(r=>r.location)).size;
      let monthly=[],bestMonth="—",projection="—",histPrice=[],avgP=avgPrice;
      renderCuadroSafe("KPI",()=>{ const r=renderCuadroKPI(rows,total,qty,avgSale,avgPrice,cities); monthly=r.monthly; });
      renderCuadroSafe("Tendencia",()=>{ const r=renderCuadroTrend(rows,monthly.length?monthly:Array.from({length:12},(_,i)=>({label:months[i].slice(0,3),value:0}))); bestMonth=r.bestMonth; projection=r.projection; });
      renderCuadroSafe("Ranking",()=>renderCuadroRanking(rows));
      renderCuadroSafe("Geo",()=>renderCuadroGeo(rows));
      renderCuadroSafe("Precio",()=>{ const r=renderCuadroPrice(rows); histPrice=r.hist; avgP=r.avgPrice; });
      renderCuadroSafe("Pareto",()=>renderCuadroPareto(rows,total));
      renderCuadroSafe("Calendario",()=>renderCuadroCalendar(rows));
      renderCuadroSafe("Ticket",()=>renderCuadroTicket(rows));
      renderCuadroSafe("Riesgo",()=>renderCuadroRisk(rows,total));
      renderCuadroSafe("Insights",()=>{
        const topProd=group(rows,"product","quantity")[0];
        const topCat=group(rows,"category","amount")[0];
        const topCity=group(rows,"location","amount")[0];
        const monthlyVals=monthly.map(x=>x.value);
        const maxIdx=monthlyVals.indexOf(Math.max(...monthlyVals));
        const locShare=topCity? ((topCity.value/total)*100).toFixed(1):0;
        const cheapest=groupAvg(rows,"product","price").slice(-1)[0];
        const expensive=groupAvg(rows,"product","price")[0];
        const lowStock=group(rows,"product","quantity").slice(-1)[0];
        const insights=document.getElementById("panelInsights");
        if(insights){
          const cards=[
            {title:"💰 Oportunidad precio", desc: `Más económico: <b>${escapeHtml(cheapest?.label||"—")}</b> (${money(cheapest?.value||0)}). Premium: <b>${escapeHtml(expensive?.label||"—")}</b> (${money(expensive?.value||0)}). <br><em>Decisión:</em> paquetizar económico con premium.`},
            {title:"📍 Concentración geográfica", desc: `<b>${escapeHtml(topCity?.label||"—")}</b> concentra ${locShare}% (${money(topCity?.value||0)}).<br><em>Decisión:</em> replicar estrategia en ciudades bajo el promedio (${money(total/(new Set(rows.map(r=>r.location)).size||1))}).`},
            {title:"📦 Riesgo quiebre", desc: `<b>${escapeHtml(topProd?.label||"—")}</b> top ${num(topProd?.value||0)} u. Menos: <b>${escapeHtml(lowStock?.label||"—")}</b> (${num(lowStock?.value||0)} u.).<br><em>Decisión:</em> +20% stock top, pack para low-stock.`},
            {title:"📈 Estacionalidad", desc: `Mejor mes <b>${escapeHtml(bestMonth)}</b> (${money(monthlyVals[maxIdx]||0)}). Proyección <b>${escapeHtml(projection)}</b>.<br><em>Decisión:</em> inventario +15% y campaña 2 semanas antes.`},
            {title:"💲 Sensibilidad precio", desc: `Rango frec.: <b>${[...histPrice].sort((a,b)=>b.value-a.value)[0]?.label||"—"}</b>. Prom <b>${money(avgP)}</b>.<br><em>Decisión:</em> &gt;S/1500 cuotas; &lt;S/100 push volumen.`},
            {title:"🧪 Estudio sólido", desc: `Recorte: <b>${num(rows.length)}</b> de ${num(state.rows.length)} (${((rows.length/(state.rows.length||1))*100).toFixed(1)}%). Filtros: ${document.getElementById("fDateFrom")?.value||'—'}→${document.getElementById("fDateTo")?.value||'—'}, ${(document.getElementById("fQuarter")?.value||'all')==='all'?'todos los trimestres':'Q'+document.getElementById("fQuarter").value}.<br><em>Decisión:</em> usar para pricing y reposición.`},
          ];
          insights.innerHTML=cards.map(c=>`<article><h5>${c.title}</h5><p>${c.desc}</p></article>`).join("");
        }
      });
      setTimeout(bindTableSelection,0);
    } finally {
      if(myId===state.panelRenderId) setPanelLoading(false);
    }
  });
}
let panelDebounce=null, globalDebounce=null;
function schedulePanel(){
  renderActiveChips();
  if(panelDebounce) clearTimeout(panelDebounce);
  panelDebounce=setTimeout(()=>{ updatePanel(); },220);
}
function scheduleGlobal(){
  if(globalDebounce) clearTimeout(globalDebounce);
  globalDebounce=setTimeout(()=>{ update(); },300);
}
function update(){
  // Global (filtros superiores + navegación). Llama al panel SIN debounce extra.
  const myId=++state.globalRenderId;
  if(state.isGlobalRendering && false) return;
  const rows=getPanelFilteredRows();
  state.filtered=rows;
  if(!state.rows.length){ updatePanel(); return; }
  if(!rows.length){
    set("totalSales",money(0));set("transactions","0");set("productsSold","0");
    set("topProduct","—");set("topProductShare","—");
    set("topLocation","—");set("topLocationShare","—");
    destroyCharts();
    renderTables([],[],[],[]);
    renderAnalysis([],[],[],[]);
    updatePanel();
    return;
  }
  if(myId!==state.globalRenderId) return;
  const total=rows.reduce((s,r)=>s+r.amount,0), qty=rows.reduce((s,r)=>s+r.quantity,0);
  const products=group(rows,"product","quantity"),locs=group(rows,"location","amount");
  const cats=group(rows,"category","amount");
  set("totalSales",money(total));set("transactions",num(rows.length));set("productsSold",num(Math.round(qty)));
  set("topProduct",products[0]?.label||"—");set("topProductShare",products[0]?((products[0].value/(qty||1))*100).toFixed(1)+"% de unidades":"—");
  set("topLocation",locs[0]?.label||"—");set("topLocationShare",locs[0]?((locs[0].value/(total||1))*100).toFixed(1)+"% de ventas":"—");
  // Solo re-renderiza gráficos globales si su sección está visible (ahorra CPU y evita "reinicios")
  const visibleSection=document.querySelector(".section.active-section")?.id||"panel";
  destroyCharts();
  try{
    const monthly=Array.from({length:12},(_,i)=>({label:months[i],value:0}));
    rows.forEach(r=>monthly[r.date.getMonth()].value+=r.amount);
    const top=products.slice(0,10), bottom=[...products].reverse().slice(0,10);
    const l=locs, cq=group(rows,"category","quantity");
    if(visibleSection==="inicio"||visibleSection==="panel"){
      makeChart("monthlyChart","line",monthly.map(x=>x.label),monthly.map(x=>x.value),"Ventas (S/)");
      makeChart("categoryChart","bar",cats.map(x=>x.label),cats.map(x=>x.value),"Ventas (S/)");
      makeChart("topProductsChart","bar",top.map(x=>x.label),top.map(x=>x.value),"Unidades",{indexAxis:"y"});
      makeChart("bottomProductsChart","bar",bottom.map(x=>x.label),bottom.map(x=>x.value),"Unidades",{indexAxis:"y"});
      makeChart("locationChart","bar",l.map(x=>x.label),l.map(x=>x.value),"Ventas (S/)");
      makeChart("categoryQuantityChart","doughnut",cq.map(x=>x.label),cq.map(x=>x.value),"Unidades");
      makeChart("locationCompareChart","bar",l.map(x=>x.label),l.map(x=>x.value),"Ventas (S/)");
      makeChart("evolutionChart","line",monthly.map(x=>x.label),monthly.map(x=>x.value),"Ventas (S/)");
    }
  }catch(e){console.warn("charts globales omitidos",e?.message)}
  renderTables(rows,cats,products,locs);
  renderAnalysis(rows,products,cats,locs);
  updatePanel();
  refreshMrDatasetInfo();
  // Si el usuario está en MapReduce y ya ejecutó una operación, re-ejecuta con los nuevos filtros
  if(visibleSection==="mapreduce"&&state.lastMR){ try{runMapReduce({auto:true})}catch(e){console.warn("mr auto omitido",e?.message)} }
}
function bindRangeSync(){
 const pairs=[["fPriceMin","fPriceMinNum"],["fPriceMax","fPriceMaxNum"],["fQtyMin","fQtyMinNum"],["fQtyMax","fQtyMaxNum"],["fAmountMin","fAmountMinNum"],["fAmountMax","fAmountMaxNum"]];
 pairs.forEach(([range,numId])=>{
   const r=document.getElementById(range), n=document.getElementById(numId);
   if(!r||!n) return;
   r.addEventListener("input",()=>{r.dataset.touched="1"; n.dataset.touched="1"; n.value=r.value; syncRangeLabels(); schedulePanel();});
   n.addEventListener("input",()=>{n.dataset.touched="1"; r.dataset.touched="1"; r.value=n.value; syncRangeLabels(); schedulePanel();});
 });
 document.getElementById("fPriceMin")?.addEventListener("input",e=>{const max=document.getElementById("fPriceMax"); if(Number(e.target.value)>Number(max.value)) max.value=e.target.value; const nm=document.getElementById("fPriceMaxNum"); if(nm) nm.value=max.value;});
 document.getElementById("fPriceMax")?.addEventListener("input",e=>{const min=document.getElementById("fPriceMin"); if(Number(e.target.value)<Number(min.value)) min.value=e.target.value; const nm=document.getElementById("fPriceMinNum"); if(nm) nm.value=min.value;});
}
function initPanelEvents(){
 ["fText","fCategory","fCity","fProduct","fMonth","fYear","fQuarter","fWeekday","fSort","fTopN","fRankMode","fMetric","trendMode","geoMode","fDateFrom","fDateTo"].forEach(id=>{
   const el=document.getElementById(id);
   if(el) el.addEventListener(el.tagName==="INPUT"?"input":"change", (e)=>{e.preventDefault?.(); schedulePanel();});
 });
 document.getElementById("resetFilters")?.addEventListener("click",(e)=>{
   e.preventDefault();
   ["fText","fDateFrom","fDateTo"].forEach(id=>{const el=document.getElementById(id); if(el) el.value="";});
   ["fCategory","fCity","fProduct","fMonth","fYear","fQuarter","fWeekday"].forEach(id=>{const el=document.getElementById(id); if(el) el.value="all";});
   const fs=document.getElementById("fSort"); if(fs) fs.value="mas_ventas";
   const tn=document.getElementById("fTopN"); if(tn) tn.value="10";
   const rm=document.getElementById("fRankMode"); if(rm) rm.value="mas";
   const fm=document.getElementById("fMetric"); if(fm) fm.value="ventas";
   state.selection={product:null,category:null,location:null,month:null};
   document.querySelectorAll('[data-touched]').forEach(el=>delete el.dataset.touched);
   populateFilters();
   schedulePanel();
   toast("↺ Filtros detallados limpiados (solo cuadros recargados).");
 });
 document.getElementById("exportPanelCSV")?.addEventListener("click",(e)=>{
   e.preventDefault();
   const rows=state.lastPanelRows;
   if(!rows.length){alert("No hay datos filtrados para exportar.");return;}
   const csv="Fecha,Producto,Categoria,Cantidad,PrecioUnitario,Ventas,Ciudad\n"+rows.map(r=>[r.date.toISOString().slice(0,10),r.product,r.category,r.quantity,r.price.toFixed(2),r.amount.toFixed(2),r.location].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
   const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`datastore_panel_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
 });
 const liveToggle=document.getElementById("liveToggle");
 if(liveToggle){
   liveToggle.addEventListener("change",e=>{
     const on=e.target.checked;
     const dot=document.getElementById("liveDot"), lab=document.getElementById("liveLabel");
     if(on){
       dot.classList.add("on"); lab.textContent="Tiempo real: ON";
       state.liveTimer=setInterval(()=>{
         if(document.hidden) return; // no trabajar en pestaña oculta (evita colapso)
         if(!state.rows.length) return;
         const sample=state.rows[Math.floor(Math.random()*state.rows.length)];
         const jitterPrice= sample.price * (0.9 + Math.random()*0.2);
         const jitterQty= Math.max(1, Math.round(sample.quantity * (0.7 + Math.random()*0.6)));
         const newRow={...sample, date:new Date(), quantity:jitterQty, price:jitterPrice, amount:jitterQty*jitterPrice};
         state.rows.unshift(newRow);
         if(state.rows.length>22000) state.rows.pop();
         scheduleGlobal();
       },2500);
     }else{
       dot.classList.remove("on"); lab.textContent="Tiempo real: OFF";
       if(state.liveTimer) {clearInterval(state.liveTimer); state.liveTimer=null;}
     }
   });
 }
}
// ===== HERRAMIENTAS DE CUADROS: Solo / Ampliar / Contraer =====
function bindCuadroTools(){
  document.querySelectorAll(".panel-card .icon-btn").forEach(btn=>{
    if(btn.dataset.bound) return; btn.dataset.bound="1";
    btn.addEventListener("click",(e)=>{
      e.preventDefault(); e.stopPropagation();
      const card=btn.closest(".panel-card");
      const action=btn.dataset.action;
      if(action==="collapse"){ card.classList.toggle("collapsed"); }
      if(action==="solo"){
        const grid=document.getElementById("panelGrid");
        const isSolo=!card.classList.contains("solo-hidden") && [...grid.querySelectorAll(".panel-card")].some(c=>c!==card&&c.classList.contains("solo-hidden")) ? false : true;
        // si ya está en modo solo para este, salir; si no, entrar
        const others=[...grid.querySelectorAll(".panel-card")].filter(c=>c!==card);
        const inSolo=others.some(c=>c.classList.contains("solo-hidden"));
        if(inSolo){ others.forEach(c=>c.classList.remove("solo-hidden")); document.getElementById("showAllCuadros").hidden=true; }
        else{ others.forEach(c=>c.classList.add("solo-hidden")); document.getElementById("showAllCuadros").hidden=false; card.scrollIntoView({behavior:"smooth",block:"start"}); toast("👁 Viendo solo: "+(card.dataset.cuadro||"cuadro")); }
        setTimeout(()=>{Object.values(state.panelCharts).forEach(c=>{try{c.resize()}catch{}})},80);
      }
      if(action==="expand"){ openCuadroModal(card); }
    });
  });
  document.getElementById("showAllCuadros")?.addEventListener("click",()=>{
    document.querySelectorAll(".panel-card.solo-hidden").forEach(c=>c.classList.remove("solo-hidden"));
    document.getElementById("showAllCuadros").hidden=true;
  });
  document.getElementById("cuadroModalClose")?.addEventListener("click",closeCuadroModal);
  document.getElementById("cuadroModal")?.addEventListener("click",(e)=>{ if(e.target.id==="cuadroModal") closeCuadroModal(); });
  document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") closeCuadroModal(); });
}
let modalPlaceholder=null, modalCard=null;
function openCuadroModal(card){
  const modal=document.getElementById("cuadroModal"), body=document.getElementById("cuadroModalBody"), title=document.getElementById("cuadroModalTitle");
  if(!modal||!body) return;
  closeCuadroModal(true);
  title.textContent=card.dataset.cuadro||"Cuadro";
  modalPlaceholder=document.createComment("cuadro-placeholder");
  card.parentNode.insertBefore(modalPlaceholder,card);
  modalCard=card;
  body.appendChild(card);
  card.classList.remove("solo-hidden");
  modal.hidden=false;
  document.body.style.overflow="hidden";
  setTimeout(()=>{Object.values(state.panelCharts).forEach(c=>{try{c.resize()}catch{}})},80);
}
function closeCuadroModal(silent){
  const modal=document.getElementById("cuadroModal"), body=document.getElementById("cuadroModalBody");
  if(!modal||modal.hidden) return;
  if(modalCard && modalPlaceholder && modalPlaceholder.parentNode){
    modalPlaceholder.parentNode.insertBefore(modalCard,modalPlaceholder);
    modalPlaceholder.remove();
  } else if(modalCard && body.contains(modalCard)){
    document.getElementById("panelGrid")?.appendChild(modalCard);
  }
  modalCard=null; modalPlaceholder=null;
  modal.hidden=true;
  document.body.style.overflow="";
  if(!silent) setTimeout(()=>{Object.values(state.panelCharts).forEach(c=>{try{c.resize()}catch{}})},80);
}
// ===== TABLAS Y UPDATE =====
function table(headers,rows,type){
 const t= type||null;
 return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>{
   const label=r[0];
   const isSelected = t && state.selection[t]===String(label);
   const cls = t ? `selectable ${isSelected?'selected':''}` : '';
   const dataAttr = t ? `data-type="${t}" data-value="${escapeHtml(label)}"` : '';
   return `<tr class="${cls}" ${dataAttr}>${r.map((x,i)=>`<td>${i===0 && t ? `${escapeHtml(x)} ${isSelected?'●':''}` : x}</td>`).join("")}</tr>`;
 }).join("")}</tbody></table></div>`;
}
function renderTables(rows,cat,products,locs){
 const total=rows.reduce((s,r)=>s+r.amount,0);
 const el1=document.getElementById("summaryTable"); if(el1) el1.innerHTML=table(["Indicador","Resultado"],[
 ["Total de ventas",money(total)],["Transacciones",num(rows.length)],
 ["Productos vendidos",num(Math.round(rows.reduce((s,r)=>s+r.quantity,0)))],
 ["Promedio de venta",money(rows.length? total/rows.length:0)]
 ]);
 const el2=document.getElementById("topFiveTable"); if(el2) el2.innerHTML=table(["Producto","Unidades","%"],products.slice(0,5).map(x=>[escapeHtml(x.label),num(x.value),((x.value/(rows.reduce((s,r)=>s+r.quantity,0)||1))*100).toFixed(1)+"%"]), "product");
 const el3=document.getElementById("periodTable"); if(el3) {
   const periodoData=months.map((m,i)=>[m,money(rows.filter(r=>r.date.getMonth()===i).reduce((s,r)=>s+r.amount,0))]);
   el3.innerHTML=table(["Mes","Ventas"],periodoData, "month");
 }
 const el4=document.getElementById("categoryTable"); if(el4) el4.innerHTML=table(["Categoría","Ventas"],cat.map(x=>[escapeHtml(x.label),money(x.value)]), "category");
 const el5=document.getElementById("productsTopTable"); if(el5) el5.innerHTML=table(["Producto","Unidades"],products.slice(0,15).map(x=>[escapeHtml(x.label),num(x.value)]), "product");
 const el6=document.getElementById("productsBottomTable"); if(el6) el6.innerHTML=table(["Producto","Unidades"],[...products].reverse().slice(0,15).map(x=>[escapeHtml(x.label),num(x.value)]), "product");
 const el7=document.getElementById("locationsTable"); if(el7) el7.innerHTML=table(["Sede / Ciudad","Ventas"],locs.map(x=>[escapeHtml(x.label),money(x.value)]), "location");
 setTimeout(bindTableSelection,0);
}
function renderAnalysis(rows,products,cat,locs){
 const total=rows.reduce((s,r)=>s+r.amount,0);
  const monthlyTotals = Array.from({length:12}, (_,i) =>
    rows.filter(r => r.date.getMonth() === i).reduce((s,r) => s + r.amount, 0)
  );
  const maxVenta = monthlyTotals.length?Math.max(...monthlyTotals):0;
  const bestMonthIndex = monthlyTotals.indexOf(maxVenta);
  const bestMonth = (maxVenta > 0) ? months[bestMonthIndex] : "Sin datos";
  const cards=[
   ["Producto con mayor demanda",`${escapeHtml(products[0]?.label||"N/D")} concentra la mayor cantidad de unidades vendidas.`,`Es el producto con mayor demanda y presenta riesgo de desabastecimiento si no se controla su inventario.`,`Se recomienda revisar su stock y mantener seguimiento de la demanda.`],
   ["Categoría líder",`${escapeHtml(cat[0]?.label||"N/D")} registra las mayores ventas monetarias (${money(cat[0]?.value||0)}).`,`La categoría concentra el mayor valor comercial y tiene un impacto importante en los ingresos.`,`Conviene priorizar inventario y acciones comerciales para esta categoría.`],
   ["Período de mayor venta",`${escapeHtml(bestMonth)} presenta el mayor nivel de ventas dentro de los datos filtrados.`,`El comportamiento observado permite anticipar períodos de alta demanda.`,`La empresa puede preparar inventario y campañas antes de los períodos de alta demanda.`],
   ["Sede líder",`${escapeHtml(locs[0]?.label||"N/D")} concentra la mayor facturación (${money(locs[0]?.value||0)}).`,`La sede puede servir como referencia para comparar prácticas comerciales y operativas.`,`Analizar sus buenas prácticas y compararlas con sedes de menor rendimiento.`],
   ["Resultado general",`El conjunto analizado representa ${money(total)} en ventas.`,`Este valor resume el rendimiento del período seleccionado y permite establecer una línea base.`,`Utilizar este resultado como línea base para comparar períodos futuros.`]
  ];
 const el=document.getElementById("analysisCards"); if(el) el.innerHTML=cards.map((c,i)=>`<article class="insight"><h3>Análisis ${i+1}: ${c[0]}</h3><p><b>Resultado:</b> ${c[1]}</p><p><b>Interpretación:</b> ${c[2]}</p><p><b>Decisión propuesta:</b> ${c[3]}</p></article>`).join("");
}
/* ================= REPORTES CON CUADROS (mantiene actual + 5 nuevos) ================= */
function reportRows(){
 const year=document.getElementById("reportYearFilter")?.value||"all";
 const month=document.getElementById("reportMonthFilter")?.value||"all";
 const location=document.getElementById("reportLocationFilter")?.value||"all";
 return state.rows.filter(row=>(year==="all"||row.date.getFullYear()==year)&&(month==="all"||row.date.getMonth()+1==month)&&(location==="all"||row.location===location));
}
function reportMetaLine(){
  const y=document.getElementById("reportYearFilter")?.value||"all";
  const m=document.getElementById("reportMonthFilter")?.value||"all";
  const l=document.getElementById("reportLocationFilter")?.value||"all";
  const t=document.getElementById("reportType")?.value||"ejecutivo";
  const mName=m==="all"?"Todos los meses":months[Number(m)-1];
  return {y,mName,l,t};
}
function linearProjection(monthly){
  const observed=monthly.filter(item=>item.value>0);
  if(observed.length<2) return {next:[],slope:0};
  const xMean=(observed.length-1)/2,yMean=observed.reduce((sum,item)=>sum+item.value,0)/observed.length;
  const slope=observed.reduce((sum,item,index)=>sum+(index-xMean)*(item.value-yMean),0)/(observed.reduce((sum,item,index)=>sum+(index-xMean)**2,0)||1);
  const nextMonths=[1,2,3].map(offset=>{const index=observed.length-1+offset;return {label:`Mes +${offset}`,value:Math.max(0,yMean+slope*(index-xMean))}});
  return {next:nextMonths,slope};
}
function reportHtml(rows){
 const type=document.getElementById("reportType")?.value||"ejecutivo";
 const total=rows.reduce((sum,row)=>sum+row.amount,0),quantity=rows.reduce((sum,row)=>sum+row.quantity,0);
 const products=group(rows,"product","quantity"), productsSales=group(rows,"product","amount");
 const categories=group(rows,"category","amount"), locations=group(rows,"location","amount");
 const monthly=Array.from({length:12},(_,index)=>({label:months[index],value:0}));rows.forEach(row=>monthly[row.date.getMonth()].value+=row.amount);
 const {next}=linearProjection(monthly);
 const meta=reportMetaLine();
 const typeName={ejecutivo:"⭐ Reporte Ejecutivo",completo:"📊 Reporte Completo",periodo:"📅 Ventas por Período",categoria:"🗂️ Reporte por Categoría",geografico:"📍 Reporte Geográfico",productos:"📦 Productos Críticos"}[type];
 const avgTicket=rows.length?total/rows.length:0;
 const avgPrice=rows.length?rows.reduce((s,r)=>s+r.price,0)/rows.length:0;
 const header=`<div class="report-header" style="background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;border-radius:12px;padding:16px;margin-bottom:12px">
   <h2 style="margin:0 0 6px;font-size:18px">📊 DATASTORE S.A.C. — ${typeName}</h2>
   <div class="rep-meta" style="color:#E0E7FF;margin:0"><span>📅 <b style="color:#fff">${new Date().toLocaleString("es-PE")}</b></span><span>· 🗂️ <b style="color:#fff">${num(rows.length)}</b> registros</span><span>· 💰 <b style="color:#fff">${money(total)}</b></span><span>· Filtros: ${meta.y} · ${escapeHtml(meta.mName)} · ${escapeHtml(meta.l)}</span></div></div>`;
 const kpis=`<div class="rep-kpis">
   <div class="rep-kpi blue"><small>Total ventas</small><strong>${money(total)}</strong><span>${num(rows.length)} transacciones</span></div>
   <div class="rep-kpi green"><small>Unidades</small><strong>${num(Math.round(quantity))}</strong><span>Ticket ${money(avgTicket)}</span></div>
   <div class="rep-kpi violet"><small>Precio prom.</small><strong>${money(avgPrice)}</strong><span>${categories.length} categorías</span></div>
   <div class="rep-kpi amber"><small>Cobertura</small><strong>${locations.length} sedes</strong><span>Líder: ${escapeHtml(locations[0]?.label||"—")}</span></div>
 </div>`;
 const boxResumen=`<div class="rep-box blue"><h4><i></i>📌 Principales resultados</h4>${table(["Indicador","Resultado"],[["Producto más vendido",escapeHtml(products[0]?.label||"N/D")],["Categoría líder",escapeHtml(categories[0]?.label||"N/D")],["Sede líder",escapeHtml(locations[0]?.label||"N/D")],["Ticket promedio",money(avgTicket)]])}</div>`;
 const boxCiudades=`<div class="rep-box green"><h4><i></i>📍 Comparación de ciudades</h4>${table(["Puesto","Ciudad / sede","Ventas","%"],locations.map((city,index)=>[index+1,escapeHtml(city.label),money(city.value),`${((city.value/(total||1))*100).toFixed(1)}%`]))}</div>`;
 const boxProy=`<div class="rep-box violet"><h4><i></i>🔮 Proyección empresarial</h4><p class="rep-note" style="margin:0 0 8px">Tendencia lineal de ventas mensuales. Referencia para inventario, metas y presupuesto; no reemplaza un pronóstico financiero.</p>${table(["Período proyectado","Ventas estimadas"],next.map(item=>[item.label,money(item.value)]))}</div>`;
 const boxInterp=`<div class="rep-box amber full"><h4><i></i>🧠 Interpretación y decisión</h4><p class="rep-note"><b>${escapeHtml(products[0]?.label||"El conjunto seleccionado")}</b> concentra la mayor demanda y <b>${escapeHtml(locations[0]?.label||"la sede líder")}</b> encabeza la facturación (${money(locations[0]?.value||0)}). Se recomienda priorizar stock del top, comparar el desempeño de todas las ciudades y preparar recursos según la tendencia proyectada (${money(next[0]?.value||0)}).</p></div>`;
 if(type==="periodo"){
   return header+kpis+`<div class="rep-grid"><div class="rep-box blue full"><h4><i></i>📅 Ventas por mes</h4>${table(["Mes","Ventas","%"],monthly.map(m=>[m.label,money(m.value),`${((m.value/(total||1))*100).toFixed(1)}%`]))}</div>${boxProy}${boxInterp}</div>`;
 }
 if(type==="categoria"){
   const cq=group(rows,"category","quantity");
   return header+kpis+`<div class="rep-grid"><div class="rep-box violet"><h4><i></i>🗂️ Ventas por categoría (S/)</h4>${table(["Categoría","Ventas","%"],categories.map(c=>[escapeHtml(c.label),money(c.value),`${((c.value/(total||1))*100).toFixed(1)}%`]))}</div><div class="rep-box cyan"><h4><i></i>📦 Unidades por categoría</h4>${table(["Categoría","Unidades"],cq.map(c=>[escapeHtml(c.label),num(Math.round(c.value))]))}</div>${boxInterp}</div>`;
 }
 if(type==="geografico"){
   return header+kpis+`<div class="rep-grid"><div class="rep-box green full"><h4><i></i>📍 Ranking de sedes</h4>${table(["Puesto","Ciudad / sede","Ventas","Participación"],locations.map((city,index)=>[index+1,escapeHtml(city.label),money(city.value),`${((city.value/(total||1))*100).toFixed(1)}%`]))}</div><div class="rep-box amber"><h4><i></i>🎯 Brecha vs líder</h4>${table(["Sede","Brecha (S/)"],locations.slice(1,6).map(c=>[escapeHtml(c.label),money((locations[0]?.value||0)-c.value)]))}</div><div class="rep-box blue"><h4><i></i>💡 Decisión territorial</h4><p class="rep-note">Replicar la estrategia de <b>${escapeHtml(locations[0]?.label||"—")}</b> en las 2 sedes más débiles y medir en 30 días.</p></div></div>`;
 }
 if(type==="productos"){
   const worst=[...products].reverse().slice(0,10);
   return header+kpis+`<div class="rep-grid"><div class="rep-box amber"><h4><i></i>🏆 Top 10 por unidades</h4>${table(["#","Producto","Unidades","%"],products.slice(0,10).map((p,i)=>[i+1,escapeHtml(p.label),num(Math.round(p.value)),`${((p.value/(quantity||1))*100).toFixed(1)}%`]))}</div><div class="rep-box rose"><h4><i></i>📉 Cola: menos vendidos</h4>${table(["#","Producto","Unidades"],worst.map((p,i)=>[i+1,escapeHtml(p.label),num(Math.round(p.value))]))}</div><div class="rep-box violet"><h4><i></i>💰 Top 10 por ventas (S/)</h4>${table(["#","Producto","Ventas"],productsSales.slice(0,10).map((p,i)=>[i+1,escapeHtml(p.label),money(p.value)]))}</div><div class="rep-box green"><h4><i></i>✅ Decisión de surtido</h4><p class="rep-note">+20% stock al Top3, pack/2x1 a la cola y revisión quincenal de quiebres.</p></div></div>`;
 }
 if(type==="completo"){
   const worst=[...products].reverse().slice(0,8);
   return header+kpis+`<div class="rep-grid">${boxResumen}${boxCiudades}<div class="rep-box cyan"><h4><i></i>📅 Detalle mensual</h4>${table(["Mes","Ventas"],monthly.map(m=>[m.label,money(m.value)]))}</div>${boxProy}<div class="rep-box violet"><h4><i></i>🗂️ Categorías</h4>${table(["Categoría","Ventas"],categories.slice(0,8).map(c=>[escapeHtml(c.label),money(c.value)]))}</div><div class="rep-box amber"><h4><i></i>📦 Top / cola productos</h4>${table(["Producto","Unidades"],products.slice(0,6).map(p=>[escapeHtml(p.label),num(Math.round(p.value))]))}</div>${boxInterp}</div>`;
 }
 // ejecutivo (por defecto, mantiene lo actual pero con cuadros y colores)
 return header+kpis+`<div class="rep-grid">${boxResumen}${boxCiudades}${boxProy}<div class="rep-box cyan"><h4><i></i>📅 Pulso mensual</h4>${table(["Mes","Ventas"],monthly.filter(m=>m.value>0).slice(0,6).map(m=>[m.label,money(m.value)]))}</div>${boxInterp}</div>`;
}
function generateReport(){
 const rows=reportRows(),container=document.getElementById("reportContent");
 if(!state.rows.length){container.innerHTML='<p class="empty">Carga un CSV primero (o usa “Cargar demo”).</p>';return}
 if(!rows.length){container.innerHTML='<p class="empty">No hay datos para los filtros seleccionados. Amplía año/mes/ciudad.</p>';return}
 container.innerHTML=reportHtml(rows);
 setTimeout(bindTableSelection,0);
}
/* ---- Exportación con diseño (cuadros + más datos) ---- */
function standaloneCss(){
  return `*{box-sizing:border-box}body{font-family:Inter,Segoe UI,Arial,sans-serif;background:#F1F5F9;color:#0F172A;margin:0;padding:24px}.sheet{max-width:980px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)}.cover{background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;padding:26px 28px}.cover h1{margin:0 0 6px;font-size:22px}.cover p{margin:2px 0;font-size:12px;color:#E0E7FF}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:16px 20px 0}.kpi{border-radius:12px;padding:12px;color:#fff}.kpi small{display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;opacity:.85}.kpi strong{display:block;font-size:18px;margin-top:4px}.kpi span{font-size:11px;opacity:.9}.b{background:linear-gradient(135deg,#2563EB,#1D4ED8)}.v{background:linear-gradient(135deg,#7C3AED,#5B21B6)}.g{background:linear-gradient(135deg,#059669,#047857)}.a{background:linear-gradient(135deg,#D97706,#B45309)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px 20px}.box{border:1px solid #E2E8F0;border-radius:12px;padding:12px;page-break-inside:avoid}.box.full{grid-column:span 2}.box h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;border-left:6px solid #2563EB;padding-left:8px}.box.green h3{border-color:#10B981}.box.violet h3{border-color:#7C3AED}.box.amber h3{border-color:#F59E0B}.box.rose h3{border-color:#EF4444}.box.cyan h3{border-color:#06B6D4}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#F1F5F9;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#64748B;text-align:left;padding:8px;border-bottom:1px solid #E2E8F0}td{padding:7px 8px;border-bottom:1px solid #F1F5F9}.note{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:10px;font-size:12px;line-height:1.55}.foot{padding:14px 20px;border-top:1px solid #E2E8F0;font-size:11px;color:#64748B;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}@media print{.grid{grid-template-columns:1fr 1fr}.kpis{grid-template-columns:repeat(4,1fr)}body{padding:0;background:#fff}.sheet{box-shadow:none;border-radius:0}}`;
}
function buildStandaloneReport(){
  const rows=reportRows();
  const type=document.getElementById("reportType")?.value||"ejecutivo";
  const meta=reportMetaLine();
  const total=rows.reduce((s,r)=>s+r.amount,0),qty=rows.reduce((s,r)=>s+r.quantity,0);
  const products=group(rows,"product","quantity"),productsSales=group(rows,"product","amount");
  const categories=group(rows,"category","amount"),locations=group(rows,"location","amount");
  const monthly=Array.from({length:12},(_,i)=>({label:months[i],value:0}));rows.forEach(r=>monthly[r.date.getMonth()].value+=r.amount);
  const {next}=linearProjection(monthly);
  const avgTicket=rows.length?total/rows.length:0;
  const avgPrice=rows.length?rows.reduce((s,r)=>s+r.price,0)/rows.length:0;
  const typeName={ejecutivo:"Reporte Ejecutivo",completo:"Reporte Completo",periodo:"Ventas por Período",categoria:"Reporte por Categoría",geografico:"Reporte Geográfico",productos:"Productos Críticos"}[type];
  const tbl=(heads,body)=>`<table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
  const cityBody=locations.map((c,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(c.label)}</td><td>S/ ${c.value.toFixed(2)}</td><td>${((c.value/(total||1))*100).toFixed(1)}%</td></tr>`).join("");
  const monthBody=monthly.map(m=>`<tr><td>${m.label}</td><td>S/ ${m.value.toFixed(2)}</td><td>${((m.value/(total||1))*100).toFixed(1)}%</td></tr>`).join("");
  const catBody=categories.map(c=>`<tr><td>${escapeHtml(c.label)}</td><td>S/ ${c.value.toFixed(2)}</td><td>${((c.value/(total||1))*100).toFixed(1)}%</td></tr>`).join("");
  const topBody=products.slice(0,10).map((p,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(p.label)}</td><td>${Math.round(p.value)}</td><td>${((p.value/(qty||1))*100).toFixed(1)}%</td></tr>`).join("");
  const worstBody=[...products].reverse().slice(0,10).map((p,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(p.label)}</td><td>${Math.round(p.value)}</td></tr>`).join("");
  const projBody=next.map(n=>`<tr><td>${n.label}</td><td>S/ ${n.value.toFixed(2)}</td></tr>`).join("");
  const detailBody=rows.slice(0,200).map(r=>`<tr><td>${r.date.toISOString().slice(0,10)}</td><td>${escapeHtml(r.product)}</td><td>${escapeHtml(r.category)}</td><td>${r.quantity}</td><td>S/ ${r.price.toFixed(2)}</td><td>S/ ${r.amount.toFixed(2)}</td><td>${escapeHtml(r.location)}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DATASTORE — ${typeName}</title><style>${standaloneCss()}</style></head><body>
  <div class="sheet">
    <div class="cover"><h1>📊 DATASTORE S.A.C. — ${typeName}</h1>
    <p>Generado: ${new Date().toLocaleString("es-PE")} · Registros: ${rows.length} · Ventas: S/ ${total.toFixed(2)} · Filtros: Año ${meta.y} · ${escapeHtml(meta.mName)} · ${escapeHtml(meta.l)}</p>
    <p>Ticket promedio S/ ${avgTicket.toFixed(2)} · Precio prom. S/ ${avgPrice.toFixed(2)} · Unidades ${Math.round(qty)} · Sedes ${locations.length} · Categorías ${categories.length}</p></div>
    <div class="kpis"><div class="kpi b"><small>Total ventas</small><strong>S/ ${total.toFixed(2)}</strong><span>${rows.length} transacciones</span></div>
    <div class="kpi g"><small>Unidades</small><strong>${Math.round(qty)}</strong><span>Ticket S/ ${avgTicket.toFixed(2)}</span></div>
    <div class="kpi v"><small>Top producto</small><strong>${escapeHtml(products[0]?.label||"—")}</strong><span>${products[0]?Math.round(products[0].value):0} u.</span></div>
    <div class="kpi a"><small>Sede líder</small><strong>${escapeHtml(locations[0]?.label||"—")}</strong><span>S/ ${(locations[0]?.value||0).toFixed(2)}</span></div></div>
    <div class="grid">
      <div class="box"><h3>📌 Resumen</h3>${tbl(["Indicador","Resultado"],`<tr><td>Producto top</td><td>${escapeHtml(products[0]?.label||"—")}</td></tr><tr><td>Categoría líder</td><td>${escapeHtml(categories[0]?.label||"—")}</td></tr><tr><td>Sede líder</td><td>${escapeHtml(locations[0]?.label||"—")}</td></tr><tr><td>Ticket prom.</td><td>S/ ${avgTicket.toFixed(2)}</td></tr>`)}</div>
      <div class="box violet"><h3>🔮 Proyección (3 meses)</h3>${tbl(["Período","Estimado"],projBody)}<p class="note">Tendencia lineal mensual. Usar para inventario y metas.</p></div>
      <div class="box green"><h3>📍 Sedes</h3>${tbl(["#","Ciudad","Ventas","%"],cityBody)}</div>
      <div class="box amber"><h3>🗂️ Categorías</h3>${tbl(["Categoría","Ventas","%"],catBody)}</div>
      <div class="box cyan"><h3>📅 Meses</h3>${tbl(["Mes","Ventas","%"],monthBody)}</div>
      <div class="box violet"><h3>🏆 Top productos</h3>${tbl(["#","Producto","U.","%"],topBody)}</div>
      <div class="box rose"><h3>📉 Cola de productos</h3>${tbl(["#","Producto","U."],worstBody)}</div>
      <div class="box blue"><h3>💰 Top por ventas</h3>${tbl(["#","Producto","Ventas"],productsSales.slice(0,8).map((p,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(p.label)}</td><td>S/ ${p.value.toFixed(2)}</td></tr>`).join(""))}</div>
      <div class="box full"><h3>🧠 Interpretación</h3><p class="note"><b>${escapeHtml(products[0]?.label||"—")}</b> lidera la demanda y <b>${escapeHtml(locations[0]?.label||"—")}</b> la facturación. Proteger stock del Top3, activar packs en la cola, replicar buenas prácticas de la sede líder y preparar inventario según la proyección (${next[0]?"S/ "+next[0].value.toFixed(2):"—"}).</p></div>
      <div class="box full"><h3>📋 Detalle (primeras ${Math.min(200,rows.length)} filas)</h3>${tbl(["Fecha","Producto","Categoría","Cant.","P.Unit","Ventas","Ciudad"],detailBody)}${rows.length>200?`<p class="note">Mostrando 200 de ${rows.length} (ver CSV completo).</p>`:""}</div>
    </div>
    <div class="foot"><span>DATASTORE S.A.C. · Dashboard Empresarial · MongoDB + HDFS</span><span>PIAD 625 · 2026 · Metodología: agregación por filtros + regresión lineal simple</span></div>
  </div></body></html>`;
}
function downloadReportFile(name,content,type){const blob=new Blob([content],{type});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),2000)}
const csvInput=document.getElementById("csvFile");
if(csvInput) csvInput.addEventListener("change",e=>{
 const file=e.target.files[0];if(!file)return;
 const reader=new FileReader();
 reader.onload=async()=>{try{const rows=parseCsv(reader.result);if(prepare(rows)){document.getElementById("fileStatus").textContent=file.name+" cargado ("+num(state.rows.length)+")";populateFilters();update();toast(`✅ ${num(state.rows.length)} registros cargados.`);const form=new FormData();form.append("file",file);try{const response=await fetch("/api/upload",{method:"POST",body:form,credentials:"same-origin"});if(response.ok){const j=await response.json();console.log('Mongo sync',j);} }catch{}}}catch(error){alert("Error leyendo CSV: "+error.message)}};
 reader.onerror=()=>alert("Error leyendo CSV");
 reader.readAsText(file,"UTF-8");
});
document.getElementById("applyFilters")?.addEventListener("click",(e)=>{e.preventDefault(); scheduleGlobal();});
document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>{
 document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));
 document.querySelectorAll(".section").forEach(x=>x.classList.remove("active-section"));
 btn.classList.add("active");document.getElementById(btn.dataset.section).classList.add("active-section");
 // Al cambiar de sección, re-renderiza solo lo visible (focalizado) para no congelar
 if(btn.dataset.section==="panel"){ updatePanel(); }
 else { scheduleGlobal(); }
}));
document.getElementById("generateReportBtn")?.addEventListener("click",(e)=>{e.preventDefault();generateReport();});
document.getElementById("reportType")?.addEventListener("change",()=>{ if(state.rows.length) generateReport(); });
["reportYearFilter","reportMonthFilter","reportLocationFilter"].forEach(id=>document.getElementById(id)?.addEventListener("change",()=>{ if(state.rows.length && document.getElementById("reportContent")?.querySelector(".rep-kpis")) generateReport(); }));
document.getElementById("clearReportBtn")?.addEventListener("click",(e)=>{e.preventDefault();document.getElementById("reportContent").innerHTML='<p class="empty">Reporte limpiado. Ajusta filtros y pulsa “Generar reporte”.</p>';toast("🧹 Reporte limpiado.");});
document.getElementById("clearDataBtn")?.addEventListener("click",(e)=>{e.preventDefault(); clearData();});
document.getElementById("downloadReportCSV")?.addEventListener("click",(e)=>{
 e.preventDefault();
 const rows=reportRows();if(!state.rows.length){alert("Carga el CSV primero.");return}
 if(!rows.length){alert("No hay datos para los filtros.");return}
 const csv="Fecha,Producto,Categoria,Cantidad,PrecioUnitario,Ventas,Sede\n"+rows.map(row=>[row.date.toISOString().slice(0,10),row.product,row.category,row.quantity,row.price.toFixed(2),row.amount.toFixed(2),row.location].map(value=>`"${String(value).replace(/"/g,'""')}"`).join(",")).join("\n");
 downloadReportFile("reporte_datastore.csv","\uFEFF"+csv,"text/csv;charset=utf-8");
});
document.getElementById("downloadReportHTML")?.addEventListener("click",(e)=>{
  e.preventDefault();
  if(!state.rows.length){alert("Carga el CSV primero.");return}
  if(!reportRows().length){alert("No hay datos para los filtros.");return}
  downloadReportFile("reporte_datastore.html",buildStandaloneReport(),"text/html;charset=utf-8");
  toast("📄 HTML exportado con cuadros y diseño.");
});
document.getElementById("downloadReportPDF")?.addEventListener("click",(e)=>{
  e.preventDefault();
  if(!state.rows.length){alert("Carga el CSV primero.");return}
  if(!reportRows().length){alert("No hay datos para los filtros.");return}
  generateReport();
  const html=buildStandaloneReport();
  const w=window.open("","_blank","width=1024,height=800");
  if(!w){ // fallback: imprime la vista actual solo-reporte
    window.print(); return;
  }
  w.document.open(); w.document.write(html); w.document.close();
  w.onload=()=>{ setTimeout(()=>{ w.focus(); w.print(); },400); };
});
document.getElementById("demoLoadBtn")?.addEventListener("click",async(e)=>{
 e?.preventDefault?.();
 try{
   let text=null;
   for(const path of ["ventas.csv","./ventas.csv","/ventas.csv","../ventas.csv","public/ventas.csv"]){
     try{const r=await fetch(path); if(r.ok){text=await r.text(); break;}}catch{}
   }
   if(!text) throw new Error("No se encontró ventas.csv - usa Cargar ventas.csv");
   const rows=parseCsv(text);
   if(prepare(rows)){
     document.getElementById("fileStatus").textContent=`demo cargado: ${num(state.rows.length)} registros`;
     populateFilters(); update(); toast(`✅ Demo: ${num(state.rows.length)} registros.`);
   }
 }catch(err){
   alert("No se pudo cargar demo: "+err.message+" — usa 'Cargar ventas.csv'");
 }
});
const landingView=document.getElementById("landingView");
const loginView=document.getElementById("loginView");
const dashboardView=document.getElementById("dashboardView");
const loginMessage=document.getElementById("loginMessage");
function showView(view){
 landingView.hidden=view!==landingView;
 loginView.hidden=view!==loginView;
 dashboardView.hidden=view!==dashboardView;
 window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll("[data-open-login]").forEach(button=>button.addEventListener("click",()=>{
 showView(loginView);document.getElementById("loginUser").focus();
}));
document.querySelector("[data-close-login]")?.addEventListener("click",()=>showView(landingView));
document.getElementById("loginForm")?.addEventListener("submit",async event=>{
 event.preventDefault();
 const user=document.getElementById("loginUser").value.trim();
 const password=document.getElementById("loginPassword").value;
 if(!user||!password){loginMessage.textContent="Completa tu usuario y contraseña.";return}
 loginMessage.textContent="Verificando acceso...";
 try{
  const response=await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({username:user,password})});
  const result=await response.json();
  if(!response.ok){loginMessage.textContent=result.error||"No se pudo iniciar sesión.";return}
  document.getElementById("sessionUser").textContent=`● ${result.user} · En línea`;
  loginMessage.textContent="";showView(dashboardView);
  try{
    const r=await fetch("/api/data",{credentials:"same-origin"});
    if(r.ok){ const j=await r.json(); }
  }catch{}
 }catch{loginMessage.textContent="No se pudo conectar con el backend (¿docker compose up?)."}
});
document.querySelectorAll("[data-demo-login]").forEach(button=>button.addEventListener("click",()=>{
 loginMessage.textContent="Tip: usa admin / Admin123* (seed Docker)";
}));
document.querySelector("[data-demo-register]")?.addEventListener("click",()=>{
 loginMessage.textContent="El registro se gestiona en el backend Docker: POST /register";
});
document.getElementById("logoutButton")?.addEventListener("click",async(e)=>{
 e?.preventDefault?.();
 await fetch("/logout",{method:"POST",credentials:"same-origin"}).catch(()=>{});
 await fetch("/api/logout",{method:"POST",credentials:"same-origin"}).catch(()=>{});
 flkStop(true);
 if(state.liveTimer){clearInterval(state.liveTimer);state.liveTimer=null;}
 const dot=document.getElementById("liveDot"); if(dot) dot.classList.remove("on");
 const lab=document.getElementById("liveLabel"); if(lab) lab.textContent="Tiempo real: OFF";
 const tog=document.getElementById("liveToggle"); if(tog) tog.checked=false;
 showView(landingView);
});
// auto-login check - sin bloquear si backend no responde (Docker)
fetch("/me",{credentials:"same-origin"}).then(async response=>{
 if(!response.ok) return;
 const result=await response.json();
 if(result.authenticated) {
   document.getElementById("sessionUser").textContent=`● ${result.user} · En línea`;
   showView(dashboardView);
 }
}).catch(()=>{});
fetch("/api/auth/me",{credentials:"same-origin"}).then(async r=>{
 if(r.ok){
   const j=await r.json();
   if(j.authenticated) {
     document.getElementById("sessionUser").textContent=`● ${j.user} · En línea`;
     showView(dashboardView);
   }
 }
}).catch(()=>{});
/* ================= MAPREDUCE (MAP → AGRUPACIÓN → REDUCE → RESULTADO) =================
   Motor didáctico que replica el pipeline Hadoop sobre las filas cargadas.
   El usuario manipula: operación, conjunto de datos, Top N y valor mínimo. */
const MR_OPS={
  ventas_producto:{label:"Total de ventas (S/) por producto",keyName:"Producto",valueName:"Ventas (S/)",kind:"sum_money",
    map:r=>({k:r.product,v:r.amount}),reduce:vals=>vals.reduce((a,b)=>a+b,0),fmt:v=>money(v),chart:"Ventas (S/)",
    mapCode:"map(fila) → emitir(fila.producto, fila.venta)",reduceCode:"reduce(clave, valores) → suma(valores)"},
  unidades_categoria:{label:"Total de unidades por categoría",keyName:"Categoría",valueName:"Unidades",kind:"sum_qty",
    map:r=>({k:r.category,v:r.quantity}),reduce:vals=>vals.reduce((a,b)=>a+b,0),fmt:v=>num(Math.round(v)),chart:"Unidades",
    mapCode:"map(fila) → emitir(fila.categoria, fila.cantidad)",reduceCode:"reduce(clave, valores) → suma(valores)"},
  ventas_ciudad:{label:"Total de ventas (S/) por ciudad / sede",keyName:"Ciudad / sede",valueName:"Ventas (S/)",kind:"sum_money",
    map:r=>({k:r.location,v:r.amount}),reduce:vals=>vals.reduce((a,b)=>a+b,0),fmt:v=>money(v),chart:"Ventas (S/)",
    mapCode:"map(fila) → emitir(fila.ciudad, fila.venta)",reduceCode:"reduce(clave, valores) → suma(valores)"},
  tickets_mes:{label:"N° de transacciones por mes",keyName:"Mes",valueName:"Transacciones",kind:"count",
    map:r=>({k:months[r.date.getMonth()],v:1}),reduce:vals=>vals.length,fmt:v=>num(v),chart:"Transacciones",
    mapCode:"map(fila) → emitir(nombre_mes(fila.fecha), 1)",reduceCode:"reduce(clave, valores) → conteo(valores)"},
  ticket_prom_categoria:{label:"Ticket promedio (S/) por categoría",keyName:"Categoría",valueName:"Ticket prom. (S/)",kind:"avg_money",
    map:r=>({k:r.category,v:r.amount}),reduce:vals=>vals.reduce((a,b)=>a+b,0)/vals.length,fmt:v=>money(v),chart:"Ticket prom. (S/)",
    mapCode:"map(fila) → emitir(fila.categoria, fila.venta)",reduceCode:"reduce(clave, valores) → suma(valores) / conteo(valores)"},
  precio_prom_producto:{label:"Precio unitario promedio (S/) por producto",keyName:"Producto",valueName:"Precio prom. (S/)",kind:"avg_money",
    map:r=>({k:r.product,v:r.price}),reduce:vals=>vals.reduce((a,b)=>a+b,0)/vals.length,fmt:v=>money(v),chart:"Precio prom. (S/)",
    mapCode:"map(fila) → emitir(fila.producto, fila.precio_unitario)",reduceCode:"reduce(clave, valores) → promedio(valores)"},
  ventas_mes:{label:"Total de ventas (S/) por mes",keyName:"Mes",valueName:"Ventas (S/)",kind:"sum_money",
    map:r=>({k:months[r.date.getMonth()],v:r.amount}),reduce:vals=>vals.reduce((a,b)=>a+b,0),fmt:v=>money(v),chart:"Ventas (S/)",
    mapCode:"map(fila) → emitir(nombre_mes(fila.fecha), fila.venta)",reduceCode:"reduce(clave, valores) → suma(valores)"},
  unidades_producto:{label:"Total de unidades por producto",keyName:"Producto",valueName:"Unidades",kind:"sum_qty",
    map:r=>({k:r.product,v:r.quantity}),reduce:vals=>vals.reduce((a,b)=>a+b,0),fmt:v=>num(Math.round(v)),chart:"Unidades",
    mapCode:"map(fila) → emitir(fila.producto, fila.cantidad)",reduceCode:"reduce(clave, valores) → suma(valores)"},
  ventas_categoria:{label:"Total de ventas (S/) por categoría",keyName:"Categoría",valueName:"Ventas (S/)",kind:"sum_money",
    map:r=>({k:r.category,v:r.amount}),reduce:vals=>vals.reduce((a,b)=>a+b,0),fmt:v=>money(v),chart:"Ventas (S/)",
    mapCode:"map(fila) → emitir(fila.categoria, fila.venta)",reduceCode:"reduce(clave, valores) → suma(valores)"},
  transacciones_ciudad:{label:"N° de transacciones por ciudad / sede",keyName:"Ciudad / sede",valueName:"Transacciones",kind:"count",
    map:r=>({k:r.location,v:1}),reduce:vals=>vals.length,fmt:v=>num(v),chart:"Transacciones",
    mapCode:"map(fila) → emitir(fila.ciudad, 1)",reduceCode:"reduce(clave, valores) → conteo(valores)"},
  ticket_prom_ciudad:{label:"Ticket promedio (S/) por ciudad / sede",keyName:"Ciudad / sede",valueName:"Ticket prom. (S/)",kind:"avg_money",
    map:r=>({k:r.location,v:r.amount}),reduce:vals=>vals.reduce((a,b)=>a+b,0)/vals.length,fmt:v=>money(v),chart:"Ticket prom. (S/)",
    mapCode:"map(fila) → emitir(fila.ciudad, fila.venta)",reduceCode:"reduce(clave, valores) → suma(valores) / conteo(valores)"},
  venta_max_producto:{label:"Venta máxima (S/) por producto",keyName:"Producto",valueName:"Venta máx. (S/)",kind:"max_money",
    map:r=>({k:r.product,v:r.amount}),reduce:vals=>Math.max(...vals),fmt:v=>money(v),chart:"Venta máx. (S/)",
    mapCode:"map(fila) → emitir(fila.producto, fila.venta)",reduceCode:"reduce(clave, valores) → máximo(valores)"}
};
/* Columnas/funciones equivalentes en Spark y Flink para cada operación */
const MR_ENGINE_META={
  ventas_producto:{key:"producto",val:"venta",agg:"SUM"},
  unidades_categoria:{key:"categoria",val:"cantidad",agg:"SUM"},
  ventas_ciudad:{key:"ciudad",val:"venta",agg:"SUM"},
  tickets_mes:{key:"mes",val:"*",agg:"COUNT"},
  ticket_prom_categoria:{key:"categoria",val:"venta",agg:"AVG"},
  precio_prom_producto:{key:"producto",val:"precio_unitario",agg:"AVG"},
  ventas_mes:{key:"mes",val:"venta",agg:"SUM"},
  unidades_producto:{key:"producto",val:"cantidad",agg:"SUM"},
  ventas_categoria:{key:"categoria",val:"venta",agg:"SUM"},
  transacciones_ciudad:{key:"ciudad",val:"*",agg:"COUNT"},
  ticket_prom_ciudad:{key:"ciudad",val:"venta",agg:"AVG"},
  venta_max_producto:{key:"producto",val:"venta",agg:"MAX"}
};
function showMrError(boxId,phase,err){
  const el=document.getElementById(boxId);
  if(el){ el.hidden=false; el.innerHTML=`<b>⚠️ Error en ${escapeHtml(phase)}:</b> ${escapeHtml(err?.message||err)} — revisa los filtros o recarga los datos.`; }
  console.warn("MR/"+phase,err);
}
function hideMrError(boxId){ const el=document.getElementById(boxId); if(el){ el.hidden=true; el.innerHTML=""; } }
/* Gráficos con registro propio: los update() globales NUNCA los destruyen */
function makeOwnChart(registry,id,labels,data,label,color){
  const ctx=document.getElementById(id);
  if(!ctx) throw new Error("canvas "+id+" no encontrado");
  if(registry[id]){try{registry[id].destroy()}catch{}}
  if(typeof Chart==="undefined") throw new Error("librería de gráficos no cargada (sin internet)");
  registry[id]=new Chart(ctx,{type:"bar",data:{labels,datasets:[{label,data,borderWidth:2,backgroundColor:color||["#14B8A6","#2563EB","#7C3AED","#F59E0B","#EC4899","#06B6D4","#10B981","#64748B","#EF4444","#A78BFA"],borderColor:"#0F766E"}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{beginAtZero:true}}}});
}
function cssBarsFallback(fallbackId,canvasId,rows,fmt){
  const fb=document.getElementById(fallbackId), cv=document.getElementById(canvasId);
  if(!fb) return;
  const max=Math.max(...rows.map(d=>d.value),0)||1;
  fb.hidden=false; if(cv) cv.style.display="none";
  fb.innerHTML=`<div class="css-bars">`+rows.map(d=>`<div class="css-bar-row"><span class="css-bar-label">${escapeHtml(d.label)}</span><span class="css-bar-track"><span class="css-bar-fill" style="width:${(d.value/max*100).toFixed(1)}%"></span></span><b>${fmt(d.value)}</b></div>`).join("")+`</div>`;
}
function hideCssFallback(fallbackId,canvasId){
  const fb=document.getElementById(fallbackId), cv=document.getElementById(canvasId);
  if(fb){ fb.hidden=true; fb.innerHTML=""; } if(cv) cv.style.display="";
}
/* Pipeline compartido MapReduce (lo usan MapReduce y el simulador Spark) */
function mrPipeline(op,input){
  const emitted=[]; const mapSample=[];
  for(const r of input){ const p=op.map(r); emitted.push(p); if(mapSample.length<8) mapSample.push(p); }
  const groups=new Map();
  for(const p of emitted){ if(!groups.has(p.k)) groups.set(p.k,[]); groups.get(p.k).push(p.v); }
  const reducedAll=[...groups.keys()].map(k=>({label:k,value:op.reduce(groups.get(k)),count:groups.get(k).length}));
  return {emitted,mapSample,groups,reducedAll};
}
function mrInputRows(){
  const scope=document.getElementById("mrDataset")?.value||"filtrados";
  return scope==="todos" ? [...state.rows] : getPanelFilteredRows();
}
function refreshMrDatasetInfo(){
  const el=document.getElementById("mrDatasetInfo");
  if(!el) return;
  if(!state.rows.length){ el.textContent="Sin datos — carga un CSV"; return; }
  const scope=document.getElementById("mrDataset")?.value||"filtrados";
  const n=scope==="todos"?state.rows.length:getPanelFilteredRows().length;
  el.textContent=`Entrada: ${scope==="todos"?"todos los registros":"filtros actuales del panel"} · ${num(n)} filas de ${num(state.rows.length)}`;
}
function runMapReduce(opts={}){
  if(!state.rows.length){ if(!opts.auto) alert("Carga un CSV primero (o usa “Cargar demo”)."); return; }
  const opKey=document.getElementById("mrOperation")?.value||"ventas_producto";
  const op=MR_OPS[opKey];
  const topN=Number(document.getElementById("mrTopN")?.value||10);
  const minVal=Number(document.getElementById("mrMinVal")?.value||0);
  const t0=performance.now();
  const input=mrInputRows();
  if(!input.length){ if(!opts.auto) alert("El recorte de datos actual está vacío. Ajusta los filtros del panel o usa “Todos los registros”."); return; }
  let pipe;
  try{ pipe=mrPipeline(op,input); }
  catch(e){ showMrError("mrError","MAP / AGRUPACIÓN",e); return; }
  const {emitted,mapSample,groups}=pipe;
  const groupKeys=[...groups.keys()];
  const firstKey=groupKeys[0];
  // 3) REDUCE
  let reducedAll=pipe.reducedAll;
  const grandTotal=reducedAll.reduce((s,x)=>s+x.value,0);
  const discarded=reducedAll.filter(x=>x.value<minVal).length;
  const reduced=reducedAll.filter(x=>x.value>=minVal).sort((a,b)=>b.value-a.value);
  const shown=topN>=50?reduced:reduced.slice(0,topN);
  const ms=Math.max(1,Math.round(performance.now()-t0));
  state.lastMR={opKey,op,shown,all:reduced,inputN:input.length,groupsN:groups.size,ms,minVal,grandTotal,discarded,
    dataset:document.getElementById("mrDataset")?.value||"filtrados"};
  // ---- render fases (cada fase protegida: un fallo no tumba a las demás) ----
  document.getElementById("mrEmpty").hidden=true;
  document.getElementById("mrResults").hidden=false;
  hideMrError("mrError");
  try{
    set("mrMapCode",op.mapCode);
    document.getElementById("mrMapStats").innerHTML=`<span class="stat">Filas leídas <b>${num(input.length)}</b></span><span class="stat">Pares emitidos <b>${num(emitted.length)}</b></span><span class="stat">Claves distintas <b>${num(groups.size)}</b></span>`;
    document.getElementById("mrMapSample").innerHTML=`<table><thead><tr><th>#</th><th>Clave emitida</th><th>Valor</th></tr></thead><tbody>${mapSample.map((p,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(p.k)}</td><td>${typeof p.v==="number"?num(Math.round(p.v*100)/100):escapeHtml(p.v)}</td></tr>`).join("")}</tbody></table><p class="empty" style="padding:4px">8 pares de ejemplo de ${num(emitted.length)} emitidos (uno por fila)</p>`;
  }catch(e){ showMrError("mrError","MAP",e); }
  try{
    const groupsByN=[...groups.entries()].map(([k,vals])=>({k,n:vals.length,sum:vals.reduce((a,b)=>a+(typeof b==="number"?b:0),0)})).sort((a,b)=>b.n-a.n);
    document.getElementById("mrGroupStats").innerHTML=`<span class="stat">Grupos <b>${num(groups.size)}</b></span><span class="stat">Grupo mayor <b>${escapeHtml(groupsByN[0]?.k||"—")}</b> (${num(groupsByN[0]?.n||0)})</span><span class="stat">Grupo menor <b>${escapeHtml(groupsByN[groupsByN.length-1]?.k||"—")}</b> (${num(groupsByN[groupsByN.length-1]?.n||0)})</span>`;
    const firstVals=(groups.get(firstKey)||[]).slice(0,3).map(v=>typeof v==="number"?(Math.round(v*100)/100):v).join(", ");
    document.getElementById("mrGroupSample").innerHTML=`<table><thead><tr><th>Grupo ejemplo</th><th>n</th><th>Valores…</th></tr></thead><tbody><tr><td>${escapeHtml(firstKey)}</td><td>${num((groups.get(firstKey)||[]).length)}</td><td>${escapeHtml(firstVals)}…</td></tr></tbody></table>`;
    document.getElementById("mrGroupTable").innerHTML=`<table><thead><tr><th>Grupo</th><th>n</th><th>Suma prev.</th><th>Prom. prev.</th></tr></thead><tbody>${groupsByN.slice(0,8).map(g=>`<tr><td>${escapeHtml(g.k)}</td><td>${num(g.n)}</td><td>${num(Math.round(g.sum*100)/100)}</td><td>${num(Math.round((g.sum/(g.n||1))*100)/100)}</td></tr>`).join("")}</tbody></table><p class="empty" style="padding:4px">Top 8 de ${num(groups.size)} grupos por cantidad de valores (vista previa antes de reducir)</p>`;
  }catch(e){ showMrError("mrError","AGRUPACIÓN",e); }
  try{
    set("mrReduceCode",op.reduceCode);
    document.getElementById("mrReduceStats").innerHTML=`<span class="stat">Claves reducidas <b>${num(reducedAll.length)}</b></span><span class="stat">Descartadas por mínimo <b>${num(discarded)}</b></span><span class="stat">En salida <b>${num(reduced.length)}</b></span><span class="stat">Tiempo <b>${ms} ms</b></span>`;
    document.getElementById("mrReduceTable").innerHTML=`<table><thead><tr><th>#</th><th>${escapeHtml(op.keyName)}</th><th>${escapeHtml(op.valueName)}</th><th>n</th></tr></thead><tbody>${reduced.slice(0,8).map((x,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(x.label)}</td><td><b>${op.fmt(x.value)}</b></td><td>${num(x.count)}</td></tr>`).join("")}</tbody></table><p class="empty" style="padding:4px">Top 8 agregados de ${num(reduced.length)} (ya con valor mínimo ≥ ${minVal})</p>`;
  }catch(e){ showMrError("mrError","REDUCE",e); }
  // Resultado: resumen + tabla PRIMERO (siempre se muestran), gráfico después con respaldo
  const top1=shown[0];
  const isSum=op.kind==="sum_money"||op.kind==="sum_qty"||op.kind==="count";
  try{
    const share=(isSum&&grandTotal&&top1)?` (${((top1.value/grandTotal)*100).toFixed(1)}% del total)`:"";
    const totalStat=isSum?`<span class="stat">Total <b>${op.fmt(grandTotal)}</b></span>`:(op.kind==="avg_money"?`<span class="stat">Rango <b>${op.fmt(reduced[reduced.length-1]?.value||0)} – ${op.fmt(reduced[0]?.value||0)}</b></span>`:`<span class="stat">Claves <b>${num(reduced.length)}</b></span>`);
    document.getElementById("mrSummary").innerHTML=`<span class="stat">Líder <b>${escapeHtml(top1?.label||"—")}</b> ${top1?op.fmt(top1.value)+share:""}</span>${totalStat}`;
    document.getElementById("mrInsight").innerHTML=mrInsightText(op,shown,grandTotal,input.length,minVal,discarded);
  }catch(e){ showMrError("mrError","RESULTADO",e); }
  try{
    document.getElementById("mrResultTable").innerHTML=`<table><thead><tr><th>#</th><th>${escapeHtml(op.keyName)}</th><th>${escapeHtml(op.valueName)}</th><th>n</th><th>%</th></tr></thead><tbody>${shown.map((x,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(x.label)}</td><td><b>${op.fmt(x.value)}</b></td><td>${num(x.count)}</td><td>${isSum&&grandTotal?((x.value/grandTotal)*100).toFixed(1)+"%":"—"}</td></tr>`).join("")||'<tr><td colspan="5">Sin resultados (sube el Top N o baja el valor mínimo).</td></tr>'}</tbody></table>`;
  }catch(e){ showMrError("mrError","tabla de resultados",e); return; }
  try{
    hideCssFallback("mrChartFallback","mrChart");
    makeOwnChart(state.mrCharts,"mrChart",shown.map(x=>x.label.length>16?x.label.slice(0,16)+"…":x.label),shown.map(x=>Math.round(x.value*100)/100),op.chart);
  }catch(e){
    cssBarsFallback("mrChartFallback","mrChart",shown,op.fmt);
    showMrError("mrError","gráfico (se muestra respaldo sin librería)",e);
  }
  refreshMrDatasetInfo();
  if(!opts.auto&&!opts.silent) toast(`✅ MapReduce: ${num(input.length)} filas → ${num(groups.size)} grupos → Top ${shown.length} (${ms} ms).`);
}
function mrInsightText(op,shown,grandTotal,inputN,minVal,discarded){
  if(!shown.length) return "Sin resultados con el valor mínimo actual. Baja el umbral o sube el Top N.";
  const top1=shown[0], top3=shown.slice(0,3);
  const isSum=op.kind==="sum_money"||op.kind==="sum_qty"||op.kind==="count";
  const unit=op.kind==="count"?"transacciones":(op.kind==="sum_qty"?"u.":(op.kind==="max_money"?"":""));
  let base="";
  if(isSum){
    const pct=grandTotal?((top1.value/grandTotal)*100).toFixed(1):"0.0";
    base=`<b>${escapeHtml(top1.label)}</b> lidera con <b>${op.fmt(top1.value)}</b> (${pct}% del total, ${num(top1.count)} registros de ${num(inputN)}).`;
  }else if(op.kind==="avg_money"){
    base=`Mayor promedio: <b>${escapeHtml(top1.label)}</b> (<b>${op.fmt(top1.value)}</b>, n=${num(top1.count)}). Ojo: promedios con <b>n</b> pequeño son menos confiables, revisa la columna n.`;
  }else{
    base=`Mayor registro individual: <b>${escapeHtml(top1.label)}</b> (<b>${op.fmt(top1.value)}</b> en una sola venta).`;
  }
  const tail=top3.length>1?` Le siguen <b>${escapeHtml(top3[1]?.label||"—")}</b> y <b>${escapeHtml(top3[2]?.label||"—")}</b>.`:"";
  const minNote=minVal>0?` El valor mínimo (${minVal}) descartó <b>${num(discarded)}</b> clave(s) menor(es).`:` Valor mínimo en 0: se muestran todas las claves (súbelo para quedarte solo con lo relevante).`;
  const dec=op.kind==="max_money"?" <span style='color:#059669'>Decisión:</span> usa el ticket máximo para fijar techos de descuento.":" <span style='color:#059669'>Decisión:</span> protege stock del líder y replica su estrategia.";
  return base+tail+minNote+dec;
}
function clearMapReduce(silent){
  state.lastMR=null;
  const r=document.getElementById("mrResults"); if(r) r.hidden=true;
  const e=document.getElementById("mrEmpty"); if(e) e.hidden=false;
  hideMrError("mrError");
  if(state.mrCharts["mrChart"]){try{state.mrCharts["mrChart"].destroy()}catch{} delete state.mrCharts["mrChart"];}
  hideCssFallback("mrChartFallback","mrChart");
  refreshMrDatasetInfo();
  if(!silent) toast("🧹 MapReduce limpiado.");
}
function initMapReduce(){
  document.getElementById("mrRunBtn")?.addEventListener("click",(e)=>{e.preventDefault(); runMapReduce();});
  document.getElementById("mrClearBtn")?.addEventListener("click",(e)=>{e.preventDefault(); clearMapReduce();});
  document.getElementById("mrDataset")?.addEventListener("change",()=>{ refreshMrDatasetInfo(); if(state.lastMR) runMapReduce({auto:true,silent:true}); });
  document.getElementById("mrOperation")?.addEventListener("change",()=>{ if(state.lastMR) runMapReduce({auto:true,silent:true}); });
  document.getElementById("mrTopN")?.addEventListener("change",()=>{ if(state.lastMR) runMapReduce({auto:true,silent:true}); });
  document.getElementById("mrMinVal")?.addEventListener("change",()=>{ if(state.lastMR) runMapReduce({auto:true,silent:true}); });
  document.getElementById("mrExportBtn")?.addEventListener("click",(e)=>{
    e.preventDefault();
    if(!state.lastMR||!state.lastMR.shown.length){alert("Ejecuta primero una operación MapReduce.");return;}
    const {op,shown}=state.lastMR;
    const csv=`Clave,${op.valueName},Conteo\n`+shown.map(x=>[x.label,typeof x.value==="number"?x.value.toFixed(2):x.value,x.count].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    downloadReportFile(`mapreduce_${state.lastMR.opKey}.csv`,"\uFEFF"+csv,"text/csv;charset=utf-8");
    toast("📥 Resultado MapReduce exportado.");
  });
}
/* ================= SIMULADOR SPARK (DAG por etapas + test real) ================= */
function spkInputRows(){
  const scope=document.getElementById("spkDataset")?.value||"filtrados";
  return scope==="todos" ? [...state.rows] : getPanelFilteredRows();
}
function spkCodeFor(opKey,op,topN){
  const m=MR_ENGINE_META[opKey]||{key:"clave",val:"valor",agg:"SUM"};
  const agg=m.agg==="COUNT"?`F.count("*")`:(m.agg==="AVG"?`F.avg("${m.val}")`:(m.agg==="MAX"?`F.max("${m.val}")`:`F.sum("${m.val}")`));
  return `# PySpark — ${op.label}\nfrom pyspark.sql import functions as F\n\ndf = spark.read.csv("ventas.csv", header=True, inferSchema=True)\nresultado = (df.groupBy("${m.key}")\n  .agg(${agg}.alias("total"))\n  .orderBy("total", ascending=False))\nresultado.show(${topN>=50?"resultado.count()":topN})  # Top ${topN>=50?"completo":topN}`;
}
/* Inspector de particiones: muestra cómo el shuffle reparte claves (hash % N) */
function spkPartitions(op,input,parts){
  const P=Array.from({length:parts},()=>({n:0,keys:new Map()}));
  for(const r of input){
    let k; try{ k=String(op.map(r).k); }catch{ continue; }
    let h=0; for(let i=0;i<k.length;i++){ h=((h*31)+k.charCodeAt(i))>>>0; }
    const p=P[h%parts]; p.n++; p.keys.set(k,(p.keys.get(k)||0)+1);
  }
  return P.map((p,i)=>{ let top="—",topN=0; p.keys.forEach((v,k)=>{ if(v>topN){ topN=v; top=k; } }); return {part:i,n:p.n,keys:p.keys.size,top,topN}; });
}
function spkCompareHtml(opKey,ms){
  const mr=(state.lastMR&&state.lastMR.opKey===opKey)?state.lastMR.ms:null;
  if(mr==null) return '<p class="empty" style="padding:6px">Ejecuta la misma operación en la pestaña MapReduce y vuelve: aquí se compararán los tiempos.</p>';
  const max=Math.max(mr,ms,1);
  const bar=(label,v,color)=>`<div class="css-bar-row"><span class="css-bar-label">${label}</span><span class="css-bar-track"><span class="css-bar-fill" style="width:${(v/max*100).toFixed(1)}%;background:${color}"></span></span><b>${v} ms</b></div>`;
  const faster=mr===ms?"empate":(ms<mr?"🔥 Spark":"🐘 MapReduce");
  return `<div class="css-bars">`+bar("🐘 MapReduce",mr,"linear-gradient(90deg,#EC4899,#9D174D)")+bar("🔥 Spark",ms,"linear-gradient(90deg,#F97316,#C2410C)")+`</div><p class="empty" style="padding:4px">Más rápido aquí: <b>${faster}</b> (misma máquina, 1 hilo; en clúster la brecha a favor de Spark crece por la memoria).</p>`;
}
function runSpark(){
  hideMrError("spkError");
  if(!state.rows.length){ alert("Carga un CSV primero (o usa “Cargar demo”)."); return; }
  const opKey=document.getElementById("spkOperation")?.value||"ventas_producto";
  const op=MR_OPS[opKey];
  if(!op){ showMrError("spkError","Spark",new Error("operación no válida")); return; }
  const topN=Number(document.getElementById("spkTopN")?.value||10);
  const t0=performance.now();
  const input=spkInputRows();
  if(!input.length){ alert("El recorte actual está vacío. Ajusta filtros o usa “Todos los registros”."); return; }
  let pipe;
  try{ pipe=mrPipeline(op,input); }catch(e){ showMrError("spkError","etapas",e); return; }
  const reduced=pipe.reducedAll.slice().sort((a,b)=>b.value-a.value);
  const shown=topN>=50?reduced:reduced.slice(0,topN);
  const ms=Math.max(1,Math.round(performance.now()-t0));
  const parts=Math.max(1,Math.ceil(input.length/5000));
  document.getElementById("spkEmpty").hidden=true;
  document.getElementById("spkResults").hidden=false;
  try{
    document.getElementById("spkStages").innerHTML=[
      {t:"Stage 0 · Lectura",d:`${num(parts)} particiones · ${num(input.length)} filas`},
      {t:"Stage 1 · Map + Combine",d:`${num(pipe.emitted.length)} pares → ${num(pipe.groups.size)} claves locales`},
      {t:"Stage 2 · Shuffle",d:`${num(pipe.groups.size)} grupos · ${num(input.length)} valores movidos`},
      {t:"Stage 3 · Reduce + show()",d:`${num(reduced.length)} resultados · ${ms} ms`}
    ].map((s)=>`<div class="dag-stage"><b>${s.t}</b><span>${s.d}</span></div>`).join('<span class="dag-arrow">→</span>');
    set("spkCode",spkCodeFor(opKey,op,topN));
    try{
      const grid=spkPartitions(op,input,parts);
      document.getElementById("spkParts").innerHTML=`<table><thead><tr><th>Partición</th><th>Filas</th><th>Claves</th><th>Clave top (n)</th></tr></thead><tbody>${grid.map(g=>`<tr><td>P${g.part}</td><td>${num(g.n)}</td><td>${num(g.keys)}</td><td>${escapeHtml(g.top)} (${num(g.topN)})</td></tr>`).join("")}</tbody></table><p class="empty" style="padding:4px">Reparto determinista: la misma clave siempre cae en la misma partición.</p>`;
    }catch(e){ document.getElementById("spkParts").innerHTML='<p class="empty">No se pudo inspeccionar particiones.</p>'; }
  }catch(e){ showMrError("spkError","etapas",e); }
  try{
    document.getElementById("spkTable").innerHTML=`<table><thead><tr><th>#</th><th>${escapeHtml(op.keyName)}</th><th>${escapeHtml(op.valueName)}</th><th>n</th></tr></thead><tbody>${shown.map((x,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(x.label)}</td><td><b>${op.fmt(x.value)}</b></td><td>${num(x.count)}</td></tr>`).join("")}</tbody></table>`;
  }catch(e){ showMrError("spkError","tabla Spark",e); return; }
  try{
    hideCssFallback("spkChartFallback","spkChart");
    makeOwnChart(state.spkCharts,"spkChart",shown.map(x=>x.label.length>16?x.label.slice(0,16)+"…":x.label),shown.map(x=>Math.round(x.value*100)/100),op.chart,["#F97316","#2563EB","#7C3AED","#10B981","#EC4899","#06B6D4","#F59E0B","#64748B","#EF4444","#A78BFA"]);
  }catch(e){ cssBarsFallback("spkChartFallback","spkChart",shown,op.fmt); }
  const mrMs=(state.lastMR&&state.lastMR.opKey===opKey)?` MapReduce midió ${state.lastMR.ms} ms en la misma máquina para esta operación.`:"";
  const noteEl=document.getElementById("spkNote");
  if(noteEl) noteEl.innerHTML=`Job Spark simulado sobre <b>${num(input.length)}</b> filas en <b>${ms} ms</b> (1 hilo del navegador; en clúster cada etapa se paraleliza por partición y los datos viven en memoria, sin disco entre etapas).${mrMs}`;
  try{ document.getElementById("spkCompare").innerHTML=spkCompareHtml(opKey,ms); }catch(e){}
  toast(`🔥 Spark: ${num(input.length)} filas → Top ${shown.length} (${ms} ms).`);
}
/* ================= SIMULADOR FLINK (streaming en vivo + test real) ================= */
function flkOpKey(){ return document.getElementById("flkOperation")?.value||"ventas_producto"; }
function flkCodeFor(opKey){
  const m=MR_ENGINE_META[opKey]||{key:"producto",val:"venta",agg:"SUM"};
  const sel=m.agg==="COUNT"?`COUNT(*)`:m.agg==="AVG"?`AVG(${m.val})`:(m.agg==="MAX"?`MAX(${m.val})`:`SUM(${m.val})`);
  return `-- Flink SQL — ${MR_OPS[opKey]?.label||opKey}\nSELECT ${m.key}, ${sel} AS total\nFROM ventas_stream\nGROUP BY ${m.key};`;
}
function flkStop(silent){
  if(state.flk.timer){ clearInterval(state.flk.timer); state.flk.timer=null; }
  state.flk.running=false;
  const d=document.getElementById("flkLiveDot"); if(d) d.hidden=true;
  if(!silent) toast("⏹ Stream detenido.");
}
function flkStart(){
  hideMrError("flkError");
  if(!state.rows.length){ alert("Carga un CSV primero (o usa “Cargar demo”)."); return; }
  flkStop(true);
  const opKey=flkOpKey(), op=MR_OPS[opKey];
  const scope=document.getElementById("flkDataset")?.value||"filtrados";
  const input=scope==="todos"?[...state.rows]:getPanelFilteredRows();
  if(!input.length){ alert("El recorte actual está vacío. Ajusta filtros o usa “Todos los registros”."); return; }
  const events=input.slice();
  for(let i=events.length-1;i>0;i--){ const k=Math.floor(Math.random()*(i+1)); const tmp=events[i]; events[i]=events[k]; events[k]=tmp; }
  // Referencia batch sobre el MISMO recorte: permite probar que el stream suma coherente
  let batchTotal=0;
  try{ for(const r of input){ batchTotal+=op.map(r).v; } }catch(e){ batchTotal=0; }
  state.flk={timer:null,events,idx:0,agg:new Map(),queue:[],processed:0,t0:performance.now(),checks:0,running:true,opKey,total:events.length,feed:[],prev:new Map(),batchTotal};
  set("flkCode",flkCodeFor(opKey));
  const d=document.getElementById("flkLiveDot"); if(d) d.hidden=false;
  document.getElementById("flkTable").innerHTML='<p class="empty" style="padding:12px">Recibiendo eventos…</p>';
  document.getElementById("flkFeed").innerHTML='<p class="empty" style="padding:6px">Recibiendo eventos…</p>';
  document.getElementById("flkMover").innerHTML="";
  state.flk.timer=setInterval(flkTick,500);
  toast(`🌊 Stream iniciado: ${num(events.length)} eventos (${document.getElementById("flkSpeed")?.value||100} ev/s).`);
}
function flkTick(){
  const F=state.flk;
  if(!F.running) return;
  const op=MR_OPS[F.opKey];
  const speed=Number(document.getElementById("flkSpeed")?.value||100);
  const mode=document.getElementById("flkWindow")?.value||"global";
  const batch=Math.max(1,Math.round(speed/2));
  let n=0;
  for(;n<batch && F.idx<F.events.length;n++,F.idx++){
    const r=F.events[F.idx];
    let p; try{ p=op.map(r); }catch{ continue; }
    // Desglose verificable de la venta: cantidad × precio = monto aplicado
    const det=(F.opKey==="tickets_mes"||F.opKey==="transacciones_ciudad")
      ? "+1 transacción"
      : `${r.product} ×${r.quantity} @ ${money(r.price)} = ${money(r.amount)}`;
    F.feed.unshift({k:p.k,v:p.v,d:det}); if(F.feed.length>6) F.feed.pop();
    if(mode==="w200"){
      F.queue.push(p); if(F.queue.length>200) F.queue.shift();
    }else{
      const cur=F.agg.get(p.k)||{sum:0,count:0};
      cur.sum+=p.v; cur.count++; F.agg.set(p.k,cur);
    }
    F.processed++;
  }
  if(mode==="w200"){
    F.agg=new Map();
    for(const p of F.queue){ const cur=F.agg.get(p.k)||{sum:0,count:0}; cur.sum+=p.v; cur.count++; F.agg.set(p.k,cur); }
  }
  if(F.idx%20===0||F.idx>=F.events.length) F.checks++;
  flkRender(op,mode);
  if(F.idx>=F.events.length){
    flkStop(true);
    const d=document.getElementById("flkLiveDot"); if(d) d.hidden=true;
    toast(`✅ Stream completado: ${num(F.processed)} eventos → ${num(F.agg.size)} claves.`);
  }
}
function flkRender(op,mode){
  const F=state.flk;
  const rows=[...F.agg.entries()].map(([label,a])=>({label,value:a.sum,count:a.count})).sort((a,b)=>b.value-a.value);
  const top=rows.slice(0,8);
  const totalSum=rows.reduce((s,x)=>s+x.value,0);
  const secs=Math.max(0.5,(performance.now()-F.t0)/1000);
  const tps=Math.round(F.processed/secs);
  // Checksum: el acumulado del stream debe igualar el batch del mismo recorte
  const diff=totalSum-(F.batchTotal||0);
  const chk=mode==="w200"
    ? `<span class="stat">🪟 Ventana parcial: <b>${op.fmt(totalSum)}</b> (de ${op.fmt(F.batchTotal||0)} total)</span>`
    : (Math.abs(diff)<0.01
      ? `<span class="stat ok">✓ Stream = Batch: <b>${op.fmt(totalSum)}</b></span>`
      : `<span class="stat warn">Δ Stream−Batch: <b>${op.fmt(diff)}</b> (converge al completar)</span>`);
  // clave en movimiento: mayor aumento desde el render anterior
  let mover=null,moverGain=0;
  for(const x of rows){ const g=x.value-(F.prev.get(x.label)||0); if(g>moverGain){ moverGain=g; mover=x; } }
  F.prev=new Map(rows.map(x=>[x.label,x.value]));
  try{
    document.getElementById("flkStats").innerHTML=`<span class="stat">Eventos <b>${num(F.processed)}/${num(F.total)}</b></span><span class="stat">Ritmo <b>${num(tps)} ev/s</b></span><span class="stat">Claves <b>${num(F.agg.size)}</b></span><span class="stat">Checkpoints <b>${num(F.checks)}</b></span><span class="stat">Ventana <b>${mode==="w200"?"últimos 200":"acumulada"}</b></span>${chk}`;
    document.getElementById("flkMover").innerHTML=mover?`<span class="stat">🚀 En movimiento: <b>${escapeHtml(mover.label)}</b> +${op.fmt(moverGain)} este tramo</span>`:"";
    document.getElementById("flkTable").innerHTML=`<table><thead><tr><th>#</th><th>${escapeHtml(op.keyName)}</th><th>${escapeHtml(op.valueName)}</th><th>n</th><th>%</th></tr></thead><tbody>${top.map((x,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(x.label)}</td><td><b>${op.fmt(x.value)}</b></td><td>${num(x.count)}</td><td>${totalSum?((x.value/totalSum)*100).toFixed(1)+"%":"—"}</td></tr>`).join("")||'<tr><td colspan="5">Sin eventos aún…</td></tr>'}</tbody></table>`;
    document.getElementById("flkFeed").innerHTML=F.feed.length?F.feed.map(e=>`<span class="feed-item feed-detail"><b>${escapeHtml(e.k)}</b><em>${escapeHtml(e.d||("+"))}</em></span>`).join(""):'<p class="empty" style="padding:6px">Sin eventos todavía.</p>';
  }catch(e){ showMrError("flkError","streaming",e); flkStop(true); return; }
  const visible=document.getElementById("sparkflink")?.classList.contains("active-section");
  if(!visible) return;
  try{
    hideCssFallback("flkChartFallback","flkChart");
    makeOwnChart(state.flkCharts,"flkChart",top.map(x=>x.label.length>16?x.label.slice(0,16)+"…":x.label),top.map(x=>Math.round(x.value*100)/100),op.chart,["#06B6D4","#2563EB","#7C3AED","#10B981","#F59E0B","#EC4899","#F97316","#64748B"]);
  }catch(e){ cssBarsFallback("flkChartFallback","flkChart",top,op.fmt); }
}
function initSparkFlink(){
  document.getElementById("spkRunBtn")?.addEventListener("click",(e)=>{e.preventDefault(); runSpark();});
  ["spkOperation","spkDataset","spkTopN"].forEach(id=>document.getElementById(id)?.addEventListener("change",()=>{ if(!document.getElementById("spkResults").hidden) runSpark(); }));
  document.getElementById("flkStartBtn")?.addEventListener("click",(e)=>{e.preventDefault(); flkStart();});
  document.getElementById("flkStopBtn")?.addEventListener("click",(e)=>{e.preventDefault(); flkStop();});
  ["flkOperation","flkDataset"].forEach(id=>document.getElementById(id)?.addEventListener("change",()=>{ if(state.flk.running) flkStart(); else set("flkCode",flkCodeFor(flkOpKey())); }));
  // Slider 1–1000 ev/s: se aplica EN VIVO (flkTick lo lee en cada tick, sin reiniciar)
  const spd=document.getElementById("flkSpeed");
  const updSpd=()=>{ const v=document.getElementById("flkSpeedVal"); if(v&&spd) v.textContent=spd.value; };
  spd?.addEventListener("input",updSpd); updSpd();
  document.getElementById("flkWindow")?.addEventListener("change",()=>{
    if(state.flk.running) flkStart(); // la ventana se reinicia para no mezclar estados
  });
  set("flkCode",flkCodeFor(flkOpKey()));
  // Diagrama: resaltar la ruta del motor elegido
  document.querySelectorAll(".route-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".route-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const pipe=document.getElementById("pipeDiagram");
      if(pipe) pipe.dataset.active=btn.dataset.route||"all";
    });
  });
}
// init — ORDEN: rangos, panel focalizado, cuadros, mapreduce, spark/flink, filtros globales aparte
bindRangeSync();
initPanelEvents();
bindCuadroTools();
initMapReduce();
initSparkFlink();
refreshMrDatasetInfo();
["yearFilter","monthFilter","locationFilter"].forEach(id=>{
 const el=document.getElementById(id);
 if(el) el.addEventListener("change",(e)=>{e.preventDefault(); scheduleGlobal();});
});
// expose for chips inline
window.toggleSelection=toggleSelection;
window.schedulePanel=schedulePanel;
window.scheduleGlobal=scheduleGlobal;
window.clearData=clearData;
window.runMapReduce=runMapReduce;
window.runSpark=runSpark;
window.flkStart=flkStart;
window.flkStop=flkStop;
