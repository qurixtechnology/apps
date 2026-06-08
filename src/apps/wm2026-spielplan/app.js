/* ============================== DATA ============================== */
const FLAG={
 "Mexiko":"🇲🇽","Südafrika":"🇿🇦","Südkorea":"🇰🇷","Tschechien":"🇨🇿",
 "Kanada":"🇨🇦","Bosnien-H.":"🇧🇦","Katar":"🇶🇦","Schweiz":"🇨🇭",
 "Brasilien":"🇧🇷","Marokko":"🇲🇦","Haiti":"🇭🇹","Schottland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿",
 "USA":"🇺🇸","Paraguay":"🇵🇾","Australien":"🇦🇺","Türkei":"🇹🇷",
 "Deutschland":"🇩🇪","Curaçao":"🇨🇼","Elfenbeinküste":"🇨🇮","Ecuador":"🇪🇨",
 "Niederlande":"🇳🇱","Japan":"🇯🇵","Schweden":"🇸🇪","Tunesien":"🇹🇳",
 "Belgien":"🇧🇪","Ägypten":"🇪🇬","Iran":"🇮🇷","Neuseeland":"🇳🇿",
 "Spanien":"🇪🇸","Kap Verde":"🇨🇻","Saudi-Arabien":"🇸🇦","Uruguay":"🇺🇾",
 "Frankreich":"🇫🇷","Senegal":"🇸🇳","Irak":"🇮🇶","Norwegen":"🇳🇴",
 "Argentinien":"🇦🇷","Algerien":"🇩🇿","Österreich":"🇦🇹","Jordanien":"🇯🇴",
 "Portugal":"🇵🇹","DR Kongo":"🇨🇩","Usbekistan":"🇺🇿","Kolumbien":"🇨🇴",
 "England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","Kroatien":"🇭🇷","Ghana":"🇬🇭","Panama":"🇵🇦"
};
const GROUPS={
 A:["Mexiko","Südafrika","Südkorea","Tschechien"],
 B:["Kanada","Bosnien-H.","Katar","Schweiz"],
 C:["Brasilien","Marokko","Haiti","Schottland"],
 D:["USA","Paraguay","Australien","Türkei"],
 E:["Deutschland","Curaçao","Elfenbeinküste","Ecuador"],
 F:["Niederlande","Japan","Schweden","Tunesien"],
 G:["Belgien","Ägypten","Iran","Neuseeland"],
 H:["Spanien","Kap Verde","Saudi-Arabien","Uruguay"],
 I:["Frankreich","Senegal","Irak","Norwegen"],
 J:["Argentinien","Algerien","Österreich","Jordanien"],
 K:["Portugal","DR Kongo","Usbekistan","Kolumbien"],
 L:["England","Kroatien","Ghana","Panama"]
};
const GCOL={A:"#f3c54a",B:"#34c878",C:"#52a8e8",D:"#ef5d60",E:"#9b8cff",F:"#f59e42",
 G:"#23c4c4",H:"#e85ab0",I:"#7bd14a",J:"#ffb4a2",K:"#6ea8fe",L:"#d4a373"};
const TEAM2GROUP={}; Object.entries(GROUPS).forEach(([g,ts])=>ts.forEach(t=>TEAM2GROUP[t]=g));

/* FIFA-Weltranglistenpunkte (Stand 10. Juni 2026, live). Vier niedrigplatzierte Teams (~) sind nahe Näherungen. */
const FIFA={
 "Argentinien":1874.81,"Spanien":1873.02,"Frankreich":1869.43,"England":1825.97,"Portugal":1763.83,
 "Brasilien":1762.66,"Marokko":1757.29,"Niederlande":1751.09,"Belgien":1739.54,"Deutschland":1731.30,
 "Kroatien":1712.24,"Kolumbien":1695.99,"Mexiko":1687.48,"Senegal":1686.41,"USA":1675.71,
 "Uruguay":1673.07,"Japan":1661.58,"Schweiz":1650.75,"Iran":1619.58,"Türkei":1601.99,
 "Österreich":1597.41,"Ecuador":1596.48,"Südkorea":1591.63,"Australien":1578.65,"Algerien":1571.04,
 "Ägypten":1565.56,"Kanada":1560.61,"Norwegen":1555.59,"Elfenbeinküste":1540.87,"Panama":1540.59,
 "Schweden":1509.79,"Tschechien":1505.74,"Paraguay":1503.50,"Schottland":1499.92,"DR Kongo":1479.68,
 "Tunesien":1479.09,"Usbekistan":1461.21,"Katar":1452.38,"Irak":1451.16,"Südafrika":1428.38,
 "Saudi-Arabien":1419.73,"Jordanien":1390.10,"Bosnien-H.":1385.77,"Kap Verde":1369.30,
 "Ghana":1345,"Curaçao":1305,"Neuseeland":1294,"Haiti":1287
};

/* Group matches: [group, date(ET ISO), time(ET 24h), home, away, venue, city] */
const GM=[
 ["A","2026-06-11","15:00","Mexiko","Südafrika","Estadio Azteca","Mexiko-Stadt"],
 ["A","2026-06-11","22:00","Südkorea","Tschechien","Estadio Akron","Zapopan"],
 ["B","2026-06-12","15:00","Kanada","Bosnien-H.","BMO Field","Toronto"],
 ["D","2026-06-12","21:00","USA","Paraguay","SoFi Stadium","Inglewood"],
 ["B","2026-06-13","15:00","Katar","Schweiz","Levi's Stadium","Santa Clara"],
 ["C","2026-06-13","18:00","Brasilien","Marokko","MetLife Stadium","East Rutherford"],
 ["C","2026-06-13","21:00","Haiti","Schottland","Gillette Stadium","Foxborough"],
 ["D","2026-06-14","00:00","Australien","Türkei","BC Place","Vancouver"],
 ["E","2026-06-14","13:00","Deutschland","Curaçao","NRG Stadium","Houston"],
 ["F","2026-06-14","16:00","Niederlande","Japan","AT&T Stadium","Arlington"],
 ["E","2026-06-14","19:00","Elfenbeinküste","Ecuador","Lincoln Financial Field","Philadelphia"],
 ["F","2026-06-14","22:00","Schweden","Tunesien","Estadio BBVA","Monterrey"],
 ["H","2026-06-15","12:00","Spanien","Kap Verde","Mercedes-Benz Stadium","Atlanta"],
 ["G","2026-06-15","15:00","Belgien","Ägypten","Lumen Field","Seattle"],
 ["H","2026-06-15","18:00","Saudi-Arabien","Uruguay","Hard Rock Stadium","Miami Gardens"],
 ["G","2026-06-15","21:00","Iran","Neuseeland","SoFi Stadium","Inglewood"],
 ["I","2026-06-16","15:00","Frankreich","Senegal","MetLife Stadium","East Rutherford"],
 ["I","2026-06-16","18:00","Irak","Norwegen","Gillette Stadium","Foxborough"],
 ["J","2026-06-16","21:00","Argentinien","Algerien","Arrowhead Stadium","Kansas City"],
 ["J","2026-06-17","00:00","Österreich","Jordanien","Levi's Stadium","Santa Clara"],
 ["K","2026-06-17","13:00","Portugal","DR Kongo","NRG Stadium","Houston"],
 ["L","2026-06-17","16:00","England","Kroatien","AT&T Stadium","Arlington"],
 ["L","2026-06-17","19:00","Ghana","Panama","BMO Field","Toronto"],
 ["K","2026-06-17","22:00","Usbekistan","Kolumbien","Estadio Azteca","Mexiko-Stadt"],
 ["A","2026-06-18","12:00","Tschechien","Südafrika","Mercedes-Benz Stadium","Atlanta"],
 ["B","2026-06-18","15:00","Schweiz","Bosnien-H.","SoFi Stadium","Inglewood"],
 ["B","2026-06-18","18:00","Kanada","Katar","BC Place","Vancouver"],
 ["A","2026-06-18","21:00","Mexiko","Südkorea","Estadio Akron","Zapopan"],
 ["D","2026-06-19","15:00","USA","Australien","Lumen Field","Seattle"],
 ["C","2026-06-19","18:00","Schottland","Marokko","Gillette Stadium","Foxborough"],
 ["C","2026-06-19","20:30","Brasilien","Haiti","Lincoln Financial Field","Philadelphia"],
 ["D","2026-06-19","23:00","Türkei","Paraguay","Levi's Stadium","Santa Clara"],
 ["F","2026-06-20","13:00","Niederlande","Schweden","NRG Stadium","Houston"],
 ["E","2026-06-20","16:00","Deutschland","Elfenbeinküste","BMO Field","Toronto"],
 ["E","2026-06-20","20:00","Ecuador","Curaçao","Arrowhead Stadium","Kansas City"],
 ["F","2026-06-21","00:00","Tunesien","Japan","Estadio BBVA","Monterrey"],
 ["H","2026-06-21","12:00","Spanien","Saudi-Arabien","Mercedes-Benz Stadium","Atlanta"],
 ["G","2026-06-21","15:00","Belgien","Iran","SoFi Stadium","Inglewood"],
 ["H","2026-06-21","18:00","Uruguay","Kap Verde","Hard Rock Stadium","Miami Gardens"],
 ["G","2026-06-21","21:00","Neuseeland","Ägypten","BC Place","Vancouver"],
 ["J","2026-06-22","13:00","Argentinien","Österreich","AT&T Stadium","Arlington"],
 ["I","2026-06-22","17:00","Frankreich","Irak","Lincoln Financial Field","Philadelphia"],
 ["I","2026-06-22","20:00","Norwegen","Senegal","MetLife Stadium","East Rutherford"],
 ["J","2026-06-22","23:00","Jordanien","Algerien","Levi's Stadium","Santa Clara"],
 ["K","2026-06-23","13:00","Portugal","Usbekistan","NRG Stadium","Houston"],
 ["L","2026-06-23","16:00","England","Ghana","Gillette Stadium","Foxborough"],
 ["L","2026-06-23","19:00","Panama","Kroatien","BMO Field","Toronto"],
 ["K","2026-06-23","22:00","Kolumbien","DR Kongo","Estadio Akron","Zapopan"],
 ["B","2026-06-24","15:00","Schweiz","Kanada","BC Place","Vancouver"],
 ["B","2026-06-24","15:00","Bosnien-H.","Katar","Lumen Field","Seattle"],
 ["C","2026-06-24","18:00","Schottland","Brasilien","Hard Rock Stadium","Miami Gardens"],
 ["C","2026-06-24","18:00","Marokko","Haiti","Mercedes-Benz Stadium","Atlanta"],
 ["A","2026-06-24","21:00","Tschechien","Mexiko","Estadio Azteca","Mexiko-Stadt"],
 ["A","2026-06-24","21:00","Südafrika","Südkorea","Estadio BBVA","Monterrey"],
 ["E","2026-06-25","16:00","Curaçao","Elfenbeinküste","Lincoln Financial Field","Philadelphia"],
 ["E","2026-06-25","16:00","Ecuador","Deutschland","MetLife Stadium","East Rutherford"],
 ["F","2026-06-25","19:00","Japan","Schweden","AT&T Stadium","Arlington"],
 ["F","2026-06-25","19:00","Tunesien","Niederlande","Arrowhead Stadium","Kansas City"],
 ["D","2026-06-25","22:00","Türkei","USA","SoFi Stadium","Inglewood"],
 ["D","2026-06-25","22:00","Paraguay","Australien","Levi's Stadium","Santa Clara"],
 ["I","2026-06-26","15:00","Norwegen","Frankreich","Gillette Stadium","Foxborough"],
 ["I","2026-06-26","15:00","Senegal","Irak","BMO Field","Toronto"],
 ["H","2026-06-26","20:00","Kap Verde","Saudi-Arabien","NRG Stadium","Houston"],
 ["H","2026-06-26","20:00","Uruguay","Spanien","Estadio Akron","Zapopan"],
 ["G","2026-06-26","23:00","Ägypten","Iran","Lumen Field","Seattle"],
 ["G","2026-06-26","23:00","Neuseeland","Belgien","BC Place","Vancouver"],
 ["L","2026-06-27","17:00","Panama","England","MetLife Stadium","East Rutherford"],
 ["L","2026-06-27","17:00","Kroatien","Ghana","Lincoln Financial Field","Philadelphia"],
 ["K","2026-06-27","19:30","Kolumbien","Portugal","Hard Rock Stadium","Miami Gardens"],
 ["K","2026-06-27","19:30","DR Kongo","Usbekistan","Mercedes-Benz Stadium","Atlanta"],
 ["J","2026-06-27","22:00","Algerien","Österreich","Arrowhead Stadium","Kansas City"],
 ["J","2026-06-27","22:00","Jordanien","Argentinien","AT&T Stadium","Arlington"]
];

/* Knockout matches. slot types: W=group winner, R=runner-up, T3=best third (groups[]), win=winner of match m, lose=loser of match m */
const W=(g)=>({s:"W",g}); const R=(g)=>({s:"R",g}); const T3=(...g)=>({s:"T3",g});
const WIN=(m)=>({s:"win",m}); const LOSE=(m)=>({s:"lose",m});
const KO=[
 {no:73,rd:"R32","date":"2026-06-28","time":"15:00",v:"SoFi Stadium",c:"Inglewood",a:R("A"),b:R("B")},
 {no:76,rd:"R32","date":"2026-06-29","time":"13:00",v:"NRG Stadium",c:"Houston",a:W("C"),b:R("F")},
 {no:74,rd:"R32","date":"2026-06-29","time":"16:30",v:"Gillette Stadium",c:"Foxborough",a:W("E"),b:T3("A","B","C","D","F")},
 {no:75,rd:"R32","date":"2026-06-29","time":"21:00",v:"Estadio BBVA",c:"Monterrey",a:W("F"),b:R("C")},
 {no:78,rd:"R32","date":"2026-06-30","time":"13:00",v:"AT&T Stadium",c:"Arlington",a:R("E"),b:R("I")},
 {no:77,rd:"R32","date":"2026-06-30","time":"17:00",v:"MetLife Stadium",c:"East Rutherford",a:W("I"),b:T3("C","D","F","G","H")},
 {no:79,rd:"R32","date":"2026-06-30","time":"21:00",v:"Estadio Azteca",c:"Mexiko-Stadt",a:W("A"),b:T3("C","E","F","H","I")},
 {no:80,rd:"R32","date":"2026-07-01","time":"12:00",v:"Mercedes-Benz Stadium",c:"Atlanta",a:W("L"),b:T3("E","H","I","J","K")},
 {no:82,rd:"R32","date":"2026-07-01","time":"16:00",v:"Lumen Field",c:"Seattle",a:W("G"),b:T3("A","E","H","I","J")},
 {no:81,rd:"R32","date":"2026-07-01","time":"20:00",v:"Levi's Stadium",c:"Santa Clara",a:W("D"),b:T3("B","E","F","I","J")},
 {no:84,rd:"R32","date":"2026-07-02","time":"15:00",v:"SoFi Stadium",c:"Inglewood",a:W("H"),b:R("J")},
 {no:83,rd:"R32","date":"2026-07-02","time":"19:00",v:"BMO Field",c:"Toronto",a:R("K"),b:R("L")},
 {no:85,rd:"R32","date":"2026-07-02","time":"23:00",v:"BC Place",c:"Vancouver",a:W("B"),b:T3("E","F","G","I","J")},
 {no:88,rd:"R32","date":"2026-07-03","time":"14:00",v:"AT&T Stadium",c:"Arlington",a:R("D"),b:R("G")},
 {no:86,rd:"R32","date":"2026-07-03","time":"18:00",v:"Hard Rock Stadium",c:"Miami Gardens",a:W("J"),b:R("H")},
 {no:87,rd:"R32","date":"2026-07-03","time":"21:30",v:"Arrowhead Stadium",c:"Kansas City",a:W("K"),b:T3("D","E","I","J","L")},
 {no:90,rd:"R16","date":"2026-07-04","time":"13:00",v:"NRG Stadium",c:"Houston",a:WIN(73),b:WIN(75)},
 {no:89,rd:"R16","date":"2026-07-04","time":"17:00",v:"Lincoln Financial Field",c:"Philadelphia",a:WIN(74),b:WIN(77)},
 {no:91,rd:"R16","date":"2026-07-05","time":"16:00",v:"MetLife Stadium",c:"East Rutherford",a:WIN(76),b:WIN(78)},
 {no:92,rd:"R16","date":"2026-07-05","time":"20:00",v:"Estadio Azteca",c:"Mexiko-Stadt",a:WIN(79),b:WIN(80)},
 {no:93,rd:"R16","date":"2026-07-06","time":"15:00",v:"AT&T Stadium",c:"Arlington",a:WIN(83),b:WIN(84)},
 {no:94,rd:"R16","date":"2026-07-06","time":"20:00",v:"Lumen Field",c:"Seattle",a:WIN(81),b:WIN(82)},
 {no:95,rd:"R16","date":"2026-07-07","time":"12:00",v:"Mercedes-Benz Stadium",c:"Atlanta",a:WIN(86),b:WIN(88)},
 {no:96,rd:"R16","date":"2026-07-07","time":"16:00",v:"BC Place",c:"Vancouver",a:WIN(85),b:WIN(87)},
 {no:97,rd:"QF","date":"2026-07-09","time":"16:00",v:"Gillette Stadium",c:"Foxborough",a:WIN(89),b:WIN(90)},
 {no:98,rd:"QF","date":"2026-07-10","time":"15:00",v:"SoFi Stadium",c:"Inglewood",a:WIN(93),b:WIN(94)},
 {no:99,rd:"QF","date":"2026-07-11","time":"17:00",v:"Hard Rock Stadium",c:"Miami Gardens",a:WIN(91),b:WIN(92)},
 {no:100,rd:"QF","date":"2026-07-11","time":"21:00",v:"Arrowhead Stadium",c:"Kansas City",a:WIN(95),b:WIN(96)},
 {no:101,rd:"SF","date":"2026-07-14","time":"15:00",v:"AT&T Stadium",c:"Arlington",a:WIN(97),b:WIN(98)},
 {no:102,rd:"SF","date":"2026-07-15","time":"15:00",v:"Mercedes-Benz Stadium",c:"Atlanta",a:WIN(99),b:WIN(100)},
 {no:103,rd:"3RD","date":"2026-07-18","time":"17:00",v:"Hard Rock Stadium",c:"Miami Gardens",a:LOSE(101),b:LOSE(102)},
 {no:104,rd:"FINAL","date":"2026-07-19","time":"15:00",v:"MetLife Stadium",c:"East Rutherford",a:WIN(101),b:WIN(102)}
];
const KOBY={}; KO.forEach(m=>KOBY[m.no]=m);
const RD_NAME={R32:"Sechzehntelfinale",R16:"Achtelfinale",QF:"Viertelfinale",SF:"Halbfinale","3RD":"Spiel um Platz 3",FINAL:"Finale"};
const RD_SHORT={R32:"Sechzehntelf.",R16:"Achtelfinale",QF:"Viertelfinale",SF:"Halbfinale","3RD":"Platz 3",FINAL:"Finale"};

/* ============================== TIME ============================== */
/* ET in Jun/Jul = EDT (UTC-4). Build the real instant, then format in Europe/Berlin. */
function instant(dateISO,time){
  const [y,m,d]=dateISO.split("-").map(Number);
  const [hh,mm]=time.split(":").map(Number);
  return new Date(Date.UTC(y,m-1,d,hh+4,mm)); // EDT -> UTC
}
const TZ_OPTIONS=[
  {id:"Europe/Berlin",label:"Deutschland · MESZ",abbr:"MESZ"},
  {id:"Europe/London",label:"UK · BST",abbr:"BST"},
  {id:"UTC",label:"UTC",abbr:"UTC"},
  {id:"America/New_York",label:"US Ostküste · ET",abbr:"ET"},
  {id:"America/Chicago",label:"US Central · CT",abbr:"CT"},
  {id:"America/Denver",label:"US Mountain · MT",abbr:"MT"},
  {id:"America/Los_Angeles",label:"US Westküste · PT",abbr:"PT"},
  {id:"America/Mexico_City",label:"Mexiko-Stadt",abbr:"MEX"}
];
let dispTz="Europe/Berlin";
try{const s=localStorage.getItem("wm2026tz"); if(s)dispTz=s;}catch(e){}
function saveTz(){try{localStorage.setItem("wm2026tz",dispTz);}catch(e){}}
function tzAbbr(id){const o=TZ_OPTIONS.find(x=>x.id===id);return o?o.abbr:id;}
let _TF={};
function buildTF(){
  const tz=dispTz, sec=(tz==="America/New_York")?"Europe/Berlin":"America/New_York";
  _TF={
    time:new Intl.DateTimeFormat("de-DE",{timeZone:tz,hour:"2-digit",minute:"2-digit"}),
    key :new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}),
    day :new Intl.DateTimeFormat("de-DE",{timeZone:tz,day:"numeric",month:"long"}),
    wd  :new Intl.DateTimeFormat("de-DE",{timeZone:tz,weekday:"long"}),
    sec :new Intl.DateTimeFormat("de-DE",{timeZone:sec,hour:"2-digit",minute:"2-digit"}),
    primAbbr:tzAbbr(tz), secAbbr:(sec==="Europe/Berlin"?"MESZ":"ET")
  };
}
buildTF();
function berlinTime(inst){return _TF.time.format(inst);}
function etTime(inst){return _TF.sec.format(inst);}
function berlinKey(inst){return _TF.key.format(inst);}
function berlinDayLabel(inst){return _TF.day.format(inst);}
function berlinWeekday(inst){return _TF.wd.format(inst);}

/* Build unified match list */
const MATCHES=[];
GM.forEach((r,i)=>{
  const inst=instant(r[1],r[2]);
  MATCHES.push({type:"group",group:r[0],home:r[3],away:r[4],venue:r[5],city:r[6],inst,etTime:r[2],id:"g"+i});
});
KO.forEach(m=>{
  const inst=instant(m.date,m.time);
  m.inst=inst; // attach to original KO object too (used by bracket + scenario cards + Sperrtermine)
  MATCHES.push({type:"ko",no:m.no,rd:m.rd,a:m.a,b:m.b,venue:m.v,city:m.c,inst,etTime:m.time,id:"k"+m.no});
});
MATCHES.sort((x,y)=>x.inst-y.inst);

/* ============================== SCENARIO ENGINE ============================== */
function slotLabel(sl,withTeam){
  if(sl.s==="W")return "Sieger "+sl.g;
  if(sl.s==="R")return "Zweiter "+sl.g;
  if(sl.s==="T3")return "3. ("+sl.g.join("/")+")";
  if(sl.s==="win")return "Sieger Sp. "+sl.m;
  if(sl.s==="lose")return "Verlierer Sp. "+sl.m;
  return "?";
}
/* find R32 match (no) for a team's finishing position */
function r32ForScenario(team,rank){ // rank 1,2,3
  const g=TEAM2GROUP[team]; const out=[];
  KO.forEach(m=>{
    if(m.rd!=="R32")return;
    [m.a,m.b].forEach(sl=>{
      if(rank===1 && sl.s==="W" && sl.g===g) out.push(m.no);
      if(rank===2 && sl.s==="R" && sl.g===g) out.push(m.no);
      if(rank===3 && sl.s==="T3" && sl.g.includes(g)) out.push(m.no);
    });
  });
  return out;
}
/* given a match no, which match does its winner feed into? */
function winChild(no){
  for(const m of KO){ if((m.a.s==="win"&&m.a.m===no)||(m.b.s==="win"&&m.b.m===no)) return m.no; }
  return null;
}
/* walk forward from an R32 match assuming the team keeps winning; return ordered match numbers incl. SF consolation */
function forwardChain(r32no){
  const chain=[r32no]; let cur=r32no;
  while(true){ const nx=winChild(cur); if(nx==null)break; chain.push(nx); cur=nx; }
  // if chain reaches a semifinal, the final-weekend means either Final(in chain) or 3rd place
  if(chain.some(n=>KOBY[n].rd==="SF") && !chain.includes(103)) chain.push(103);
  return chain;
}
/* full scenario result for a team+rank: list of match numbers (possible) */
function scenarioMatches(team,rank){
  const starts=r32ForScenario(team,rank); const set=new Set();
  starts.forEach(s=>forwardChain(s).forEach(n=>set.add(n)));
  return {starts,all:[...set].sort((a,b)=>a-b)};
}

/* ============================== STATE ============================== */
let selTeam=null;
try{const s=localStorage.getItem("wm2026fav"); if(s)selTeam=s;}catch(e){}
function saveSelTeam(){try{if(selTeam)localStorage.setItem("wm2026fav",selTeam);else localStorage.removeItem("wm2026fav");}catch(e){}}
let scnOn={1:true,2:true,3:true};
let calFilter="all";
let calView="list";
let scores={}; // key "g"+index -> {h:,a:}
try{const s=localStorage.getItem("wm2026scores"); if(s)scores=JSON.parse(s);}catch(e){}
function saveScores(){try{localStorage.setItem("wm2026scores",JSON.stringify(scores));}catch(e){}}

/* ============================== STANDINGS ============================== */
function standings(group){
  const teams=GROUPS[group];
  const tab={}; teams.forEach(t=>tab[t]={t,sp:0,s:0,u:0,n:0,gf:0,ga:0,pts:0});
  GM.forEach((r,i)=>{
    if(r[0]!==group)return;
    const sc=scores["g"+i]; if(!sc||sc.h===""||sc.a===""||sc.h==null||sc.a==null)return;
    const h=+sc.h,a=+sc.a; const H=tab[r[3]],A=tab[r[4]];
    H.sp++;A.sp++;H.gf+=h;H.ga+=a;A.gf+=a;A.ga+=h;
    if(h>a){H.s++;A.n++;H.pts+=3;} else if(h<a){A.s++;H.n++;A.pts+=3;} else {H.u++;A.u++;H.pts++;A.pts++;}
  });
  return Object.values(tab).sort((x,y)=>
    y.pts-x.pts || (y.gf-y.ga)-(x.gf-x.ga) || y.gf-x.gf || GROUPS[group].indexOf(x.t)-GROUPS[group].indexOf(y.t));
}

/* ============================== KO SIMULATION ============================== */
let koPicks={}; // matchNo -> "a" | "b" (manual / penalty-shootout winner)
try{const s=localStorage.getItem("wm2026picks"); if(s)koPicks=JSON.parse(s);}catch(e){}
function savePicks(){try{localStorage.setItem("wm2026picks",JSON.stringify(koPicks));}catch(e){}}
let koScores={}; // matchNo -> {h,a} goals for side a / side b (after extra time)
try{const s=localStorage.getItem("wm2026koscores"); if(s)koScores=JSON.parse(s);}catch(e){}
function saveKoScores(){try{localStorage.setItem("wm2026koscores",JSON.stringify(koScores));}catch(e){}}
const TEAMS=Object.values(GROUPS).flat();
let myTip={name:"",g:{},b:[null,null,null,null]};
try{const s=localStorage.getItem("wm2026_mytip"); if(s)myTip=JSON.parse(s);}catch(e){}
if(!myTip.b)myTip.b=[null,null,null,null];
function saveMyTip(){try{localStorage.setItem("wm2026_mytip",JSON.stringify(myTip));}catch(e){} if(typeof cloudPushMyTip==="function")cloudPushMyTip();}
let tipPlayers=[];
try{const s=localStorage.getItem("wm2026_tips"); if(s)tipPlayers=JSON.parse(s);}catch(e){}
function saveTipPlayers(){try{localStorage.setItem("wm2026_tips",JSON.stringify(tipPlayers));}catch(e){}}
let tipViewName=null;
function koScoreSet(no){const s=koScores[no];return s&&s.h!==""&&s.a!==""&&s.h!=null&&s.a!=null;}
function koDraw(no){return koScoreSet(no)&&(+koScores[no].h)===(+koScores[no].a);}
/* winning side: decisive score wins; a draw needs a penalty pick; with no score fall back to a manual pick */
function koResultWinner(no){
  if(koScoreSet(no)){ const h=+koScores[no].h,a=+koScores[no].a; if(h>a)return "a"; if(a>h)return "b"; return koPicks[no]||null; }
  return koPicks[no]||null;
}
let T3MAP=null; // matchNo -> group letter assigned as that match's best-third

function groupComplete(g){let n=0;GM.forEach((r,i)=>{if(r[0]===g){const s=scores["g"+i];if(s&&s.h!==""&&s.a!==""&&s.h!=null&&s.a!=null)n++;}});return n===6;}
function allGroupsComplete(){return Object.keys(GROUPS).every(groupComplete);}
function gamesPlayed(){let n=0;GM.forEach((r,i)=>{const s=scores["g"+i];if(s&&s.h!==""&&s.a!==""&&s.h!=null&&s.a!=null)n++;});return n;}
/* remaining (unplayed) group games per team */
function remainingInGroup(g){const rem={};GROUPS[g].forEach(t=>rem[t]=0);GM.forEach((r,i)=>{if(r[0]!==g)return;const s=scores["g"+i];const pl=s&&s.h!==""&&s.a!==""&&s.h!=null&&s.a!=null;if(!pl){rem[r[3]]++;rem[r[4]]++;}});return rem;}
/* exact final rank if mathematically guaranteed on points alone (no tie-break risk), else null */
function guaranteedRank(team){
  const g=TEAM2GROUP[team]; const pts={}; standings(g).forEach(o=>pts[o.t]=o.pts);
  const rem=remainingInGroup(g); const tMax=pts[team]+3*rem[team], tCur=pts[team];
  let above=0,amb=0;
  GROUPS[g].forEach(R=>{ if(R===team)return; const rMax=pts[R]+3*rem[R], rCur=pts[R];
    if(rCur>tMax)above++; else if(rMax<tCur){} else amb++; });
  return amb>0?null:above+1;
}
/* rank known: exact standings position once group complete, else guaranteed rank */
function determinedRank(team){ const g=TEAM2GROUP[team];
  if(groupComplete(g))return standings(g).findIndex(o=>o.t===team)+1;
  return guaranteedRank(team);
}
/* team in group g that has clinched exactly this rank before completion */
function clinchedTeam(g,rank){ if(groupComplete(g))return null; for(const t of GROUPS[g]){ if(guaranteedRank(t)===rank)return t; } return null; }
/* which scenario ranks are still relevant for selTeam: a single rank once determined, else the user-toggled set */
function activeRanks(){ if(!selTeam)return []; const det=determinedRank(selTeam); if(det!=null)return (det>=1&&det<=3)?[det]:[]; return [1,2,3].filter(rk=>scnOn[rk]); }
/* points-based reachable final-rank range (inclusive on ties so we never wrongly exclude) */
function rankRange(team){
  const g=TEAM2GROUP[team]; const pts={}; standings(g).forEach(o=>pts[o.t]=o.pts);
  const rem=remainingInGroup(g); const tCur=pts[team], tBest=tCur+3*rem[team];
  let unavoid=0, canAbove=0;
  GROUPS[g].forEach(R=>{ if(R===team)return; const rCur=pts[R], rMax=rCur+3*rem[R];
    if(rCur>tBest)unavoid++;        // R stays above T even in T's best / R's worst case
    if(rMax>=tCur)canAbove++;       // R can reach/exceed T (ties count, GD could decide)
  });
  return {best:unavoid+1, worst:canAbove+1};
}
/* can this team still finish exactly 3rd in its group? (exact once the group is complete) */
function canBeThird(team){ const g=TEAM2GROUP[team];
  if(groupComplete(g)) return standings(g)[2].t===team;
  const r=rankRange(team); return r.best<=3 && r.worst>=3;
}
function thirdRanking(){
  const arr=Object.keys(GROUPS).map(g=>{const s=standings(g)[2];return {t:s.t,g,pts:s.pts,gd:s.gf-s.ga,gf:s.gf};});
  arr.sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf||a.g.localeCompare(b.g));
  return arr;
}
const T3SLOTS=KO.filter(m=>m.rd==="R32"&&(m.a.s==="T3"||m.b.s==="T3"))
  .map(m=>({no:m.no, groups:(m.a.s==="T3"?m.a:m.b).g}));
/* assign the 8 best thirds to the 8 third-slots via a valid bipartite matching honoring each slot's eligible groups */
function matchThirds(quals){
  const adj=T3SLOTS.map(s=>s.groups.filter(g=>quals.includes(g)));
  const g2s={};
  function aug(si,seen){
    for(const g of adj[si]){
      if(seen[g])continue; seen[g]=true;
      if(g2s[g]===undefined || aug(g2s[g],seen)){ g2s[g]=si; return true; }
    }
    return false;
  }
  for(let si=0;si<T3SLOTS.length;si++) aug(si,{});
  const res={}; Object.entries(g2s).forEach(([g,si])=>{ res[T3SLOTS[si].no]=g; });
  return res;
}
function assignThirds(){
  if(!allGroupsComplete())return null;
  return matchThirds(thirdRanking().slice(0,8).map(o=>o.g));
}
function slotTeam(sl,matchNo){
  if(sl.s==="W")return groupComplete(sl.g)?standings(sl.g)[0].t:clinchedTeam(sl.g,1);
  if(sl.s==="R")return groupComplete(sl.g)?standings(sl.g)[1].t:clinchedTeam(sl.g,2);
  if(sl.s==="T3"){const g=T3MAP&&T3MAP[matchNo];return g?standings(g)[2].t:null;}
  if(sl.s==="win")return koWinner(sl.m);
  if(sl.s==="lose")return koLoser(sl.m);
  return null;
}
function koParts(no){const m=KOBY[no];return {a:slotTeam(m.a,no),b:slotTeam(m.b,no)};}
function koWinner(no){const side=koResultWinner(no);if(!side)return null;const p=koParts(no);return side==="a"?p.a:p.b;}
function koLoser(no){const side=koResultWinner(no);if(!side)return null;const p=koParts(no);return side==="a"?p.b:p.a;}
function pickWinner(no,side){
  if(koScoreSet(no)&&!koDraw(no))return; // a decisive score governs; change the score to change the winner
  const p=koParts(no); if(!p.a||!p.b)return;
  koPicks[no]=(koPicks[no]===side)?undefined:side;
  if(koPicks[no]===undefined)delete koPicks[no];
  savePicks(); renderAll();
}

/* ============================== RENDER: GROUPS ============================== */
function renderGroups(){
  const wrap=document.getElementById("grpGrid"); wrap.innerHTML="";
  Object.keys(GROUPS).forEach(g=>{
    const tab=standings(g);
    const card=document.createElement("div"); card.className="grp"; card.style.setProperty("--gcol",GCOL[g]);
    let rows="";
    tab.forEach((row,idx)=>{
      const cls=idx===0?"q1":idx===1?"q2":idx===2?"q3":"";
      const isFav=row.t===selTeam;
      const gd=row.gf-row.ga; const gds=(gd>0?"+":"")+gd;
      rows+=`<tr class="${cls}${isFav?' fav-row':''}">
        <td class="team"><span class="pos">${idx+1}</span><span class="fl">${FLAG[row.t]}</span>${row.t}${isFav?' <span class="favstar">★</span>':''}</td>
        <td>${row.sp}</td><td>${row.s}-${row.u}-${row.n}</td>
        <td>${row.gf}:${row.ga}</td><td>${gds}</td><td class="pts">${row.pts}</td></tr>`;
    });
    let fix="";
    GM.forEach((r,i)=>{
      if(r[0]!==g)return;
      const inst=instant(r[1],r[2]); const sc=scores["g"+i]||{h:"",a:""};
      fix+=`<div class="fx">
        <div class="fd">${berlinDayLabel(inst).replace(/ /,'.&nbsp;')}<br>${berlinTime(inst)}</div>
        <div class="h">${r[3]} <span style="font-size:13px">${FLAG[r[3]]}</span></div>
        <div class="sc"><input class="score-in" data-k="g${i}" data-s="h" inputmode="numeric" value="${sc.h??""}">:<input class="score-in" data-k="g${i}" data-s="a" inputmode="numeric" value="${sc.a??""}"></div>
        <div class="a"><span style="font-size:13px">${FLAG[r[4]]}</span> ${r[4]}</div>
      </div>`;
    });
    card.innerHTML=`
      <div class="grp-h"><div class="grp-badge">${g}</div><div class="gt">Gruppe ${g}<small>${GROUPS[g].length} Teams</small></div></div>
      <table><thead><tr><th class="l">Team</th><th>Sp</th><th>S-U-N</th><th>Tore</th><th>Diff</th><th>Pkt</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="grp-fix"><h4>Spiele (${_TF.primAbbr})</h4>${fix}</div>`;
    wrap.appendChild(card);
  });
  wrap.querySelectorAll(".score-in").forEach(inp=>{
    inp.addEventListener("input",e=>{
      let v=e.target.value.replace(/[^0-9]/g,"").slice(0,2); e.target.value=v;
      const k=e.target.dataset.k,s=e.target.dataset.s;
      scores[k]=scores[k]||{h:"",a:""}; scores[k][s]=v;
      saveScores();
      const pos=e.target.selectionStart;
      renderAll();
      const again=document.querySelector(`.score-in[data-k="${k}"][data-s="${s}"]`);
      if(again){again.focus(); try{again.setSelectionRange(pos,pos);}catch(_){}}
    });
  });
}

/* ============================== RENDER: BRACKET ============================== */
function pathClassForMatch(no){
  // returns set of ranks (1/2/3) whose scenario includes this match for selTeam
  if(!selTeam)return [];
  const ranks=[];
  activeRanks().forEach(rk=>{ if(scenarioMatches(selTeam,rk).all.includes(no)) ranks.push(rk); });
  return ranks;
}
function teamInSlotLabel(sl){
  // if a slot directly resolves to selTeam under an active/realized scenario, return {rank}
  if(!selTeam)return null;
  const g=TEAM2GROUP[selTeam]; const ar=activeRanks();
  if(sl.s==="W" && sl.g===g && ar.includes(1)) return {rank:1};
  if(sl.s==="R" && sl.g===g && ar.includes(2)) return {rank:2};
  if(sl.s==="T3" && sl.g.includes(g) && ar.includes(3)) return {rank:3};
  return null;
}
function makeBox(m){
  const box=document.createElement("div"); box.className="mbox";
  const ranks=pathClassForMatch(m.no);
  if(selTeam){
    if(ranks.length){
      if(ranks.includes(1))box.classList.add("path1");
      else if(ranks.includes(2))box.classList.add("path2");
      else box.classList.add("path3");
    } else box.classList.add("dim");
  }
  const inst=m.inst; const p=koParts(m.no); const winSide=koResultWinner(m.no); const s=koScores[m.no];
  const slotHTML=(sl,side,team)=>{
    if(team){
      const win=winSide===side;
      const hl=(team===selTeam)?" team-here":"";
      const goal = koScoreSet(m.no) ? `<span class="gl">${side==="a"?s.h:s.a}</span>` : (win?'<span class="wtick">✓</span>':"");
      return `<div class="mslot resolved${win?" win":""}${hl}" data-no="${m.no}" data-side="${side}"><span class="fl">${FLAG[team]}</span><span class="bn">${team}</span>${goal}</div>`;
    }
    const here=teamInSlotLabel(sl);
    if(here) return `<div class="mslot team-here"><span class="fl">${FLAG[selTeam]}</span>${selTeam}</div>`;
    return `<div class="mslot"><span class="ph">${slotLabel(sl)}</span></div>`;
  };
  const pen = koDraw(m.no)?'<span class="pen">i.E.</span>':"";
  box.innerHTML=`<span class="mno">#${m.no}</span>
    <div class="mdt">${berlinDayLabel(inst)} · ${berlinTime(inst)}${pen}</div>`+
    slotHTML(m.a,"a",p.a)+slotHTML(m.b,"b",p.b);
  return box;
}
/* order each column by the actual tree (derived recursively from the Final) so feeders align with their parent */
function bracketOrder(){
  const feeders=no=>[KOBY[no].a,KOBY[no].b].filter(s=>s.s==="win").map(s=>s.m);
  const FINAL=[104];
  const SF=FINAL.flatMap(feeders);
  const QF=SF.flatMap(feeders);
  const R16=QF.flatMap(feeders);
  const R32=R16.flatMap(feeders);
  return {R32,R16,QF,SF,FINAL};
}
function renderBracket(){
  const order=["R32","R16","QF","SF","FINAL"];
  const ord=bracketOrder();
  const counts={R32:16,R16:8,QF:4,SF:2,FINAL:1};
  const wrap=document.getElementById("bracket"); wrap.innerHTML="";
  order.forEach(rd=>{
    const col=document.createElement("div"); col.className="round-col"+(rd==="R32"?" r32":"")+(rd==="FINAL"?" final-col":"");
    col.innerHTML=`<div class="round-lbl">${RD_SHORT[rd]}<small>${counts[rd]} ${counts[rd]===1?"Spiel":"Spiele"}</small></div>`;
    const mc=document.createElement("div"); mc.className="matches";
    if(rd==="FINAL"){ const tr=document.createElement("div"); tr.className="trophy"; tr.textContent="🏆"; mc.appendChild(tr); }
    ord[rd].forEach(no=>mc.appendChild(makeBox(KOBY[no])));
    if(rd==="FINAL"){
      const lbl=document.createElement("div"); lbl.className="thirdlbl"; lbl.textContent="Spiel um Platz 3";
      mc.appendChild(lbl); mc.appendChild(makeBox(KOBY[103]));
    }
    col.appendChild(mc); wrap.appendChild(col);
  });
  wrap.querySelectorAll(".mslot.resolved").forEach(s=>s.addEventListener("click",()=>pickWinner(+s.dataset.no,s.dataset.side)));
}

/* ============================== RENDER: CALENDAR ============================== */
function projectedKoSet(){
  const map={}; // no -> highest priority rank (1>2>3)
  if(!selTeam)return map;
  activeRanks().forEach(rk=>{
    scenarioMatches(selTeam,rk).all.forEach(no=>{ if(!(no in map)) map[no]=rk; });
  });
  return map;
}
function koSlotText(m){
  const p=koParts(m.no);
  const a=p.a?`${FLAG[p.a]} ${p.a}`:slotLabel(m.a);
  const b=p.b?`${FLAG[p.b]} ${p.b}`:slotLabel(m.b);
  return `<span class="vs"><span class="mid">#${m.no}</span> ${a} <span class="mid">–</span> ${b}</span>`;
}
function passFilter(m,proj){
  if(calFilter==="group"&&m.type!=="group")return false;
  if(calFilter==="ko"&&m.type!=="ko")return false;
  if(calFilter==="team"){
    const isTeam=(m.type==="group"&&(m.home===selTeam||m.away===selTeam))||(m.type==="ko"&&(m.no in proj));
    if(!isTeam)return false;
  }
  return true;
}
function buildCalRow(m,proj){
  const row=document.createElement("div"); row.className="cal-row";
  let isHl=false,isProj=false;
  if(selTeam){
    if(m.type==="group"&&(m.home===selTeam||m.away===selTeam))isHl=true;
    if(m.type==="ko"&&(m.no in proj))isProj=true;
    if(!isHl&&!isProj&&calFilter!=="team")row.classList.add("dimmed");
  }
  if(isHl)row.classList.add("hl");
  if(isProj)row.classList.add("proj");
  let mid="";
  if(m.type==="group"){
    const hh=(m.home===selTeam)?`<b>${m.home}</b>`:m.home;
    const aa=(m.away===selTeam)?`<b>${m.away}</b>`:m.away;
    mid=`<div class="cal-match"><span class="gtag" style="--gcol:${GCOL[m.group]};background:${GCOL[m.group]}">Gr. ${m.group}</span>
      <span class="vs">${FLAG[m.home]} ${hh} <span class="mid">–</span> ${FLAG[m.away]} ${aa}</span></div>`;
  } else {
    const projRank=proj[m.no];
    const rankTxt=projRank?` <span class="proj-badge">${projRank===1?"als Sieger":projRank===2?"als Zweiter":"als 3."}</span>`:"";
    mid=`<div class="cal-match"><span class="kotag">${RD_SHORT[m.rd]}</span>${koSlotText(m)}${rankTxt}</div>`;
  }
  row.innerHTML=`<div class="cal-time">${berlinTime(m.inst)}<small>${etTime(m.inst)} ${_TF.secAbbr}</small></div>
    ${mid}
    <div class="cal-venue">${m.venue}<small>${m.city}</small></div>`;
  return row;
}
function daysMap(proj){
  const days={};
  MATCHES.forEach(m=>{ if(!passFilter(m,proj))return; const k=berlinKey(m.inst); (days[k]=days[k]||[]).push(m); });
  Object.values(days).forEach(l=>l.sort((a,b)=>a.inst-b.inst));
  return days;
}
function renderCalendar(){ if(calView==="month")renderCalMonth(); else renderCalList(); }

function renderCalList(){
  const cal=document.getElementById("calendar"); cal.innerHTML="";
  const proj=projectedKoSet();
  const days=daysMap(proj);
  const blockedDates=blockedDateKeys();
  Object.keys(days).sort().forEach(k=>{
    const list=days[k]; const inst0=list[0].inst;
    const stages=[...new Set(list.map(m=>m.type==="ko"?RD_NAME[m.rd]:"Gruppenphase"))];
    const dayEl=document.createElement("div"); dayEl.className="day";
    const isBlocked=blockedDates.has(k);
    dayEl.innerHTML=`<div class="day-h">
      <span class="dn">${berlinDayLabel(inst0)}</span>
      <span class="dw">${berlinWeekday(inst0)}</span>
      ${isBlocked?'<span class="blockflag">★ freihalten</span>':''}
      <span class="ph-stage">${stages.join(" · ")}</span></div>`;
    list.forEach(m=>dayEl.appendChild(buildCalRow(m,proj)));
    cal.appendChild(dayEl);
  });
}

function renderCalMonth(){
  const cal=document.getElementById("calendar"); cal.innerHTML="";
  const proj=projectedKoSet();
  const days=daysMap(proj);
  const blocked=blockedDateKeys();
  const note=document.createElement("p"); note.className="mo-hint";
  note.innerHTML="Turnierzeitraum 11. Juni – 19. Juli 2026 · Tag anklicken für die Spieldetails.";
  cal.appendChild(note);
  const wrap=document.createElement("div"); wrap.className="months";
  [[2026,6,"Juni"],[2026,7,"Juli"]].forEach(([y,mo,name])=>wrap.appendChild(buildMonth(y,mo,name,days,blocked)));
  cal.appendChild(wrap);
  cal.querySelectorAll(".mo-cell.has").forEach(c=>c.addEventListener("click",()=>openDayModal(c.dataset.key)));
}
function buildMonth(y,mo,name,days,blocked){
  const box=document.createElement("div"); box.className="month";
  const nDays=new Date(y,mo,0).getDate();
  const startDow=(new Date(y,mo-1,1).getDay()+6)%7; // Monday=0
  const wd=["Mo","Di","Mi","Do","Fr","Sa","So"];
  let cells=wd.map(d=>`<div class="mo-wd">${d}</div>`).join("");
  for(let i=0;i<startDow;i++) cells+='<div class="mo-cell empty"></div>';
  for(let d=1;d<=nDays;d++){
    const key=`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const ms=days[key]||[]; const has=ms.length>0; const isBlk=blocked.has(key);
    let dots="";
    if(has){
      const uniq=[...new Set(ms.map(m=>m.type==="group"?("g"+m.group):"ko"))].slice(0,7);
      dots=uniq.map(u=>`<i style="background:${u==="ko"?"var(--gold)":GCOL[u.slice(1)]}"></i>`).join("");
    }
    cells+=`<div class="mo-cell ${has?"has":"none"}${isBlk?" blk":""}" data-key="${key}">
      <span class="mo-dn">${d}</span>
      ${isBlk?'<span class="mo-star">★</span>':''}
      ${has?`<span class="mo-cnt">${ms.length}</span><div class="mo-dots">${dots}</div>`:''}</div>`;
  }
  box.innerHTML=`<div class="mo-h">${name} 2026</div><div class="mo-grid">${cells}</div>`;
  return box;
}
function dayMatchesAll(key){ return MATCHES.filter(m=>berlinKey(m.inst)===key).sort((a,b)=>a.inst-b.inst); }
function openDayModal(key,forceAll){
  const proj=projectedKoSet();
  const ms = forceAll ? dayMatchesAll(key) : (daysMap(proj)[key]||[]);
  if(!ms||!ms.length)return;
  const inst0=ms[0].inst;
  const stages=[...new Set(ms.map(m=>m.type==="ko"?RD_NAME[m.rd]:"Gruppenphase"))];
  const isBlk=blockedDateKeys().has(key);
  document.getElementById("dayModalHead").innerHTML=`
    <div class="md-title"><span class="dn">${berlinDayLabel(inst0)}</span><span class="dw">${berlinWeekday(inst0)}</span></div>
    ${isBlk?'<span class="blockflag">★ freihalten</span>':''}
    <span class="ph-stage">${stages.join(" · ")}</span>`;
  const body=document.getElementById("dayModalBody"); body.innerHTML="";
  ms.forEach(m=>body.appendChild(buildCalRow(m,proj)));
  document.getElementById("dayModal").classList.add("open");
}
function closeDayModal(){ document.getElementById("dayModal").classList.remove("open"); }

/* ============================== RENDER: PLANNER ============================== */
function blockedDateKeys(){
  const set=new Set();
  if(!selTeam)return set;
  // fixed group games
  MATCHES.forEach(m=>{ if(m.type==="group"&&(m.home===selTeam||m.away===selTeam)) set.add(berlinKey(m.inst)); });
  // scenario KO games (collapse to the realized rank once the placement is determined)
  activeRanks().forEach(rk=>{
    scenarioMatches(selTeam,rk).all.forEach(no=>set.add(berlinKey(KOBY[no].inst)));
  });
  return set;
}
function renderScenarioCards(){
  const grid=document.getElementById("scnGrid"); if(!grid)return; grid.innerHTML="";
  if(!selTeam){ return; }
  const g=TEAM2GROUP[selTeam];
  const det=determinedRank(selTeam); const ar=activeRanks();
  const meta=[
    {rk:1,col:"var(--gold)",t:"Gruppensieger",sub:"Platz 1 in Gruppe "+g},
    {rk:2,col:"var(--blue)",t:"Gruppenzweiter",sub:"Platz 2 in Gruppe "+g},
    {rk:3,col:"var(--violet)",t:"Gruppendritter",sub:"Platz 3 in Gruppe "+g}
  ];
  meta.forEach(mt=>{
    const sc=scenarioMatches(selTeam,mt.rk);
    const koDays=new Set(sc.all.map(no=>berlinKey(KOBY[no].inst))).size;
    const on=ar.includes(mt.rk);
    const card=document.createElement("div");
    card.className="scn"+(on?" on":"")+(det!=null?" locked":""); card.style.setProperty("--scol",mt.col);
    const fixed = det!=null && det===mt.rk ? `<span class="scn-fixed">steht fest</span>` : "";
    const body = mt.rk===3
      ? `<div class="scn-body"><div class="scn-note">⚠ Als Dritter nicht sicher weiter — nur die 8 besten Gruppendritten ziehen ein. Bis zu ${koDays} mögliche K.-o.-Tage im Kalender.</div></div>`
      : `<div class="scn-body"><div class="scn-mini">${koDays} mögliche K.-o.-Tage im Kalender markiert</div></div>`;
    card.innerHTML=`
      <div class="scn-top" data-rk="${mt.rk}">
        <div class="scn-rank">${mt.rk}</div>
        <div class="t">${mt.t}<small>${mt.sub}</small></div>
        ${fixed||'<div class="toggle"></div>'}
      </div>${body}`;
    grid.appendChild(card);
  });
  if(det==null){
    grid.querySelectorAll(".scn-top").forEach(el=>{
      el.addEventListener("click",()=>{ const rk=+el.dataset.rk; scnOn[rk]=!scnOn[rk]; renderAll(); });
    });
  }
}
function blockCatMap(){
  // key -> {fix:bool, ranks:Set, inst, entries:Map(id->{inst,cat})}  cat: 0=Gruppenspiel, 1/2/3=Platzierung
  const map={};
  const ensure=(k,inst)=>map[k]||(map[k]={fix:false,ranks:new Set(),inst,entries:new Map()});
  MATCHES.forEach(m=>{ if(m.type==="group"&&(m.home===selTeam||m.away===selTeam)){
    const o=ensure(berlinKey(m.inst),m.inst); o.fix=true; o.entries.set(m.id,{inst:m.inst,cat:0}); }});
  activeRanks().forEach(rk=>{
    scenarioMatches(selTeam,rk).all.forEach(no=>{ const m=KOBY[no]; const o=ensure(berlinKey(m.inst),m.inst);
      o.ranks.add(rk); const id="k"+no; const ex=o.entries.get(id);
      if(!ex) o.entries.set(id,{inst:m.inst,cat:rk});
      else if(ex.cat!==0 && rk<ex.cat) ex.cat=rk; });
  });
  return map;
}
function buildMiniMonth(y,mo,name,map){
  const box=document.createElement("div"); box.className="bc-month";
  const nDays=new Date(y,mo,0).getDate();
  const startDow=(new Date(y,mo-1,1).getDay()+6)%7;
  const wd=["M","D","M","D","F","S","S"];
  let cells=wd.map(d=>`<div class="bc-wd">${d}</div>`).join("");
  for(let i=0;i<startDow;i++) cells+='<div class="bc-cell pad"></div>';
  for(let d=1;d<=nDays;d++){
    const key=`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const o=map[key];
    if(!o){ cells+=`<div class="bc-cell off"><span class="bc-dn">${d}</span></div>`; continue; }
    const entries=[...o.entries.values()].sort((a,b)=>a.inst-b.inst);
    const catCls=c=>c===0?"g":"r"+c;
    const shown=entries.slice(0,3);
    let times=shown.map(e=>`<span class="bt ${catCls(e.cat)}">${berlinTime(e.inst)}</span>`).join("");
    if(entries.length>3) times+=`<span class="bt more">+${entries.length-3}</span>`;
    const cls=o.fix?"fix":"ko";
    cells+=`<div class="bc-cell on ${cls}" data-key="${key}" title="${berlinDayLabel(o.inst)}"><span class="bc-dn">${d}</span><div class="bc-times">${times}</div></div>`;
  }
  box.innerHTML=`<div class="bc-h">${name}</div><div class="bc-grid">${cells}</div>`;
  return box;
}
function renderBlockSummary(){
  const box=document.getElementById("blockSum"); if(!box)return;
  if(!selTeam){ box.style.display="none"; return; }
  box.style.display="block";
  const map=blockCatMap();
  const fixDays=Object.values(map).filter(o=>o.fix).length;
  const koDays=Object.values(map).filter(o=>o.ranks.size>0).length;
  box.innerHTML=`<h3>🗓️ Sperrtermine — ${selTeam} ${FLAG[selTeam]}</h3>
    <p class="hint">${fixDays} fixe Gruppenspiele · ${koDays} mögliche K.-o.-Tage (je nach aktivierten Szenarien). Tag anklicken für Details · Zeiten ${_TF.primAbbr}.</p>
    <div class="blockcal" id="blockCal"></div>
    <div class="bc-legend">
      <span><i class="g"></i>Gruppenspiel (fix)</span>
      <span><i class="r1"></i>als Sieger</span>
      <span><i class="r2"></i>als Zweiter</span>
      <span><i class="r3"></i>als 3.</span>
    </div>`;
  const cal=document.getElementById("blockCal");
  cal.appendChild(buildMiniMonth(2026,6,"Juni 2026",map));
  cal.appendChild(buildMiniMonth(2026,7,"Juli 2026",map));
  cal.querySelectorAll(".bc-cell.on").forEach(c=>c.addEventListener("click",()=>openDayModal(c.dataset.key,true)));
}

/* ============================== RENDER: KO SIMULATION ============================== */
function renderKoSim(){
  const wrap=document.getElementById("koSim"); if(!wrap)return;
  const complete=allGroupsComplete();
  const played=gamesPlayed();
  let html=`<div class="section-title" style="margin-top:34px">K.-o.-Phase — Ergebnisse eintragen <span class="ln"></span></div>`;
  html+=`<p class="section-sub">${complete
    ? "Alle Gruppen vollständig. Trage Ergebnisse ein (oder klicke direkt den Sieger an) — die nächste Runde füllt sich automatisch. Bei Unentschieden wählst du den Sieger im Elfmeterschießen."
    : `Trage die Gruppenergebnisse oben ein (${played}/72 Spiele). Plätze 1 & 2 stehen fest, sobald eine Gruppe komplett ist; die 8 besten Dritten werden erst nach <b>allen</b> Gruppen zugeordnet.`}</p>`;

  const champ=koWinner(104);
  if(champ) html+=`<div class="champ-banner">🏆 Weltmeister: <span class="fl">${FLAG[champ]}</span> <b>${champ}</b></div>`;

  if(complete){
    const ranking=thirdRanking();
    const qualG=new Set(ranking.slice(0,8).map(o=>o.g));
    const slotByGroup={}; if(T3MAP)Object.entries(T3MAP).forEach(([no,g])=>slotByGroup[g]=no);
    let chips=ranking.map((o,i)=>{
      const q=qualG.has(o.g);
      const slot=q&&slotByGroup[o.g]?` → Sp. ${slotByGroup[o.g]}`:"";
      return `<span class="third-chip ${q?"q":"out"}"><b>${i+1}.</b> ${FLAG[o.t]} ${o.t} <small>Gr. ${o.g} · ${o.pts} Pkt${slot}</small></span>`;
    }).join("");
    html+=`<div class="thirds-panel"><h4>Beste Gruppendritte — 8 von 12 qualifiziert</h4><div class="third-chips">${chips}</div></div>`;
  }

  const rounds=[["R32","Sechzehntelfinale"],["R16","Achtelfinale"],["QF","Viertelfinale"],["SF","Halbfinale"],["3RD","Spiel um Platz 3"],["FINAL","Finale"]];
  rounds.forEach(([rd,name])=>{
    const ms=KO.filter(m=>m.rd===rd).sort((a,b)=>a.no-b.no);
    let rowsH="";
    ms.forEach(m=>{
      const p=koParts(m.no); const ready=p.a&&p.b;
      const winSide=koResultWinner(m.no);
      const s=koScores[m.no]||{h:"",a:""};
      const team=(side,t)=>{
        if(!t)return `<div class="ko-team ph">${slotLabel(side==="a"?m.a:m.b)}</div>`;
        const win=winSide===side;
        return `<button class="ko-team${win?" win":""}" data-no="${m.no}" data-side="${side}"><span class="fl">${FLAG[t]}</span><span class="nm">${t}</span></button>`;
      };
      const dis=ready?"":"disabled";
      rowsH+=`<div class="ko-match">
        <div class="ko-meta"><span class="mno">#${m.no}</span>${berlinDayLabel(m.inst)}<br>${berlinTime(m.inst)} · ${m.c}</div>
        <div class="ko-tw left">${team("a",p.a)}</div>
        <div class="ko-score-box">
          <input class="score-in ko-score" data-ko="${m.no}" data-side="h" inputmode="numeric" value="${s.h}" ${dis}>
          <span class="cln">:</span>
          <input class="score-in ko-score" data-ko="${m.no}" data-side="a" inputmode="numeric" value="${s.a}" ${dis}>
        </div>
        <div class="ko-tw right">${team("b",p.b)}</div>
      </div>`;
      if(koDraw(m.no)){
        const wTxt = winSide?`Weiter per Elfmeterschießen: <b>${winSide==="a"?p.a:p.b}</b>` : "Unentschieden — Sieger anklicken (Elfmeterschießen)";
        rowsH+=`<div class="ko-draw">⚽ ${wTxt}</div>`;
      }
    });
    html+=`<div class="ko-round"><h4>${name}</h4>${rowsH}</div>`;
  });
  wrap.innerHTML=html;
  wrap.querySelectorAll(".ko-team").forEach(b=>{ if(b.tagName==="BUTTON") b.addEventListener("click",()=>pickWinner(+b.dataset.no,b.dataset.side)); });
  wrap.querySelectorAll(".ko-score").forEach(inp=>{
    inp.addEventListener("input",e=>{
      let v=e.target.value.replace(/[^0-9]/g,"").slice(0,2); e.target.value=v;
      const no=+e.target.dataset.ko, side=e.target.dataset.side;
      koScores[no]=koScores[no]||{h:"",a:""}; koScores[no][side]=v;
      saveKoScores();
      const pos=e.target.selectionStart; renderAll();
      const again=document.querySelector(`.ko-score[data-ko="${no}"][data-side="${side}"]`);
      if(again){again.focus(); try{again.setSelectionRange(pos,pos);}catch(_){}}
    });
  });
}

/* ============================== MONTE-CARLO SIMULATOR ============================== */
let SIMRES=null;
function simStandings(group,gs){
  const tab={}; GROUPS[group].forEach(t=>tab[t]={t,sp:0,s:0,u:0,n:0,gf:0,ga:0,pts:0});
  GM.forEach((r,i)=>{ if(r[0]!==group)return; const sc=gs["g"+i]; if(!sc)return;
    const h=sc.h,a=sc.a; const H=tab[r[3]],A=tab[r[4]]; H.sp++;A.sp++;H.gf+=h;H.ga+=a;A.gf+=a;A.ga+=h;
    if(h>a){H.s++;A.n++;H.pts+=3;}else if(h<a){A.s++;H.n++;A.pts+=3;}else{H.u++;A.u++;H.pts++;A.pts++;} });
  return Object.values(tab).sort((x,y)=>y.pts-x.pts||(y.gf-y.ga)-(x.gf-x.ga)||y.gf-x.gf||GROUPS[group].indexOf(x.t)-GROUPS[group].indexOf(y.t));
}
function pois(l){let L=Math.exp(-l),k=0,p=1;do{k++;p*=Math.random();}while(p>L);return k-1;}
function expLambdas(a,b){const ra=FIFA[a]||1300,rb=FIFA[b]||1300;const sup=(ra-rb)/300;const base=1.35;return [base*Math.exp(0.45*sup),base*Math.exp(-0.45*sup)];}
function simGoals(a,b){const[la,lb]=expLambdas(a,b);return [Math.min(pois(la),9),Math.min(pois(lb),9)];}
function clamp(v,lo,hi){return v<lo?lo:v>hi?hi:v;}
function simKoOutcome(a,b){
  let [ga,gb]=simGoals(a,b); let pen=null;
  if(ga===gb){ const pa=clamp(0.5+((FIFA[a]||1300)-(FIFA[b]||1300))/4000,0.33,0.67); pen=Math.random()<pa?"a":"b"; }
  return {ga,gb,pen};
}
function userGroupScore(i){const u=scores["g"+i];return (u&&u.h!==""&&u.a!==""&&u.h!=null&&u.a!=null)?{h:+u.h,a:+u.a}:null;}
function userKoScore(no){const u=koScores[no];return (u&&u.h!==""&&u.a!==""&&u.h!=null&&u.a!=null)?{h:+u.h,a:+u.a}:null;}
function runSimulation(useBase){
  const gs={};
  GM.forEach((r,i)=>{ const ub=useBase&&userGroupScore(i); if(ub){gs["g"+i]={h:ub.h,a:ub.a};} else {const [x,y]=simGoals(r[3],r[4]);gs["g"+i]={h:x,a:y};} });
  const pos={}; Object.keys(GROUPS).forEach(g=>{ pos[g]=simStandings(g,gs).map(o=>o.t); });
  const thirds=Object.keys(GROUPS).map(g=>{const s=simStandings(g,gs)[2];return {g,t:s.t,pts:s.pts,gd:s.gf-s.ga,gf:s.gf};});
  thirds.sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf||a.g.localeCompare(b.g));
  const quals=thirds.slice(0,8).map(o=>o.g);
  const t3map=matchThirds(quals);
  const A={},B={},WIN={},LOSE={},SC={};
  const resolve=(sl,no)=>{
    if(sl.s==="W")return pos[sl.g][0];
    if(sl.s==="R")return pos[sl.g][1];
    if(sl.s==="T3"){const g=t3map[no];return g?pos[g][2]:null;}
    if(sl.s==="win")return WIN[sl.m];
    if(sl.s==="lose")return LOSE[sl.m];
    return null;
  };
  ["R32","R16","QF","SF","3RD","FINAL"].forEach(rd=>{
    KO.filter(m=>m.rd===rd).sort((a,b)=>a.no-b.no).forEach(m=>{
      const ta=resolve(m.a,m.no), tb=resolve(m.b,m.no); A[m.no]=ta; B[m.no]=tb;
      const ub=useBase&&userKoScore(m.no);
      if(ub){ let pen=null; if(ub.h===ub.a) pen=koPicks[m.no]||(Math.random()<0.5?"a":"b"); SC[m.no]={ga:ub.h,gb:ub.a,pen}; }
      else SC[m.no]=simKoOutcome(ta,tb);
      const o=SC[m.no]; const w=o.ga>o.gb?"a":o.gb>o.ga?"b":o.pen;
      WIN[m.no]=w==="a"?ta:tb; LOSE[m.no]=w==="a"?tb:ta;
    });
  });
  return {gs,pos,quals,t3map,A,B,WIN,LOSE,SC,champ:WIN[104],runnerup:LOSE[104],third:WIN[103],useBase};
}
function simSlotHTML(team,side,m,res){
  if(!team)return `<div class="mslot"><span class="ph">—</span></div>`;
  const o=res.SC[m.no]; const w=o?(o.ga>o.gb?"a":o.gb>o.ga?"b":o.pen):null; const win=w===side;
  const goal=o?`<span class="gl">${side==="a"?o.ga:o.gb}</span>`:"";
  const hl=(team===selTeam)?" team-here":"";
  return `<div class="mslot resolved${win?" win":""}${hl}"><span class="fl">${FLAG[team]}</span><span class="bn">${team}</span>${goal}</div>`;
}
function makeSimBox(m,res){
  const box=document.createElement("div"); box.className="mbox";
  const o=res.SC[m.no]; const pen=(o&&o.ga===o.gb)?'<span class="pen">i.E.</span>':"";
  box.innerHTML=`<span class="mno">#${m.no}</span><div class="mdt">${berlinDayLabel(m.inst)} · ${berlinTime(m.inst)}${pen}</div>`+
    simSlotHTML(res.A[m.no],"a",m,res)+simSlotHTML(res.B[m.no],"b",m,res);
  return box;
}
function renderSimBracket(res){
  const wrap=document.getElementById("simBracket"); if(!wrap)return;
  const order=["R32","R16","QF","SF","FINAL"]; const ord=bracketOrder();
  const counts={R32:16,R16:8,QF:4,SF:2,FINAL:1}; wrap.innerHTML="";
  order.forEach(rd=>{
    const col=document.createElement("div"); col.className="round-col"+(rd==="R32"?" r32":"")+(rd==="FINAL"?" final-col":"");
    col.innerHTML=`<div class="round-lbl">${RD_SHORT[rd]}<small>${counts[rd]} ${counts[rd]===1?"Spiel":"Spiele"}</small></div>`;
    const mc=document.createElement("div"); mc.className="matches";
    if(rd==="FINAL"){const tr=document.createElement("div");tr.className="trophy";tr.textContent="🏆";mc.appendChild(tr);}
    ord[rd].forEach(no=>mc.appendChild(makeSimBox(KOBY[no],res)));
    if(rd==="FINAL"){const lbl=document.createElement("div");lbl.className="thirdlbl";lbl.textContent="Spiel um Platz 3";mc.appendChild(lbl);mc.appendChild(makeSimBox(KOBY[103],res));}
    col.appendChild(mc); wrap.appendChild(col);
  });
}
function renderSim(){
  const out=document.getElementById("simOut"); if(!out||!SIMRES)return;
  const res=SIMRES; const fo=res.SC[104];
  const fScore=fo?`${fo.ga}:${fo.gb}${fo.ga===fo.gb?" i.E.":""}`:"";
  let groups='<div class="sim-groups">';
  Object.keys(GROUPS).forEach(g=>{
    const st=simStandings(g,res.gs); const q3=res.quals.includes(g);
    groups+=`<div class="sim-grp"><div class="sg-h"><span class="gb" style="background:${GCOL[g]}">${g}</span>Gruppe ${g}</div>`;
    st.forEach((row,i)=>{ const adv=i<2?"adv":(i===2&&q3?"adv3":"");
      groups+=`<div class="sg-row ${adv}"><span class="pos">${i+1}</span><span class="fl">${FLAG[row.t]}</span><span class="nm">${row.t}</span><span class="pts">${row.pts}</span></div>`; });
    groups+="</div>";
  });
  groups+="</div>";
  out.innerHTML=`
    <div class="sim-champ">
      <div class="cup">🏆</div>
      <div class="ctxt"><div class="ttl">Weltmeister 2026</div>
        <div class="team">${FLAG[res.champ]} ${res.champ}</div>
        <div class="sub">Finale: ${res.champ} <b>${fScore}</b> ${res.runnerup} &nbsp;·&nbsp; 🥉 Platz 3: ${FLAG[res.third]} ${res.third}</div>
        <div class="base-note">${res.useBase?"inkl. deiner eingetragenen Ergebnisse":"komplett zufällig (ohne deine Ergebnisse)"}</div>
      </div>
    </div>
    <div class="section-title" style="font-size:18px;margin-top:26px">Turnierbaum <span class="ln"></span></div>
    <div class="bracket-scroll"><div class="bracket" id="simBracket"></div></div>
    <div class="section-title" style="font-size:18px;margin-top:26px">Gruppen-Endstand <span class="ln"></span></div>
    ${groups}`;
  renderSimBracket(res);
}
function renderFifaRanking(){
  const el=document.getElementById("fifaList"); if(!el)return;
  const arr=Object.entries(FIFA).map(([t,p])=>({t,p})).sort((a,b)=>b.p-a.p);
  const max=arr[0].p, min=arr[arr.length-1].p, span=(max-min)||1;
  el.innerHTML=arr.map((o,i)=>{
    const g=TEAM2GROUP[o.t];
    const w=(8+(o.p-min)/span*92).toFixed(0);
    return `<div class="fifa-row${o.t===selTeam?' faved':''}">
      <span class="fr-rank">${i+1}</span>
      <span class="fr-team"><span class="fl">${FLAG[o.t]}</span><span class="nm">${o.t}${o.t===selTeam?' <span class="favstar">★</span>':''}</span></span>
      <span class="fr-grp" style="background:${GCOL[g]}">${g}</span>
      <div class="fr-barwrap"><div class="fr-bar" style="width:${w}%"></div></div>
      <span class="fr-pts">${o.p.toFixed(0)}</span>
    </div>`;
  }).join("");
}
function runManySimulations(n,useBase){
  const champ={},finalist={};
  for(let i=0;i<n;i++){
    const r=runSimulation(useBase);
    champ[r.champ]=(champ[r.champ]||0)+1;
    finalist[r.champ]=(finalist[r.champ]||0)+1;
    finalist[r.runnerup]=(finalist[r.runnerup]||0)+1;
  }
  return {champ,finalist};
}
function renderDistribution(res,n,useBase){
  const out=document.getElementById("simOut"); if(!out)return;
  const arr=Object.entries(res.champ).map(([t,c])=>({t,c,p:c/n*100,fin:res.finalist[t]||0})).sort((a,b)=>b.c-a.c);
  const max=arr.length?arr[0].c:1;
  const rows=arr.map((o,i)=>`
    <div class="dist-row">
      <span class="dr-rank">${i+1}</span>
      <span class="dr-team"><span class="fl">${FLAG[o.t]}</span><span class="nm">${o.t}</span></span>
      <div class="dr-barwrap"><div class="dr-bar" style="width:${Math.max(2,o.c/max*100).toFixed(1)}%"></div></div>
      <span class="dr-pct">${o.p.toFixed(1)}%</span>
      <span class="dr-cnt">${o.c}×</span>
    </div>`).join("");
  out.innerHTML=`
    <div class="dist-head">
      <div><div class="dh-ttl">Weltmeister-Häufigkeit</div>
        <div class="dh-sub">${n.toLocaleString("de-DE")} Simulationen · ${arr.length} verschiedene Champions · ${useBase?"inkl. deiner Ergebnisse":"komplett zufällig"}</div></div>
    </div>
    <div class="dist-list">${rows}</div>
    <p class="section-sub" style="margin-top:14px">Wahrscheinlichkeiten basieren auf den FIFA-Punkten (Stand 10. Juni 2026). Mehr Simulationen → stabilere Werte.</p>`;
}
/* ============================== TIPPSPIEL ============================== */
function b64enc(obj){const s=JSON.stringify(obj);const by=new TextEncoder().encode(s);let bin="";by.forEach(b=>bin+=String.fromCharCode(b));return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function b64dec(code){let c=code.replace(/-/g,"+").replace(/_/g,"/");const bin=atob(c);const by=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)by[i]=bin.charCodeAt(i);return JSON.parse(new TextDecoder().decode(by));}
function encodeTip(t){
  const g=GM.map((_,i)=>{const p=t.g["g"+i];return (p&&p[0]!==""&&p[1]!==""&&p[0]!=null&&p[1]!=null)?[+p[0],+p[1]]:null;});
  const b=(t.b||[]).map(nm=>nm?TEAMS.indexOf(nm):null);
  return b64enc({v:1,n:t.name||"",g,b});
}
function decodeTip(code){
  const o=b64dec(code.trim()); const g={};
  (o.g||[]).forEach((p,i)=>{ if(p&&p[0]!=null&&p[1]!=null)g["g"+i]=[+p[0],+p[1]]; });
  const b=(o.b||[null,null,null,null]).map(ix=>(ix==null?null:(TEAMS[ix]||null)));
  return {name:(o.n||"Spieler").slice(0,40),g,b};
}
function scoreGroupTip(t,a){
  const th=+t[0],ta=+t[1],ah=a.h,aa=a.a;
  if(th===ah&&ta===aa)return 4;
  const dd=th-ta,da=ah-aa;
  if(dd===da&&dd!==0)return 3;
  const sg=x=>x>0?1:x<0?-1:0;
  if(sg(dd)===sg(da))return 2;
  return 0;
}
function scorePlayer(p){
  let grp=0,exact=0,counted=0;
  GM.forEach((r,i)=>{ const t=p.g["g"+i]; if(!t||t[0]===""||t[1]===""||t[0]==null||t[1]==null)return;
    const a=scores["g"+i]; if(!a||a.h===""||a.a===""||a.h==null||a.a==null)return;
    const pt=scoreGroupTip(t,{h:+a.h,a:+a.a}); grp+=pt; counted++; if(pt===4)exact++; });
  let bonus=0; const b=p.b||[];
  const champ=koWinner(104); if(champ&&b[0]&&b[0]===champ)bonus+=20;
  const f=koParts(104); const fin=[f.a,f.b].filter(Boolean);
  [b[0],b[1]].forEach(x=>{ if(x&&fin.includes(x))bonus+=8; });
  const s1=koParts(101),s2=koParts(102); const semi=[s1.a,s1.b,s2.a,s2.b].filter(Boolean);
  [b[2],b[3]].forEach(x=>{ if(x&&semi.includes(x))bonus+=4; });
  return {total:grp+bonus,grp,bonus,exact,counted};
}
function teamOptions(sel){
  return '<option value="">— wählen —</option>'+TEAMS.slice().sort((a,b)=>a.localeCompare(b,"de")).map(t=>`<option value="${t}"${t===sel?" selected":""}>${t}</option>`).join("");
}
/* ===================== Cloud-Tippspiel (Supabase, optional) =====================
   Trage die Projekt-URL und den OEFFENTLICHEN anon-Key deines kostenlosen
   Supabase-Projekts ein, um Tipprunden online zu teilen. Bleiben beide leer,
   funktioniert das Tippspiel rein lokal (Code-Austausch) wie bisher.
   NIE den geheimen service_role-Key hier eintragen. */
const SUPABASE_URL = "https://sxsxbosroharlvitcopf.supabase.co";        // z.B. "https://abcdxyz.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4c3hib3Nyb2hhcmx2aXRjb3BmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MTc3MzMsImV4cCI6MjA5NjM5MzczM30.xthyyzxc70yaL1IRKsrBQxpsvzjt6g-TQxOoR7nKiqQ";   // oeffentlicher "anon"-Key
const CLOUD_ON = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
let cloudRound = null;
try { cloudRound = localStorage.getItem("wm2026_round") || null; } catch(_){}
let cloudPollTimer = null, cloudPushTimer = null, cloudBusy = false;

let sbClient = null, sbUid = null;
async function cloudClient(){
  if(sbClient) return sbClient;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  sbClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth:{ persistSession:true, autoRefreshToken:true, storageKey:"wm2026_sb_auth" }
  });
  return sbClient;
}
// Anonyme Identität sicherstellen (nötig für Schreibzugriffe; Lesen geht auch ohne).
async function cloudAuth(){
  const sb = await cloudClient();
  let { data:{ session } } = await sb.auth.getSession();
  if(!session){
    const { data, error } = await sb.auth.signInAnonymously();
    if(error) throw new Error("Anonyme Anmeldung fehlgeschlagen (in Supabase 'Anonymous sign-ins' aktivieren): "+error.message);
    session = data.session;
  }
  sbUid = session && session.user ? session.user.id : null;
  return sb;
}
function cloudSetStatus(msg, kind){
  const el = document.getElementById("cloudStatus"); if(!el) return;
  el.textContent = msg || ""; el.className = "cloud-status" + (kind ? " "+kind : "");
}
function randomCode(){ const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s=""; for(let i=0;i<5;i++)s+=a[Math.floor(Math.random()*a.length)]; return "WM-"+s; }
function cloudTipFilled(){ return !!(myTip.name && (Object.keys(myTip.g).length || (myTip.b||[]).some(Boolean))); }

async function cloudCreateRound(){
  if(!CLOUD_ON()) return;
  if(!myTip.name){ alert("Bitte zuerst oben deinen Namen eingeben."); return; }
  const sb = await cloudAuth();
  let code = null, lastErr = null;
  for(let i=0;i<6;i++){
    const c = randomCode();
    const { error } = await sb.from("rounds").insert({ code:c, name:"WM 2026 Tipprunde" });
    if(!error){ code = c; break; }
    lastErr = error;
    // 23505 = unique_violation (Code bereits vergeben) → neuen Code versuchen.
    const dup = error.code === "23505" || /duplicate|unique/i.test(error.message||"");
    if(!dup) throw new Error(error.message);
  }
  if(!code) throw new Error("Konnte keinen freien Runden-Code erzeugen. Bitte erneut versuchen." + (lastErr&&lastErr.message?" ("+lastErr.message+")":""));
  await cloudSetRound(code);
}
async function cloudJoinRound(code){
  if(!CLOUD_ON()) return;
  code = (code||"").trim().toUpperCase();
  if(!code){ alert("Bitte einen Runden-Code eingeben."); return; }
  if(!myTip.name){ alert("Bitte zuerst oben deinen Namen eingeben."); return; }
  const sb = await cloudAuth();
  const { data: rounds, error } = await sb.from("rounds").select("code").eq("code", code).limit(1);
  if(error) throw new Error(error.message);
  if(!rounds || !rounds.length){ alert("Runde nicht gefunden: "+code); return; }
  // Namens-Kollision prüfen: gehört der Name in dieser Runde schon jemand anderem?
  const { data: ex } = await sb.from("tips").select("player,owner").eq("round_code", code);
  const clash = (ex||[]).some(r => (r.player||"").toLowerCase()===myTip.name.toLowerCase() && r.owner && r.owner!==sbUid);
  if(clash){ alert("In dieser Runde gibt es bereits einen Mitspieler „"+myTip.name+"\". Bitte oben einen anderen Namen wählen und erneut beitreten."); return; }
  await cloudSetRound(code);
}
async function cloudSetRound(code){
  cloudRound = code; try{ localStorage.setItem("wm2026_round", code); }catch(_){}
  if(cloudTipFilled()) { try{ await cloudPushNow(); }catch(e){ console.warn(e); } }
  await cloudPullTips();
  cloudStartPolling();
  renderTippspiel();
}
function cloudLeaveRound(){
  cloudRound = null; try{ localStorage.removeItem("wm2026_round"); }catch(_){}
  cloudStopPolling(); renderTippspiel();
}
async function cloudPushNow(){
  if(!CLOUD_ON() || !cloudRound || !myTip.name) return;
  const sb = await cloudAuth();
  const row = { round_code:cloudRound, player:myTip.name, tip:myTip, owner:sbUid, updated_at:new Date().toISOString() };
  const { error } = await sb.from("tips").upsert(row, { onConflict:"round_code,player" });
  if(error){ cloudSetStatus("nicht gespeichert", "warn"); throw new Error(error.message); }
  cloudSetStatus("gespeichert ✓", "ok");
}
function cloudPushMyTip(){
  if(!CLOUD_ON() || !cloudRound || !myTip.name) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(()=>{ cloudPushNow().catch(e=>console.warn("cloud push", e)); }, 1200);
}
async function cloudPullTips(){
  if(!CLOUD_ON() || !cloudRound || cloudBusy) return;
  cloudBusy = true;
  try{
    const sb = await cloudClient();
    const { data: rows, error } = await sb.from("tips").select("player,tip").eq("round_code", cloudRound);
    if(error) throw error;
    const mine = (myTip.name||"").toLowerCase();
    const others = []; let own = null;
    (rows||[]).forEach(r=>{ const t = r.tip||{}; t.name = t.name || r.player;
      if((r.player||"").toLowerCase() === mine) own = t; else others.push(t); });
    tipPlayers = others; saveTipPlayers();
    // Adopt own cloud tip only when local is still empty (e.g. a second device).
    if(own && !cloudTipFilled()){ myTip = own; saveMyTip(); }
    renderTipRoster(); renderTipBoard();
  } finally { cloudBusy = false; }
}
function cloudStartPolling(){
  cloudStopPolling();
  if(!CLOUD_ON() || !cloudRound) return;
  cloudPollTimer = setInterval(()=>{ if(document.visibilityState==="visible") cloudPullTips().catch(()=>{}); }, 15000);
}
function cloudStopPolling(){ if(cloudPollTimer){ clearInterval(cloudPollTimer); cloudPollTimer=null; } }

function cloudBlockHtml(){
  if(!CLOUD_ON()){
    return `<div class="tip-block cloud-block"><h3>☁️ Cloud-Runde</h3>
      <p class="cloud-hint">Cloud-Tippspiel ist nicht konfiguriert. Trage <code>SUPABASE_URL</code> und <code>SUPABASE_ANON_KEY</code> oben im Script ein, um Tipprunden online zu teilen. Bis dahin läuft alles lokal (Code-Austausch unten).</p></div>`;
  }
  if(cloudRound){
    return `<div class="tip-block cloud-block"><h3>☁️ Cloud-Runde <span class="cloud-pill on">verbunden</span></h3>
      <p class="cloud-hint">Runden-Code: <b class="cloud-code">${cloudRound}</b> — teile ihn mit Mitspielern. Dein Tipp wird automatisch gespeichert; die Rangliste aktualisiert sich alle 15&nbsp;s (oder per Klick).</p>
      <div class="tip-actions">
        <button class="mini-btn" id="cloudCopyCode">📋 Code kopieren</button>
        <button class="mini-btn" id="cloudRefresh">🔄 Jetzt aktualisieren</button>
        <button class="mini-btn warn" id="cloudLeave">Runde verlassen</button>
        <span class="cloud-status" id="cloudStatus"></span>
      </div></div>`;
  }
  return `<div class="tip-block cloud-block"><h3>☁️ Cloud-Runde</h3>
    <p class="cloud-hint">Erstelle eine Tipprunde oder tritt mit einem Code bei (zuerst oben deinen Namen eingeben).</p>
    <div class="cloud-join">
      <input id="cloudCode" class="tip-name" maxlength="12" placeholder="Runden-Code, z. B. WM-7F3K">
      <button class="sim-btn" id="cloudJoin">Beitreten</button>
      <button class="sim-btn alt" id="cloudCreate">Neue Runde erstellen</button>
    </div></div>`;
}

function renderTippspiel(){
  const main=document.getElementById("tipMain"); if(!main)return;
  let pred="";
  Object.keys(GROUPS).forEach(g=>{
    pred+=`<div class="tg"><div class="tg-h"><span class="gb" style="background:${GCOL[g]}">${g}</span>Gruppe ${g}</div>`;
    GM.forEach((r,i)=>{ if(r[0]!==g)return; const t=myTip.g["g"+i]||["",""];
      pred+=`<div class="tip-fx"><span class="hm">${r[3]} <span class="fl">${FLAG[r[3]]}</span></span>
        <input class="tip-in" data-gi="${i}" data-s="0" inputmode="numeric" value="${t[0]??""}">
        <span class="cl">:</span>
        <input class="tip-in" data-gi="${i}" data-s="1" inputmode="numeric" value="${t[1]??""}">
        <span class="aw"><span class="fl">${FLAG[r[4]]}</span> ${r[4]}</span></div>`;
    });
    pred+="</div>";
  });
  const b=myTip.b||[null,null,null,null];
  main.innerHTML=`
    <div class="tip-scheme"><b>Wertung je Spiel:</b> exakt 4 · richtige Tordifferenz 3 · richtige Tendenz 2 · sonst 0. &nbsp;<b>Bonus:</b> Weltmeister +20 · je richtiger Finalist +8 · je richtiger Halbfinalist +4.</div>
    ${cloudBlockHtml()}
    <div class="tip-block">
      <h3>① Mein Tipp</h3>
      <div class="tip-namerow"><label>Name</label><input id="tipName" class="tip-name" maxlength="40" placeholder="Dein Name" value="${(myTip.name||"").replace(/"/g,"&quot;")}"></div>
      <details class="tip-pred" open><summary>Gruppenspiele tippen (72 Spiele)</summary><div class="tg-grid">${pred}</div></details>
      <div class="tip-bonusrow">
        <div class="field"><label>Weltmeister (+20)</label><select class="tip-bonus" data-slot="0">${teamOptions(b[0])}</select></div>
        <div class="field"><label>Vize-WM (+8)</label><select class="tip-bonus" data-slot="1">${teamOptions(b[1])}</select></div>
        <div class="field"><label>Halbfinalist (+4)</label><select class="tip-bonus" data-slot="2">${teamOptions(b[2])}</select></div>
        <div class="field"><label>Halbfinalist (+4)</label><select class="tip-bonus" data-slot="3">${teamOptions(b[3])}</select></div>
      </div>
      <div class="tip-actions">
        <button class="sim-btn" id="tipExportBtn">📤 Tipp als Code exportieren</button>
        <button class="mini-btn warn" id="tipResetMy">Meinen Tipp leeren</button>
      </div>
      <textarea id="tipCode" class="tip-code" readonly style="display:none" placeholder=""></textarea>
      <button class="mini-btn" id="tipCopy" style="display:none">📋 Kopieren</button>
    </div>
    <div class="tip-block">
      <h3>② Mitspieler importieren</h3>
      <textarea id="tipImport" class="tip-code" placeholder="Code eines Mitspielers hier einfügen …"></textarea>
      <button class="sim-btn alt" id="tipImportBtn">📥 Tipp importieren</button>
      <div id="tipRoster" class="tip-roster"></div>
    </div>
    <div class="tip-block">
      <h3>③ Rangliste</h3>
      <div id="tipBoard"></div>
    </div>
    <div class="tip-block">
      <h3>④ Tipps ansehen</h3>
      <div class="tip-viewsel"><label>Spieler</label><select id="tipViewSel"></select></div>
      <div id="tipViewBody"></div>
    </div>`;
  main.querySelector("#tipName").addEventListener("input",e=>{myTip.name=e.target.value;saveMyTip();renderTipRoster();renderTipBoard();});
  main.querySelectorAll(".tip-in").forEach(inp=>inp.addEventListener("input",e=>{
    let v=e.target.value.replace(/[^0-9]/g,"").slice(0,2); e.target.value=v;
    const key="g"+e.target.dataset.gi, s=+e.target.dataset.s;
    const cur=myTip.g[key]||["",""]; cur[s]=(v===""?"":+v);
    if(cur[0]===""&&cur[1]==="")delete myTip.g[key]; else myTip.g[key]=cur;
    saveMyTip(); renderTipRoster(); renderTipBoard();
  }));
  main.querySelectorAll(".tip-bonus").forEach(sel=>sel.addEventListener("change",e=>{
    myTip.b=myTip.b||[null,null,null,null]; myTip.b[+e.target.dataset.slot]=e.target.value||null; saveMyTip(); renderTipBoard();
  }));
  main.querySelector("#tipExportBtn").addEventListener("click",()=>{
    if(!myTip.name){alert("Bitte zuerst einen Namen eingeben.");return;}
    const ta=main.querySelector("#tipCode"); ta.value=encodeTip(myTip); ta.style.display="block";
    const cp=main.querySelector("#tipCopy"); cp.style.display="inline-block"; ta.focus(); ta.select();
  });
  main.querySelector("#tipCopy").addEventListener("click",()=>{const ta=main.querySelector("#tipCode");ta.select();try{navigator.clipboard.writeText(ta.value);}catch(_){try{document.execCommand("copy");}catch(e){}}});
  main.querySelector("#tipResetMy").addEventListener("click",()=>{if(confirm("Deinen eigenen Tipp leeren? (Name bleibt)")){myTip={name:myTip.name||"",g:{},b:[null,null,null,null]};saveMyTip();renderTippspiel();}});
  main.querySelector("#tipImportBtn").addEventListener("click",()=>{
    const ta=main.querySelector("#tipImport"); const code=ta.value.trim(); if(!code)return;
    try{ const p=decodeTip(code);
      if(myTip.name&&p.name.toLowerCase()===myTip.name.toLowerCase()){alert("Dieser Name ist dein eigener Tipp.");return;}
      const idx=tipPlayers.findIndex(x=>x.name.toLowerCase()===p.name.toLowerCase());
      if(idx>=0){ if(!confirm(`„${p.name}" existiert bereits — überschreiben?`))return; tipPlayers[idx]=p; } else tipPlayers.push(p);
      saveTipPlayers(); ta.value=""; renderTippspiel();
    }catch(e){ alert("Code konnte nicht gelesen werden. Bitte vollständig kopieren."); }
  });
  // Cloud-Runde
  const cCreate=main.querySelector("#cloudCreate"); if(cCreate)cCreate.addEventListener("click",()=>cloudCreateRound().catch(e=>alert(e.message)));
  const cJoin=main.querySelector("#cloudJoin"); if(cJoin)cJoin.addEventListener("click",()=>cloudJoinRound(main.querySelector("#cloudCode").value).catch(e=>alert(e.message)));
  const cLeave=main.querySelector("#cloudLeave"); if(cLeave)cLeave.addEventListener("click",()=>{ if(confirm("Cloud-Runde verlassen? Dein Tipp bleibt lokal erhalten."))cloudLeaveRound(); });
  const cRef=main.querySelector("#cloudRefresh"); if(cRef)cRef.addEventListener("click",()=>cloudPullTips().catch(e=>alert(e.message)));
  const cCopy=main.querySelector("#cloudCopyCode"); if(cCopy)cCopy.addEventListener("click",()=>{ try{navigator.clipboard.writeText(cloudRound);}catch(_){} });
  renderTipRoster(); renderTipBoard();
}
function renderTipRoster(){
  const el=document.getElementById("tipRoster"); if(!el)return;
  let h="";
  if(myTip.name)h+=`<div class="rost-item me"><span class="ri">🧑</span><span class="rn">${myTip.name} <small>(du)</small></span><span class="rc">${Object.keys(myTip.g).length}/72</span></div>`;
  tipPlayers.forEach((p,i)=>{ h+=`<div class="rost-item"><span class="ri">👤</span><span class="rn">${p.name}</span><span class="rc">${Object.keys(p.g).length}/72</span><button class="rost-x" data-i="${i}" title="Entfernen">✕</button></div>`; });
  if(!h)h=`<div class="empty-state" style="padding:8px 2px">Noch keine Mitspieler. Gib oben deinen Namen ein und importiere Codes.</div>`;
  el.innerHTML=h;
  el.querySelectorAll(".rost-x").forEach(btn=>btn.addEventListener("click",()=>{tipPlayers.splice(+btn.dataset.i,1);saveTipPlayers();renderTippspiel();}));
}
function renderTipBoard(){
  const el=document.getElementById("tipBoard"); if(!el)return;
  const players=[]; if(myTip.name)players.push(Object.assign({_me:true},myTip)); tipPlayers.forEach(p=>players.push(p));
  if(!players.length){el.innerHTML=`<div class="empty-state" style="padding:8px 2px">Sobald Tipps abgegeben und echte Ergebnisse eingetragen sind, erscheint hier die Rangliste.</div>`;return;}
  const scored=players.map(p=>({p,s:scorePlayer(p)})).sort((a,b)=>b.s.total-a.s.total||b.s.exact-a.s.exact||a.p.name.localeCompare(b.p.name,"de"));
  const champ=koWinner(104);
  const rows=scored.map((o,i)=>`<div class="tb-row${o.p._me?" me":""}">
     <span class="tb-rank">${i+1}</span>
     <span class="tb-name">${o.p.name||"—"}${o.p._me?' <small>(du)</small>':''}</span>
     <span class="tb-tot">${o.s.total}</span>
     <span class="tb-sub">Gruppe ${o.s.grp} · Bonus ${o.s.bonus} · ${o.s.exact}× exakt</span>
   </div>`).join("");
  el.innerHTML=`<div class="tb-note">${gamesPlayed()}/72 echte Gruppenergebnisse eingetragen${champ?` · 🏆 Weltmeister steht fest: ${FLAG[champ]} ${champ}`:""}.</div><div class="tboard">${rows}</div>`;
  renderTipViewer();
}
function tipPlayerList(){ const arr=[]; if(myTip.name)arr.push(Object.assign({_me:true},myTip)); tipPlayers.forEach(p=>arr.push(p)); return arr; }
function renderTipViewer(){
  const sel=document.getElementById("tipViewSel"), body=document.getElementById("tipViewBody"); if(!sel||!body)return;
  const list=tipPlayerList();
  if(!list.length){ sel.innerHTML=""; sel.parentElement.style.display="none"; body.innerHTML=`<div class="empty-state" style="padding:8px 2px">Noch keine Tipps vorhanden. Gib oben deinen Namen + Tipp ein oder importiere Mitspieler-Codes.</div>`; return; }
  sel.parentElement.style.display="";
  if(!list.some(p=>p.name===tipViewName))tipViewName=list[0].name;
  sel.innerHTML=list.map(p=>`<option value="${(p.name||"").replace(/"/g,"&quot;")}"${p.name===tipViewName?" selected":""}>${p.name||"—"}${p._me?" (du)":""}</option>`).join("");
  body.innerHTML=tipViewerBodyHTML(list.find(p=>p.name===tipViewName)||list[0]);
  sel.onchange=e=>{ tipViewName=e.target.value; const p=tipPlayerList().find(x=>x.name===tipViewName); const b=document.getElementById("tipViewBody"); if(p&&b)b.innerHTML=tipViewerBodyHTML(p); };
}
function tipViewerBodyHTML(pl){
  const sc=scorePlayer(pl);
  let groups="";
  Object.keys(GROUPS).forEach(g=>{
    let rows="";
    GM.forEach((r,i)=>{ if(r[0]!==g)return;
      const t=pl.g["g"+i];
      const tipped=t&&t[0]!==""&&t[1]!==""&&t[0]!=null&&t[1]!=null;
      const a=scores["g"+i]; const hasA=a&&a.h!==""&&a.a!==""&&a.h!=null&&a.a!=null;
      const tipTxt=tipped?`${t[0]}:${t[1]}`:"–:–";
      let meta="";
      if(hasA){ let badge=""; if(tipped){ const pt=scoreGroupTip([+t[0],+t[1]],{h:+a.h,a:+a.a}); badge=`<span class="tv-pt p${pt}">+${pt}</span>`; }
        meta=`<span class="tv-meta">Ergebnis ${+a.h}:${+a.a} ${badge}</span>`; }
      rows+=`<div class="tv-fx${tipped?"":" untip"}">
        <span class="tv-hm">${r[3]} <span class="fl">${FLAG[r[3]]}</span></span>
        <span class="tv-tip">${tipTxt}</span>
        <span class="tv-aw"><span class="fl">${FLAG[r[4]]}</span> ${r[4]}</span>${meta}</div>`;
    });
    groups+=`<div class="tv-g"><div class="tv-gh"><span class="gb" style="background:${GCOL[g]}">${g}</span>Gruppe ${g}</div>${rows}</div>`;
  });
  const b=pl.b||[]; const champ=koWinner(104);
  const f=koParts(104); const fin=[f.a,f.b].filter(Boolean);
  const s1=koParts(101),s2=koParts(102); const semi=[s1.a,s1.b,s2.a,s2.b].filter(Boolean);
  const bteam=nm=>nm?`${FLAG[nm]} ${nm}`:`<span class="tv-none">—</span>`;
  const ok=c=>c?`<span class="tv-ok">✓</span>`:"";
  const bonus=`<div class="tv-bonus">
     <div class="tv-brow"><span>🏆 Weltmeister <small>+20</small></span><span>${bteam(b[0])} ${champ?ok(b[0]&&b[0]===champ):""}</span></div>
     <div class="tv-brow"><span>🥈 Vize <small>+8</small></span><span>${bteam(b[1])} ${fin.length?ok(b[1]&&fin.includes(b[1])):""}</span></div>
     <div class="tv-brow"><span>Halbfinalist <small>+4</small></span><span>${bteam(b[2])} ${semi.length?ok(b[2]&&semi.includes(b[2])):""}</span></div>
     <div class="tv-brow"><span>Halbfinalist <small>+4</small></span><span>${bteam(b[3])} ${semi.length?ok(b[3]&&semi.includes(b[3])):""}</span></div>
   </div>`;
  return `<div class="tv-summary"><b>${pl.name||"—"}</b> · ${Object.keys(pl.g).length}/72 getippt · <b>${sc.total} Pkt</b> <small>(Gruppe ${sc.grp} · Bonus ${sc.bonus} · ${sc.exact}× exakt)</small></div>
    <div class="tv-grid">${groups}</div>
    <div class="tv-bh">Bonus-Tipps</div>${bonus}`;
}

/* ============================== OPENLIGADB ============================== */
const OLB_BASE="https://api.openligadb.de",OLB_SC="wm26",OLB_SE="2026";
function olbNorm(s){return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");}
const OLB_MAP={}; TEAMS.forEach(t=>{OLB_MAP[olbNorm(t)]=t;});
[["korearepublik","Südkorea"],["korea","Südkorea"],["republikkorea","Südkorea"],["südkorea","Südkorea"],
 ["vereinigtestaaten","USA"],["vereinigtestaatenvonamerika","USA"],["usa","USA"],
 ["cotedivoire","Elfenbeinküste"],["elfenbeinkueste","Elfenbeinküste"],
 ["kongodr","DR Kongo"],["demokratischerepublikkongo","DR Kongo"],["kongodemokratischerepublik","DR Kongo"],["drcongo","DR Kongo"],["congodr","DR Kongo"],["drkongo","DR Kongo"],
 ["bosnienundherzegowina","Bosnien-H."],["bosnienherzegowina","Bosnien-H."],["bosnienundherzegovina","Bosnien-H."],["bosnienherzegovina","Bosnien-H."],
 ["kapverden","Kap Verde"],["kapverdeinseln","Kap Verde"],["caboverde","Kap Verde"],
 ["iranislamischerepublik","Iran"],["iriran","Iran"],
 ["tschechischerepublik","Tschechien"],
 ["turkiye","Türkei"],["tuerkei","Türkei"],
 ["neuseeland","Neuseeland"],["saudiarabien","Saudi-Arabien"]
].forEach(([k,v])=>{OLB_MAP[k]=v;});
function olbTeam(n){return OLB_MAP[olbNorm(n)]||null;}
function olbFinal(m){
  if(!m.matchResults||!m.matchResults.length)return null;
  let end=m.matchResults.find(r=>/endergebnis/i.test(r.resultName||""))
        ||m.matchResults.find(r=>r.resultTypeID===2)
        ||m.matchResults[m.matchResults.length-1];
  const pen=m.matchResults.find(r=>/(elfmeter|elfer|penalt|11meter)/i.test(r.resultName||""));
  if(!end)return null;
  return {p1:end.pointsTeam1,p2:end.pointsTeam2,pen:pen?{p1:pen.pointsTeam1,p2:pen.pointsTeam2}:null};
}
function olbIsKO(m){
  const oid=m.group&&m.group.groupOrderID; if(oid&&oid>3)return true;
  const n=(m.group&&m.group.groupName||"").toLowerCase();
  return /(sechzehntel|achtel|viertel|halb|final|spiel um|platz 3)/.test(n);
}
function olbImport(matches){
  let grp=0,ko=0; const unmatched=new Set();
  // --- group stage ---
  matches.forEach(m=>{
    if(!m.matchIsFinished||olbIsKO(m))return;
    const t1=olbTeam(m.team1&&m.team1.teamName),t2=olbTeam(m.team2&&m.team2.teamName);
    if(!t1)unmatched.add(m.team1&&m.team1.teamName); if(!t2)unmatched.add(m.team2&&m.team2.teamName);
    if(!t1||!t2||TEAM2GROUP[t1]!==TEAM2GROUP[t2])return;
    const i=GM.findIndex(r=>(r[3]===t1&&r[4]===t2)||(r[3]===t2&&r[4]===t1));
    if(i<0)return; const f=olbFinal(m); if(!f||f.p1==null||f.p2==null)return;
    scores["g"+i]={h:(GM[i][3]===t1?f.p1:f.p2),a:(GM[i][3]===t1?f.p2:f.p1)}; grp++;
  });
  saveScores();
  // --- knockout: iterative, participants resolve round by round ---
  const done=new Set();
  for(let pass=0;pass<6;pass++){
    T3MAP=assignThirds();
    matches.forEach(m=>{
      if(!m.matchIsFinished||!olbIsKO(m))return;
      const t1=olbTeam(m.team1&&m.team1.teamName),t2=olbTeam(m.team2&&m.team2.teamName);
      if(!t1||!t2)return;
      const km=KO.find(x=>{ if(done.has(x.no))return false; const p=koParts(x.no);
        return p.a&&p.b&&((p.a===t1&&p.b===t2)||(p.a===t2&&p.b===t1)); });
      if(!km)return; const f=olbFinal(m); if(!f||f.p1==null||f.p2==null)return;
      const p=koParts(km.no);
      koScores[km.no]={h:(p.a===t1?f.p1:f.p2),a:(p.a===t1?f.p2:f.p1)};
      if(f.p1===f.p2&&f.pen){ const wt=f.pen.p1>f.pen.p2?t1:t2; koPicks[km.no]=(p.a===wt)?"a":"b"; }
      done.add(km.no); ko++;
    });
  }
  saveKoScores(); savePicks();
  return {grp,ko,unmatched:[...unmatched].filter(Boolean)};
}
let olbAuto=false,olbTimer=null,olbLastSig="";
function olbNow(){return new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});}
function olbSetDot(state){const d=document.getElementById("olbDot");if(d)d.className="olb-dot"+(state?" "+state:"");}
async function olbDoUpdate(manual){
  const st=document.getElementById("olbStatus");
  olbSetDot("busy"); if(st)st.textContent="lädt …";
  try{
    const res=await fetch(`${OLB_BASE}/getmatchdata/${OLB_SC}/${OLB_SE}`,{headers:{Accept:"application/json"}});
    if(!res.ok)throw new Error("HTTP "+res.status);
    const data=await res.json();
    if(!Array.isArray(data)||!data.length){olbSetDot(olbAuto?"live":"");if(st)st.textContent="Liga noch ohne Spieldaten · "+olbNow();return;}
    const sig=data.map(m=>m.matchID+":"+m.lastUpdateDateTime).join("|");
    if(!manual&&sig===olbLastSig){olbSetDot(olbAuto?"live":"");if(st)st.textContent="aktuell · keine Änderung · "+olbNow();return;}
    olbLastSig=sig;
    const r=olbImport(data); renderAll();
    let msg=`${r.grp+r.ko} Spiele übernommen (Gruppe ${r.grp} · K.o. ${r.ko}) · Stand ${olbNow()}`;
    if(r.unmatched.length)msg+=` · ⚠ nicht zugeordnet: ${r.unmatched.slice(0,4).join(", ")}${r.unmatched.length>4?" …":""}`;
    if(st)st.textContent=msg;
    olbSetDot(olbAuto?"live":"");
  }catch(e){ olbSetDot(olbAuto?"live":""); if(st)st.textContent="⚠ Laden fehlgeschlagen ("+(e.message||e)+"). Beim lokalen Öffnen ggf. CORS/Netz."; }
}
function olbToggleAuto(on){
  olbAuto=on; if(olbTimer){clearInterval(olbTimer);olbTimer=null;}
  if(on){olbSetDot("live");olbDoUpdate(false);olbTimer=setInterval(()=>olbDoUpdate(false),120000);}
  else olbSetDot("");
}

/* ============================== MEIN TEAM / EXPORT ============================== */
function simTeamChances(team,n,useBase){
  let grp=0,r16=0,qf=0,sf=0,fin=0,ch=0;
  for(let i=0;i<n;i++){
    const r=runSimulation(useBase);
    let q=false; for(const m of KO){ if(m.rd!=="R32")continue; if(r.A[m.no]===team||r.B[m.no]===team){q=true;break;} }
    if(q)grp++;
    const wonIn=rd=>KO.some(m=>m.rd===rd&&r.WIN[m.no]===team);
    if(wonIn("R32"))r16++; if(wonIn("R16"))qf++; if(wonIn("QF"))sf++; if(wonIn("SF"))fin++;
    if(r.champ===team)ch++;
  }
  return {n,grp,r16,qf,sf,fin,ch};
}
function renderChances(c){
  const rows=[["Gruppenphase überstanden",c.grp,"var(--green)"],["Achtelfinale",c.r16,"var(--blue)"],["Viertelfinale",c.qf,"var(--blue)"],["Halbfinale",c.sf,"var(--violet)"],["Finale",c.fin,"var(--gold)"],["Weltmeister",c.ch,"var(--gold)"]];
  return `<div class="chance-list">`+rows.map(([lbl,v,col])=>{const pct=v/c.n*100;
    return `<div class="chance-row"><span class="cl">${lbl}</span><div class="cbarwrap"><div class="cbar" style="width:${Math.max(pct,0).toFixed(1)}%;background:${col}"></div></div><span class="cv">${pct.toFixed(1)}%</span></div>`;}).join("")
    +`</div><div class="chance-note">aus ${c.n.toLocaleString("de-DE")} simulierten Turnieren</div>`;
}
function downloadFile(name,content,mime){const b=new Blob([content],{type:mime||"text/plain;charset=utf-8"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}
function icsEsc(s){return (s||"").replace(/([,;\\])/g,"\\$1").replace(/\n/g,"\\n");}
function icsDt(d){return d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");}
function icsFold(line){if(line.length<=74)return line;let out=line.slice(0,74),rest=line.slice(74);while(rest.length){out+="\r\n "+rest.slice(0,73);rest=rest.slice(73);}return out;}
const RD_ICS={R32:"Sechzehntelfinale",R16:"Achtelfinale",QF:"Viertelfinale",SF:"Halbfinale","3RD":"Spiel um Platz 3",FINAL:"Finale"};
function matchSummary(m){
  if(m.type==="group")return `WM ⚽ ${m.home} – ${m.away} (Gruppe ${m.group})`;
  const p=koParts(m.no), a=p.a||slotLabel(KOBY[m.no].a), b=p.b||slotLabel(KOBY[m.no].b);
  return `WM ⚽ ${RD_ICS[m.rd]}: ${a} – ${b}`;
}
function buildICS(list,calName){
  const now=icsDt(new Date());
  const L=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//qurix//WM2026 Spielplan//DE","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:"+icsEsc(calName),"X-WR-TIMEZONE:UTC"];
  list.forEach(m=>{ const st=m.inst,en=new Date(st.getTime()+105*60000);
    L.push("BEGIN:VEVENT","UID:wm2026-"+m.id+"@finwohl","DTSTAMP:"+now,"DTSTART:"+icsDt(st),"DTEND:"+icsDt(en),
      "SUMMARY:"+icsEsc(matchSummary(m)),"LOCATION:"+icsEsc(m.venue+", "+m.city),
      "DESCRIPTION:"+icsEsc("WM 2026 · "+(m.type==="group"?("Gruppe "+m.group):RD_ICS[m.rd])),"END:VEVENT"); });
  L.push("END:VCALENDAR");
  return L.map(icsFold).join("\r\n");
}
function exportAllIcs(){downloadFile("wm2026-alle-spiele.ics",buildICS(MATCHES,"WM 2026 — Alle Spiele"),"text/calendar;charset=utf-8");}
function exportTeamIcs(team){ if(!team)return;
  const list=MATCHES.filter(m=>{ if(m.type==="group")return m.home===team||m.away===team; const p=koParts(m.no); return p.a===team||p.b===team; });
  downloadFile(`wm2026-${team.replace(/[^a-z0-9]/gi,"_")}.ics`,buildICS(list,"WM 2026 — "+team),"text/calendar;charset=utf-8");
}
const BK_KEYS=["wm2026scores","wm2026picks","wm2026koscores","wm2026_mytip","wm2026_tips","wm2026fav","wm2026tz","wm2026_round"];
function dataBlockHTML(){
  return `<div class="mt-block data-block"><h3>Daten &amp; Sicherung</h3>
    <p class="db-note">Sichert alle lokal gespeicherten Daten (Ergebnisse, K.-o.-Tipps, dein Tippspiel inkl. Mitspieler, Lieblingsteam, Zeitzone) als Datei — etwa zum Übertragen auf ein anderes Gerät.</p>
    <div class="db-actions">
      <button class="mini-btn" id="dbExport">⬇️ Backup exportieren (.json)</button>
      <button class="mini-btn" id="dbImportBtn">⬆️ Backup importieren</button>
      <input type="file" id="dbImport" accept="application/json,.json" hidden>
    </div></div>`;
}
function wireDataBlock(root){
  const ex=root.querySelector("#dbExport"); if(ex)ex.addEventListener("click",()=>{
    const out={app:"wm2026",version:1,exported:new Date().toISOString(),data:{}};
    BK_KEYS.forEach(k=>{try{const v=localStorage.getItem(k);if(v!=null)out.data[k]=v;}catch(_){}});
    downloadFile("wm2026-backup.json",JSON.stringify(out,null,2),"application/json");
  });
  const ib=root.querySelector("#dbImportBtn"),inp=root.querySelector("#dbImport");
  if(ib&&inp){ ib.addEventListener("click",()=>inp.click());
    inp.addEventListener("change",e=>{ const f=e.target.files&&e.target.files[0]; if(!f)return;
      const rd=new FileReader(); rd.onload=()=>{ try{ const o=JSON.parse(rd.result); if(!o||!o.data)throw 0;
        if(!confirm("Backup einspielen? Die aktuellen Daten in diesem Browser werden überschrieben."))return;
        BK_KEYS.forEach(k=>{ if(o.data[k]!=null)localStorage.setItem(k,o.data[k]); });
        location.reload();
      }catch(err){ alert("Backup-Datei konnte nicht gelesen werden."); } };
      rd.readAsText(f); e.target.value="";
    });
  }
}
function teamSelectHTML(){
  let o='<option value="">— kein Team gewählt —</option>';
  Object.keys(GROUPS).forEach(g=>{ o+=`<optgroup label="Gruppe ${g}">`+GROUPS[g].map(t=>`<option value="${t}"${t===selTeam?" selected":""}>${FLAG[t]}  ${t}</option>`).join("")+`</optgroup>`; });
  return o;
}
function renderMyTeam(){
  const main=document.getElementById("mtMain"); if(!main)return;
  const picker=`<div class="team-row">
      <div class="field"><label>Mein Team</label><select id="teamSel">${teamSelectHTML()}</select></div>
      ${selTeam?'<button class="btn-clear" id="clearTeam">Zurücksetzen</button>':''}
    </div>`;
  let body="";
  if(!selTeam){ body=`<div class="empty-state">Wähle dein Team — dann erscheinen hier Tabellenstand, Restprogramm, Titelchancen und der Szenario-Planer. Dein Team wird außerdem in Gruppen, Kalender und Weltrangliste hervorgehoben.</div>`; }
  else {
    const g=TEAM2GROUP[selTeam], tab=standings(g), pos=tab.findIndex(r=>r.t===selTeam)+1, me=tab.find(r=>r.t===selTeam);
    let fx="";
    GM.forEach((r,i)=>{ if(r[3]!==selTeam&&r[4]!==selTeam)return; const inst=instant(r[1],r[2]); const sc=scores["g"+i];
      const opp=r[3]===selTeam?r[4]:r[3], ha=r[3]===selTeam?"H":"A";
      const played=sc&&sc.h!==""&&sc.a!==""&&sc.h!=null&&sc.a!=null;
      let res;
      if(played){const my=r[3]===selTeam?+sc.h:+sc.a, ot=r[3]===selTeam?+sc.a:+sc.h; const wl=my>ot?"win":my<ot?"loss":"draw"; res=`<span class="mt-res ${wl}">${my}:${ot}</span>`;}
      else res=`<span class="mt-res up">${berlinTime(inst)}</span>`;
      fx+=`<div class="mt-fx"><div class="mt-d">${berlinDayLabel(inst)}</div><div class="mt-o"><span class="ha">${ha}</span>${FLAG[opp]} ${opp}</div>${res}</div>`;
    });
    let kox="";
    KO.forEach(m=>{ const p=koParts(m.no); if(p.a!==selTeam&&p.b!==selTeam)return; const opp=(p.a===selTeam?p.b:p.a);
      const set=koScoreSet(m.no); let res;
      if(set){const s=koScores[m.no];const my=p.a===selTeam?s.h:s.a, ot=p.a===selTeam?s.a:s.h; const w=koResultWinner(m.no); const won=(w===(p.a===selTeam?"a":"b")); res=`<span class="mt-res ${won?"win":"loss"}">${my}:${ot}${my===ot?" i.E.":""}</span>`;}
      else res=`<span class="mt-res up">${berlinTime(m.inst)}</span>`;
      kox+=`<div class="mt-fx"><div class="mt-d">${berlinDayLabel(m.inst)}</div><div class="mt-o"><span class="ha ko">${RD_SHORT[m.rd]}</span>${FLAG[opp]||""} ${opp||"?"}</div>${res}</div>`;
    });
    const det=determinedRank(selTeam); const gc=groupComplete(g);
    let scnDone="";
    if(det!=null){
      const lead=gc?`Gruppenphase in Gruppe ${g} abgeschlossen`:`Platz in Gruppe ${g} bereits uneinholbar`;
      if(det===4||det>4) scnDone=`<div class="scn-done">${lead} — dein Team ist als <b>${det}.</b> ausgeschieden.</div>`;
      else { const word=det===1?"Gruppensieger":det===2?"Gruppenzweiter":"Gruppendritter";
        const slot=det<=2?` und steht im Sechzehntelfinale (als ${det===1?"Sieger":"Zweiter"} Gruppe ${g})`:"";
        const third=det===3?" Ob es als Gruppendritter reicht, hängt vom Vergleich aller Gruppendritten ab.":"";
        scnDone=`<div class="scn-done">${lead} — dein Team ist als <b>${word}</b> gesetzt${slot}.${third} Die Szenarien unten dienen nur noch der Übersicht.</div>`;
      }
    }
    body=`
      <div class="mt-headcard">
        <div class="mt-flag">${FLAG[selTeam]}</div>
        <div><div class="mt-name">${selTeam} <span class="favstar">★</span></div>
        <div class="mt-meta">Gruppe ${g} · aktuell Platz ${pos} · ${me.pts} Pkt · ${me.s}-${me.u}-${me.n} · ${me.gf}:${me.ga} Tore</div></div>
      </div>
      <div class="mt-cols">
        <div class="mt-block"><h3>Restprogramm &amp; Ergebnisse</h3><div class="mt-fxlist">${fx}${kox?`<div class="mt-kohead">K.-o.-Phase (Stand jetzt)</div>`+kox:""}</div></div>
        <div class="mt-block">
          <h3>Titelchancen <small>Monte-Carlo</small></h3>
          <label class="sim-toggle mt-toggle"><input type="checkbox" id="mtBase" checked><span class="sw"></span>Eingetragene Ergebnisse berücksichtigen</label>
          <button class="sim-btn" id="mtCalc">📊 Chancen berechnen (2000×)</button>
          <div id="mtChances"><div class="empty-state" style="padding:10px 2px">Noch nicht berechnet.</div></div>
          <div class="mt-actions"><button class="mini-btn" id="mtIcs">📅 ${selTeam}-Spiele als .ics</button></div>
        </div>
      </div>
      ${scnDone}
      <details class="scn-details"${det!=null?"":" open"}>
        <summary>🎯 Szenario-Planer — mögliche K.-o.-Termine</summary>
        <p class="scn-intro">Aktiviere die Szenarien (Gruppensieger / -zweiter / -dritter). Alle möglichen K.-o.-Termine werden im Turnierbaum &amp; Kalender markiert — nützlich, um vorab Termine freizuhalten.</p>
        <div class="scn-grid" id="scnGrid"></div>
        <div class="block-sum" id="blockSum"></div>
      </details>`;
  }
  main.innerHTML=picker+body+dataBlockHTML();
  const ts=main.querySelector("#teamSel"); if(ts)ts.addEventListener("change",e=>{selTeam=e.target.value||null;saveSelTeam();renderAll();});
  const cl=main.querySelector("#clearTeam"); if(cl)cl.addEventListener("click",()=>{selTeam=null;saveSelTeam();renderAll();});
  const ic=main.querySelector("#mtIcs"); if(ic)ic.addEventListener("click",()=>exportTeamIcs(selTeam));
  const mc=main.querySelector("#mtCalc"); if(mc)mc.addEventListener("click",()=>{
    const useBase=main.querySelector("#mtBase").checked, box=main.querySelector("#mtChances");
    box.innerHTML=`<div class="sim-loading">⏳ Simuliere 2000 Turniere …</div>`;
    setTimeout(()=>{ box.innerHTML=renderChances(simTeamChances(selTeam,2000,useBase)); },30);
  });
  wireDataBlock(main);
}
function updateTzNote(){
  const sel=document.getElementById("tzSel");
  if(sel&&!sel.dataset.init){ sel.innerHTML=TZ_OPTIONS.map(o=>`<option value="${o.id}"${o.id===dispTz?" selected":""}>${o.label}</option>`).join(""); sel.dataset.init="1"; }
  const note=document.getElementById("tzNote"); if(note)note.textContent=`Zeiten: ${_TF.primAbbr} · ${_TF.secAbbr} in Klammern`;
}

function renderThirdsTable(){
  const main=document.getElementById("thirdsMain"); if(!main)return;
  const complete=allGroupsComplete();
  const cand=TEAMS.filter(canBeThird).map(t=>{ const g=TEAM2GROUP[t]; const st=standings(g); const o=st.find(x=>x.t===t); const pos=st.findIndex(x=>x.t===t)+1;
    return {t,g,pos,pts:o.pts,gf:o.gf,ga:o.ga,gd:o.gf-o.ga,sp:o.sp};});
  cand.sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf||a.g.localeCompare(b.g));
  const tr=thirdRanking(); const top8=new Set(tr.slice(0,8).map(o=>o.g));
  let rows="";
  cand.forEach((c,i)=>{
    let cls,badge;
    if(complete){ const q=top8.has(c.g); cls=q?"q":"out"; badge=`<span class="tt-b ${q?"q":"out"}">${q?"qualifiziert":"ausgeschieden"}</span>`; }
    else if(c.pos===3){ const q=top8.has(c.g); cls=q?"q":"warn"; badge=`<span class="tt-b ${q?"q":"warn"}">${q?"auf Kurs (Top 8)":"aktuell 9.–12."}</span>`; }
    else { cls="poss"; badge='<span class="tt-b poss">noch möglich</span>'; }
    const fav=c.t===selTeam?" fav-row":"";
    const gds=(c.gd>0?"+":"")+c.gd;
    rows+=`<tr class="${cls}${fav}">
      <td class="rk">${i+1}</td>
      <td class="l team"><span class="fl">${FLAG[c.t]}</span>${c.t}${c.t===selTeam?' <span class="favstar">★</span>':''}</td>
      <td><span class="ttg" style="background:${GCOL[c.g]}">${c.g}</span></td>
      <td class="pl">${c.pos}.</td><td>${c.sp}</td><td>${c.gf}:${c.ga}</td><td>${gds}</td><td class="pts">${c.pts}</td>
      <td class="st">${badge}</td></tr>`;
  });
  const note = complete
    ? "Alle Gruppen abgeschlossen — die acht grün markierten Gruppendritten sind für das Sechzehntelfinale qualifiziert, die vier roten ausgeschieden."
    : `<b>${cand.length}</b> Mannschaften können rechnerisch noch Gruppendritter werden (Teams, die nicht mehr Dritter werden können, sind ausgeblendet). Spalte „Pl." = aktueller Platz in der Gruppe. Acht der zwölf Gruppendritten ziehen ins Sechzehntelfinale ein — die endgültige Wertung steht erst nach Abschluss aller Gruppen fest.`;
  main.innerHTML=`<p class="thirds-intro">${note}</p>
    <div class="thirds-legend">
      <span><i class="q"></i>auf Kurs / qualifiziert</span>
      <span><i class="warn"></i>aktuell außerhalb Top 8</span>
      <span><i class="poss"></i>noch möglich (derzeit nicht 3.)</span>
    </div>
    <div class="thirds-tablewrap"><table class="thirds-table">
      <thead><tr><th>#</th><th class="l">Team</th><th>Gr.</th><th title="Aktueller Platz in der Gruppe">Pl.</th><th>Sp</th><th>Tore</th><th>Diff</th><th>Pkt</th><th class="l">Status</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

/* ============================== DEV: TESTDATEN ============================== */
const GM_MD={}; // GM index -> group matchday (1..3)
Object.keys(GROUPS).forEach(g=>{ const idx=[]; GM.forEach((r,i)=>{if(r[0]===g)idx.push(i);});
  idx.sort((a,b)=>instant(GM[a][1],GM[a][2])-instant(GM[b][1],GM[b][2]));
  idx.forEach((i,k)=>GM_MD[i]=Math.floor(k/2)+1); });
const RD_LEVEL={R32:4,R16:5,QF:6,SF:7,"3RD":8,FINAL:8};
function devSimulate(target){ // target = {level:1..8} or {date:"YYYY-MM-DD"}
  scores={}; koScores={}; koPicks={};
  GM.forEach((r,i)=>{
    const take = target.level!=null ? (GM_MD[i]<=Math.min(target.level,3))
                                    : (berlinKey(instant(r[1],r[2]))<=target.date);
    if(take){ const [h,a]=simGoals(r[3],r[4]); scores["g"+i]={h,a}; }
  });
  saveScores();
  ["R32","R16","QF","SF","3RD","FINAL"].forEach(rd=>{
    T3MAP=assignThirds();
    KO.filter(m=>m.rd===rd).forEach(m=>{
      const take = target.level!=null ? (target.level>=RD_LEVEL[rd])
                                      : (berlinKey(m.inst)<=target.date);
      if(!take)return;
      const p=koParts(m.no); if(!p.a||!p.b)return; // participants not resolved yet
      const o=simKoOutcome(p.a,p.b);
      koScores[m.no]={h:o.ga,a:o.gb};
      if(o.ga===o.gb)koPicks[m.no]=o.pen;
    });
  });
  saveKoScores(); savePicks(); renderAll();
}

/* ============================== AUSTRAGUNGSORTE ============================== */
const VENUES=[
 {v:"AT&T Stadium",c:"Arlington",land:"USA",lat:32.7473,lng:-97.0945},
 {v:"Mercedes-Benz Stadium",c:"Atlanta",land:"USA",lat:33.7553,lng:-84.4006},
 {v:"MetLife Stadium",c:"East Rutherford",land:"USA",lat:40.8135,lng:-74.0745},
 {v:"Gillette Stadium",c:"Foxborough",land:"USA",lat:42.0909,lng:-71.2643},
 {v:"NRG Stadium",c:"Houston",land:"USA",lat:29.6847,lng:-95.4107},
 {v:"SoFi Stadium",c:"Inglewood",land:"USA",lat:33.9535,lng:-118.3392},
 {v:"Arrowhead Stadium",c:"Kansas City",land:"USA",lat:39.0489,lng:-94.4839},
 {v:"Estadio Azteca",c:"Mexiko-Stadt",land:"Mexiko",lat:19.3029,lng:-99.1505},
 {v:"Hard Rock Stadium",c:"Miami Gardens",land:"USA",lat:25.9580,lng:-80.2389},
 {v:"Estadio BBVA",c:"Monterrey",land:"Mexiko",lat:25.6695,lng:-100.2447},
 {v:"Lincoln Financial Field",c:"Philadelphia",land:"USA",lat:39.9008,lng:-75.1675},
 {v:"Levi's Stadium",c:"Santa Clara",land:"USA",lat:37.4030,lng:-121.9700},
 {v:"Lumen Field",c:"Seattle",land:"USA",lat:47.5952,lng:-122.3316},
 {v:"BMO Field",c:"Toronto",land:"Kanada",lat:43.6332,lng:-79.4185},
 {v:"BC Place",c:"Vancouver",land:"Kanada",lat:49.2768,lng:-123.1119},
 {v:"Estadio Akron",c:"Zapopan",land:"Mexiko",lat:20.6819,lng:-103.4625}
];
const LANDFLAG={USA:"🇺🇸",Mexiko:"🇲🇽",Kanada:"🇨🇦"};
const BASEMAPS={
 voyager:{url:"https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",label:"Voyager"},
 light:{url:"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",label:"Hell"},
 dark:{url:"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",label:"Dunkel"}
};
let mapStyle=localStorage.getItem("wm2026map")||"voyager";
let venueTile=null;
function applyBasemap(){
  if(!venueMap)return;
  if(venueTile)venueMap.removeLayer(venueTile);
  venueTile=L.tileLayer(BASEMAPS[mapStyle].url,{maxZoom:20,subdomains:"abcd",attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende &copy; <a href="https://carto.com/attributions">CARTO</a>'}).addTo(venueMap);
  document.querySelectorAll("#mapStyleBar .msb-btn").forEach(b=>b.classList.toggle("active",b.dataset.style===mapStyle));
}
function venueMatches(vn){ return MATCHES.filter(m=>m.venue===vn).sort((a,b)=>a.inst-b.inst); }
function matchInvolvesSel(m){ if(!selTeam)return false; if(m.type==="group")return m.home===selTeam||m.away===selTeam; const p=koParts(m.no); return p.a===selTeam||p.b===selTeam; }
function venueHasSel(vn){ return venueMatches(vn).some(matchInvolvesSel); }
function venueMatchLine(m){
  const when=`${berlinDayLabel(m.inst)}, ${berlinTime(m.inst)}`;
  let teams;
  if(m.type==="group"){ teams=`<span class="vg" style="background:${GCOL[m.group]}">${m.group}</span> ${FLAG[m.home]} ${m.home} – ${FLAG[m.away]} ${m.away}`; }
  else { const p=koParts(m.no); const a=p.a?`${FLAG[p.a]} ${p.a}`:slotLabel(KOBY[m.no].a); const b=p.b?`${FLAG[p.b]} ${p.b}`:slotLabel(KOBY[m.no].b); teams=`<span class="vko">${RD_SHORT[m.rd]}</span> ${a} – ${b}`; }
  return `<div class="vm-line${matchInvolvesSel(m)?' sel':''}"><span class="vm-when">${when}</span><span class="vm-teams">${teams}</span></div>`;
}
function venuePopupHTML(vd){
  const ms=venueMatches(vd.v);
  return `<div class="vpop"><div class="vpop-h">${vd.v}</div><div class="vpop-sub">${LANDFLAG[vd.land]} ${vd.c} · ${ms.length} Spiele</div><div class="vpop-list">${ms.map(venueMatchLine).join("")||'<div class="vm-line">—</div>'}</div></div>`;
}
let venueMap=null, venueMarkers=[];
function venueIcon(active){ return L.divIcon({className:"vmark-wrap", html:`<div class="vmark${active?' on':''}"></div>`, iconSize:[18,18], iconAnchor:[9,9], popupAnchor:[0,-9]}); }
function initVenueMap(){
  if(venueMap||typeof L==="undefined")return;
  venueMap=L.map("venueMap",{scrollWheelZoom:true});
  applyBasemap();
  const pts=[];
  VENUES.forEach(vd=>{
    const mk=L.marker([vd.lat,vd.lng],{icon:venueIcon(venueHasSel(vd.v))}).addTo(venueMap);
    mk.bindPopup(()=>venuePopupHTML(vd),{maxWidth:330,minWidth:240});
    mk._vd=vd; venueMarkers.push(mk); pts.push([vd.lat,vd.lng]);
  });
  venueMap.fitBounds(pts,{padding:[40,40]});
  document.querySelectorAll("#mapStyleBar .msb-btn").forEach(b=>b.addEventListener("click",()=>{mapStyle=b.dataset.style;localStorage.setItem("wm2026map",mapStyle);applyBasemap();}));
}
function updateVenueMarkers(){ if(!venueMap)return; venueMarkers.forEach(mk=>mk.setIcon(venueIcon(venueHasSel(mk._vd.v)))); }
function renderVenues(){
  const list=document.getElementById("venueList"); if(!list)return;
  const byLand={USA:[],Mexiko:[],Kanada:[]};
  VENUES.slice().sort((a,b)=>a.c.localeCompare(b.c,"de")).forEach(vd=>byLand[vd.land].push(vd));
  let h="";
  ["USA","Mexiko","Kanada"].forEach(land=>{
    h+=`<div class="vl-group"><div class="vl-h">${LANDFLAG[land]} ${land} <small>${byLand[land].length} Orte</small></div>`;
    byLand[land].forEach(vd=>{ const n=venueMatches(vd.v).length;
      h+=`<button class="vl-item${venueHasSel(vd.v)?' sel':''}" data-v="${vd.v.replace(/"/g,'&quot;')}"><span class="vl-dot"></span><span class="vl-name">${vd.v}<small>${vd.c}</small></span><span class="vl-cnt">${n}</span></button>`; });
    h+=`</div>`;
  });
  list.innerHTML=h;
  list.querySelectorAll(".vl-item").forEach(b=>b.addEventListener("click",()=>{
    const vd=VENUES.find(x=>x.v===b.dataset.v); if(!vd||!venueMap)return;
    venueMap.flyTo([vd.lat,vd.lng],7,{duration:.6});
    const mk=venueMarkers.find(m=>m._vd.v===vd.v); if(mk)setTimeout(()=>mk.openPopup(),650);
  }));
  updateVenueMarkers();
}

/* ===================== WM-Historie (Herren) ===================== */
function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
// [year, host, teams, champion, runnerUp, third, fourth]
const WC_HISTORY_M = [
  [1930,"Uruguay",13,"Uruguay","Argentina","United States","Yugoslavia"],
  [1934,"Italy",16,"Italy","Czechoslovakia","Germany","Austria"],
  [1938,"France",15,"Italy","Hungary","Brazil","Sweden"],
  [1950,"Brazil",13,"Uruguay","Brazil","Sweden","Spain"],
  [1954,"Switzerland",16,"West Germany","Hungary","Austria","Uruguay"],
  [1958,"Sweden",16,"Brazil","Sweden","France","West Germany"],
  [1962,"Chile",16,"Brazil","Czechoslovakia","Chile","Yugoslavia"],
  [1966,"England",16,"England","West Germany","Portugal","Soviet Union"],
  [1970,"Mexico",16,"Brazil","Italy","West Germany","Uruguay"],
  [1974,"West Germany",16,"West Germany","Netherlands","Poland","Brazil"],
  [1978,"Argentina",16,"Argentina","Netherlands","Brazil","Italy"],
  [1982,"Spain",24,"Italy","West Germany","Poland","France"],
  [1986,"Mexico",24,"Argentina","West Germany","France","Belgium"],
  [1990,"Italy",24,"West Germany","Argentina","Italy","England"],
  [1994,"United States",24,"Brazil","Italy","Sweden","Bulgaria"],
  [1998,"France",32,"France","Brazil","Croatia","Netherlands"],
  [2002,"Korea, Japan",32,"Brazil","Germany","Turkey","South Korea"],
  [2006,"Germany",32,"Italy","France","Germany","Portugal"],
  [2010,"South Africa",32,"Spain","Netherlands","Germany","Uruguay"],
  [2014,"Brazil",32,"Germany","Argentina","Netherlands","Brazil"],
  [2018,"Russia",32,"France","Croatia","Belgium","England"],
  [2022,"Qatar",32,"Argentina","France","Croatia","Morocco"]
];
// DB-Name → {de: deutscher Name, fl: Flaggen-Emoji}. fl:"" für untergegangene
// Staaten ohne eindeutigen heutigen Nachfolger (keine Flagge angezeigt).
const WC_COUNTRY = {
  "Argentina":{de:"Argentinien",fl:"🇦🇷"}, "Austria":{de:"Österreich",fl:"🇦🇹"},
  "Belgium":{de:"Belgien",fl:"🇧🇪"}, "Brazil":{de:"Brasilien",fl:"🇧🇷"},
  "Bulgaria":{de:"Bulgarien",fl:"🇧🇬"}, "Chile":{de:"Chile",fl:"🇨🇱"},
  "Croatia":{de:"Kroatien",fl:"🇭🇷"}, "Czechoslovakia":{de:"Tschechoslowakei",fl:""},
  "England":{de:"England",fl:"🏴󠁧󠁢󠁥󠁮󠁧󠁿"}, "France":{de:"Frankreich",fl:"🇫🇷"},
  "Germany":{de:"Deutschland",fl:"🇩🇪"}, "Hungary":{de:"Ungarn",fl:"🇭🇺"},
  "Italy":{de:"Italien",fl:"🇮🇹"}, "Korea, Japan":{de:"Südkorea & Japan",fl:"🇰🇷 🇯🇵"},
  "Mexico":{de:"Mexiko",fl:"🇲🇽"}, "Morocco":{de:"Marokko",fl:"🇲🇦"},
  "Netherlands":{de:"Niederlande",fl:"🇳🇱"}, "Poland":{de:"Polen",fl:"🇵🇱"},
  "Portugal":{de:"Portugal",fl:"🇵🇹"}, "Qatar":{de:"Katar",fl:"🇶🇦"},
  "Russia":{de:"Russland",fl:"🇷🇺"}, "South Africa":{de:"Südafrika",fl:"🇿🇦"},
  "South Korea":{de:"Südkorea",fl:"🇰🇷"}, "Soviet Union":{de:"Sowjetunion",fl:""},
  "Spain":{de:"Spanien",fl:"🇪🇸"}, "Sweden":{de:"Schweden",fl:"🇸🇪"},
  "Switzerland":{de:"Schweiz",fl:"🇨🇭"}, "Turkey":{de:"Türkei",fl:"🇹🇷"},
  "United States":{de:"USA",fl:"🇺🇸"}, "Uruguay":{de:"Uruguay",fl:"🇺🇾"},
  "West Germany":{de:"Westdeutschland",fl:"🇩🇪"}, "Yugoslavia":{de:"Jugoslawien",fl:""}
};
function histCountry(name){ return WC_COUNTRY[name] || {de:name, fl:""}; }
// A history country matches the team chosen in "Mein Team" (selTeam, a German
// name). West Germany counts as Deutschland.
function histMatchesSel(name){
  if(!selTeam) return false;
  if(histCountry(name).de === selTeam) return true;
  if(selTeam === "Deutschland" && (name==="Germany" || name==="West Germany")) return true;
  return false;
}
function histTeamHtml(name){
  const c = histCountry(name);
  const fl = c.fl ? `<span class="hist-fl">${c.fl}</span>` : "";
  return `<span class="hist-team${histMatchesSel(name)?' hist-sel':''}">${fl}${escapeHtml(c.de)}</span>`;
}
function renderHistorie(){
  // Titel-Rangliste (Westdeutschland zählt zu Deutschland)
  const tally={};
  WC_HISTORY_M.forEach(t=>{ const k=(t[3]==="West Germany")?"Germany":t[3]; tally[k]=(tally[k]||0)+1; });
  const ranked=Object.entries(tally).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  const titlesEl=document.getElementById("histTitles");
  if(titlesEl) titlesEl.innerHTML=ranked.map(([nm,n])=>{
    const c=histCountry(nm);
    const fl=c.fl?`<span class="hist-fl">${c.fl}</span>`:"";
    return `<span class="hist-title-chip${histMatchesSel(nm)?' sel':''}">${fl}<span class="nm">${escapeHtml(c.de)}</span><span class="n">${n}</span></span>`;
  }).join("");
  const tblEl=document.getElementById("histTable");
  if(tblEl){
    const head=`<thead><tr><th>Jahr</th><th>Gastgeber</th><th class="num">Teams</th><th>🥇 Weltmeister</th><th>🥈 Finalist</th><th>🥉 Dritter</th><th>4.</th></tr></thead>`;
    const body=WC_HISTORY_M.slice().reverse().map(t=>{
      const [y,host,teams,c1,c2,c3,c4]=t;
      return `<tr><td class="yr">${y}</td><td>${histTeamHtml(host)}</td><td class="num">${teams}</td>`+
             `<td>${histTeamHtml(c1)}</td><td>${histTeamHtml(c2)}</td><td>${histTeamHtml(c3)}</td><td>${histTeamHtml(c4)}</td></tr>`;
    }).join("");
    tblEl.innerHTML=head+`<tbody>${body}</tbody>`;
  }
}

function renderAll(){
  T3MAP=assignThirds();
  renderGroups();
  renderKoSim();
  renderBracket();
  renderCalendar();
  renderTippspiel();
  renderMyTeam();
  renderThirdsTable();
  renderVenues();
  renderHistorie();
  renderScenarioCards();
  renderBlockSummary();
  updateTzNote();
  document.getElementById("chipTeam").style.display=selTeam?"inline-block":"none";
  if(!selTeam && calFilter==="team"){calFilter="all";syncChips();}
}
function syncChips(){ document.querySelectorAll(".chip").forEach(c=>c.classList.toggle("active",c.dataset.filter===calFilter)); }

/* tabs */
document.querySelectorAll(".tab").forEach(t=>{
  t.addEventListener("click",()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".panel-view").forEach(x=>x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById("view-"+t.dataset.view).classList.add("active");
    if(t.dataset.view==="orte"){ initVenueMap(); if(venueMap)setTimeout(()=>{venueMap.invalidateSize();updateVenueMarkers();},80); }
    window.scrollTo({top:0,behavior:"smooth"});
  });
});
/* calendar filter chips */
document.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{ calFilter=c.dataset.filter; syncChips(); renderCalendar(); }));
/* view toggle */
document.querySelectorAll(".vbtn").forEach(b=>b.addEventListener("click",()=>{
  calView=b.dataset.view;
  document.querySelectorAll(".vbtn").forEach(x=>x.classList.toggle("active",x===b));
  renderCalendar();
}));
/* timezone + ics export */
document.getElementById("tzSel").addEventListener("change",e=>{ dispTz=e.target.value; saveTz(); buildTF(); renderAll(); });
document.getElementById("icsAll").addEventListener("click",exportAllIcs);
/* day modal close */
document.getElementById("dayModalX").addEventListener("click",closeDayModal);
document.getElementById("dayModal").addEventListener("click",e=>{ if(e.target.id==="dayModal")closeDayModal(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape")closeDayModal(); });
/* reset scores */
document.getElementById("resetScores").addEventListener("click",()=>{
  if(confirm("Alle eingetragenen Ergebnisse löschen?")){ scores={}; saveScores(); renderAll(); }
});
document.getElementById("resetPicks").addEventListener("click",()=>{
  if(confirm("Alle K.-o.-Ergebnisse löschen? (Gruppenergebnisse bleiben erhalten)")){ koPicks={}; koScores={}; savePicks(); saveKoScores(); renderAll(); }
});

document.getElementById("simRun").addEventListener("click",()=>{
  SIMRES=runSimulation(document.getElementById("simBase").checked);
  renderSim();
});
document.getElementById("simRunMany").addEventListener("click",()=>{
  const inp=document.getElementById("simN");
  let n=parseInt(inp.value,10); if(isNaN(n))n=1000; n=Math.max(10,Math.min(50000,n)); inp.value=n;
  const useBase=document.getElementById("simBase").checked;
  const out=document.getElementById("simOut");
  out.innerHTML=`<div class="sim-loading">⏳ Simuliere ${n.toLocaleString("de-DE")} Turniere …</div>`;
  setTimeout(()=>{ const res=runManySimulations(n,useBase); renderDistribution(res,n,useBase); },30);
});

document.getElementById("fifaHead").addEventListener("click",()=>document.getElementById("fifaPanel").classList.toggle("collapsed"));
renderFifaRanking();

document.getElementById("olbLoad").addEventListener("click",()=>olbDoUpdate(true));
document.getElementById("olbAuto").addEventListener("change",e=>olbToggleAuto(e.target.checked));

/* dev: testdata simulation */
document.getElementById("devRunLevel").addEventListener("click",()=>{
  const lv=+document.getElementById("devLevel").value;
  if(confirm("Testdaten erzeugen? Alle eingetragenen Ergebnisse werden überschrieben."))devSimulate({level:lv});
});
document.getElementById("devRunDate").addEventListener("click",()=>{
  const d=document.getElementById("devDate").value; if(!d)return;
  if(confirm("Testdaten bis "+d+" erzeugen? Alle eingetragenen Ergebnisse werden überschrieben."))devSimulate({date:d});
});
document.getElementById("devClear").addEventListener("click",()=>{
  if(confirm("Alle eingetragenen Ergebnisse löschen?")){ scores={};koScores={};koPicks={};saveScores();saveKoScores();savePicks();renderAll(); }
});

renderAll();

// Wenn beim Laden bereits eine Cloud-Runde gespeichert ist: Tipps holen + Polling starten.
if(CLOUD_ON() && cloudRound){ cloudStartPolling(); cloudPullTips().catch(()=>{}); }

/* === qurix snapshot hooks ===
   All app state lives in localStorage (BK_KEYS). "Export with data" serialises
   those keys; on open, hydrateState writes them back and reloads once so the
   app re-renders from the restored data. A change check prevents a reload loop
   (after applying, localStorage equals the snapshot → no further reload). */
window.qurixApp = window.qurixApp || {};
window.qurixApp.serializeState = function(){
  const data = {};
  BK_KEYS.forEach(k => { try { const v = localStorage.getItem(k); if (v != null) data[k] = v; } catch(_){} });
  return data;
};
window.qurixApp.hydrateState = function(s){
  if (!s || typeof s !== "object") return;
  // Warn before overwriting existing, differing local data.
  const conflict = BK_KEYS.some(k => {
    let cur; try { cur = localStorage.getItem(k); } catch(_){ return false; }
    return cur != null && s[k] != null && cur !== s[k];
  });
  if (conflict && !confirm("Dieser Snapshot enthält gespeicherte Daten, die deine aktuellen lokalen Daten in diesem Browser überschreiben. Fortfahren?")) return;
  let changed = false;
  BK_KEYS.forEach(k => {
    if (s[k] == null) return;
    let cur; try { cur = localStorage.getItem(k); } catch(_){ cur = null; }
    if (cur !== s[k]) { try { localStorage.setItem(k, s[k]); changed = true; } catch(_){} }
  });
  if (changed) location.reload();
};
