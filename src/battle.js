/* 陸これ（仮） — 戦闘（りっくじあーす式：六角マス・ターン制・自動戦闘）
   マスごとに地形の絵と効果があり、戦闘で地形が変わる（森→炎上→焼け野原、市街→瓦礫、砲撃痕、残骸、煙幕）。
   隊員には強化・弱体（炎上・履帯損傷・制圧・照準・士気高揚・防御態勢）が付く。
   動き（移動・発砲・弾・爆発・被弾・撃破・ターンの帯）は、すべて待ってから次へ進む（battle.busy）。 */
'use strict';

/* ===== 盤面の大きさ（戦闘画面の地図枠 820×594 に収める） ===== */
const MAP_COLS=11, MAP_ROWS=9, HEX_S=40, HEX_W=Math.sqrt(3)*HEX_S;
const MAP_W=820, MAP_H=594;
const MAP_OX=(MAP_W-(MAP_COLS+0.5)*HEX_W)/2, MAP_OY=(MAP_H-(1.5*(MAP_ROWS-1)+2)*HEX_S)/2;

/* ===== 地形 =====
   cost=移動に使う点（Infinity は通れない）、def=そのマスに居る者の被ダメージ倍率（小さいほど堅い）、range=射程+ */
const TERRAIN={
  plain:{name:"平地",cost:1,def:1.00,g:["#8db35a","#5f8538"],note:"見通しの良い草地"},
  road:{name:"道路",cost:0.5,def:1.05,g:["#8fa065","#66763f"],note:"速く進めるが隠れられない"},
  forest:{name:"森林",cost:2,def:0.80,g:["#5b8a44","#355f27"],note:"木立が身を隠す。燃える"},
  mountain:{name:"山岳",cost:3,def:0.75,range:1,g:["#9d9478","#665f4b"],note:"高所。射程+1・堅い"},
  city:{name:"市街",cost:1.5,def:0.75,g:["#a7a39a","#76716a"],note:"建物が遮蔽。壊れると瓦礫"},
  water:{name:"河川",cost:Infinity,def:1.2,g:["#5b9cc6","#2f6489"],note:"戦車は渡れない"},
  bridge:{name:"橋",cost:1,def:1.1,g:["#5b9cc6","#2f6489"],note:"壊れると浅瀬に"},
  ford:{name:"浅瀬",cost:3,def:1.15,g:["#79b2cf","#4a83a3"],note:"渡れるが遅く無防備"},
  snow:{name:"雪原",cost:1.5,def:0.95,g:["#eef3f7","#bccad6"],note:"深雪で足が鈍る"},
  snowforest:{name:"雪の森",cost:2,def:0.82,g:["#dde7ee","#a9bccb"],note:"雪をかぶった木立"},
  sand:{name:"砂浜",cost:1.5,def:1.00,g:["#ecd79c","#c7a866"],note:"足を取られる"},
  rubble:{name:"瓦礫",cost:2,def:0.70,g:["#8f867a","#5e564c"],note:"崩れた街。最も堅い"},
  burning:{name:"炎上中",cost:2,def:0.90,g:["#7a4a26","#4a2a14"],note:"燃えている。止まると炎上"},
  burnt:{name:"焼け野原",cost:1,def:1.00,g:["#5f4d3c","#3a2f25"],note:"焼け落ちた森"},
  crater:{name:"砲撃痕",cost:1.5,def:0.90,g:["#8a8f55","#5c6233"],note:"穴が身を隠す"},
  hill:{name:"丘陵",cost:2,def:0.85,g:["#9fbf6a","#6a8a3c"],note:"なだらかな高み。少し堅い"},
  town:{name:"集落",cost:1.5,def:0.82,g:["#b7c08f","#8a935f"],note:"民家が並ぶ。壊れると瓦礫"},
  fort:{name:"陣地",cost:2,def:0.62,g:["#a8915e","#76623a"],note:"土嚢と塹壕。とても堅い"},
  field:{name:"畑",cost:1.5,def:0.95,g:["#c9c56a","#9a9640"],note:"畝で足が取られる"},
  swamp:{name:"湿地",cost:2.5,def:1.10,g:["#6f7f4f","#46542e"],note:"ぬかるみ。遅く無防備"},
  rail:{name:"線路",cost:1,def:1.05,g:["#9a9486","#6d6759"],note:"砂利の線路。隠れられない"},
};
/* 爆発・撃破でマスがこう変わる */
const SCAR={forest:"burning",snowforest:"burning",city:"rubble",town:"rubble",plain:"crater",road:"crater",snow:"crater",sand:"crater",bridge:"ford",burnt:"crater",field:"crater",fort:"crater",rail:"crater",hill:"crater"};

/* ===== 強化・弱体 ===== */
const STATUS={
  morale:{name:"士気高揚",icon:"⏫",buff:true,desc:"攻撃+30%"},
  guard:{name:"防御態勢",icon:"🛡️",buff:true,desc:"被ダメージ−30%（動かず攻撃もしないと付く）"},
  burn:{name:"炎上",icon:"🔥",desc:"自分の番の始めに最大耐久の8%のダメージ"},
  track:{name:"履帯損傷",icon:"⛓️",desc:"移動力が1になる"},
  suppress:{name:"制圧",icon:"💢",desc:"攻撃−30%"},
  mark:{name:"照準",icon:"🎯",desc:"被ダメージ+20%"},
};

/* ===== 攻撃と支援 ===== */
const ATTACKS={
  normal:{name:"通常砲撃",icon:"💥",mul:1.0,cd:0,desc:"基本の砲撃"},
  ap:{name:"徹甲弾",icon:"🎯",mul:1.5,pierce:0.5,cd:3,desc:"装甲を貫く。35%で履帯損傷（3ターンに1回）"},
  he:{name:"榴弾",icon:"💣",mul:0.85,splash:0.5,cd:3,desc:"周りにも50%。35%で炎上・地形が荒れる（3ターンに1回）"},
  mg:{name:"機銃掃射",icon:"🔫",mul:0.4,hits:3,cd:2,noCounter:true,desc:"3連射。歩兵に強く制圧する。反撃なし（2ターンに1回）"},
};
const SKILLS={
  charge:{name:"全車突撃",icon:"⚡",cd:4,desc:"全員に士気高揚（攻撃+30%・2ターン）"},
  smoke:{name:"煙幕展開",icon:"🌫️",cd:4,desc:"味方の周りに煙幕（中の者は被ダメージ−30%・2ターン）"},
  repair:{name:"応急修理",icon:"🛠️",cd:5,desc:"全員の耐久を25%回復し、炎上と履帯損傷を治す"},
  barrage:{name:"支援砲撃",icon:"☄️",cd:6,desc:"敵全員に砲撃。地形も荒れる"},
};

/* ===== 敵 ===== kind: inf=歩兵（機銃に弱い）, veh=車輌, air=航空（地形を無視） */
const ENEMY_TYPES={
  infantry:{name:"敵歩兵",kind:"inf",hp:34,atk:14,def:4,mv:3,rng:1,weapon:"mg"},
  light:{name:"敵軽戦車",kind:"veh",hp:60,atk:20,def:10,mv:4,rng:1,weapon:"normal"},
  heavy:{name:"敵重戦車",kind:"veh",hp:120,atk:30,def:22,mv:2,rng:1,weapon:"ap"},
  spg:{name:"敵自走砲",kind:"veh",hp:64,atk:34,def:6,mv:2,rng:3,weapon:"he"},
  atgun:{name:"敵対戦車砲",kind:"inf",hp:44,atk:32,def:6,mv:1,rng:2,weapon:"ap"},
  heli:{name:"敵攻撃ヘリ",kind:"air",hp:70,atk:26,def:10,mv:5,rng:2,weapon:"normal"},
};

/* ===== 戦域と段階（艦これの 1-1・1-2・1-3 にあたる） =====
   各段階の地図は手で描いた 11列×9行（左2列＝味方の配置、右3列＝敵の出現）。
   記号: . 平地  r 道路  f 森林  M 山岳  h 丘陵  c 市街  t 集落  w 河川  b 橋  o 浅瀬  s 雪原  S 雪の森
         d 砂浜  x 瓦礫  q 砲撃痕  k 陣地  p 畑  m 湿地  = 線路 */
const TILE_CODE={".":"plain",r:"road",f:"forest",M:"mountain",h:"hill",c:"city",t:"town",w:"water",b:"bridge",o:"ford",s:"snow",S:"snowforest",
  d:"sand",x:"rubble",q:"crater",k:"fort",p:"field",m:"swamp","=":"rail"};
const AREAS=[
  { id:"hokkaido", name:"戦域I 北部方面隊：北海道大演習場", short:"北海道", desc:"機甲科の聖地。雪原と森の機動戦。", terrain:"snow", restrict:null, power:300, eBaseHP:1400 },
  { id:"fuji", name:"戦域II 東部方面隊：富士総合火力演習場", short:"富士", desc:"総火演の舞台。山を挟んだ火力戦。", terrain:"mountain", restrict:{note:"中・重戦車の活躍が見込まれる戦域"}, power:600, eBaseHP:1900 },
  { id:"kyushu", name:"戦域III 西部方面隊：九州防衛線", short:"九州", desc:"離島防衛の最前線。上陸から港町、司令部へ。", terrain:"sand", restrict:null, power:900, eBaseHP:2600 },
  { id:"city", name:"戦域IV 市街戦：包囲下の工業都市", short:"工業都市", desc:"郊外から工業地帯、中央駅へ。近接の死闘。", terrain:"city", restrict:null, power:1100, eBaseHP:3000 },
  { id:"river", name:"戦域V 渡河作戦：大河の防衛線", short:"大河", desc:"湿地を抜け、大橋を渡り、対岸の砲兵陣地を叩け。", terrain:"water", restrict:null, power:1300, eBaseHP:2800 },
];
const W=(t,n,o)=>Object.assign({t,n},o||{});
const STAGES={
  hokkaido:[
    { name:"雪原の偵察線", desc:"見通しの良い雪原。道路を使って素早く寄せろ。", atk:0.6, x:28,y:62,
      layout:["sssSSssssss","ssssSsshsss","rrrrrrrrrrr","sssSssssSSs","ssSSsshssss","sssssSsssss","sshssssSSss","sSSsssssshs","sssssSSssss"],
      waves:[[W("infantry",2),W("light",1)],[W("infantry",2),W("light",1,{boss:true,hp:1.3})]] },
    { name:"凍った渡渉点", desc:"川を渡るのは橋か浅瀬だけ。渡る間は無防備になる。", atk:0.65, x:52,y:36,
      layout:["sSssswssSSs","ssSssossssh","sssSswsSsss","sSssswhssss","rrrrrbrrrrr","sssSswssSss","shsSswsSSss","sssssosssSs","sSSsswsssss"],
      waves:[[W("infantry",3),W("light",1)],[W("light",2),W("infantry",1)],[W("light",1,{boss:true,hp:1.5}),W("infantry",2)]] },
    { name:"矢臼別の高地", desc:"高地の陣地に敵の重戦車。山は射程+1、陣地はとても堅い。", atk:0.7, x:80,y:56, boss:true,
      layout:["ssSShMhSsss","sssShMMhsks","sSsshhMhssk","ssssshhskss","rrrrrrrrrrr","sSssshhskss","ssSshMhhsks","sssShMMhsss","sSssshhSSss"],
      waves:[[W("infantry",3),W("light",1)],[W("light",2),W("infantry",2)],[W("heavy",1,{boss:true,hp:1.8}),W("infantry",2)]] },
  ],
  fuji:[
    { name:"演習開始線", desc:"畑と森の帯が続く。集落を盾に前進せよ。", atk:0.8, x:26,y:66,
      layout:["pp..ff.pp..","pp..f..ppff","....ff....f","rrrrrrrrrrr","..tt..ff...",".ttp..f..pp","..pp..ff.pp","ff..h...ff.","fff.hh..ff."],
      waves:[[W("light",2),W("infantry",2)],[W("infantry",2),W("atgun",1)],[W("light",1,{boss:true,hp:1.5}),W("infantry",1)]] },
    { name:"北富士射場", desc:"砲撃の跡だらけの射場。穴に隠れて撃ち合え。", atk:0.85, x:54,y:70,
      layout:["ff....h..kf","f..q...q.k.","..q..q....k","....hh.q...","rr.q.hh..rr","...q..q....",".q....q.qk.","f..q.....k.","ff...hh..kf"],
      waves:[[W("light",2),W("infantry",2)],[W("spg",1),W("heavy",1),W("infantry",2)],[W("heavy",1,{boss:true,hp:1.6}),W("infantry",1)]] },
    { name:"富士山麓", desc:"霊峰の裾野。山を回り込むか、越えて撃ち下ろすか。", atk:0.9, x:78,y:42, boss:true,
      layout:["ffhMMMMMhff","fhhMMMMMhhf","f.hhMMMhh.k","..fhhMhhf.k","...ffhff...","rrrrrrrrrrr","pp.tt...ppk","ppptt.ff.pk","ff..ffff..f"],
      waves:[[W("light",2),W("infantry",2)],[W("spg",1),W("heavy",1),W("infantry",2)],[W("heavy",1,{boss:true,hp:2.2}),W("spg",1),W("light",1)]] },
  ],
  kyushu:[
    { name:"上陸海岸", desc:"砂浜から上陸。敵の対戦車砲に注意。", atk:0.9, x:22,y:60,
      layout:["wwwdd..ffff","wddd..f.ff.","ddd...tt...","dd.rrrrrrrr","dd..f.t...k","ddd..ff..kk","wddd...hh..","wwdd..fhh..","wwwddd....."],
      waves:[[W("light",3),W("atgun",1)],[W("infantry",3),W("light",1,{boss:true,hp:1.5})]] },
    { name:"港町", desc:"運河の走る港町。橋を押さえ、ヘリに備えよ。", atk:1.0, x:48,y:34,
      layout:["..tt.ff.tt.",".ttt..ttct.","rrrrrrrrrrr",".tc.cc.ctt.",".tc.wwcc.t.","..t.bbc.tt.",".tt.ww.tt..","dddwwwwddd.","wwwwwwwwwww"],
      waves:[[W("light",2),W("atgun",1)],[W("heli",2),W("infantry",2)],[W("heavy",1,{boss:true,hp:1.8}),W("infantry",2)]] },
    { name:"防衛線司令部", desc:"陣地の列の奥に敵司令部。榴弾で陣地を崩せ。", atk:1.05, x:80,y:56, boss:true,
      layout:["..ff.hk.cc.",".f..hhk.ct.","...f..k..c.","rrrrrrrrrrr","..t...kxcc.",".tt..hk.cck","...f.hk..t.","dd..ff.k.t.","wwdd.f..k.."],
      waves:[[W("light",3),W("atgun",1)],[W("heli",2),W("infantry",3)],[W("spg",2),W("heavy",1)],[W("heavy",1,{boss:true,hp:2.6}),W("heli",1),W("atgun",1)]] },
  ],
  city:[
    { name:"郊外", desc:"線路の走る郊外。集落と畑が入り組む。", atk:1.2, x:24,y:40,
      layout:["pp.tt..tt..","p.ttt.f.tt.","===========",".t..pp.t...","rrrrrrrrrrr","..tt..pp.t.",".ttf..p.tt.","pp..ff..t..","ppp.f..tt.."],
      waves:[[W("infantry",3),W("atgun",1)],[W("light",2),W("infantry",2)],[W("heavy",1,{boss:true,hp:1.6}),W("infantry",1)]] },
    { name:"工業地帯", desc:"工場と操車場。瓦礫が最良の盾になる。", atk:1.35, x:52,y:66,
      layout:["cc.cc==.cc.","c..xc==.c.c",".cc..==.xcc","rrrrr==rrrr","x.cc.==.cc.",".c.x.==..cx","rrrrr==rrrr","cc..c==.c..",".cx.c==..cc"],
      waves:[[W("infantry",3),W("atgun",2)],[W("heavy",2),W("infantry",2)],[W("spg",1),W("heli",1),W("light",1,{boss:true,hp:2})]] },
    { name:"中央駅", desc:"駅は要塞と化した。陣地に籠もる敵主力を撃て。", atk:1.45, x:80,y:36, boss:true,
      layout:["ccrcccrcccc","ccrcxcrc.kc","rrrrrrrrrrr","cxrcc==ckkc","ccr==k==.kc","ccrcc==ckkc","rrrrrrrrrrr","ccrc.crcxcc","ccrccxrcccc"],
      waves:[[W("infantry",3),W("atgun",2)],[W("heavy",2),W("infantry",2)],[W("spg",1),W("heli",1),W("light",2)],[W("heavy",1,{boss:true,hp:3.0}),W("atgun",2)]] },
  ],
  river:[
    { name:"湿地帯", desc:"ぬかるみと小川。足を取られる所で撃たれるな。", atk:1.4, x:22,y:58,
      layout:["ffmm..ffmmf","f.mmw.f.mm.","..m.w.mm...","ff..o..m.ff","rrrrbrrrrrr","..mmw..ff..","f.m.w.mm.f.","ffmmo.fmm..","fff.w..ffmf"],
      waves:[[W("infantry",3),W("light",1)],[W("spg",1),W("infantry",2)],[W("light",2),W("heli",1,{boss:true,hp:1.5})]] },
    { name:"大橋", desc:"渡れるのは大橋と上流の浅瀬だけ。対岸から狙われる。", atk:1.5, x:50,y:38,
      layout:["ff..ooo..ff","f...www..f.","..t.www.t..",".tt.www.tt.","rrrrbbbrrrr",".tt.www.tt.","..f.www.f..","f...www...f","ff.mwwwm.ff"],
      waves:[[W("spg",2),W("infantry",2)],[W("heli",2),W("light",2)],[W("heavy",1,{boss:true,hp:2.2}),W("atgun",1)]] },
    { name:"対岸の砲兵陣地", desc:"川を越えた先、高地の砲兵陣地が最後の砦。", atk:1.6, x:80,y:62, boss:true,
      layout:["f..ww.hhMkk","..fww.hMhk.","rrrbbrrrrrr",".f.ww.hhk.k","...ww..hkkM","f..ww.h.k..","..foo.hhk..",".ffww..h.kk","ff.ww.hhMk."],
      waves:[[W("spg",2),W("infantry",2)],[W("heli",2),W("light",2)],[W("heavy",2),W("atgun",1)],[W("spg",1,{boss:true,hp:3.2}),W("heavy",1),W("heli",1)]] },
  ],
};
/* 進み具合（state.clearedStages に "hokkaido-1" の形で入る） */
function stageKey(a,i){ return a+"-"+(i+1); }
function stageCleared(a,i){ return (state.clearedStages||[]).includes(stageKey(a,i)); }
function stageOpen(a,i){ return i===0||stageCleared(a,i-1); }
function areaOpen(idx){ return idx===0||(state.clearedAreas||[]).includes(AREAS[idx-1].id); }
function stagePower(a,i){ return Math.round(AREAS.find(x=>x.id===a).power*[0.6,0.8,1][i]); }

const ALLY_DEF=0.7;   // 味方の装甲→防御の換算（調整用）
let battle=null;      // 進行中の戦闘
let sortie=null;      // 選んだ戦域 {areaId}

/* ===== 六角マスの計算（尖った頂点が上・奇数行が右へ半マスずれる） ===== */
function hexCenter(c,r){ return {x:MAP_OX+HEX_W*(c+0.5*(r&1))+HEX_W/2, y:MAP_OY+HEX_S+r*1.5*HEX_S}; }
function hexPoints(s){ const p=[]; for(let i=0;i<6;i++){ const a=Math.PI/180*(60*i-30); p.push(`${(s*Math.cos(a)).toFixed(1)},${(s*Math.sin(a)).toFixed(1)}`); } return p.join(" "); }
function toCube(c,r){ const x=c-(r-(r&1))/2; return {x,y:-x-r,z:r}; }
function hexDist(a,b){ const p=toCube(a.c,a.r), q=toCube(b.c,b.r); return Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y),Math.abs(p.z-q.z)); }
function inMap(c,r){ return c>=0&&c<MAP_COLS&&r>=0&&r<MAP_ROWS; }
const NB_EVEN=[[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]], NB_ODD=[[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]];
function neighbors(c,r){ return ((r&1)?NB_ODD:NB_EVEN).map(([dc,dr])=>({c:c+dc,r:r+dr})).filter(p=>inMap(p.c,p.r)); }
function key(c,r){ return c+","+r; }

/* ===== 地図を作る（手描きの配置を読む。左2列の水は砂浜にして必ず配置できるようにする） ===== */
function genMap(stage){
  const T=stage.layout.map((row,r)=>{ if(row.length!==MAP_COLS) throw new Error(`地図の${r+1}行目が${row.length}文字`);
    return [...row].map(ch=>({t:TILE_CODE[ch]||"plain",fire:0,smoke:0,wreck:false})); });
  if(T.length!==MAP_ROWS) throw new Error("地図の行数が違う");
  for(let r=0;r<MAP_ROWS;r++){ if(T[r][1].t==="water") T[r][1].t="sand"; }
  return T;
}

/* ===== マスの絵（SVG） ===== */
function terrainDefs(){
  const g=Object.entries(TERRAIN).map(([k,v])=>`<radialGradient id="tg-${k}" cx="45%" cy="35%" r="80%"><stop offset="0" stop-color="${v.g[0]}"/><stop offset="1" stop-color="${v.g[1]}"/></radialGradient>`).join("");
  return `<defs>${g}
    <radialGradient id="tg-shade" cx="50%" cy="30%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></radialGradient>
    <symbol id="d-tree" viewBox="-10 -22 20 26"><rect x="-1.6" y="-2" width="3.2" height="6" fill="#4b3420"/><path d="M0-22 L9-6 L4-6 L10 1 L-10 1 L-4-6 L-9-6Z" fill="#2f6b2a" stroke="#1d4419" stroke-width="1"/><path d="M0-22 L5-12 L-1-12Z" fill="#4f9a43"/></symbol>
    <symbol id="d-stree" viewBox="-10 -22 20 26"><rect x="-1.6" y="-2" width="3.2" height="6" fill="#4b3420"/><path d="M0-22 L9-6 L4-6 L10 1 L-10 1 L-4-6 L-9-6Z" fill="#3f6b4a" stroke="#27443a" stroke-width="1"/><path d="M0-22 L6-11 L3-11 L7-5 L-7-5 L-3-11 L-6-11Z" fill="#f4f8fb"/></symbol>
    <symbol id="d-btree" viewBox="-10 -22 20 26"><path d="M0 4 L0-14 M0-8 L5-13 M0-5 L-5-11" stroke="#1d150e" stroke-width="2.4" fill="none" stroke-linecap="round"/></symbol>
    <symbol id="d-house" viewBox="-12 -16 24 18"><rect x="-10" y="-8" width="20" height="10" fill="#d8d1c2" stroke="#5a5348"/><path d="M-12-8 L0-16 L12-8Z" fill="#a8483a" stroke="#5a2a22"/><rect x="-6" y="-5" width="4" height="4" fill="#5d7fa0"/><rect x="2" y="-5" width="4" height="4" fill="#5d7fa0"/></symbol>
    <symbol id="d-bldg" viewBox="-8 -26 16 28"><rect x="-7" y="-24" width="14" height="26" fill="#bfc3c7" stroke="#4f555b"/><g fill="#6a8fb0"><rect x="-5" y="-21" width="3" height="3"/><rect x="2" y="-21" width="3" height="3"/><rect x="-5" y="-15" width="3" height="3"/><rect x="2" y="-15" width="3" height="3"/><rect x="-5" y="-9" width="3" height="3"/><rect x="2" y="-9" width="3" height="3"/></g></symbol>
    <symbol id="d-ruin" viewBox="-12 -16 24 18"><path d="M-10 2 L-10-8 L-6-12 L-4-6 L0-10 L2-4 L6-9 L10-2 L10 2Z" fill="#7e776d" stroke="#3f3a34"/><g fill="#5b544b"><rect x="-8" y="-1" width="5" height="3"/><rect x="2" y="-2" width="6" height="4"/></g></symbol>
    <symbol id="d-wreck" viewBox="-14 -12 28 16"><rect x="-12" y="-4" width="24" height="7" rx="2" fill="#2a2622" stroke="#000"/><rect x="-5" y="-9" width="10" height="6" rx="2" fill="#3a332c"/><path d="M5-7 L13-11" stroke="#2a2622" stroke-width="2.4"/><circle cx="-8" cy="4" r="2" fill="#111"/><circle cx="0" cy="4" r="2" fill="#111"/><circle cx="8" cy="4" r="2" fill="#111"/></symbol>
  </defs>`;
}
function decoFor(tile){
  const t=tile.t; let d="";
  const s=HEX_S;
  if(t==="plain") d=`<g stroke="#4c7a2c" stroke-width="1.6" stroke-linecap="round" opacity=".8"><path d="M-14 6 l2 -6 l2 6 M8 -8 l2 -6 l2 6 M-4 16 l2 -5 l2 5 M14 10 l2 -5 l2 5"/></g>`;
  else if(t==="road") d=`<rect x="${-HEX_W/2}" y="-7" width="${HEX_W}" height="14" fill="#6d6a62"/><path d="M${-HEX_W/2} 0 H${HEX_W/2}" stroke="#e8e1c8" stroke-width="1.6" stroke-dasharray="6 6"/>`;
  else if(t==="forest") d=`<use href="#d-tree" x="-24" y="-24" width="22" height="28"/><use href="#d-tree" x="2" y="-28" width="24" height="30"/><use href="#d-tree" x="-12" y="-6" width="24" height="30"/>`;
  else if(t==="snowforest") d=`<use href="#d-stree" x="-24" y="-24" width="22" height="28"/><use href="#d-stree" x="2" y="-28" width="24" height="30"/><use href="#d-stree" x="-12" y="-6" width="24" height="30"/>`;
  else if(t==="mountain") d=`<path d="M-30 18 L-8 -22 L2 -8 L10 -26 L32 18Z" fill="#7d7562" stroke="#4a4436" stroke-width="1.2"/><path d="M-8 -22 L-14 -11 L-8 -14 L-3 -11Z M10 -26 L4 -15 L10 -18 L16 -14Z" fill="#f4f1ea"/><path d="M10 -26 L32 18 L14 18Z" fill="#000" opacity=".18"/>`;
  else if(t==="city") d=`<use href="#d-bldg" x="-26" y="-30" width="18" height="32"/><use href="#d-house" x="-6" y="-14" width="26" height="20"/><use href="#d-bldg" x="8" y="-34" width="16" height="30"/><use href="#d-house" x="-24" y="2" width="22" height="16"/>`;
  else if(t==="rubble") d=`<use href="#d-ruin" x="-24" y="-16" width="26" height="20"/><use href="#d-ruin" x="0" y="-4" width="26" height="20"/><circle cx="16" cy="-14" r="3" fill="#6b645a"/><circle cx="-12" cy="14" r="2.5" fill="#6b645a"/>`;
  else if(t==="water") d=`<g stroke="#bfe3f5" stroke-width="1.6" fill="none" opacity=".75" class="wave"><path d="M-22 -8 q5 -5 10 0 t10 0"/><path d="M-4 8 q5 -5 10 0 t10 0"/><path d="M-26 20 q5 -5 10 0 t10 0"/></g>`;
  else if(t==="bridge") d=`<g stroke="#bfe3f5" stroke-width="1.4" fill="none" opacity=".6"><path d="M-22 -16 q5 -5 10 0 t10 0"/><path d="M4 22 q5 -5 10 0 t10 0"/></g><rect x="${-HEX_W/2}" y="-9" width="${HEX_W}" height="18" fill="#8a6a44" stroke="#4a3520"/><path d="M${-HEX_W/2} -9 H${HEX_W/2} M${-HEX_W/2} 9 H${HEX_W/2}" stroke="#2c2016" stroke-width="2"/>`;
  else if(t==="ford") d=`<g fill="#a9a08a" stroke="#6b6352"><ellipse cx="-12" cy="-6" rx="6" ry="4"/><ellipse cx="6" cy="4" rx="7" ry="4"/><ellipse cx="-4" cy="16" rx="5" ry="3"/></g><path d="M-20 -16 q5 -5 10 0 t10 0" stroke="#d5eef8" fill="none" stroke-width="1.4"/>`;
  else if(t==="snow") d=`<g fill="#fff"><circle cx="-14" cy="-8" r="2"/><circle cx="10" cy="-14" r="1.6"/><circle cx="4" cy="10" r="2.2"/><circle cx="-6" cy="18" r="1.4"/><circle cx="18" cy="6" r="1.8"/></g>`;
  else if(t==="sand") d=`<g fill="#b4935a" opacity=".7"><circle cx="-12" cy="-6" r="1.4"/><circle cx="8" cy="-12" r="1.2"/><circle cx="2" cy="8" r="1.4"/><circle cx="-4" cy="18" r="1.1"/><circle cx="16" cy="4" r="1.3"/></g><path d="M-24 14 q8 -4 16 0 t16 0" stroke="#fff3cf" fill="none" stroke-width="1.4"/>`;
  else if(t==="burning") d=`<use href="#d-btree" x="-22" y="-22" width="20" height="26"/><use href="#d-btree" x="4" y="-26" width="22" height="28"/>
      <g class="flames"><path class="fl f1" d="M-14 10 C-20 0,-12 -6,-12 -16 C-6 -8,-2 -4,-6 10Z" fill="#ff7a1a"/><path class="fl f2" d="M4 12 C-2 2,6 -6,8 -20 C14 -10,18 -2,12 12Z" fill="#ffb12a"/><path class="fl f3" d="M-4 14 C-8 8,-2 2,0 -6 C4 2,6 8,2 14Z" fill="#ffe36a"/></g>`;
  else if(t==="burnt") d=`<use href="#d-btree" x="-22" y="-22" width="20" height="26"/><use href="#d-btree" x="4" y="-26" width="22" height="28"/><use href="#d-btree" x="-8" y="-4" width="20" height="26"/><g fill="#1c1611" opacity=".6"><ellipse cx="-10" cy="16" rx="8" ry="3"/><ellipse cx="12" cy="10" rx="7" ry="2.5"/></g>`;
  else if(t==="crater") d=`<ellipse cx="0" cy="4" rx="${s*0.48}" ry="${s*0.3}" fill="#3e3a28" stroke="#6b6640" stroke-width="2"/><ellipse cx="2" cy="6" rx="${s*0.3}" ry="${s*0.17}" fill="#2a2719"/><g fill="#5a5438"><circle cx="-20" cy="-10" r="2.5"/><circle cx="18" cy="-12" r="2"/></g>`;
  else if(t==="hill") d=`<ellipse cx="0" cy="8" rx="${s*0.62}" ry="${s*0.36}" fill="#86a84f" stroke="#5c7a34" stroke-width="1.2"/><ellipse cx="-2" cy="4" rx="${s*0.42}" ry="${s*0.22}" fill="none" stroke="#5c7a34" stroke-width="1"/><ellipse cx="-3" cy="1" rx="${s*0.2}" ry="${s*0.1}" fill="#a3c46a"/>`;
  else if(t==="town") d=`<use href="#d-house" x="-24" y="-20" width="22" height="18"/><use href="#d-house" x="2" y="-12" width="24" height="19"/><use href="#d-house" x="-14" y="4" width="22" height="18"/><use href="#d-tree" x="12" y="-30" width="14" height="18"/>`;
  else if(t==="fort") d=`<path d="M-24 6 Q0 -16 24 6" fill="none" stroke="#4f4026" stroke-width="7" stroke-linecap="round"/><path d="M-24 6 Q0 -16 24 6" fill="none" stroke="#c9b27a" stroke-width="5" stroke-dasharray="5 2" stroke-linecap="round"/><rect x="-7" y="-4" width="14" height="8" rx="2" fill="#5a4a2c"/><path d="M-3 -2 L8 -6" stroke="#222" stroke-width="2"/><path d="M-26 16 H26" stroke="#4f4026" stroke-width="3"/>`;
  else if(t==="field") d=`<g stroke="#8a8630" stroke-width="2" opacity=".85"><path d="M-26 -10 L10 -26 M-28 0 L18 -20 M-26 10 L26 -12 M-20 18 L28 -2 M-8 24 L26 8"/></g><g fill="#e8e09a"><circle cx="-10" cy="-8" r="1.6"/><circle cx="8" cy="0" r="1.6"/><circle cx="-2" cy="12" r="1.6"/></g>`;
  else if(t==="swamp") d=`<g fill="#3d5a5e" stroke="#2b3f3a"><ellipse cx="-10" cy="-4" rx="9" ry="4"/><ellipse cx="10" cy="8" rx="11" ry="4.5"/><ellipse cx="-4" cy="18" rx="7" ry="3"/></g><g stroke="#2f4a1e" stroke-width="1.6" stroke-linecap="round"><path d="M-20 10 v-10 M-17 10 v-7 M16 -8 v-10 M19 -8 v-7 M2 -14 v-8"/></g>`;
  else if(t==="rail") d=`<rect x="${-HEX_W/2}" y="-8" width="${HEX_W}" height="16" fill="#8a8476"/><g stroke="#4a3a28" stroke-width="3">${[-24,-14,-4,6,16,26].map(x=>`<path d="M${x} -8 V8"/>`).join("")}</g><path d="M${-HEX_W/2} -4 H${HEX_W/2} M${-HEX_W/2} 4 H${HEX_W/2}" stroke="#cfd3d6" stroke-width="2"/>`;
  if(tile.wreck) d+=`<use href="#d-wreck" x="-16" y="-2" width="32" height="18"/><g class="wsmoke"><circle cx="6" cy="-6" r="4" fill="#555" opacity=".5"/><circle cx="9" cy="-14" r="5" fill="#777" opacity=".35"/></g>`;
  if(tile.smoke>0) d+=`<g class="smoke"><circle cx="-10" cy="-4" r="15" fill="#d9dde0" opacity=".55"/><circle cx="10" cy="0" r="17" fill="#e8ebed" opacity=".5"/><circle cx="0" cy="12" r="14" fill="#cdd2d6" opacity=".5"/></g>`;
  return d;
}
function tileSvg(c,r){
  const tile=battle.tiles[r][c], p=hexCenter(c,r);
  return `<g class="hx t-${tile.t}" data-c="${c}" data-r="${r}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
    <polygon points="${hexPoints(HEX_S)}" fill="url(#tg-${tile.t})"/>
    <polygon points="${hexPoints(HEX_S)}" fill="url(#tg-shade)"/>
    ${decoFor(tile)}
    <polygon class="hx-edge" points="${hexPoints(HEX_S-1.2)}" fill="none"/>
  </g>`;
}
function renderMap(){
  const svg=document.getElementById("bt-svg");
  svg.setAttribute("viewBox",`0 0 ${MAP_W} ${MAP_H}`); svg.setAttribute("width",MAP_W); svg.setAttribute("height",MAP_H);
  let h=terrainDefs()+`<g id="bt-tiles">`;
  for(let r=0;r<MAP_ROWS;r++) for(let c=0;c<MAP_COLS;c++) h+=tileSvg(c,r);
  h+=`</g><g id="bt-hl"></g>`;
  svg.innerHTML=h;
}
function updateTile(c,r,flash){
  const old=document.querySelector(`#bt-tiles .hx[data-c="${c}"][data-r="${r}"]`); if(!old) return;
  const tmp=document.createElementNS("http://www.w3.org/2000/svg","g"); tmp.innerHTML=tileSvg(c,r);
  const nu=tmp.firstElementChild; old.replaceWith(nu);
  if(flash) nu.animate([{opacity:.2},{opacity:1}],{duration:T(500)});
}
/* マスが変わる（爆発・撃破） */
function scarTile(c,r){
  const tile=battle.tiles[r][c], to=SCAR[tile.t]; if(!to) return false;
  tile.t=to; if(to==="burning") tile.fire=3;
  updateTile(c,r,true); blog(`🗺️ ${TERRAIN[to].name}に変わった`,"log-sys"); return true;
}

/* ===== 敵の絵（SVG のシルエット） ===== */
function enemySvg(type,boss,size){
  const col=boss?"#f0c040":"#ff5a4a", body="#3a1418";
  const sh={
    infantry:`<circle cx="0" cy="-10" r="5" fill="${body}"/><path d="M-6-14 Q0-20 6-14Z" fill="#5a2a1c"/><rect x="-5" y="-5" width="10" height="13" rx="3" fill="${body}"/><path d="M-3 8 L-4 16 M3 8 L4 16" stroke="${body}" stroke-width="3"/><path d="M4-2 L14-8" stroke="#222" stroke-width="2.4"/>`,
    light:`<rect x="-14" y="-2" width="28" height="9" rx="3" fill="${body}"/><rect x="-6" y="-9" width="12" height="8" rx="2" fill="#5a2224"/><path d="M5-6 L17-8" stroke="#222" stroke-width="2.6"/><g fill="#111"><circle cx="-9" cy="8" r="2.6"/><circle cx="0" cy="8" r="2.6"/><circle cx="9" cy="8" r="2.6"/></g>`,
    heavy:`<rect x="-17" y="-3" width="34" height="11" rx="3" fill="${body}"/><rect x="-9" y="-12" width="18" height="10" rx="2" fill="#5a2224"/><path d="M8-8 L22-10" stroke="#222" stroke-width="3.4"/><g fill="#111"><circle cx="-12" cy="9" r="3"/><circle cx="-4" cy="9" r="3"/><circle cx="4" cy="9" r="3"/><circle cx="12" cy="9" r="3"/></g>`,
    spg:`<rect x="-15" y="-1" width="30" height="9" rx="2" fill="${body}"/><rect x="-10" y="-8" width="16" height="8" fill="#5a2224"/><path d="M2-6 L18-20" stroke="#222" stroke-width="3"/><g fill="#111"><circle cx="-10" cy="9" r="2.6"/><circle cx="0" cy="9" r="2.6"/><circle cx="10" cy="9" r="2.6"/></g>`,
    atgun:`<path d="M-12 8 L0-2 L12 8" stroke="${body}" stroke-width="3" fill="none"/><rect x="-6" y="-6" width="12" height="6" fill="#5a2224"/><path d="M4-4 L20-10" stroke="#222" stroke-width="2.6"/><circle cx="-8" cy="8" r="4" fill="#111"/><circle cx="8" cy="8" r="4" fill="#111"/>`,
    heli:`<ellipse cx="-2" cy="0" rx="12" ry="6" fill="${body}"/><path d="M9 0 L22-3 L22 2Z" fill="${body}"/><path d="M-22-10 H18" stroke="#222" stroke-width="2"/><path d="M-2-6 V-10" stroke="#222" stroke-width="2"/><path d="M-8 7 H6" stroke="#222" stroke-width="2"/><circle cx="-8" cy="-1" r="3" fill="#7ad0ff" opacity=".8"/>`,
  }[type]||"";
  return `<svg viewBox="-24 -24 48 48" width="${size}" height="${size}"><circle r="22" fill="#0d0607" opacity=".55" stroke="${col}" stroke-width="2.4"/>${sh}${boss?'<path d="M-9-22 L-5-16 L0-23 L5-16 L9-22 L8-14 L-8-14Z" fill="#f0c040" stroke="#7a5a10"/>':""}</svg>`;
}

/* ===== 出撃：戦域の一覧 → 戦域の地図（段階の点） → 出撃準備 ===== */
function renderSortie(){
  const l=document.getElementById("area-list"); l.innerHTML="";
  if(sortie&&sortie.view==="map") return renderAreaMap();
  AREAS.forEach((a,i)=>{
    const open=areaOpen(i), cleared=(state.clearedAreas||[]).includes(a.id);
    const kinds=[...new Set(STAGES[a.id].flatMap(st=>st.waves.flat().map(w=>w.t)))];
    const pips=STAGES[a.id].map((st,k)=>`<i class="${stageCleared(a.id,k)?"done":stageOpen(a.id,k)?"open":""}${st.boss?" boss":""}"></i>`).join("");
    const d=document.createElement("div"); d.className="area-card"+(cleared?" cleared":"")+(open?"":" locked");
    d.innerHTML=`<div class="ac-no">${["I","II","III","IV","V"][i]}</div>
      <div class="ac-body"><div class="ac-name">${a.name}${cleared?'<span class="ac-clear">攻略済</span>':''}</div>
        <div class="ac-desc">${open?a.desc:"前の戦域のボスを倒すと出撃できます"}</div>
        <div class="ac-meta"><span class="ac-pips">${pips}</span><span>推奨戦闘力 <b>${a.power}</b></span>
          <span class="ac-foes">${kinds.map(t=>enemySvg(t,false,22)).join("")}</span></div>
        ${a.restrict&&a.restrict.note?`<div class="ac-restrict">⚑ ${a.restrict.note}</div>`:""}</div>
      <div class="ac-terrain">${miniHex(a.terrain)}</div>
      <button class="primary" ${open?"":"disabled"} onclick="enterArea('${a.id}')">${open?"戦域へ ▶":"🔒 未開放"}</button>`;
    l.appendChild(d);
  });
}
function miniHex(t){ const tile={t,fire:0,smoke:0,wreck:false};
  return `<svg viewBox="-40 -42 80 84" width="74" height="78">${terrainDefs()}<polygon points="${hexPoints(HEX_S)}" fill="url(#tg-${t})" stroke="#1b1b14" stroke-width="2"/>${decoFor(tile)}</svg>`; }
/* 段階の地図の見本（小さな六角で全体を描く） */
function layoutPreview(st,s){
  const w=Math.sqrt(3)*s; let h="";
  st.layout.forEach((row,r)=>[...row].forEach((ch,c)=>{ const t=TERRAIN[TILE_CODE[ch]||"plain"];
    const x=w*(c+0.5*(r&1))+w/2, y=s+r*1.5*s;
    h+=`<polygon points="${hexPoints(s-0.4)}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})" fill="${t.g[0]}" stroke="${t.g[1]}" stroke-width="1"/>`; }));
  const W2=(MAP_COLS+0.5)*w, H2=(1.5*(MAP_ROWS-1)+2)*s;
  return `<svg viewBox="0 0 ${W2.toFixed(0)} ${H2.toFixed(0)}" width="${W2.toFixed(0)}" height="${H2.toFixed(0)}">${h}
    <rect x="0" y="0" width="${(2*w).toFixed(0)}" height="${H2.toFixed(0)}" fill="#2a8fd0" opacity=".18"/><rect x="${(W2-3*w).toFixed(0)}" y="0" width="${(3*w).toFixed(0)}" height="${H2.toFixed(0)}" fill="#d0402a" opacity=".16"/></svg>`;
}
/* 戦域の絵（背景と目印） */
function areaArt(id){
  const art={
    hokkaido:`<rect width="100" height="60" fill="url(#ag-hokkaido)"/><path d="M0 18 Q25 12 50 16 T100 14 V0 H0Z" fill="#9fb4c8" opacity=".5"/>
      ${[8,14,20,64,70,76,88].map((x,i)=>`<path d="M${x} ${44-i%3*3} l3 -8 l3 8Z" fill="#4f6f5a" opacity=".55"/>`).join("")}<path d="M46 60 Q50 40 44 30 T52 0" stroke="#9fd3f2" stroke-width="1.6" fill="none" opacity=".8"/>`,
    fuji:`<rect width="100" height="60" fill="url(#ag-fuji)"/><path d="M40 40 L62 6 L84 40Z" fill="#6f7f9a"/><path d="M57 14 L62 6 L67 14 L64 13 L62 16 L60 13Z" fill="#fff"/>
      <g fill="#cbb85a" opacity=".5">${[6,14,22].map(x=>`<rect x="${x}" y="46" width="6" height="8"/>`).join("")}</g>${[30,36,88,94].map(x=>`<path d="M${x} 48 l2.5 -7 l2.5 7Z" fill="#3f6a3a" opacity=".6"/>`).join("")}`,
    kyushu:`<rect width="100" height="60" fill="url(#ag-kyushu)"/><path d="M0 0 H34 Q26 18 30 32 T22 60 H0Z" fill="#3f7fb0" opacity=".85"/><path d="M34 0 Q26 18 30 32 T22 60" stroke="#f2e2a8" stroke-width="2.2" fill="none"/>
      <ellipse cx="10" cy="20" rx="4" ry="2" fill="#7a9a5a"/><g fill="#d9d4c4" opacity=".7">${[56,62,68,74].map(x=>`<rect x="${x}" y="24" width="3" height="4"/>`).join("")}</g>`,
    city:`<rect width="100" height="60" fill="url(#ag-city)"/><g fill="#555b62" opacity=".7">${[4,12,18,30,40,48,58,66,74,86,92].map((x,i)=>`<rect x="${x}" y="${30-(i*7%14)}" width="6" height="${30+(i*7%14)}"/>`).join("")}</g>
      <path d="M0 44 H100" stroke="#c9c3b6" stroke-width="1.2" stroke-dasharray="3 2"/>`,
    river:`<rect width="100" height="60" fill="url(#ag-river)"/><path d="M38 0 Q48 18 42 30 T50 60 H62 Q56 40 60 30 T52 0Z" fill="#3f86b8" opacity=".9"/><path d="M36 34 H64" stroke="#8a6a44" stroke-width="3"/>
      ${[10,16,22,80,86].map(x=>`<path d="M${x} 50 l2.5 -7 l2.5 7Z" fill="#3f6a3a" opacity=".6"/>`).join("")}`,
  }[id]||"";
  return `<defs><linearGradient id="ag-hokkaido" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfdbe6"/><stop offset="1" stop-color="#eef3f7"/></linearGradient>
    <linearGradient id="ag-fuji" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ec3e0"/><stop offset=".55" stop-color="#b8cf8a"/><stop offset="1" stop-color="#7f9a52"/></linearGradient>
    <linearGradient id="ag-kyushu" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8d8a0"/><stop offset="1" stop-color="#8fae66"/></linearGradient>
    <linearGradient id="ag-city" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9b3a8"/><stop offset="1" stop-color="#7d786e"/></linearGradient>
    <linearGradient id="ag-river" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8fae66"/><stop offset="1" stop-color="#6f8f4a"/></linearGradient></defs>${art}`;
}
function renderAreaMap(){
  const a=curArea(), sts=STAGES[a.id], l=document.getElementById("area-list");
  const sel=sortie.stage!=null?sortie.stage:Math.max(0,sts.findIndex((st,i)=>stageOpen(a.id,i)&&!stageCleared(a.id,i)));
  sortie.stage=sel<0?0:sel;
  const pts=[{x:6,y:50}].concat(sts.map(st=>({x:st.x,y:st.y})));
  const path=pts.map((p,i)=>(i?"L":"M")+p.x+" "+p.y*0.6).join(" ");
  const nodes=sts.map((st,i)=>{ const done=stageCleared(a.id,i), open=stageOpen(a.id,i);
    return `<g class="an${done?" done":open?" open":" locked"}${i===sortie.stage?" sel":""}${st.boss?" boss":""}" transform="translate(${st.x},${st.y*0.6})" onclick="pickStage(${i})">
      <circle r="4.2" class="an-ring"/><circle r="3"/><text y="1.1">${st.boss?"★":i+1}</text><text class="an-lbl" y="-5.6">${a.short} ${i+1}</text></g>`; }).join("");
  const st=sts[sortie.stage], kinds=[...new Set(st.waves.flat().map(w=>w.t))];
  l.innerHTML=`<div class="amap">
    <div class="amap-head"><button onclick="leaveArea()">◀ 戦域選択</button><b>${a.name}</b><span>${sts.filter((x,i)=>stageCleared(a.id,i)).length}/${sts.length} 攻略</span></div>
    <div class="amap-body">
      <svg class="amap-art" viewBox="0 0 100 60" preserveAspectRatio="none">${areaArt(a.id)}<path d="${path}" class="an-path"/>
        <g class="an start" transform="translate(6,30)"><circle r="3.4"/><text y="1.1">出</text></g>${nodes}</svg>
      <div class="amap-info">
        <div class="ai-no">${a.short} ${sortie.stage+1}${st.boss?'<span class="ai-boss">ボス</span>':""}${stageCleared(a.id,sortie.stage)?'<span class="ai-done">攻略済</span>':""}</div>
        <div class="ai-name">${st.name}</div><p class="ai-desc">${st.desc}</p>
        <div class="ai-prev">${layoutPreview(st,13)}</div>
        <div class="ai-meta"><span>推奨戦闘力 <b>${stagePower(a.id,sortie.stage)}</b></span><span>敵 ${st.waves.length}波</span></div>
        <div class="ai-foes">${kinds.map(t=>`<span>${enemySvg(t,false,26)}<small>${ENEMY_TYPES[t].name.replace("敵","")}</small></span>`).join("")}</div>
        <button class="primary big" ${stageOpen(a.id,sortie.stage)?"":"disabled"} onclick="openPreBattle()">${stageOpen(a.id,sortie.stage)?"出撃準備 ▶":"🔒 前の段階を攻略"}</button>
      </div>
    </div></div>`;
}
function enterArea(id){ sortie={areaId:id,view:"map",stage:null}; renderSortie(); }
function leaveArea(){ sortie=null; renderSortie(); }
function pickStage(i){ sortie.stage=i; renderAreaMap(); }
function openPreBattle(){ if(!stageOpen(sortie.areaId,sortie.stage)) return; renderPreBattle(); document.getElementById("prebattle").classList.remove("hidden"); }
function curArea(){ return AREAS.find(a=>a.id===sortie.areaId); }
function curStage(){ return STAGES[sortie.areaId][sortie.stage]; }
function areaBack(){ document.getElementById("prebattle").classList.add("hidden"); }
function renderPreBattle(){
  const a=curArea(), st=curStage();
  document.getElementById("map-title").textContent=`${a.short} ${sortie.stage+1}「${st.name}」`;
  document.getElementById("restrict-note").innerHTML=`${st.desc}　<b>推奨戦闘力 ${stagePower(a.id,sortie.stage)}</b>`+(a.restrict&&a.restrict.note?`　⚑ ${a.restrict.note}`:"");
  const tabs=document.getElementById("pb-squad-tabs"); tabs.innerHTML="";
  for(let i=0;i<SQUAD_COUNT;i++){ const b=document.createElement("button");
    b.className="num-tab"+(state.activeSquad===i?" active":""); b.textContent=i+1;
    b.onclick=()=>{ state.activeSquad=i; save(); renderPreBattle(); }; tabs.appendChild(b); }
  tabs.insertAdjacentHTML("beforeend",`<span class="pb-power">${squadName(state.activeSquad)}　総戦闘力 <b>${squadPower()}</b></span>`);
  renderSortieSquad();
}
function renderSortieSquad(){
  const bar=document.getElementById("sortie-squad"); bar.innerHTML="";
  activeSquad().forEach((uid,i)=>{ const s=document.createElement("div");
    if(uid){ const u=findUnit(uid),c=charOf(u); s.className="slot filled";
      s.innerHTML=`<img class="schibi" src="../assets/chibi/${c.id}.png${ASSET_V}" onerror="this.style.display='none'">
        <b>${c.name}</b><span>Lv.${u.level}・戦闘力 ${unitPower(u)}</span>${slotHp(u)}`; }
    else{ s.className="slot"; s.textContent=`第${i+1}枠（空）`; }
    bar.appendChild(s); });
}

/* ===== 戦闘を始める ===== */
function startBattle(){
  const a=curArea(), stage=curStage(); const members=squadMembers();
  if(!members.length){ toast("出撃部隊が空です（編成で隊員を入れてください）"); return; }
  if(a.restrict){ for(const u of members){ const c=charOf(u);
      if(a.restrict.classes&&!a.restrict.classes.includes(c.class)){ toast(`${c.name} は出撃不可（兵科制限）`); return; }
      if(a.restrict.nations&&!a.restrict.nations.includes(c.nation)){ toast(`${c.name} は出撃不可（国籍制限）`); return; }
      if(a.restrict.maxRarity&&c.rarity>a.restrict.maxRarity){ toast(`${c.name} は出撃不可（★制限）`); return; } } }
  const inRepair=members.filter(u=>u.repairEnd>Date.now());
  if(inRepair.length){ toast(`修理中の隊員は出撃できません（${inRepair.map(u=>charOf(u).name).join("・")}）`); return; }
  if(state.res.fuel<30||state.res.ammo<30){ toast("燃料・弾薬が不足（各30）"); return; }
  state.res.fuel-=30; state.res.ammo-=30; save(); renderRes();
  const squad=members.slice(0,SQUAD_SIZE);
  const lead=squad.reduce((m,u)=>abilityOf(u).type==="leadership"?Math.max(m,abilityVal(u)):m,0);
  const count=squad.length>=5?squad.reduce((m,u)=>abilityOf(u).type==="count"?Math.max(m,abilityVal(u)):m,0):0;
  const tiles=genMap(stage);
  const spots=[]; for(const c of [1,0]) for(const r of [4,3,5,2,6,1,7,0,8]) spots.push({c,r});
  const units=squad.map((u,i)=>{ const c=charOf(u), ab=abilityOf(u), av=abilityVal(u);
    const selfAtk=(ab.type==="selffire"||ab.type==="self_def")?av:0;
    const sp=spots[i];
    return {side:"ally",id:"a"+u.uid,uid:u.uid,name:c.name,cid:c.id,cls:c.class,abType:ab.type,abVal:av,_tier:dmgTier(u.hp/u.maxhp),
      hp:u.hp,maxhp:u.maxhp, kind:"veh", lv:u.level,
      atk:Math.round(effStat(u,"fire")*lvMul(u)*(1+lead+count+selfAtk)),
      def:Math.round(effStat(u,"armor")*ALLY_DEF),
      mv:Math.max(2,Math.min(5,Math.round(effStat(u,"mobility")/22))),
      rng:effStat(u,"range")>=RANGE_LONG?2:1, crit:critRate(u), scout:effStat(u,"scout"),
      c:sp.c, r:sp.r, moved:false, acted:false, st:{}, cd:{}}; });
  battle={ area:a, stage, stageNo:sortie.stage, tiles, units, enemies:[], waveIdx:0, side:"ally", turnNo:1, sel:null, busy:false,
    memberUids:squad.map(u=>u.uid), selAttack:"normal", skillCd:{}, result:null, auto:false, speed:battle&&battle.speed||1,
    logs:[], startHp:squad.reduce((s,u)=>s+u.hp,0) };
  battle.enemyTotal=stage.waves.flat().reduce((s,w)=>s+Math.round(ENEMY_TYPES[w.t].hp*(w.hp||1))*w.n,0);
  state.records.sorties++; bumpMission("sortie"); save();
  document.getElementById("prebattle").classList.add("hidden");
  showBattleScreen(true);
  renderMap(); spawnWave(true);
  if(lead||count) blog(`📡 小隊の攻撃力 +${Math.round((lead+count)*100)}%（${[lead?"指揮":"",count?"数の力":""].filter(Boolean).join("・")}）`,"log-win");
  renderBattle();
  document.getElementById("battle").dataset.area=a.id;
  (async()=>{ battle.busy=true; await banner(`${a.short} ${sortie.stage+1}「${stage.name}」　作戦開始`,"start"); battle.busy=false; await beginSide("ally"); })();
}
function showBattleScreen(on){
  document.getElementById("battle").classList.toggle("hidden",!on);
  document.getElementById("stage").dataset.screen=on?"battle":"sortie";
}
function spawnWave(first){
  const bd=battle.stage;
  if(battle.waveIdx>=bd.waves.length) return false;
  const wave=bd.waves[battle.waveIdx]; battle.waveIdx++;
  const spots=[]; for(const c of [MAP_COLS-1,MAP_COLS-2,MAP_COLS-3]) for(const r of [4,2,6,3,5,1,7,0,8]) spots.push({c,r});
  let k=0, n=0;
  wave.forEach(w=>{ const tpl=ENEMY_TYPES[w.t];
    for(let i=0;i<w.n;i++){
      while(k<spots.length && (unitAt(spots[k].c,spots[k].r) || TERRAIN[battle.tiles[spots[k].r][spots[k].c].t].cost===Infinity && tpl.kind!=="air")) k++;
      if(k>=spots.length) break;
      const sp=spots[k++]; const hp=Math.round(tpl.hp*(w.hp||1));
      battle.enemies.push({side:"enemy",id:"e"+(battle.eid=(battle.eid||0)+1),type:w.t,name:(w.boss?"【ボス】":"")+tpl.name,kind:tpl.kind,
        hp,maxhp:hp, atk:Math.round(tpl.atk*bd.atk*(w.boss?1.25:1)), def:tpl.def+(w.boss?6:0), mv:tpl.mv, rng:tpl.rng, weapon:tpl.weapon,
        crit:0.05, scout:0, boss:!!w.boss, c:sp.c, r:sp.r, moved:false, acted:false, st:{}, cd:{}}); n++;
    } });
  blog(first?`敵部隊 ${n}体 を確認`:`⚠ 敵増援 ${n}体！`,"log-lose");
  return true;
}

/* ===== 盤面の問い合わせ ===== */
function allUnits(){ return battle.units.concat(battle.enemies); }
function unitAt(c,r){ return allUnits().find(u=>u.hp>0&&u.c===c&&u.r===r); }
function foesOf(u){ return (u.side==="ally"?battle.enemies:battle.units).filter(x=>x.hp>0); }
function friendsOf(u){ return (u.side==="ally"?battle.units:battle.enemies).filter(x=>x.hp>0); }
function terr(c,r){ return TERRAIN[battle.tiles[r][c].t]; }
function rangeAt(u,c,r){ return u.rng+((u.kind!=="air"&&terr(c,r).range)||0); }
function moveCost(u,c,r){ if(u.kind==="air") return 1; const t=battle.tiles[r][c]; return terr(c,r).cost+(t.wreck?1:0); }
function movePoints(u){ return u.st.track?1:u.mv; }
/* 届くマス（移動の点で行ける所）。相手のいるマスは通れない。味方は通れるが止まれない */
function reachable(u){
  const res=new Map(), start=key(u.c,u.r); res.set(start,{c:u.c,r:u.r,cost:0,prev:null});
  if(u.moved) return res;
  const open=[{c:u.c,r:u.r,cost:0}], mp=movePoints(u);
  while(open.length){ open.sort((a,b)=>a.cost-b.cost); const cur=open.shift();
    for(const n of neighbors(cur.c,cur.r)){
      const o=unitAt(n.c,n.r); if(o&&o.side!==u.side) continue;
      const nc=cur.cost+moveCost(u,n.c,n.r); if(nc>mp) continue;
      const k=key(n.c,n.r), old=res.get(k); if(old&&old.cost<=nc) continue;
      res.set(k,{c:n.c,r:n.r,cost:nc,prev:key(cur.c,cur.r)}); open.push({c:n.c,r:n.r,cost:nc}); } }
  for(const [k,v] of [...res]){ if(k!==start&&unitAt(v.c,v.r)) res.delete(k); }
  return res;
}
function pathTo(reach,c,r){ const p=[]; let k=key(c,r); while(k){ const n=reach.get(k); if(!n) break; p.unshift({c:n.c,r:n.r}); k=n.prev; } return p; }
function atkReady(u,t){ return !(u.cd[t]>0); }
function attackTypes(u){ return u.side==="ally"?Object.keys(ATTACKS):[u.weapon,"normal"].filter((v,i,a)=>a.indexOf(v)===i); }

/* ===== ダメージ ===== */
function mitig(def){ return 60/(60+Math.max(0,def)); }
function calcDamage(att,tgt,type,from){
  const A=ATTACKS[type]||ATTACKS.normal, ac=from||att;
  let atk=att.atk*A.mul;
  if(att.st.morale) atk*=1.3;
  if(att.st.suppress) atk*=0.7;
  if(att.abType==="vanguard"&&battle.turnNo===1) atk*=1+att.abVal;
  if(att.abType==="bossfire"&&tgt.boss) atk*=1+att.abVal;
  let per=atk*mitig(tgt.def*(1-(A.pierce||0)));
  if(type==="mg") per*=tgt.kind==="inf"?1.5:tgt.kind==="veh"?0.6:1;
  if(type==="he"&&tgt.kind==="air") per*=0.5;
  if(tgt.kind!=="air") per*=terr(tgt.c,tgt.r).def;
  if(battle.tiles[tgt.r][tgt.c].smoke>0||battle.tiles[ac.r][ac.c].smoke>0) per*=0.7;
  if(tgt.st.guard) per*=0.7;
  if(tgt.st.mark) per*=1.2;
  if(tgt.abType==="armor"||tgt.abType==="self_def") per*=1-tgt.abVal;
  if(tgt.abType==="laststand"&&tgt.hp<tgt.maxhp*0.3) per*=1-tgt.abVal;
  if(tgt.abType==="vanguard") per*=1.1;
  const flank=friendsOf(att).filter(f=>f!==att&&hexDist(f,tgt)===1).length+(hexDist(ac,tgt)===1?1:0)>=2;
  if(flank) per*=1.2;
  return {per:Math.max(1,Math.round(per)), hits:A.hits||1, flank};
}
function expectedDamage(att,tgt,type,from){ const d=calcDamage(att,tgt,type,from); return d.per*d.hits; }

/* ===== 動きの道具（速度×2・試験用の早送りに対応） ===== */
function T(ms){ return ms/((battle&&battle.speed)||1)/(window.__battleFast||1); }
function wait(ms){ return new Promise(r=>setTimeout(r,T(ms))); }
function anim(el,kf,ms,opt){ if(!el||!el.animate) return Promise.resolve(); return el.animate(kf,Object.assign({duration:T(ms),easing:"ease-out"},opt||{})).finished.catch(()=>{}); }
function fxEl(cls,x,y,html){ const d=document.createElement("div"); d.className="fx "+cls; d.style.left=x+"px"; d.style.top=y+"px"; if(html) d.innerHTML=html; document.getElementById("bt-fx").appendChild(d); return d; }
function unitEl(u){ return document.querySelector(`#bt-units .bu[data-id="${u.id}"]`); }
async function banner(text,cls){
  const b=document.getElementById("bt-banner"); b.className=cls||""; b.innerHTML=`<span>${text}</span>`;
  await anim(b,[{transform:"translateX(-110%)",opacity:0},{transform:"translateX(0)",opacity:1,offset:.25},{transform:"translateX(0)",opacity:1,offset:.75},{transform:"translateX(110%)",opacity:0}],1100,{easing:"ease-in-out"});
  b.className="hidden";
}
async function shake(power){
  const w=document.getElementById("bt-world"), p=power||5;
  await anim(w,[{transform:"translate(0,0)"},{transform:`translate(${p}px,${-p/2}px)`},{transform:`translate(${-p}px,${p/2}px)`},{transform:`translate(${p/2}px,${p}px)`},{transform:"translate(0,0)"}],260,{easing:"linear"});
}
async function popText(u,text,cls){
  const p=hexCenter(u.c,u.r); const d=fxEl("pop "+(cls||""),p.x,p.y-34,text);
  anim(d,[{transform:"translate(-50%,0) scale(.6)",opacity:0},{transform:"translate(-50%,-14px) scale(1.15)",opacity:1,offset:.2},{transform:"translate(-50%,-44px) scale(1)",opacity:0}],1100).then(()=>d.remove());
  await wait(260);
}
async function moveAlong(u,path){
  const el=unitEl(u);
  for(let i=1;i<path.length;i++){ const a=hexCenter(path[i-1].c,path[i-1].r), b=hexCenter(path[i].c,path[i].r);
    if(el){ el.classList.toggle("flip",b.x<a.x&&u.side==="ally"); await anim(el,[{left:a.x+"px",top:a.y+"px"},{left:b.x+"px",top:b.y+"px"}],150,{easing:"linear"}); el.style.left=b.x+"px"; el.style.top=b.y+"px"; }
    u.c=path[i].c; u.r=path[i].r; }
  if(el) el.classList.remove("flip");
}
async function fireAnim(att,tgt,type){
  const a=hexCenter(att.c,att.r), b=hexCenter(tgt.c,tgt.r), el=unitEl(att);
  const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1, ux=dx/len, uy=dy/len, ang=Math.atan2(dy,dx)*180/Math.PI;
  const inner=el&&el.querySelector(".bu-in");
  anim(inner,[{transform:"translate(0,0)"},{transform:`translate(${-ux*7}px,${-uy*7}px)`},{transform:"translate(0,0)"}],260);
  const mf=fxEl("muzzle",a.x+ux*22,a.y-14+uy*22); anim(mf,[{transform:"translate(-50%,-50%) scale(.2)",opacity:1},{transform:"translate(-50%,-50%) scale(1.5)",opacity:0}],200).then(()=>mf.remove());
  if(type==="he"){
    const s=fxEl("shell he",a.x,a.y-16); const pts=[];
    for(let i=0;i<=8;i++){ const t=i/8; pts.push({left:(a.x+dx*t)+"px",top:(a.y-16+dy*t-Math.sin(Math.PI*t)*Math.min(140,len*0.6))+"px"}); }
    await anim(s,pts,420,{easing:"linear"}); s.remove();
  }else if(type==="mg"){
    for(let i=0;i<3;i++){ const s=fxEl("shell mg",a.x,a.y-14); s.style.transform=`translate(-50%,-50%) rotate(${ang}deg)`;
      anim(s,[{left:a.x+"px",top:(a.y-14)+"px"},{left:(b.x+(Math.random()*10-5))+"px",top:(b.y-14+(Math.random()*10-5))+"px"}],140,{easing:"linear"}).then(()=>s.remove()); await wait(70); }
    await wait(90);
  }else{
    const s=fxEl("shell "+(type==="ap"?"ap":"std"),a.x,a.y-14); s.style.transform=`translate(-50%,-50%) rotate(${ang}deg)`;
    await anim(s,[{left:a.x+"px",top:(a.y-14)+"px"},{left:b.x+"px",top:(b.y-14)+"px"}],Math.min(260,90+len*0.4),{easing:"linear"}); s.remove();
  }
}
async function boom(c,r,size){
  const p=hexCenter(c,r), sz=size||1;
  const e=fxEl("explo",p.x,p.y-10); e.style.setProperty("--s",sz);
  anim(e,[{transform:`translate(-50%,-50%) scale(${.2*sz})`,opacity:1},{transform:`translate(-50%,-50%) scale(${1.4*sz})`,opacity:.9,offset:.4},{transform:`translate(-50%,-50%) scale(${1.8*sz})`,opacity:0}],520).then(()=>e.remove());
  for(let i=0;i<7;i++){ const ang=Math.random()*Math.PI*2, dist=(24+Math.random()*26)*sz; const s=fxEl("spark",p.x,p.y-10);
    anim(s,[{transform:"translate(-50%,-50%)",opacity:1},{transform:`translate(calc(-50% + ${Math.cos(ang)*dist}px),calc(-50% + ${Math.sin(ang)*dist}px))`,opacity:0}],480).then(()=>s.remove()); }
  const sm=fxEl("puff",p.x,p.y-14); anim(sm,[{transform:"translate(-50%,-50%) scale(.4)",opacity:.0},{transform:"translate(-50%,-50%) scale(1)",opacity:.6,offset:.3},{transform:"translate(-50%,-110%) scale(1.6)",opacity:0}],900).then(()=>sm.remove());
}
async function hitAnim(u,dmg,crit){
  const el=unitEl(u), inner=el&&el.querySelector(".bu-in"), p=hexCenter(u.c,u.r);
  if(inner){ inner.classList.add("hit"); anim(inner,[{transform:"translateX(0)"},{transform:"translateX(-6px)"},{transform:"translateX(6px)"},{transform:"translateX(-3px)"},{transform:"translateX(0)"}],300).then(()=>inner.classList.remove("hit")); }
  const n=fxEl("dmgnum "+(u.side==="ally"?"to-ally":"to-enemy")+(crit?" crit":""),p.x,p.y-30,(crit?"<small>CRITICAL!</small>":"")+dmg);
  anim(n,[{transform:"translate(-50%,0) scale(.5)",opacity:0},{transform:"translate(-50%,-18px) scale(1.25)",opacity:1,offset:.18},{transform:"translate(-50%,-30px) scale(1)",opacity:1,offset:.6},{transform:"translate(-50%,-52px) scale(1)",opacity:0}],1000).then(()=>n.remove());
  updateUnitEl(u);
}
async function destroyAnim(u){
  const el=unitEl(u), inner=el&&el.querySelector(".bu-in");
  await boom(u.c,u.r,1.5); shake(8);
  if(inner) await anim(inner,[{transform:"rotate(0) scale(1)",filter:"none",opacity:1},{transform:"rotate(-14deg) scale(.95) translateY(4px)",filter:"grayscale(1) brightness(.4)",opacity:.9,offset:.5},{transform:"rotate(-22deg) scale(.7) translateY(14px)",filter:"grayscale(1) brightness(.2)",opacity:0}],700);
  if(el) el.remove();
  const tile=battle.tiles[u.r][u.c]; if(u.kind!=="air"&&u.kind!=="inf") tile.wreck=true;
  updateTile(u.c,u.r,true);
}

/* ===== 攻撃を1回行う（動き込み） ===== */
async function doAttack(att,tgt,type,isCounter){
  if(att.hp<=0||tgt.hp<=0) return;
  const A=ATTACKS[type]||ATTACKS.normal;
  if(!isCounter&&A.cd) att.cd[type]=A.cd;
  await fireAnim(att,tgt,type);
  const d=calcDamage(att,tgt,type); let total=0, crit=false;
  for(let i=0;i<d.hits;i++){ let x=d.per; if(Math.random()<(att.crit||0)){ x=Math.round(x*1.5); crit=true; } if(isCounter) x=Math.max(1,Math.round(x*0.7)); total+=x; }
  const before=tgt.hp; tgt.hp=Math.max(0,tgt.hp-total);
  boom(tgt.c,tgt.r,type==="he"?1.2:type==="mg"?0.5:type==="ap"?0.9:0.8);
  if(type==="ap"||type==="he"||crit) shake(type==="he"?7:5);
  await hitAnim(tgt,total,crit);
  blog(`${att.name}${isCounter?"の反撃":"の"+A.name} → ${tgt.name}に${total}${crit?"（会心）":""}${d.flank?"（挟撃）":""}`,att.side==="ally"?"log-win":"log-lose");
  // 弱体・強化
  if(tgt.hp>0&&!isCounter){
    if(type==="ap"&&tgt.kind==="veh"&&Math.random()<0.35){ tgt.st.track=2; await popText(tgt,"履帯損傷！","debuff"); }
    if(type==="he"&&tgt.kind!=="air"&&Math.random()<0.35){ tgt.st.burn=2; await popText(tgt,"炎上！","debuff"); }
    if(type==="mg"&&(tgt.kind==="inf"||Math.random()<0.5)){ tgt.st.suppress=1; await popText(tgt,"制圧！","debuff"); }
    if((att.scout||0)>=60&&!tgt.st.mark){ tgt.st.mark=2; await popText(tgt,"照準！","debuff"); }
  }
  // 榴弾：周りにも当たり、地形が荒れる
  if(type==="he"&&!isCounter){
    if(tgt.kind!=="air") scarTile(tgt.c,tgt.r);
    for(const n of neighbors(tgt.c,tgt.r)){ const o=unitAt(n.c,n.r); if(o&&o.side===tgt.side&&o.hp>0){ const s=Math.max(1,Math.round(total*0.5)); o.hp=Math.max(0,o.hp-s); hitAnim(o,s,false); } }
  }
  updateUnitEl(tgt); renderSide();
  await afterHit(tgt,before);
  await reapDead();
  // 反撃：隣で生きていて、機銃・榴弾以外なら
  if(!isCounter&&tgt.hp>0&&att.hp>0&&hexDist(att,tgt)===1&&!A.noCounter&&type!=="he"){ await wait(120); await doAttack(tgt,att,"normal",true); }
}
async function afterHit(u,before){
  if(u.side!=="ally"||u.hp<=0) return;
  const nt=dmgTier(u.hp/u.maxhp);
  if(nt>(u._tier||0)){ u._tier=nt; if(nt>=2){ battle.busy=true; showCutin({cid:u.cid,name:u.name,ratio:u.hp/u.maxhp,tier:nt}); await wait(1500); } }
  void before;
}
async function reapDead(){
  for(const u of allUnits().filter(x=>x.hp<=0&&!x.dead)){
    u.dead=true; blog(`${u.name} 撃破${u.side==="ally"?"…":"！"}`,u.side==="ally"?"log-lose":"log-win");
    await destroyAnim(u);
  }
  battle.units=battle.units.filter(u=>!u.dead); battle.enemies=battle.enemies.filter(u=>!u.dead);
  renderBattle();
  await checkEnd();
}
async function checkEnd(){
  if(battle.result) return true;
  if(!battle.units.length){ endBattle("lose"); return true; }
  if(battle.enemies.length<=1){
    if(battle.waveIdx<battle.stage.waves.length){ spawnWave(false); renderBattle(); await banner("敵増援 接近！","warn"); }
    else if(!battle.enemies.length){ await banner("敵部隊 殲滅","start"); endBattle("win"); return true; }
  }
  return false;
}

/* ===== 支援（全体の技） ===== */
async function useSkill(id,fromAI){
  if(!battle||battle.side!=="ally"||(battle.busy&&!fromAI)||battle.result) return;
  const S=SKILLS[id];
  if((battle.skillCd[id]||0)>0){ toast(`${S.name} はあと${battle.skillCd[id]}ターン`); return; }
  battle.busy=true; battle.skillCd[id]=S.cd; renderActions();
  await banner(`${S.icon} ${S.name}`,"skill");
  if(id==="charge"){ for(const u of battle.units){ u.st.morale=2; await popText(u,"士気高揚！","buff"); } }
  else if(id==="repair"){ for(const u of battle.units){ const h=Math.round(u.maxhp*0.25); u.hp=Math.min(u.maxhp,u.hp+h); delete u.st.burn; delete u.st.track; updateUnitEl(u); await popText(u,`+${h}`,"heal"); } }
  else if(id==="smoke"){ const set=new Set(); battle.units.forEach(u=>{ set.add(key(u.c,u.r)); neighbors(u.c,u.r).forEach(n=>set.add(key(n.c,n.r))); });
    for(const k of set){ const [c,r]=k.split(",").map(Number); battle.tiles[r][c].smoke=2; updateTile(c,r,true); } blog("🌫️ 煙幕を展開","log-sys"); }
  else if(id==="barrage"){
    for(const e of [...battle.enemies]){ const p=hexCenter(e.c,e.r); const s=fxEl("shell he",p.x,p.y-220);
      anim(s,[{top:(p.y-220)+"px"},{top:(p.y-12)+"px"}],320,{easing:"ease-in"}).then(()=>s.remove()); }
    await wait(320); shake(10);
    for(const e of [...battle.enemies]){ const dmg=Math.round(e.maxhp*0.3+30); e.hp=Math.max(0,e.hp-dmg); boom(e.c,e.r,1.3); hitAnim(e,dmg,false); if(e.kind!=="air"&&Math.random()<0.6) scarTile(e.c,e.r); }
    await wait(700); blog("☄️ 支援砲撃！","log-win"); await reapDead();
  }
  battle.busy=!!fromAI; renderBattle();
}

/* ===== ターンの流れ ===== */
async function beginSide(side){
  if(!battle||battle.result) return;
  battle.side=side; battle.sel=null; battle.busy=true;
  const mine=side==="ally"?battle.units:battle.enemies;
  mine.forEach(u=>{ u.moved=false; u.acted=false; });
  renderBattle();
  await banner(side==="ally"?`自軍ターン　${battle.turnNo}`:"敵軍ターン",side==="ally"?"ally":"enemy");
  if(!battle||battle.result) return;
  // 炎上のダメージ
  for(const u of mine.filter(x=>x.st.burn&&x.hp>0)){ const d=Math.max(1,Math.round(u.maxhp*0.08)); u.hp=Math.max(0,u.hp-d);
    boom(u.c,u.r,0.6); await hitAnim(u,d,false); blog(`🔥 ${u.name} 炎上で${d}`,"log-lose"); }
  await reapDead(); if(!battle||battle.result) return;
  battle.busy=side==="enemy"||battle.auto; renderBattle();
  if(side==="enemy"){ await runAI(battle.enemies); if(battle&&!battle.result) await endSide("enemy"); }
  else if(battle.auto){ await autoAllies(); }
}
async function autoAllies(){
  if(!battle||battle.side!=="ally"||battle.result) return;
  // 自動：使える支援は先に使う
  for(const id of ["charge","barrage"]) if(!(battle.skillCd[id]>0)&&battle.enemies.length>=2){ await useSkill(id,true); break; }
  if(battle.result) return;
  if(!(battle.skillCd.repair>0)&&battle.units.some(u=>u.hp<u.maxhp*0.45)) await useSkill("repair",true);
  if(battle.result) return;
  await runAI(battle.units.filter(u=>!u.acted));
  if(battle&&!battle.result) await endSide("ally");
}
async function endSide(side){
  if(!battle||battle.result) return;
  battle.busy=true; battle.sel=null; clearHl();
  const mine=side==="ally"?battle.units:battle.enemies;
  for(const u of mine){
    for(const k in u.st){ if(--u.st[k]<=0) delete u.st[k]; }
    for(const k in u.cd){ if(u.cd[k]>0) u.cd[k]--; }
    if(!u.moved&&!u.acted){ u.st.guard=1; }
    if(battle.tiles[u.r][u.c].t==="burning"&&u.kind!=="air"&&!u.st.burn){ u.st.burn=2; await popText(u,"炎上！","debuff"); }
  }
  if(side==="ally"){ for(const k in battle.skillCd) if(battle.skillCd[k]>0) battle.skillCd[k]--; }
  else{ tickTiles(); battle.turnNo++; }
  renderBattle();
  await beginSide(side==="ally"?"enemy":"ally");
}
/* 地形の時間経過：煙が晴れる、火が燃え広がり、やがて焼け野原に */
function tickTiles(){
  const spread=[];
  for(let r=0;r<MAP_ROWS;r++) for(let c=0;c<MAP_COLS;c++){ const t=battle.tiles[r][c]; let ch=false;
    if(t.smoke>0){ t.smoke--; ch=true; }
    if(t.t==="burning"){ t.fire--; neighbors(c,r).forEach(n=>{ const nt=battle.tiles[n.r][n.c]; if((nt.t==="forest"||nt.t==="snowforest")&&Math.random()<0.15) spread.push(n); });
      if(t.fire<=0){ t.t="burnt"; } ch=true; }
    if(ch) updateTile(c,r,false); }
  spread.forEach(n=>{ const nt=battle.tiles[n.r][n.c]; if(nt.t==="forest"||nt.t==="snowforest"){ nt.t="burning"; nt.fire=3; updateTile(n.c,n.r,true); blog("🔥 火が燃え広がった","log-sys"); } });
}

/* ===== 考える（敵・自動の味方で同じ） ===== */
async function runAI(list){
  const order=[...list].sort((a,b)=>b.mv-a.mv);
  for(const u of order){ if(!battle||battle.result) return; if(u.hp<=0||u.acted) continue; battle.busy=true; await aiAct(u); }
}
async function aiAct(u){
  const foes=foesOf(u); if(!foes.length){ u.acted=true; return; }
  const reach=reachable(u);
  let best=null;
  for(const [,t] of reach){
    const cover=(u.kind==="air")?0:(1-terr(t.c,t.r).def)*30;
    for(const f of foes){ const dist=hexDist(t,f); if(dist>rangeAt(u,t.c,t.r)) continue;
      for(const type of attackTypes(u)){ if(!atkReady(u,type)) continue;
        const exp=expectedDamage(u,f,type,t);
        let sc=exp+(exp>=f.hp?60:0)+(1-f.hp/f.maxhp)*20+cover-t.cost*0.5;
        if(dist===1&&type!=="mg"&&type!=="he"&&exp<f.hp) sc-=expectedDamage(f,u,"normal",f)*0.5;
        if(u.weapon==="he"&&dist===1) sc-=15;
        if(!best||sc>best.sc) best={sc,t,f,type}; } } }
  if(best){
    if(best.t.c!==u.c||best.t.r!==u.r){ await moveAlong(u,pathTo(reach,best.t.c,best.t.r)); u.moved=true; renderBattle(); }
    u.acted=true; u.moved=true;
    await doAttack(u,best.f,best.type,false);
  }else{
    // 届かない：一番近い相手へ寄る（遮蔽の良いマスを好む）。自走砲は2マス以上離れて止まる
    let mv=null;
    for(const [,t] of reach){ const d=Math.min(...foes.map(f=>hexDist(t,f)));
      const sc=-d*10+((u.kind==="air")?0:(1-terr(t.c,t.r).def)*20)-(u.weapon==="he"&&d<2?40:0);
      if(!mv||sc>mv.sc) mv={sc,t}; }
    if(mv&&(mv.t.c!==u.c||mv.t.r!==u.r)){ await moveAlong(u,pathTo(reach,mv.t.c,mv.t.r)); u.moved=true; }
    u.acted=true; renderBattle();
  }
  await wait(120);
}

/* ===== 操作（自軍ターン） ===== */
function onMapClick(e){
  if(!battle||battle.result) return;
  const ue=e.target.closest(".bu"); if(ue){ const u=allUnits().find(x=>x.id===ue.dataset.id); if(u) return clickUnit(u); }
  const g=e.target.closest(".hx"); if(!g) return;
  clickTile(+g.dataset.c,+g.dataset.r);
}
function clickUnit(u){
  if(u.side==="ally"){
    if(battle.busy||battle.side!=="ally"){ showInfo(u); return; }
    battle.sel=(battle.sel===u.id||u.acted)?null:u.id;
    if(battle.sel&&!atkReady(u,battle.selAttack)) battle.selAttack="normal";
    showInfo(u); renderHl(); renderSide(); renderActions(); return;
  }
  const s=selUnit();
  if(s&&!battle.busy&&battle.side==="ally"&&!s.acted&&hexDist(s,u)<=rangeAt(s,s.c,s.r)) return playerAttack(s,u);
  showInfo(u); renderHl(u);
}
async function clickTile(c,r){
  const s=selUnit(); const occ=unitAt(c,r);
  if(occ) return clickUnit(occ);
  if(s&&!battle.busy&&battle.side==="ally"&&!s.moved&&!s.acted){
    const reach=reachable(s); if(reach.has(key(c,r))&&!(c===s.c&&r===s.r)){
      battle.busy=true; clearHl(); await moveAlong(s,pathTo(reach,c,r)); s.moved=true; battle.busy=false;
      if(!foesOf(s).some(f=>hexDist(s,f)<=rangeAt(s,s.c,s.r))) blog(`${s.name} 移動（攻撃できる敵なし）`,"log-sys");
      renderBattle(); showInfo(s); return; } }
  showTileInfo(c,r);
}
async function playerAttack(s,t){
  if(!atkReady(s,battle.selAttack)){ toast(`${ATTACKS[battle.selAttack].name}はあと${s.cd[battle.selAttack]}ターン`); return; }
  battle.busy=true; clearHl(); s.acted=true; s.moved=true;
  await doAttack(s,t,battle.selAttack,false);
  if(!battle||battle.result) return;
  battle.sel=null; battle.busy=false; renderBattle();
  if(battle.units.every(u=>u.acted)) blog("全員の行動が終わりました。ターン終了を押してください","log-sys");
}
function selUnit(){ return battle&&battle.sel?battle.units.find(u=>u.id===battle.sel):null; }
function selectAttack(t){ if(!battle) return; const s=selUnit(); if(s&&!atkReady(s,t)) return; battle.selAttack=t; renderActions(); renderHl(); }
function waitUnit(){ const s=selUnit(); if(!s||battle.busy) return; s.acted=true; battle.sel=null; blog(`${s.name} 待機`,"log-sys"); renderBattle(); }
async function endPlayerTurn(){ if(!battle||battle.side!=="ally"||battle.busy||battle.result) return; await endSide("ally"); }
async function toggleAuto(){
  if(!battle) return; battle.auto=!battle.auto; renderActions();
  if(battle.auto&&battle.side==="ally"&&!battle.busy&&!battle.result){ battle.sel=null; clearHl(); battle.busy=true; await autoAllies(); }
}
function toggleSpeed(){ if(!battle) return; battle.speed=battle.speed===1?2:battle.speed===2?3:1; renderActions(); }
function retreat(){
  if(!battle||battle.busy||battle.side!=="ally"||battle.result) return; // 動きの途中・敵の番は撤退できない
  if(!confirm("撤退しますか？戦果は失われます（損傷はそのまま残ります）")) return;
  syncBattleHp(); battle=null; showBattleScreen(false); renderSortie(); toast("撤退しました。損傷した隊員は整備へ。");
}

/* ===== 描画 ===== */
function renderBattle(){ if(!battle) return; renderUnits(); renderSide(); renderHl(); renderActions(); renderForce(); renderLog(); }
function renderUnits(){
  const box=document.getElementById("bt-units");
  const live=new Set(allUnits().filter(u=>!u.dead).map(u=>u.id));
  box.querySelectorAll(".bu").forEach(el=>{ if(!live.has(el.dataset.id)) el.remove(); });
  allUnits().filter(u=>!u.dead).forEach(u=>{ let el=unitEl(u);
    if(!el){ el=document.createElement("div"); el.className="bu "+u.side; el.dataset.id=u.id;
      el.innerHTML=`<div class="bu-in">${u.side==="ally"?`<img src="../assets/chibi/${u.cid}.png${ASSET_V}" alt="">`:enemySvg(u.type,u.boss,52)}</div><div class="bu-hp"><i></i></div><div class="bu-st"></div>`;
      box.appendChild(el); const p=hexCenter(u.c,u.r); el.style.left=p.x+"px"; el.style.top=p.y+"px"; }
    updateUnitEl(u); });
}
function updateUnitEl(u){
  const el=unitEl(u); if(!el) return;
  const p=hexCenter(u.c,u.r); if(!el.getAnimations().length){ el.style.left=p.x+"px"; el.style.top=p.y+"px"; }
  el.querySelector(".bu-hp i").style.width=Math.max(0,u.hp/u.maxhp*100)+"%";
  el.querySelector(".bu-hp").className="bu-hp"+(u.hp/u.maxhp<0.25?" low":u.hp/u.maxhp<0.5?" mid":"");
  el.querySelector(".bu-st").innerHTML=Object.keys(u.st).map(k=>`<span class="${STATUS[k].buff?"b":"d"}">${STATUS[k].icon}</span>`).join("");
  el.classList.toggle("sel",battle.sel===u.id);
  el.classList.toggle("done",u.side===battle.side&&u.acted);
  el.classList.toggle("boss",!!u.boss);
  el.classList.toggle("buffed",!!(u.st.morale||u.st.guard));
}
function stIcons(u){ return Object.entries(u.st).map(([k,v])=>`<span class="sti ${STATUS[k].buff?"b":"d"}" title="${STATUS[k].name}：${STATUS[k].desc}（残り${v}）">${STATUS[k].icon}</span>`).join(""); }
function renderSide(){
  const al=document.getElementById("bt-allies");
  const fought=battle.memberUids.map(uid=>battle.units.find(u=>u.uid===uid)||{dead:true,uid});
  al.innerHTML=fought.map(u=>{ if(u.dead||!u.name){ const ou=findUnit(u.uid), c=ou&&charOf(ou);
      return `<div class="bc-card ally dead"><div class="bc-face" style="background-image:url('${c?faceImg(c.id,1):""}')"></div><div class="bc-body"><b>${c?c.name:""}</b><span class="bc-dead">撃破</span></div></div>`; }
    const pct=u.hp/u.maxhp*100;
    return `<div class="bc-card ally${battle.sel===u.id?" sel":""}${u.acted&&battle.side==="ally"?" done":""}" onclick="clickUnitById('${u.id}')">
      <div class="bc-face" style="background-image:url('${faceImg(u.cid,u.hp/u.maxhp)}')"></div>
      <div class="bc-body"><b>${u.name}</b><small>Lv.${u.lv}・${u.cls}</small>
      <div class="bc-hp${pct<25?" low":pct<50?" mid":""}"><i style="width:${pct}%"></i></div><span class="bc-hpt">耐久 ${u.hp}/${u.maxhp}</span>
      <div class="bc-st">${stIcons(u)}</div></div></div>`; }).join("");
  const el=document.getElementById("bt-enemies");
  el.innerHTML=battle.enemies.map(e=>{ const pct=e.hp/e.maxhp*100;
    return `<div class="bc-card enemy${e.boss?" boss":""}" onclick="clickUnitById('${e.id}')"><div class="bc-token">${enemySvg(e.type,e.boss,50)}</div>
      <div class="bc-body"><b>${e.name}</b><small>攻${e.atk}・防${e.def}・射${e.rng}</small>
      <div class="bc-hp enemy${pct<25?" low":""}"><i style="width:${pct}%"></i></div><span class="bc-hpt">耐久 ${e.hp}/${e.maxhp}</span>
      <div class="bc-st">${stIcons(e)}</div></div></div>`; }).join("")+
    (battle.waveIdx<battle.stage.waves.length?`<div class="bc-next">増援 あと${battle.stage.waves.length-battle.waveIdx}波</div>`:"");
}
function clickUnitById(id){ const u=allUnits().find(x=>x.id===id); if(u) clickUnit(u); }
function renderForce(){
  const a=battle.units.reduce((s,u)=>s+u.hp,0), amax=battle.memberUids.reduce((s,uid)=>{ const f=findUnit(uid); return s+(f?f.maxhp:0); },0);
  const bd=battle.stage;
  const pend=bd.waves.slice(battle.waveIdx).flat().reduce((s,w)=>s+Math.round(ENEMY_TYPES[w.t].hp*(w.hp||1))*w.n,0);
  const e=battle.enemies.reduce((s,u)=>s+u.hp,0)+pend;
  document.getElementById("bf-ally").style.width=(a/amax*100)+"%"; document.getElementById("bf-ally-num").textContent=a;
  document.getElementById("bf-enemy").style.width=(e/battle.enemyTotal*100)+"%"; document.getElementById("bf-enemy-num").textContent=e;
  document.getElementById("bt-turn").textContent=`TURN ${battle.turnNo}`;
  document.getElementById("bt-area").textContent=`${battle.area.short} ${battle.stageNo+1}「${battle.stage.name}」`;
}
function clearHl(){ const g=document.getElementById("bt-hl"); if(g) g.innerHTML=""; }
function renderHl(enemyView){
  const g=document.getElementById("bt-hl"); if(!g) return; let h="";
  const poly=(c,r,cls)=>{ const p=hexCenter(c,r); return `<polygon class="hl ${cls}" points="${hexPoints(HEX_S-3)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})" data-c="${c}" data-r="${r}"/>`; };
  if(enemyView){ // 敵の届く範囲（危険地帯）
    const reach=reachable(Object.assign({},enemyView,{moved:false})); const danger=new Set();
    for(const [,t] of reach) for(let r=0;r<MAP_ROWS;r++) for(let c=0;c<MAP_COLS;c++) if(hexDist(t,{c,r})<=rangeAt(enemyView,t.c,t.r)) danger.add(key(c,r));
    danger.forEach(k=>{ const [c,r]=k.split(",").map(Number); h+=poly(c,r,"danger"); });
  }else{ const s=selUnit();
    if(s&&battle.side==="ally"&&!s.acted){
      if(!s.moved) for(const [,t] of reachable(s)) h+=poly(t.c,t.r,"move");
      foesOf(s).forEach(f=>{ if(hexDist(s,f)<=rangeAt(s,s.c,s.r)) h+=poly(f.c,f.r,"target"); });
      h+=poly(s.c,s.r,"self");
    } }
  g.innerHTML=h;
  // 攻撃の見込み（選んだ攻撃で）
  document.querySelectorAll("#bt-units .bu .bu-pred").forEach(x=>x.remove());
  const s=selUnit();
  if(s&&!enemyView&&!s.acted) foesOf(s).forEach(f=>{ if(hexDist(s,f)<=rangeAt(s,s.c,s.r)){ const el=unitEl(f); if(!el) return;
    const d=expectedDamage(s,f,battle.selAttack); const p=document.createElement("div"); p.className="bu-pred"+(d>=f.hp?" kill":""); p.textContent=(d>=f.hp?"撃破 ":"")+"≈"+d; el.appendChild(p); } });
}
function renderActions(){
  const s=selUnit(), box=document.getElementById("bt-actions");
  const atk=Object.entries(ATTACKS).map(([id,A])=>{ const w=s?(s.cd[id]||0):0;
    return `<button class="bt-act${battle.selAttack===id?" sel":""}" ${w>0||!s?"disabled":""} onclick="selectAttack('${id}')" title="${A.desc}"><i>${A.icon}</i>${A.name}${w>0?`<em>${w}</em>`:""}</button>`; }).join("");
  const sk=Object.entries(SKILLS).map(([id,S])=>{ const cd=battle.skillCd[id]||0;
    return `<button class="bt-skill" ${cd>0||battle.side!=="ally"||battle.busy?"disabled":""} onclick="useSkill('${id}')" title="${S.desc}"><i>${S.icon}</i>${S.name}${cd>0?`<em>${cd}</em>`:""}</button>`; }).join("");
  box.innerHTML=`<div class="ba-row">${atk}<button class="bt-act wait" ${!s?"disabled":""} onclick="waitUnit()"><i>⏸</i>待機</button></div><div class="ba-row">${sk}</div>`;
  const au=document.getElementById("bt-auto"); au.classList.toggle("on",battle.auto); au.querySelector("b").textContent=battle.auto?"ON":"OFF";
  document.getElementById("bt-speed").querySelector("b").textContent="×"+battle.speed;
  document.getElementById("bt-endturn").disabled=battle.side!=="ally"||battle.busy;
}
function showInfo(u){
  const i=document.getElementById("bt-info"), t=terr(u.c,u.r);
  i.innerHTML=`<b>${u.name}</b> 攻${u.atk} 防${u.def} 移${movePoints(u)} 射${rangeAt(u,u.c,u.r)}${u.crit?` 会心${Math.round(u.crit*100)}%`:""}<br>
    <small>${t.name}（被ダメ×${t.def}）${Object.keys(u.st).map(k=>`・${STATUS[k].name}`).join("")}</small>`;
}
function showTileInfo(c,r){
  const t=battle.tiles[r][c], d=TERRAIN[t.t];
  document.getElementById("bt-info").innerHTML=`<b>${d.name}</b> 移動${d.cost===Infinity?"不可":d.cost} 被ダメ×${d.def}${d.range?" 射程+1":""}<br><small>${d.note}${t.wreck?"・残骸（遮蔽／移動+1）":""}${t.smoke?"・煙幕（被ダメ−30%）":""}${t.t==="burning"?`・あと${t.fire}ターン燃える`:""}</small>`;
}
function blog(msg,cls){ if(!battle) return; battle.logs.unshift(`<div class="${cls||""}">${msg}</div>`); if(battle.logs.length>30) battle.logs.length=30; renderLog(); }
function renderLog(){ const l=document.getElementById("bt-log"); if(l&&battle) l.innerHTML=battle.logs.slice(0,4).join(""); }

/* ===== 艦これ風 被弾カットイン ===== */
function showCutin(info){
  const el=document.getElementById("dmg-cutin"); if(!el) return;
  const label=info.tier>=3?"大破！":"中破！", bgColor=info.tier>=3?"#7a1f1f":"#1f3a7a";
  el.innerHTML=`<div class="ci-bg" style="background:radial-gradient(circle at 30% 40%, ${bgColor}, #05070c)"></div>
    <div class="ci-art"><img src="${dmgSprite(info.cid,info.ratio)}" alt=""></div>
    <div class="ci-label">${label}</div><div class="ci-name">${info.name}</div>`;
  el.classList.remove("hidden","show"); void el.offsetWidth; el.classList.add("show");
  setTimeout(()=>{ el.classList.remove("show"); el.classList.add("hidden"); }, T(1450));
}
function dmgTier(ratio){ return ratio<=0?4:ratio<0.25?3:ratio<0.5?2:ratio<0.75?1:0; }

/* ===== 勝敗 ===== */
function endBattle(result){
  if(battle.result) return;
  battle.result=result; battle.busy=true; const a=battle.area;
  const summary={res:{},drops:[],equips:[],exp:0,firstClear:false};
  const fought=battle.memberUids.map(findUnit).filter(Boolean);
  const all=fought.map(u=>({abType:abilityOf(u).type,abVal:abilityVal(u)}));
  syncBattleHp();
  if(result==="win"){
    const foe=a.eBaseHP*0.2*[0.5,0.75,1][battle.stageNo], resB=1+teamAbility(all,"resource");
    const g={fuel:Math.round(foe*0.18*resB),ammo:Math.round(foe*0.2*resB),steel:Math.round(foe*0.15*resB),parts:Math.round(foe*0.12*resB),gold:Math.round(foe*0.08*resB)};
    for(const k in g) state.res[k]=(state.res[k]||0)+g[k];
    summary.res=Object.assign({},g);
    const ex=Math.round(200*(1+teamAbility(all,"exp")));
    fought.forEach(u=>gainExp(u,ex)); gainCmdExp(120); summary.exp=ex;
    state.records.wins++; bumpMission("win");
    if(!state.clearedStages) state.clearedStages=[];
    const sk=stageKey(a.id,battle.stageNo);
    if(!state.clearedStages.includes(sk)){ state.clearedStages.push(sk); state.res.gold+=50; summary.res.gold=(summary.res.gold||0)+50; summary.stageClear=true; }
    if(battle.stage.boss){ bumpMission("clear");
      if(!state.clearedAreas) state.clearedAreas=[];
      if(!state.clearedAreas.includes(a.id)){ state.clearedAreas.push(a.id); state.res.gold+=150; addItem("remodel",1);
        summary.firstClear=true; summary.res.gold=(summary.res.gold||0)+150; } }
    if(Math.random()<Math.min(1,0.9+teamAbility(all,"luck"))){ const u=rollUnit(0.6); state.owned.push(u); seeDex(u.charId); state.records.drops++;
      summary.drops.push(`${charOf(u).name}（★${charOf(u).rarity}）`); }
    if(Math.random()<0.8+teamAbility(all,"luck")){ const eid=rollEquip(0.6); addEquip(eid,1);
      summary.equips.push(`${EQUIPMENTS[eid].name}（★${EQUIPMENTS[eid].rarity}）`); }
    toast(`🏆 ${a.name} 制圧！`);
  }else{
    fought.forEach(u=>{ u.hp=1; gainExp(u,30); }); gainCmdExp(20); state.records.losses++;
    summary.exp=30; toast("💥 敗北…");
  }
  summary.mvp=mvpOf();
  save(); renderRes(); renderCmd();
  const ov=document.getElementById("battle-result");
  ov.className="br-"+result; ov.innerHTML=battleResultCard(result,a,summary);
}
function mvpOf(){ const live=battle.units.filter(u=>u.hp>0); if(!live.length) return null; return live.reduce((a,b)=>a.atk>b.atk?a:b); }
const RES_ICON={fuel:"⛽燃料",ammo:"💥弾薬",steel:"🔩鋼材",parts:"⚙️部品",gold:"💴資金"};
function battleResultCard(result,a,s){
  let rows="";
  if(result==="win"){
    rows+=Object.keys(RES_ICON).filter(k=>s.res[k]).map(k=>`<li>${RES_ICON[k]} <b>+${s.res[k]}</b></li>`).join("");
    if(s.exp) rows+=`<li>📈 経験値 <b>+${s.exp}</b></li>`;
    s.drops.forEach(d=>rows+=`<li class="br-special">🎁 ${d} が着隊！</li>`);
    s.equips.forEach(e=>rows+=`<li class="br-special">⚙️ 装備「${e}」を入手</li>`);
    if(s.stageClear&&!s.firstClear) rows+=`<li class="br-special">🚩 ${a.short} ${battle.stageNo+1} 初攻略！ 次の段階へ進めます</li>`;
    if(s.firstClear) rows+=`<li class="br-special">🎖 戦域攻略！ 次の戦域が開きました</li>`;
    return `<div class="br-card">${s.mvp?`<div class="br-mvp"><img src="../assets/characters/${s.mvp.cid}.png${ASSET_V}" alt=""><span>MVP<b>${s.mvp.name}</b></span></div>`:""}
      <div class="br-main"><div class="br-rank">S</div><h3>勝　利</h3><div class="br-sub">${a.short} ${battle.stageNo+1}「${battle.stage.name}」を制圧（${battle.turnNo}ターン）</div>
      <ul class="br-summary">${rows}</ul><button class="primary big" onclick="afterBattle()">確認</button></div></div>`;
  }
  return `<div class="br-card"><div class="br-main"><div class="br-rank lose">D</div><h3>敗　北</h3>
    <div class="br-sub">部隊が全滅しました。整備で修理を。</div>
    <ul class="br-summary"><li>📈 経験値 <b>+${s.exp}</b></li></ul><button class="primary big" onclick="afterBattle()">確認</button></div></div>`;
}
/* 戦闘中のダメージを隊員本体へ反映（撃破=耐久1）。撤退でも回復させない */
function syncBattleHp(){
  if(!battle) return;
  battle.memberUids.map(findUnit).filter(Boolean).forEach(u=>{ const pu=battle.units.find(x=>x.uid===u.uid&&!x.dead);
    u.hp=pu?Math.max(1,Math.min(u.maxhp,Math.round(pu.hp))):1; });
  save();
}
function afterBattle(){ document.getElementById("battle-result").className="hidden"; battle=null; showBattleScreen(false);
  if(sortie){ const sts=STAGES[sortie.areaId]; const nx=sts.findIndex((x,i)=>stageOpen(sortie.areaId,i)&&!stageCleared(sortie.areaId,i)); sortie.stage=nx>=0?nx:sortie.stage; }
  renderSortie(); renderBaseStats(); }
function gainExp(u,a){ u.exp+=a; while(u.exp>=u.level*100){ u.exp-=u.level*100; u.level++; } }

/* ===== 結線 ===== */
function bindBattle(){
  document.getElementById("bt-map").addEventListener("click",onMapClick);
  document.getElementById("bt-endturn").onclick=endPlayerTurn;
  document.getElementById("bt-auto").onclick=toggleAuto;
  document.getElementById("bt-speed").onclick=toggleSpeed;
  document.getElementById("bt-retreat").onclick=retreat;
  document.getElementById("btn-area-back").onclick=areaBack;
  document.getElementById("btn-startbattle").onclick=startBattle;
}
