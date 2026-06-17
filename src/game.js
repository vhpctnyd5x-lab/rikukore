/* 陸これ（仮） v0.5.1 — フル機能版 */
'use strict';

const CLASS_ICON={"MBT":"🛡️","重戦車":"🐗","中戦車":"🚙","軽戦車":"🏍️","機動戦闘車":"🚙","装甲戦闘車":"🚐","自走砲":"🎯","対空":"🚀","偵察":"🛰️","工兵":"🔧","ヘリ":"🚁","歩兵戦車":"🛡️"};
const SAVE_KEY="rikukore_save_v5";
const ASSET_V="?v=0.5.2";
/* ===== VOICEVOX 音声合成 ===== */
const VOICEVOX_URL="http://127.0.0.1:50021";
// charId -> {sp:話者ID, pitch:音程, speed:速度}。すべて女性ボイス、顔・性格で選定。
const VOICE_MAP={
  type10:{sp:16},            // 九州そら：落ち着いた最新鋭
  leopard2:{sp:29},          // No.7：凛とした自信家
  m26:{sp:20},               // もち子さん：頼れるお姉さん
  m4a1:{sp:70},              // 満別花丸 元気：明るいムードメーカー
  tiger1:{sp:9},             // 波音リツ：低めクールな猛獣
  tiger2:{sp:65},            // 波音リツ クイーン：威厳の王者
  panther:{sp:14},           // 冥鳴ひまり：冷静沈着
  panzer4:{sp:23},           // WhiteCUL：働き者の苦労人
  t34_85:{sp:24,pitch:0.04}, // WhiteCUL たのしい：元気で押し強い
  is2:{sp:110},              // 猫使アル つよつよ：突撃娘
  bt7:{sp:45},               // 櫻歌ミコ ロリ：子供っぽい韋駄天
  t72:{sp:6},                // 四国めたん ツンツン：効率重視クール
  matilda2:{sp:17},          // 九州そら セクシー：英国淑女
  churchill:{sp:54},         // 春歌ナナ：不屈の頑張り屋
  chiha:{sp:0}               // 四国めたん あまあま：小柄健気
};
function voiceOf(charId){ return VOICE_MAP[charId]||{sp:2}; }

/* HPに応じた破損立ち絵を返す（撃破=d4/大破=d3/中破=d2/小破=d1/健在=無印） */
function dmgSuffix(ratio){
  if(ratio<=0) return "_d4";
  if(ratio<0.25) return "_d3";
  if(ratio<0.5) return "_d2";
  if(ratio<0.75) return "_d1";
  return "";
}
function dmgSprite(id, ratio){ return `../assets/characters/${id}${dmgSuffix(ratio)}.png${ASSET_V}`; }
function dmgClass(ratio){ return ratio<0.25?"dmg3":ratio<0.5?"dmg2":ratio<0.75?"dmg1":""; }
const voiceCache=new Map(); // `${sp}|${text}` -> objectURL（合成結果を再利用して即時再生）
let curAudio=null;
async function synth(text, v){
  const key=`${v.sp}|${v.pitch||0}|${v.speed||1}|${text}`;
  if(voiceCache.has(key)) return voiceCache.get(key);
  const q=await fetch(`${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${v.sp}`,{method:"POST"});
  if(!q.ok) throw 0;
  const query=await q.json();
  if(v.pitch!=null) query.pitchScale=v.pitch;
  if(v.speed!=null) query.speedScale=v.speed;
  const syn=await fetch(`${VOICEVOX_URL}/synthesis?speaker=${v.sp}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(query)});
  if(!syn.ok) throw 0;
  const url=URL.createObjectURL(new Blob([await syn.arrayBuffer()],{type:"audio/wav"}));
  voiceCache.set(key,url); return url;
}
async function speak(text, charId){
  if(!state || !state.voiceOn) return;
  try{
    const url=await synth(text, voiceOf(charId));
    if(curAudio){ try{ curAudio.pause(); }catch(e){} }
    curAudio=new Audio(url); curAudio.play().catch(()=>{});
  }catch(e){ /* VOICEVOX未起動 / file://のCORS時は無音 */ }
}
/* 秘書のボイス5個を裏で先に合成しておく（タップ時に即再生） */
function prefetchVoices(charId){
  if(!state || !state.voiceOn) return;
  const v=voiceOf(charId);
  charVoices(charId).forEach(t=>{ synth(t,v).catch(()=>{}); });
}
const SQUAD_SIZE=6;     // 1小隊の人数
const SQUAD_COUNT=3;    // 編成できる小隊数
const SUPPLY_INTERVAL=60000; // 自動補給の間隔(ms)

const ITEMS={
  repair:{name:"高速修復材",icon:"🛠️",desc:"損傷した1名を即時全回復",price:200},
  build:{name:"高速建造材",icon:"⚡",desc:"工場依頼を即時完了",price:150},
  remodel:{name:"改修資材",icon:"🔧",desc:"改装に使用する強化資材",price:300},
  fuelpack:{name:"燃料ドラム",icon:"⛽",desc:"燃料+200",price:120},
  ammopack:{name:"弾薬箱",icon:"💥",desc:"弾薬+200",price:120},
  steelpack:{name:"鋼材塊",icon:"🔩",desc:"鋼材+200",price:140},
  partspack:{name:"部品箱",icon:"⚙️",desc:"部品+200",price:160},
};

const WEAPONS=[
  {id:"gun",name:"120mm滑腔砲",stat:"fire",amt:6,icon:"🔫"},
  {id:"armor",name:"複合装甲",stat:"armor",amt:6,icon:"🛡️"},
  {id:"engine",name:"高出力機関",stat:"mobility",amt:6,icon:"⚙️"},
  {id:"radio",name:"C4I無線機",stat:"scout",amt:6,icon:"📡"},
  {id:"scope",name:"高倍率照準器",stat:"range",amt:5,icon:"🔭"},
];

/* ===== 装備システム（艦これ式・実在兵器） =====
   cat=種別, st=ステータス補正, real=史実解説。EQUIP_SLOTS個まで装備可。 */
const EQUIP_SLOTS=3;
const EQUIP_CAT={"主砲":"🔫","装甲":"🛡️","機関":"⚙️","電子":"📡"};
const EQUIPMENTS={
  // 主砲
  kwk36:{name:"8.8cm KwK36 L/56",cat:"主砲",rarity:4,st:{fire:14,range:6},real:"ティーガーIの主砲。88mm高初速砲で連合軍戦車を圧倒した。"},
  kwk42:{name:"7.5cm KwK42 L/70",cat:"主砲",rarity:4,st:{fire:12,range:8},real:"パンターの長砲身75mm砲。貫通力に優れた大戦屈指の傑作砲。"},
  d25t:{name:"122mm D-25T",cat:"主砲",rarity:5,st:{fire:18,range:4},real:"IS-2の主砲。一撃でティーガーを粉砕する破壊力を持つ。"},
  rh120:{name:"120mm滑腔砲 Rh120",cat:"主砲",rarity:5,st:{fire:16,range:9},real:"レオパルト2・10式の主力滑腔砲。西側の事実上の標準。"},
  m1a1_76:{name:"76mm戦車砲 M1",cat:"主砲",rarity:3,st:{fire:8,range:4},real:"シャーマン後期型の主砲。対戦車能力を強化した。"},
  type1_47:{name:"一式47mm戦車砲",cat:"主砲",rarity:2,st:{fire:5,range:3},real:"チハ改の47mm砲。日本戦車の標準対戦車砲。"},
  // 装甲
  schurzen:{name:"シュルツェン",cat:"装甲",rarity:2,st:{armor:6,mobility:-1},real:"側面に吊るす増加装甲板。成形炸薬弾・対戦車ライフルを防ぐ。"},
  zimmerit:{name:"ツィメリットコーティング",cat:"装甲",rarity:2,st:{armor:4},real:"対磁気吸着地雷用の塗膜。独戦車に広く施された。"},
  era:{name:"爆発反応装甲(ERA)",cat:"装甲",rarity:4,st:{armor:12,mobility:-1},real:"被弾時に爆発し噴流を相殺するブロック式装甲。"},
  composite:{name:"複合装甲モジュール",cat:"装甲",rarity:5,st:{armor:16,mobility:-2},real:"セラミック等を挟んだ近代複合装甲。MBTの防護中核。"},
  // 機関
  hl230:{name:"マイバッハ HL230",cat:"機関",rarity:3,st:{mobility:8},real:"独重戦車用700馬力ガソリン機関。"},
  v2diesel:{name:"V-2 ディーゼル",cat:"機関",rarity:3,st:{mobility:10},real:"T-34の傑作ディーゼル機関。航続と信頼性に優れる。"},
  gasturbine:{name:"ガスタービン機関",cat:"機関",rarity:5,st:{mobility:14},real:"高出力ガスタービン。加速性能に優れる現代戦車の機関。"},
  // 電子
  fug5:{name:"無線機 FuG5",cat:"電子",rarity:2,st:{scout:6},real:"独戦車の標準無線機。連携戦闘の要となった。"},
  ir_sight:{name:"赤外線暗視装置",cat:"電子",rarity:3,st:{scout:10,range:3},real:"夜間でも目標を捉える暗視装置。夜戦を制する。"},
  fcs:{name:"射撃統制装置(FCS)",cat:"電子",rarity:5,st:{fire:8,scout:8,range:5},real:"レーザー測距と弾道計算で命中率を激増させる統制装置。"},
  c4i:{name:"C4Iデータリンク",cat:"電子",rarity:5,st:{scout:14,fire:4},real:"車両間ネットワーク。部隊全体で目標情報を共有する。"},
};
function equipSlots(u){ if(!u.equip) u.equip=[null,null,null]; while(u.equip.length<EQUIP_SLOTS) u.equip.push(null); return u.equip; }
function equipBonus(u){ const b={fire:0,armor:0,mobility:0,range:0,scout:0};
  equipSlots(u).forEach(id=>{ const e=id&&EQUIPMENTS[id]; if(e) for(const k in e.st) b[k]=(b[k]||0)+e.st[k]; });
  return b; }
function effStat(u,key){ const c=charOf(u); return Math.max(0, (c[key]||0)+((u.bonus&&u.bonus[key])||0)+equipBonus(u)[key]); }

const WORKSHOPS=[
  {id:"kawasaki",name:"川崎重工業",nation:"🇯🇵",mins:2,cost:{steel:120,parts:90},pool:["type10","chiha"]},
  {id:"mitsubishi",name:"三菱重工業",nation:"🇯🇵",mins:3,cost:{steel:160,parts:120},pool:["type10","chiha"]},
  {id:"krupp",name:"クルップ社",nation:"🇩🇪",mins:3,cost:{steel:170,parts:110},pool:["tiger1","tiger2","panther","panzer4"]},
  {id:"daimler",name:"ダイムラー・ベンツ",nation:"🇩🇪",mins:2,cost:{steel:130,parts:120},pool:["panther","panzer4","leopard2"]},
  {id:"ural",name:"ウラル車輌工場",nation:"🟥",mins:3,cost:{steel:150,parts:80},pool:["t34_85","is2","bt7","t72"]},
  {id:"chrysler",name:"クライスラー",nation:"🇺🇸",mins:2,cost:{steel:140,parts:100},pool:["m4a1","m26"]},
  {id:"vickers",name:"ヴィッカース社",nation:"🇬🇧",mins:2,cost:{steel:130,parts:90},pool:["matilda2","churchill"]},
];

const MISSIONS=[
  {id:"sortie1",name:"出撃訓練",desc:"出撃を1回行う",need:1,type:"sortie",reward:{gold:50,res:{fuel:120,ammo:120}}},
  {id:"sortie3",name:"連続演習",desc:"戦闘を3回行う",need:3,type:"sortie",reward:{gold:90,res:{steel:150,parts:100}}},
  {id:"win2",name:"二連勝",desc:"演習に2回勝利",need:2,type:"win",reward:{gold:120,item:"repair"}},
  {id:"win5",name:"演習の鬼",desc:"演習に5回勝利",need:5,type:"win",reward:{gold:200,item:"remodel"}},
  {id:"commission1",name:"工房発注",desc:"工場依頼を1回",need:1,type:"commission",reward:{gold:80,res:{steel:120,parts:120}}},
  {id:"deploy1",name:"新戦力配備",desc:"配備建造を1回",need:1,type:"deploy",reward:{gold:70,item:"build"}},
  {id:"remodel1",name:"戦力増強",desc:"改装を1回行う",need:1,type:"remodel",reward:{gold:100,item:"remodel"}},
  {id:"repair1",name:"整備点検",desc:"修理を1回行う",need:1,type:"repair",reward:{gold:50,res:{fuel:100,ammo:100}}},
  {id:"clear1",name:"戦域制圧",desc:"いずれかの戦域のボスを撃破",need:1,type:"clear",reward:{gold:250,item:"repair"}},
];

const UI_THEMES=[
  {id:"green", name:"陸自グリーン"},
  {id:"steel", name:"鋼鉄ブルー"},
  {id:"night", name:"夜戦ダーク"},
  {id:"sakura",name:"桜ブロッサム"},
  {id:"desert",name:"砂漠カーキ"},
];
function applyUITheme(){ document.body.dataset.ui = state.uiTheme||"green"; }

const THEMES=[
  {id:"photo",name:"司令部室（写真）"},
  {id:"od",name:"オリーブドラブ"},
  {id:"night",name:"夜間作戦"},
  {id:"snow",name:"冬季迷彩"},
  {id:"desert",name:"砂漠戦線"},
];

const VOICES=["司令官、本日も異常ありません。","次の作戦、いつでも出られます。","資源の管理はお任せを。","隊のみんな、調子は上々です。","休憩も大事ですよ、司令官。"];
/* キャラ別ボイス：1人5個（最後の1つは「お触り」反応） */
const VOICELINES={
  type10:["司令官、最新のデータリンク、最適化しておきました。","連携戦闘、わたしにお任せください。","国を守る、それがわたしの使命です。","次の演習、データを取りましょう。","ひゃっ…！？ そ、そういうのは作戦に含まれていません！"],
  leopard2:["精密射撃、いつでも準備できています。","西側の誇り、見せて差し上げます。","この一発、外しはしません。","整備は完璧。出撃しましょう。","む…許可なく触れるのは感心しませんね、司令官。"],
  m26:["先輩として、みんなを引っ張ります。","重戦車の本気、見たいですか？","若い子には負けませんよ。","ふふ、頼りにしてくれて嬉しいです。","あらあら、甘えん坊さんですね、司令官？"],
  m4a1:["やっほー司令官！今日も元気いっぱい！","数なら負けない、みんなで行こう！","あたしに任せて、ぱぱっと片付けるよ！","作戦会議？いいね、燃えてきた！","わわっ、くすぐったいってば〜！もう、司令官ったら！"],
  tiger1:["鋼鉄の咆哮、聞かせてあげる。","この八十八ミリ、伊達じゃない。","正面から来るなら、相手になろう。","恐れられるのも、悪くない。","…ふん、馴れ馴れしいぞ。だが、嫌いではない。"],
  tiger2:["王の名に懸けて、退きはしない。","この装甲、誰にも貫けません。","守りは任せて。前へ進みなさい。","重く、強く。それが私の在り方。","……っ、不用意に触れるな。心臓に悪い。"],
  panther:["冷静に、確実に仕留めます。","傾斜装甲の妙、お見せします。","落ち着いて。勝機は必ずある。","司令官の判断を信じます。","……今のは、わざとですか？　もう。"],
  panzer4:["どんな戦線でも、働きますよ。","縁の下の力持ち、得意です。","地味でも確実に、がモットーです。","今日もこつこつ頑張ります。","あぅ…い、いきなりは驚きます、司令官。"],
  t34_85:["量産の力、なめないでよね！","元気と勢いなら誰にも負けない！","ガンガン押していくよ、司令官！","次の戦場、待ちきれないなー！","ちょっ、どこ触ってんの！？　…ま、いいけど。"],
  is2:["この一二二ミリ、必殺です。","重戦車だって、一撃で沈めます。","突撃あるのみ、ついてきて。","勝利のため、前へ。","…っ、不意打ちはずるいです、司令官。"],
  bt7:["速いよ速いよ、捕まえてごらん！","韋駄天のあたしにお任せ！","風みたいに駆け抜けるよ！","じっとしてるの、苦手なんだ〜","きゃっ！もー、すばしっこいんだから、捕まえないでよ！"],
  t72:["自動装填、テンポよくいくよ。","東側の主力、ここにあり。","効率重視で片付けよう。","無駄のない一手を。","…ふぅん、そういう気分？　仕方ないなあ。"],
  matilda2:["ごきげんよう、司令官。紅茶でもいかが？","守りは鉄壁、ご安心を。","淑女らしく、けれど強かに。","あら、お紅茶が冷めてしまいますわ。","まあ…レディに触れるなんて、お行儀が悪いですわよ？"],
  churchill:["不屈の精神、ここにあり。","悪路だろうと、登ってみせます。","粘り強く、最後まで。","紳士として、退きはしません。","おっと…レディに、いや私に何を？　ふふ。"],
  chiha:["小さくたって、頑張ります！","運だけは誰にも負けません！","チハ、まいります！","健気にいきますよ、司令官！","ふぁっ…！？ び、びっくりしたぁ…もう、司令官さん！"]
};
function charVoices(id){ return VOICELINES[id]||VOICES; }
/* 破損時（HP低下）の共通ボイス */
const DMG_VOICES=["うぅ…まだ、戦えます…！","ちょっと痛いけど…平気、平気！","装甲をやられた…でも退きません。","司令官…無理は、しないでくださいね…","くっ…修理が、必要かも…","この程度、かすり傷です…っ","次は、油断しません…","早く、整備に戻りたいな…"];

let DB=null, state=null, tickTimer=null, idleTimer=null;

/* ===== 初期化 ===== */
async function init(){
  DB = window.CHARDB || await fetch("../data/characters.json").then(r=>r.json());
  load();
  preloadArt();
  bindTabs(); bindButtons();
  startClock();
  renderAll();
  resetIdle();
}

function preloadArt(){ // 軽いチビ絵だけ、初回描画の後で遅延先読み（立ち絵は都度ロード）
  setTimeout(()=>{ DB.characters.forEach(c=>{ const i=new Image(); i.src=`../assets/chibi/${c.id}.png${ASSET_V}`; }); }, 1800); }
function emptySquad(){ return new Array(SQUAD_SIZE).fill(null); }
function defaultState(){
  const s={ player:{name:"司令官",level:1,exp:0},
    res:{fuel:300,ammo:300,steel:300,parts:200,gold:300},
    items:{}, weapons:{}, owned:[],
    squads:[emptySquad(),emptySquad(),emptySquad()], activeSquad:0, secretary:null,
    dex:[], dexMax:{}, records:{sorties:0,wins:0,losses:0,deployed:0,drops:0},
    missions:{date:todayKey(),prog:{}}, commissions:[], theme:"photo", uiTheme:"green",
    lastSupply:Date.now(), voiceOn:true, nextUid:100 };
  state=s;
  s.owned=[mkUnit("chiha"),mkUnit("m4a1"),mkUnit("panzer4")];
  s.owned.forEach((u,i)=>{ seeDex(u.charId); s.squads[0][i]=u.uid; });
  s.secretary=s.owned[0].uid;
  return s;
}
function mkUnit(id){ const c=DB.characters.find(x=>x.id===id);
  return {uid:state.nextUid++,charId:id,level:1,exp:0,hp:c.hp,maxhp:c.hp,remodel:0,bonus:{},repairEnd:0,equip:[null,null,null]}; }
function charOf(u){ return DB.characters.find(c=>c.id===u.charId); }
function findUnit(uid){ return state.owned.find(u=>u.uid===uid); }
function todayKey(){ const d=new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }

/* ===== 保存 ===== */
function save(){ localStorage.setItem(SAVE_KEY,JSON.stringify(state)); }
function load(){
  const raw=localStorage.getItem(SAVE_KEY);
  state = raw ? JSON.parse(raw) : defaultState();
  if(!raw) save();
  if(!state.lastSupply) state.lastSupply=Date.now();
  if(state.voiceOn===undefined) state.voiceOn=true;
  if(!state.uiTheme) state.uiTheme="green";
  if(!state.equips) state.equips={};
  // 日付が変わったら任務リセット
  if(state.missions.date!==todayKey()){ state.missions={date:todayKey(),prog:{}}; save(); }
  applyAutoSupply(true);
}

/* ===== 自動補給（時間経過・上限なし） ===== */
function applyAutoSupply(silent){
  const now=Date.now();
  const elapsed=now-(state.lastSupply||now);
  const ticks=Math.floor(elapsed/SUPPLY_INTERVAL);
  if(ticks<=0) return;
  state.lastSupply+=ticks*SUPPLY_INTERVAL;
  // 1tickあたりの自然回復量（控えめ・上限なし）
  const per={fuel:12,ammo:12,steel:8,parts:6};
  for(const k in per) state.res[k]+=per[k]*ticks;
  save(); renderRes();
  if(!silent) toast(`⛽ 自然回復：燃料/弾薬+${12*ticks} 鋼材+${8*ticks} 部品+${6*ticks}`);
}

/* ===== 司令官レベル ===== */
function cmdNeed(){ return state.player.level*200; }
function gainCmdExp(n){
  state.player.exp+=n;
  while(state.player.exp>=cmdNeed()){ state.player.exp-=cmdNeed(); state.player.level++;
    toast(`🎖️ 司令官 Lv.${state.player.level} に昇進！`); }
}

/* ===== 戦闘力 ===== */
function unitPower(u){
  const c=charOf(u), b=u.bonus||{};
  const lvb=1+(u.level-1)*0.04+(u.remodel||0)*0.08;
  const fire=c.fire+(b.fire||0),armor=c.armor+(b.armor||0),mob=c.mobility+(b.mobility||0),
        rng=c.range+(b.range||0),scout=c.scout+(b.scout||0);
  return Math.round((fire*1.3+armor*0.8+mob*0.5+rng*0.7+scout*0.3)*lvb);
}
function activeSquad(){ return state.squads[state.activeSquad]; }
function squadMembers(){ return activeSquad().filter(Boolean).map(findUnit).filter(Boolean); }
function squadPower(){ return squadMembers().reduce((s,u)=>s+unitPower(u),0); }

/* 固有能力を反映した戦闘力（戦闘時に使用） */
function battlePower(members, node){
  const boss=node&&node.type==="boss";
  let total=0, hasLead=null;
  members.forEach(u=>{
    const ab=charOf(u).ability||{}; let m=1;
    if(ab.type==="selffire") m+=ab.val;
    if(ab.type==="self_def") m+=ab.val;
    if(ab.type==="bossfire"&&boss) m+=ab.val;
    if(ab.type==="vanguard") m+=ab.val;
    total+=unitPower(u)*m;
    if(ab.type==="leadership") hasLead=ab.val;
  });
  if(members.some(u=>(charOf(u).ability||{}).type==="count")&&members.length>=5)
    total*=1+(members.find(u=>(charOf(u).ability||{}).type==="count").ability?0.06:0.06);
  if(hasLead) total*=1+hasLead;
  return Math.round(total);
}
/* 被ダメージ倍率（能力反映） */
function dmgMult(u){
  const ab=charOf(u).ability||{}; let m=1;
  if(ab.type==="armor") m-=ab.val;
  if(ab.type==="self_def") m-=ab.val;
  if(ab.type==="vanguard") m+=ab.val;
  if(ab.type==="laststand"&&u.hp<u.maxhp*0.3) m-=ab.val;
  return Math.max(0.3,m);
}

/* ===== タブ ===== */
function bindTabs(){
  document.querySelectorAll("#tabs button").forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll("#tabs button").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll("main > .tab").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("tab-"+b.dataset.tab).classList.add("active");
      renderTab(b.dataset.tab);
    };
  });
  document.querySelectorAll("#arsenal-nav button").forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll("#arsenal-nav button").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll("#tab-arsenal .subtab").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("sub-"+b.dataset.sub).classList.add("active");
      renderArsenal(b.dataset.sub);
    };
  });
}
function renderTab(t){
  if(t==="base") renderPort();
  else if(t==="squad"){ renderSquad(); renderRoster(); }
  else if(t==="sortie") renderSortie();
  else if(t==="arsenal") renderArsenal(currentSub());
  else if(t==="mission") renderMissions();
  else if(t==="dex") renderDex();
  else if(t==="shop") renderShop();
  else if(t==="config") renderConfig();
}
function currentSub(){ const a=document.querySelector("#arsenal-nav button.active"); return a?a.dataset.sub:"build"; }

/* ===== ボタン ===== */
function bindButtons(){
  document.querySelectorAll("#port-command .pc-act[data-tab], #port-utils .pu[data-tab]").forEach(b=>{
    b.onclick=()=>document.querySelector(`#tabs button[data-tab="${b.dataset.tab}"]`).click();
  });
  document.getElementById("btn-changesec").onclick=openSecretarySelect;
  document.getElementById("modal-close").onclick=closeDetail;
  document.getElementById("modal").onclick=e=>{ if(e.target.id==="modal") closeDetail(); };
  const ep=document.getElementById("equip-picker");
  if(ep) ep.onclick=e=>{ if(e.target.id==="equip-picker") ep.classList.add("hidden"); };
  document.getElementById("modal-toggle").onclick=()=>{ if(modalUid!=null){ toggleSquad(modalUid); refreshToggleBtn(); } };
  const ds=document.getElementById("d-steel"),dp=document.getElementById("d-parts");
  ds.oninput=()=>document.getElementById("d-steel-v").textContent=ds.value;
  dp.oninput=()=>document.getElementById("d-parts-v").textContent=dp.value;
  document.getElementById("btn-deploy").onclick=doDeploy;
  document.getElementById("btn-area-back").onclick=areaBack;
  document.getElementById("btn-startbattle").onclick=startBattle;
  document.getElementById("bc-endturn").onclick=endPlayerTurn;
  document.getElementById("bc-quit").onclick=()=>{ if(confirm("撤退しますか？戦果は失われます（損傷はそのまま残ります）")){ stopBattle(); syncBattleHp(); battle=null; renderPreBattle(); renderRoster(); toast("撤退しました。損傷した隊員は工廠で修理を。"); } };
  const si=document.getElementById("secretary-img");
  if(si) si.onclick=()=>{ const u=secretaryUnit(); if(!u)return; const c=charOf(u);
    si.classList.remove("tapped"); void si.offsetWidth; si.classList.add("tapped");
    const ratio=u.hp/u.maxhp;
    let line;
    if(ratio<0.5){ line=DMG_VOICES[Math.floor(Math.random()*DMG_VOICES.length)]; } // 破損ボイス
    else { const lines=charVoices(c.id); line=lines[Math.floor(Math.random()*lines.length)]; }
    document.getElementById("base-msg").textContent=`「${line}」 — ${c.name}`;
    speak(line, c.id); resetIdle();
  };
  document.getElementById("cmd-name").onclick=doRename;
  document.getElementById("btn-rename").onclick=doRename;
  document.getElementById("btn-voice-toggle").onclick=()=>{ state.voiceOn=!state.voiceOn; save(); renderConfig(); toast(`音声を ${state.voiceOn?"ON":"OFF"} にしました`); };
  document.getElementById("btn-voice-test").onclick=()=>{ const u=secretaryUnit(); const c=u?charOf(u):null;
    speak(c?c.intro:"テスト、こちら司令室。", c?c.id:"type10"); };
  document.getElementById("btn-reset").onclick=()=>{ if(confirm("本当に最初からやり直しますか？")){ localStorage.removeItem(SAVE_KEY); state=defaultState(); save(); renderAll(); toast("データを初期化しました"); } };
  document.body.addEventListener("click",resetIdle,true);
}

/* ===== 時計 / 通知 / 放置ボイス ===== */
function startClock(){
  const upd=()=>{
    const d=new Date();
    document.getElementById("clock").textContent=
      `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
    tickCommissions();
    tickRepairs();
    applyAutoSupply();
  };
  upd(); if(tickTimer) clearInterval(tickTimer); tickTimer=setInterval(upd,1000);
}
function noti(msg,icon){ document.getElementById("noti").textContent=msg; if(icon)document.getElementById("noti-icon").textContent=icon; }
function toast(msg){
  const w=document.getElementById("toast-wrap");
  const t=document.createElement("div"); t.className="toast"; t.textContent=msg;
  w.appendChild(t); noti(msg,"🔔");
  setTimeout(()=>{ t.classList.add("out"); setTimeout(()=>t.remove(),400); },3200);
}
function resetIdle(){
  if(idleTimer) clearTimeout(idleTimer);
  idleTimer=setTimeout(idleVoice,90000);
}
function idleVoice(){
  const onBase=document.getElementById("tab-base").classList.contains("active");
  const u=secretaryUnit();
  if(onBase&&u){
    const lines=charVoices(charOf(u).id), line=lines[Math.floor(Math.random()*lines.length)];
    document.getElementById("base-msg").textContent=`「${line}」 — ${charOf(u).name}`;
    speak(line, u.charId);
  }
  resetIdle();
}

/* ===== 秘書隊員 選択 ===== */
function openSecretarySelect(){
  const wrap=document.getElementById("sec-select"); if(!wrap) return;
  const grid=document.getElementById("sec-select-grid"); grid.innerHTML="";
  state.owned.forEach(u=>{ const c=charOf(u);
    const d=document.createElement("div"); d.className="mini-card"+rarityClass(u)+(state.secretary===u.uid?" selected":"");
    d.innerHTML=`<img src="../assets/chibi/${c.id}.png${ASSET_V}" onerror="this.style.display='none'"><span class="mc-name">${c.name}</span>`;
    d.onclick=()=>{ state.secretary=u.uid; save(); renderPort(); wrap.classList.add("hidden"); resetIdle(); toast(`秘書を ${c.name} に変更`); speak(c.intro, c.id); };
    grid.appendChild(d);
  });
  wrap.classList.remove("hidden");
}

/* ===== 改名 ===== */
function doRename(){
  const cur=state.player.name;
  const v=prompt("司令官名を入力してください（最大12文字）",cur);
  if(v&&v.trim()){ state.player.name=v.trim().slice(0,12); save(); renderCmd(); toast(`司令官名を「${state.player.name}」に変更`); }
}

/* ===== 図鑑 ===== */
function seeDex(id){ if(!state.dex.includes(id)) state.dex.push(id); }

/* ===== 配備（建造） ===== */
function doDeploy(){
  const steel=+document.getElementById("d-steel").value, parts=+document.getElementById("d-parts").value;
  if(state.res.steel<steel||state.res.parts<parts){ toast("資源が足りません"); return; }
  state.res.steel-=steel; state.res.parts-=parts;
  const u=rollUnit((steel+parts)/600);
  state.owned.push(u); seeDex(u.charId); state.records.deployed++; bumpMission("deploy");
  save(); renderRes();
  const c=charOf(u);
  document.getElementById("deploy-result").innerHTML=
    `<div class="card${rarityClass(u)}">${cardInner(u)}</div>
     <p>新隊員 <b style="color:var(--gold2)">${c.name}</b>（${c.base}）<span class="stars" style="color:var(--gold2)">${"★".repeat(c.rarity)}</span> 着隊！<br><span style="opacity:.7;font-size:.85rem">${c.intro}</span></p>`;
  toast(`🏭 ${c.name} が配備されました（★${c.rarity}）`);
}
function rollUnit(invest, pool){
  const roll=Math.random()*0.6+invest*0.6;
  let cand=DB.characters;
  if(pool) cand=DB.characters.filter(c=>pool.includes(c.id));
  let f;
  if(roll>0.95) f=cand.filter(c=>c.rarity>=5);
  else if(roll>0.7) f=cand.filter(c=>c.rarity>=4);
  else if(roll>0.4) f=cand.filter(c=>c.rarity>=3);
  else f=cand.filter(c=>c.rarity<=3);
  if(!f.length) f=cand;
  const c=f[Math.floor(Math.random()*f.length)];
  return mkUnit(c.id);
}

/* ===== 工場依頼 ===== */
function renderCommissions(){
  const l=document.getElementById("commission-list"); l.innerHTML="";
  WORKSHOPS.forEach(ws=>{
    const active=state.commissions.find(c=>c.id===ws.id);
    const d=document.createElement("div"); d.className="commission";
    if(active){
      const left=Math.max(0,active.end-Date.now());
      d.innerHTML=`<div class="cm-head"><b>${ws.nation} ${ws.name}</b><span class="cm-status">製造中…</span></div>
        <div class="cm-timer" data-end="${active.end}">${fmtTime(left)}</div>
        <div class="btnrow"><button onclick="rushCommission('${ws.id}')">⚡ 高速建造材で完成</button></div>`;
    }else{
      d.innerHTML=`<div class="cm-head"><b>${ws.nation} ${ws.name}</b><span class="cm-status">待機中</span></div>
        <div class="cm-cost">費用: 🔩${ws.cost.steel} ⚙️${ws.cost.parts}／納期 約${ws.mins}分</div>
        <div class="cm-pool">製造候補: ${ws.pool.map(id=>DB.characters.find(c=>c.id===id).name).join("・")} ＋武装</div>
        <div class="btnrow"><button onclick="startCommission('${ws.id}')">📝 依頼する</button></div>`;
    }
    l.appendChild(d);
  });
}
function startCommission(wsId){
  const ws=WORKSHOPS.find(w=>w.id===wsId);
  if(state.commissions.find(c=>c.id===wsId)){ toast("既に依頼中です"); return; }
  if(state.res.steel<ws.cost.steel||state.res.parts<ws.cost.parts){ toast("資源が足りません"); return; }
  state.res.steel-=ws.cost.steel; state.res.parts-=ws.cost.parts;
  state.commissions.push({id:wsId,end:Date.now()+ws.mins*60000});
  bumpMission("commission"); save(); renderRes(); renderCommissions();
  toast(`📝 ${ws.name} に製造を依頼しました`);
}
function rushCommission(wsId){
  if(!useItem("build")){ toast("高速建造材がありません（商店で購入）"); return; }
  const c=state.commissions.find(x=>x.id===wsId); if(c){ c.end=Date.now(); }
  tickCommissions(true); renderCommissions(); renderInventory();
}
function tickCommissions(force){
  if(!state.commissions||!state.commissions.length) return;
  const now=Date.now(); let changed=false;
  state.commissions=state.commissions.filter(c=>{
    if(c.end<=now){ completeCommission(c.id); changed=true; return false; }
    return true;
  });
  // タイマー表示更新
  document.querySelectorAll(".cm-timer").forEach(el=>{
    const left=Math.max(0,(+el.dataset.end)-now); el.textContent=fmtTime(left);
  });
  if(changed){ save(); if(isActive("arsenal")) renderCommissions(); }
}
function completeCommission(wsId){
  const ws=WORKSHOPS.find(w=>w.id===wsId);
  if(Math.random()<0.7){ // 戦車
    const u=rollUnit(0.5,ws.pool); state.owned.push(u); seeDex(u.charId);
    toast(`🏭 ${ws.name}より ${charOf(u).name}（★${charOf(u).rarity}）が完成！`);
  }else{ // 武装
    const w=WEAPONS[Math.floor(Math.random()*WEAPONS.length)];
    state.weapons[w.id]=(state.weapons[w.id]||0)+1;
    toast(`🔧 ${ws.name}より 武装「${w.name}」が完成！`);
  }
}
function fmtTime(ms){ const s=Math.ceil(ms/1000); return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`; }

/* ===== 改装 ===== */
const REMODEL_FORMS=["","改","改二","改三","改四","改五","改六","改七","改八"];
function remodelFormName(lv){ return REMODEL_FORMS[lv]||("改"+lv); }
/* 改装段階ごとの成長プラン（どの能力が伸びるか可視化） */
function remodelGain(u){
  const c=charOf(u), nextLv=(u.remodel||0)+1;
  // 兵科ごとに伸びやすい方向を変える（単調回避）
  const cls=c.class;
  let plan;
  if(cls==="重戦車"||cls==="歩兵戦車") plan={armor:6,fire:4,range:3,hp:8,mobility:1};
  else if(cls==="軽戦車"||cls==="偵察") plan={mobility:7,scout:6,fire:3,range:2,hp:3};
  else if(cls==="MBT") plan={fire:5,armor:4,mobility:4,scout:4,range:4,hp:5};
  else if(cls==="自走砲") plan={fire:7,range:7,scout:3,armor:1,hp:3};
  else plan={fire:5,armor:4,mobility:4,range:3,hp:5}; // 中戦車など
  // 5段階ごとに固有能力が強化される
  const abilityUp = nextLv%3===0;
  return {plan, abilityUp, nextLv};
}
function renderRemodel(){
  const g=document.getElementById("remodel-list"); g.innerHTML="";
  state.owned.forEach(u=>{
    const c=charOf(u);
    const d=document.createElement("div"); d.className="card"+rarityClass(u);
    const cost=remodelCost(u); const gain=remodelGain(u);
    const gl=Object.entries(gain.plan).map(([k,v])=>`${statJP(k)}+${v}`).join(" ");
    d.innerHTML=cardInner(u)+
      `<div class="rm-info">現在: <b>${c.name}${u.remodel?remodelFormName(u.remodel):""}</b>（改★${u.remodel||0}）
        <div class="rm-next">▶ ${c.name}${remodelFormName(gain.nextLv)} へ</div>
        <div class="rm-gain">${gl}${gain.abilityUp?`<br><span class="rm-ab">⚡ 固有能力【${c.ability.name}】強化！</span>`:""}</div>
        <div class="rm-cost">必要: 🔧改修資材×${cost.kit} ＋ 💴${cost.gold}</div></div>
       <button onclick="doRemodel(${u.uid})">⭐ 改装実行</button>`;
    g.appendChild(d);
  });
}
function statJP(k){ return {fire:"火力",armor:"装甲",mobility:"機動",range:"射程",scout:"索敵",hp:"耐久"}[k]||k; }
function resJP(k){ return {fuel:"⛽燃料",ammo:"💥弾薬",steel:"🔩鋼材",parts:"⚙️部品",gold:"💴資金"}[k]||k; }
function remodelCost(u){ const lv=(u.remodel||0); return {kit:1+lv, gold:300+lv*250}; }
function doRemodel(uid){
  const u=findUnit(uid); const cost=remodelCost(u); const gain=remodelGain(u);
  if((state.items.remodel||0)<cost.kit){ toast("改修資材が不足（戦域攻略/工場/商店で入手）"); return; }
  if(state.res.gold<cost.gold){ toast("資金が不足しています"); return; }
  state.items.remodel-=cost.kit; state.res.gold-=cost.gold; u.remodel=(u.remodel||0)+1;
  for(const [k,v] of Object.entries(gain.plan)){
    if(k==="hp"){ u.maxhp+=v; } else { u.bonus[k]=(u.bonus[k]||0)+v; }
  }
  u.hp=u.maxhp;
  // 能力強化：固有能力の効果値を少し上げる（個体に保存）
  if(gain.abilityUp){ u.abilityLv=(u.abilityLv||0)+1; }
  bumpMission("remodel");
  save(); renderRes(); renderRemodel(); renderInventory();
  const gl=Object.entries(gain.plan).map(([k,v])=>`${statJP(k)}+${v}`).join("・");
  toast(`⭐ ${charOf(u).name}${remodelFormName(u.remodel)} に改装！ ${gl}${gain.abilityUp?" ＋能力強化":""}`);
}

/* ===== 修理 ===== */
function renderRepair(){
  const g=document.getElementById("repair-list"); g.innerHTML="";
  const damaged=state.owned.filter(u=>u.hp<u.maxhp||u.repairEnd>Date.now());
  if(!damaged.length){ g.innerHTML='<p class="hint">損傷した隊員はいません。</p>'; return; }
  // 全車修理（即時・資金消費）
  const woundedNow=state.owned.filter(u=>u.hp<u.maxhp&&!(u.repairEnd>Date.now()));
  if(woundedNow.length){
    const total=woundedNow.reduce((s,u)=>s+repairGold(u),0);
    const bar=document.createElement("div"); bar.className="repair-allbar";
    bar.innerHTML=`<button class="repair-all-btn" onclick="repairAll()">🛠️ 全車修理（${woundedNow.length}名・💴${total}）</button>`;
    g.appendChild(bar);
  }
  damaged.forEach(u=>{
    const c=charOf(u);
    const repairing=u.repairEnd>Date.now();
    const d=document.createElement("div"); d.className="card"+rarityClass(u)+(repairing?" repairing":"");
    const hpPct=Math.round(u.hp/u.maxhp*100);
    let foot;
    if(repairing){ foot=`<div class="repair-fx"><span class="spark">🔧</span><span class="spark s2">✨</span><span class="spark s3">⚙️</span></div>
       <div class="rm-info" data-rep="${u.repairEnd}">🔧 修理中 ${fmtTime(u.repairEnd-Date.now())}</div>
       <button onclick="rushRepair(${u.uid})">⚡ 即時修復</button>`; }
    else{ const cg=repairGold(u);
      foot=`<div class="rm-info">耐久 ${u.hp}/${u.maxhp} (${hpPct}%)<br>💴${cg} か 🛠️1</div>
       <button onclick="startRepair(${u.uid})">🔧 修理(時間)</button>
       <button onclick="rushRepair(${u.uid})">🛠️ 即時</button>`; }
    d.innerHTML=cardInner(u)+foot;
    g.appendChild(d);
  });
}
function repairGold(u){ return (u.maxhp-u.hp)*8+30; }
function repairAll(){
  // 損傷した全隊員を資金で即時全回復。資金不足なら可能な範囲＋トースト。
  const wounded=state.owned.filter(u=>u.hp<u.maxhp&&!(u.repairEnd>Date.now()))
    .sort((a,b)=>repairGold(a)-repairGold(b));
  if(!wounded.length){ toast("修理対象がいません"); return; }
  let n=0;
  for(const u of wounded){ const cg=repairGold(u);
    if(state.res.gold<cg) break;
    state.res.gold-=cg; u.hp=u.maxhp; u.repairEnd=0; n++; bumpMission("repair");
  }
  save(); renderRes(); renderRepair();
  if(n===wounded.length) toast(`🛠️ 全${n}名を修理しました`);
  else if(n>0) toast(`🛠️ ${n}名を修理（資金不足で残り${wounded.length-n}名）`);
  else toast("資金が不足しています");
}
function startRepair(uid){
  const u=findUnit(uid); const cg=repairGold(u);
  if(state.res.gold<cg){ toast("資金が不足しています"); return; }
  state.res.gold-=cg;
  const mins=Math.max(1,Math.round((u.maxhp-u.hp)/6));
  u.repairEnd=Date.now()+mins*60000;
  bumpMission("repair");
  save(); renderRes(); renderRepair(); toast(`🔧 ${charOf(u).name} の修理を開始（約${mins}分）`);
}
function rushRepair(uid){
  const u=findUnit(uid);
  if(!useItem("repair")){ toast("高速修復材がありません（商店で購入）"); return; }
  u.hp=u.maxhp; u.repairEnd=0;
  bumpMission("repair");
  save(); renderRepair(); renderInventory();
  toast(`🛠️ ${charOf(u).name} を完全修復！`);
}
function tickRepairs(){
  if(!state.owned) return; const now=Date.now(); let ch=false;
  state.owned.forEach(u=>{ if(u.repairEnd&&u.repairEnd<=now){ u.hp=u.maxhp; u.repairEnd=0; ch=true; toast(`🔧 ${charOf(u).name} の修理完了`); } });
  document.querySelectorAll("[data-rep]").forEach(el=>{ const l=(+el.dataset.rep)-now; if(l>0) el.textContent=`修理中 ${fmtTime(l)}`; });
  if(ch){ save(); if(isActive("arsenal")) renderRepair(); }
}

/* ===== アイテム / 商店 ===== */
function useItem(id){ if((state.items[id]||0)<=0) return false; state.items[id]--; return true; }
function addItem(id,n){ state.items[id]=(state.items[id]||0)+(n||1); }
function renderShop(){
  const l=document.getElementById("shop-list"); l.innerHTML="";
  Object.entries(ITEMS).forEach(([id,it])=>{
    const d=document.createElement("div"); d.className="shop-item";
    d.innerHTML=`<span class="si-icon">${it.icon}</span>
      <div class="si-body"><b>${it.name}</b><small>${it.desc}</small></div>
      <div class="si-buy"><span>💴${it.price}</span><button onclick="buyItem('${id}')">購入</button></div>`;
    l.appendChild(d);
  });
  renderInventory(); renderWeaponInv();
}
function buyItem(id){
  const it=ITEMS[id];
  if(state.res.gold<it.price){ toast("資金が足りません"); return; }
  state.res.gold-=it.price;
  if(id==="fuelpack") state.res.fuel+=200;
  else if(id==="ammopack") state.res.ammo+=200;
  else if(id==="steelpack") state.res.steel+=200;
  else if(id==="partspack") state.res.parts+=200;
  else addItem(id,1);
  save(); renderRes(); renderInventory();
  toast(`🛒 ${it.name} を購入しました`);
}
function renderInventory(){
  const g=document.getElementById("inventory"); if(!g) return; g.innerHTML="";
  const keys=Object.keys(state.items).filter(k=>state.items[k]>0&&ITEMS[k]);
  if(!keys.length){ g.innerHTML='<p class="hint">所持アイテムはありません。</p>'; return; }
  keys.forEach(k=>{ const it=ITEMS[k];
    const d=document.createElement("div"); d.className="inv-item";
    d.innerHTML=`<span>${it.icon}</span><b>${it.name}</b><span class="cnt">×${state.items[k]}</span>`;
    g.appendChild(d);
  });
}
function renderWeaponInv(){
  const g=document.getElementById("weapon-inv"); if(!g) return; g.innerHTML="";
  const keys=Object.keys(state.weapons||{}).filter(k=>state.weapons[k]>0);
  if(!keys.length){ g.innerHTML='<p class="hint">所持武装はありません（工場依頼で入手）。</p>'; return; }
  keys.forEach(k=>{ const w=WEAPONS.find(x=>x.id===k);
    const d=document.createElement("div"); d.className="inv-item weapon";
    d.innerHTML=`<span>${w.icon}</span><b>${w.name}</b><small>${statLabel(w.stat)}+${w.amt}</small><span class="cnt">×${state.weapons[k]}</span>
      <button onclick="openEquip('${k}')">装備</button>`;
    g.appendChild(d);
  });
}
function statLabel(s){ return {fire:"火力",armor:"装甲",mobility:"機動",range:"射程",scout:"索敵"}[s]||s; }
function openEquip(wid){
  const w=WEAPONS.find(x=>x.id===wid);
  const names=state.owned.map((u,i)=>`${i+1}: ${charOf(u).name}(Lv${u.level})`).join("\n");
  const v=prompt(`「${w.name}」を装備する隊員の番号を入力:\n${names}`);
  const idx=parseInt(v)-1;
  if(isNaN(idx)||idx<0||idx>=state.owned.length){ return; }
  const u=state.owned[idx];
  u.bonus[w.stat]=(u.bonus[w.stat]||0)+w.amt;
  state.weapons[wid]--; save();
  renderWeaponInv(); toast(`🔧 ${charOf(u).name} に ${w.name} を装備（${statLabel(w.stat)}+${w.amt}）`);
}

/* ===== 任務 ===== */
function bumpMission(type){
  const ms=MISSIONS.filter(m=>m.type===type);
  ms.forEach(m=>{
    const p=state.missions.prog[m.id]||{prog:0,claimed:false};
    if(!p.claimed){ p.prog=Math.min(m.need,(p.prog||0)+1); }
    state.missions.prog[m.id]=p;
  });
  save();
}
function renderMissions(){
  const l=document.getElementById("mission-list"); l.innerHTML="";
  MISSIONS.forEach(m=>{
    const p=state.missions.prog[m.id]||{prog:0,claimed:false};
    const done=p.prog>=m.need, claimed=p.claimed;
    const d=document.createElement("div"); d.className="mission"+(claimed?" claimed":done?" done":"");
    const rwd=`💴${m.reward.gold||0}`+(m.reward.item?` ＋ ${ITEMS[m.reward.item].icon}${ITEMS[m.reward.item].name}`:"")+
      (m.reward.res?` ＋ ${Object.entries(m.reward.res).map(([k,v])=>`${resJP(k)}${v}`).join(" ")}`:"");
    d.innerHTML=`<div class="ms-main"><b>${m.name}</b><small>${m.desc}</small>
      <div class="ms-prog"><i style="width:${Math.min(100,p.prog/m.need*100)}%"></i></div>
      <span class="ms-cnt">${Math.min(p.prog,m.need)}/${m.need}</span></div>
      <div class="ms-rwd"><span>${rwd}</span>
      <button ${(!done||claimed)?"disabled":""} onclick="claimMission('${m.id}')">${claimed?"受領済":"報酬受取"}</button></div>`;
    l.appendChild(d);
  });
}
function claimMission(id){
  const m=MISSIONS.find(x=>x.id===id); const p=state.missions.prog[id];
  if(!p||p.prog<m.need||p.claimed) return;
  if(m.reward.gold) state.res.gold+=m.reward.gold;
  if(m.reward.item) addItem(m.reward.item,1);
  if(m.reward.res){ for(const k in m.reward.res) state.res[k]=(state.res[k]||0)+m.reward.res[k]; } // 補給はミッション報酬で
  gainCmdExp(50); p.claimed=true; save();
  renderRes(); renderCmd(); renderMissions();
  const rs=m.reward.res?" ＋"+Object.entries(m.reward.res).map(([k,v])=>`${resJP(k)}+${v}`).join(" "):"";
  toast(`📋 任務「${m.name}」達成！💴${m.reward.gold||0}${m.reward.item?` ＋${ITEMS[m.reward.item].name}`:""}${rs}`);
}

/* ===== 編成 ===== */
function inAnySquad(uid){ return state.squads.some(sq=>sq.includes(uid)); }
function toggleSquad(uid){
  const sq=activeSquad();
  const idx=sq.indexOf(uid);
  if(idx>=0){ sq[idx]=null; }
  else{
    // 他小隊から重複編入を防ぐ
    state.squads.forEach(s=>{ const i=s.indexOf(uid); if(i>=0) s[i]=null; });
    const free=sq.indexOf(null); if(free<0){ toast(`小隊は満員です（最大${SQUAD_SIZE}名）`); return; }
    sq[free]=uid;
  }
  save(); renderSquad(); renderRoster();
}
/* ドラッグ&ドロップ用：スロットへ配置 */
function placeInSlot(uid, slotIdx){
  const sq=activeSquad();
  // 既に他の枠/他小隊にいたら除去
  state.squads.forEach(s=>{ const i=s.indexOf(uid); if(i>=0) s[i]=null; });
  // スロットに既存ユニットがいれば押し出し（入替）
  sq[slotIdx]=uid;
  save(); renderSquad(); renderRoster();
}
function swapSlots(a,b){ const sq=activeSquad(); const t=sq[a]; sq[a]=sq[b]; sq[b]=t; save(); renderSquad(); }
function setActiveSquad(i){ state.activeSquad=i; save(); renderSquad(); renderRoster(); }

/* ===== 出撃（ノードマップ式） =====
   AREAS: りっくじあーす風の戦域。各戦域はノード(地点)とエッジ(進路)で構成。
   restrict: 出撃制限（将来用）。classes/nations/maxRarity を指定すると該当外は出撃不可。 */
/* 地形：マス1つ1つの情景。tile=マスの色, def=そのマスに居る車の被ダメ倍率(低いほど堅い) */
const TERRAINS={
  plain:{ name:"平野", icon:"🌿", tile:"#5d7a39", def:1.0, note:"見通し良好の草原" },
  snow:{ name:"雪原", icon:"❄️", tile:"#aeb9c6", def:0.95, note:"深雪。機動が鈍る" },
  city:{ name:"市街地", icon:"🏚️", tile:"#7a7064", def:0.78, note:"瓦礫が遮蔽になる。堅い" },
  river:{ name:"河川", icon:"🌊", tile:"#3f6f80", def:1.12, note:"渡河中は無防備" },
  coast:{ name:"海岸", icon:"🏖️", tile:"#b89a5e", def:1.0, note:"砂浜と防潮堤" },
  road:{ name:"舗装路", icon:"🛣️", tile:"#5a5550", def:1.05, note:"進軍は速いが隠れられない" },
  forest:{ name:"森林", icon:"🌲", tile:"#3d5a32", def:0.85, note:"木立の遮蔽" },
  urban_ruin:{ name:"廃墟", icon:"🏙️", tile:"#5a514a", def:0.72, note:"崩れた市街。最も堅い" },
};
/* 戦域ごとのマス構成（出やすい地形セット） */
const AREA_TILESET={
  hokkaido:["plain","plain","snow","forest","plain"],
  fuji:["plain","plain","forest","road","plain"],
  kyushu:["coast","plain","city","road","coast"],
  city:["urban_ruin","city","road","city","urban_ruin"],
  river:["river","plain","river","forest","plain"],
};

const AREAS=[
  { id:"hokkaido", name:"戦域I 北部方面隊：北海道大演習場", desc:"機甲科の聖地。広大な原野で機動戦を学べ。",
    bg:"snow", terrain:"snow", restrict:null,
    nodes:[
      {id:"S",x:8,y:50,type:"start",label:"出発"},
      {id:"A",x:30,y:28,type:"battle",power:120,label:"A 偵察線"},
      {id:"B",x:30,y:72,type:"battle",power:140,label:"B 渡渉点"},
      {id:"C",x:52,y:50,type:"resource",label:"C 補給所"},
      {id:"D",x:73,y:34,type:"battle",power:210,label:"D 高地"},
      {id:"Z",x:91,y:55,type:"boss",power:320,label:"Z 敵主力"},
    ],
    edges:[["S","A"],["S","B"],["A","C"],["B","C"],["C","D"],["D","Z"]] },
  { id:"fuji", name:"戦域II 東部方面隊：富士総合火力演習場", desc:"総火演の舞台。火力と連携が試される。",
    bg:"od", terrain:"plain", restrict:{note:"中・重戦車の活躍が見込まれる戦域"},
    nodes:[
      {id:"S",x:8,y:50,type:"start",label:"出発"},
      {id:"A",x:28,y:42,type:"battle",power:260,label:"A 演習開始線"},
      {id:"C",x:48,y:24,type:"resource",label:"C 弾薬集積"},
      {id:"B",x:50,y:66,type:"battle",power:300,label:"B 射場"},
      {id:"D",x:71,y:46,type:"battle",power:400,label:"D 突破口"},
      {id:"Z",x:91,y:52,type:"boss",power:540,label:"Z 機甲連隊"},
    ],
    edges:[["S","A"],["A","C"],["A","B"],["C","D"],["B","D"],["D","Z"]] },
  { id:"kyushu", name:"戦域III 西部方面隊：九州防衛線", desc:"離島防衛の最前線。砂浜と防潮堤の戦い。",
    bg:"desert", terrain:"coast", restrict:null,
    nodes:[
      {id:"S",x:8,y:50,type:"start",label:"出発"},
      {id:"A",x:30,y:55,type:"battle",power:420,label:"A 上陸地点"},
      {id:"B",x:50,y:32,type:"battle",power:480,label:"B 市街地"},
      {id:"C",x:52,y:72,type:"resource",label:"C 野戦病院"},
      {id:"D",x:72,y:52,type:"battle",power:600,label:"D 司令部前"},
      {id:"Z",x:91,y:50,type:"boss",power:780,label:"Z 敵総司令"},
    ],
    edges:[["S","A"],["A","B"],["A","C"],["B","D"],["C","D"],["D","Z"]] },
  { id:"city", name:"戦域IV 市街戦：包囲下の工業都市", desc:"瓦礫と化した街路。近接の死闘。重装甲が物を言う。",
    bg:"od", terrain:"urban_ruin", restrict:null, nodes:[], edges:[] },
  { id:"river", name:"戦域V 渡河作戦：大河の防衛線", desc:"濁流の渡河点を突破せよ。全車が減速する難所。",
    bg:"od", terrain:"river", restrict:null, nodes:[], edges:[] },
];

/* 敵テンプレ（プレースホルダー図形）。今後 空・ミサイル等を追加予定 */
const ENEMY_TYPES={
  circle:{shape:"circle",name:"敵歩兵",hp:30,atk:8,def:3,spd:0.9,color:"#c0392b"},
  triangle:{shape:"triangle",name:"敵軽戦車",hp:55,atk:14,def:8,spd:0.7,color:"#e8a33a"},
  square:{shape:"square",name:"敵重戦車",hp:110,atk:24,def:18,spd:0.45,color:"#7d5fd3"},
  diamond:{shape:"diamond",name:"敵自走砲",hp:60,atk:30,def:6,spd:0.35,color:"#5fa8d3",rng:30},
};
/* 各戦域のウェーブ：t=出現時刻(tick), type, n=体数, hpMul=強化倍率 */
const AREA_BATTLE={
  hokkaido:{ baseHP:1200, eBaseHP:1400, waves:[
    {t:1,type:"circle",n:2},{t:4,type:"triangle",n:1},{t:8,type:"circle",n:2},
    {t:12,type:"triangle",n:2},{t:18,type:"square",n:1,hpMul:1},{t:24,type:"triangle",n:2},{t:30,type:"square",n:1,boss:true,hpMul:2.2}] },
  fuji:{ baseHP:1500, eBaseHP:1900, waves:[
    {t:1,type:"triangle",n:2},{t:5,type:"circle",n:3},{t:9,type:"square",n:1},{t:14,type:"diamond",n:1},
    {t:20,type:"triangle",n:3},{t:26,type:"square",n:2},{t:34,type:"square",n:1,boss:true,hpMul:2.6}] },
  kyushu:{ baseHP:1800, eBaseHP:2600, waves:[
    {t:1,type:"triangle",n:3},{t:6,type:"square",n:1},{t:10,type:"diamond",n:2},{t:15,type:"square",n:2},
    {t:22,type:"triangle",n:4},{t:30,type:"square",n:2},{t:40,type:"square",n:1,boss:true,hpMul:3.2}] },
  city:{ baseHP:2200, eBaseHP:3000, waves:[
    {t:1,type:"square",n:2},{t:6,type:"triangle",n:3},{t:12,type:"square",n:2},{t:18,type:"diamond",n:2},
    {t:24,type:"square",n:3},{t:32,type:"square",n:2,boss:true,hpMul:3.6}] },
  river:{ baseHP:2000, eBaseHP:2800, waves:[
    {t:1,type:"diamond",n:2},{t:6,type:"triangle",n:4},{t:12,type:"diamond",n:2},{t:18,type:"square",n:2},
    {t:24,type:"triangle",n:4},{t:30,type:"diamond",n:1,boss:true,hpMul:3.0}] },
};

/* 攻撃手段（4種）と スキル */
const ATTACKS={
  normal:{name:"通常砲撃",icon:"💥",mul:1.0,aoe:1,cd:1,desc:"バランスの取れた砲撃"},
  ap:{name:"徹甲弾",icon:"🎯",mul:1.6,aoe:1,defPierce:0.5,cd:3,desc:"装甲貫通・単体高威力"},
  he:{name:"榴弾",icon:"💣",mul:0.8,aoe:3,cd:4,desc:"範囲攻撃・複数体に命中"},
  mg:{name:"機銃掃射",icon:"🔫",mul:0.45,aoe:2,hits:3,cd:2,desc:"連射・低威力多段"},
};
const SKILLS={
  charge:{name:"全車突撃",icon:"⚡",cd:14,desc:"全車を前進させ攻撃力UP(数秒)"},
  repair:{name:"応急修理",icon:"🛠️",cd:18,desc:"全車のHPを回復"},
  barrage:{name:"集中砲火",icon:"☄️",cd:22,desc:"全敵に大ダメージ"},
};

/* ===== 出撃：アッシュアームズ式 横スクロール戦闘 ===== */
let sortie=null;          // {areaId} 選択中の戦域（出撃準備）
let battle=null;          // 進行中の戦闘
let battleTimer=null;
const COLS=12, ROWS=4;                 // マス目（列×レーン）長方形ステージ
const COST_MAX=300, COST_START=120, COST_REGEN=4;  // にゃんこ式 戦力ゲージ

function renderSortie(){
  if(sortie){
    document.getElementById("sortie-area-view").classList.add("hidden");
    document.getElementById("sortie-map-view").classList.remove("hidden");
    if(battle){ showBattleScene(); } else { renderPreBattle(); }
  }else{
    document.getElementById("sortie-area-view").classList.remove("hidden");
    document.getElementById("sortie-map-view").classList.add("hidden");
    renderAreaList();
  }
}
function renderAreaList(){
  const l=document.getElementById("area-list"); l.innerHTML="";
  AREAS.forEach(a=>{
    const cleared=(state.clearedAreas||[]).includes(a.id);
    const d=document.createElement("div"); d.className="area-card"+(cleared?" cleared":"");
    d.innerHTML=`<div class="ac-body"><div class="ac-name">${a.name} ${cleared?'<span class="ac-clear">攻略済</span>':''}</div>
      <div class="ac-desc">${a.desc}</div>
      ${a.restrict&&a.restrict.note?`<div class="ac-restrict">⚑ ${a.restrict.note}</div>`:""}</div>
      <button onclick="enterArea('${a.id}')">出撃準備 ▶</button>`;
    l.appendChild(d);
  });
}
function enterArea(id){ sortie={areaId:id}; battle=null; renderSortie(); }
function curArea(){ return AREAS.find(a=>a.id===sortie.areaId); }
function areaBack(){ stopBattle(); sortie=null; battle=null;
  document.getElementById("prebattle").classList.remove("hidden");
  document.getElementById("battlescene").classList.add("hidden");
  renderSortie(); }

function renderPreBattle(){
  const a=curArea();
  document.getElementById("map-title").textContent=a.name+"（出撃準備）";
  const rn=document.getElementById("restrict-note");
  const terr=TERRAINS[a.terrain]||TERRAINS.plain;
  rn.innerHTML=`<b>${terr.icon} 地形：${terr.name}</b> — ${terr.note}`+(a.restrict&&a.restrict.note?`<br>⚑ ${a.restrict.note}`:"");
  rn.style.display="block";
  document.getElementById("prebattle").classList.remove("hidden");
  document.getElementById("battlescene").classList.add("hidden");
  renderSortieSquad(); renderSortieRoster();
}
function renderSortieSquad(){
  const bar=document.getElementById("sortie-squad"); bar.innerHTML="";
  activeSquad().forEach((uid,i)=>{ const s=document.createElement("div");
    if(uid){ const u=findUnit(uid),c=charOf(u); s.className="slot filled";
      const hpPct=Math.round(u.hp/u.maxhp*100), dmg=hpPct<40;
      s.innerHTML=`<img class="schibi" src="../assets/chibi/${c.id}.png${ASSET_V}" onerror="this.style.display='none'">
        <b>${c.name}</b><span>戦闘力 ${unitPower(u)}</span>
        <span class="hpbar ${dmg?'dmg':''}"><i style="width:${hpPct}%"></i></span><span class="hptxt">${u.hp}/${u.maxhp}</span>`;
      s.onclick=()=>{ toggleSquad(uid); renderSortieSquad(); renderSortieRoster(); }; }
    else{ s.className="slot"; s.textContent=`第${i+1}枠（空）`; }
    bar.appendChild(s); });
}
function renderSortieRoster(){
  const g=document.getElementById("sortie-roster"); g.innerHTML="";
  state.owned.forEach(u=>{ const c=charOf(u),inS=activeSquad().includes(u.uid);
    const d=document.createElement("div"); d.className="mini-card"+rarityClass(u)+(inS?" selected":"");
    const hpPct=Math.round(u.hp/u.maxhp*100);
    d.innerHTML=`<img src="../assets/chibi/${c.id}.png${ASSET_V}" onerror="this.style.display='none'">
      <span class="mc-name">${c.name}</span><span class="mc-pow">⚔${unitPower(u)} ❤${hpPct}%</span>`;
    d.onclick=()=>{ toggleSquad(u.uid); renderSortieSquad(); renderSortieRoster(); };
    g.appendChild(d);
  });
}

/* ---- 戦闘開始 ---- */
function startBattle(){
  const a=curArea(); const members=squadMembers();
  if(!members.length){ toast("出撃部隊が空です"); return; }
  if(a.restrict){ for(const u of members){ const c=charOf(u);
      if(a.restrict.classes&&!a.restrict.classes.includes(c.class)){ toast(`${c.name} は出撃不可（兵科制限）`); return; }
      if(a.restrict.nations&&!a.restrict.nations.includes(c.nation)){ toast(`${c.name} は出撃不可（国籍制限）`); return; }
      if(a.restrict.maxRarity&&c.rarity>a.restrict.maxRarity){ toast(`${c.name} は出撃不可（★制限）`); return; } } }
  if(state.res.fuel<30||state.res.ammo<30){ toast("燃料・弾薬が不足（各30）"); return; }
  state.res.fuel-=30; state.res.ammo-=30; save(); renderRes();
  const units=members.slice(0,6).map((u,i)=>{ const c=charOf(u);
    return {uid:u.uid,name:c.name,cid:c.id,ability:c.ability,_tier:dmgTier(u.hp/u.maxhp),
      hp:u.hp,maxhp:u.maxhp,
      atk:Math.round(effStat(u,"fire")*(1+(u.level-1)*0.04+(u.remodel||0)*0.08)),
      def:Math.round(effStat(u,"armor")*0.5),
      mv:Math.max(1,Math.min(3,Math.round(effStat(u,"mobility")/35))),
      rng:1, row:i%ROWS, col:Math.floor(i/ROWS), moved:false, attacked:false, buff:0}; });
  battle={ area:a, tiles:genTiles(a), units, enemies:[], waveIdx:0, turn:"player", sel:null, fx:[],
    selAttack:"normal", skillCd:{}, result:null, cutin:null,
    log:[`<div class="log-head">⚔️ ${a.name} 交戦！ マスごとに地形が違う。地形を活かして戦え</div>`] };
  state.records.sorties++; bumpMission("sortie");
  spawnNextWave();
  showBattleScene();
}
function showBattleScene(){
  document.getElementById("prebattle").classList.add("hidden");
  document.getElementById("battlescene").classList.remove("hidden");
  document.getElementById("map-title").textContent=battle.area.name+"（交戦中）";
  const bf=document.getElementById("battlefield");
  if(bf) bf.style.background="linear-gradient(180deg,#20251a,#14180f)";
  renderBattleControls(); renderBattle();
}
function stopBattle(){ /* ターン制：タイマー無し */ }
function dmgTier(ratio){ return ratio<=0?4:ratio<0.25?3:ratio<0.5?2:ratio<0.75?1:0; }
/* マスごとの地形を生成（戦域のタイルセットから、列で帯状に） */
function genTiles(a){
  const set=AREA_TILESET[a.id]||["plain","plain","forest","plain","plain"];
  const t=[];
  for(let r=0;r<ROWS;r++){ const row=[];
    for(let c=0;c<COLS;c++){
      // 列位置で帯を作りつつ、レーンでずらして情景を散らす
      const idx=Math.floor((c+ (r%2)) / Math.max(1,COLS/set.length)) % set.length;
      let key=set[idx];
      // たまにアクセント地形
      if((c*7+r*3)%11===0) key=set[(idx+2)%set.length];
      row.push(key);
    }
    t.push(row);
  }
  return t;
}
function tileAt(r,c){ return (battle.tiles[r]&&battle.tiles[r][c])||"plain"; }
function tileDef(r,c){ return (TERRAINS[tileAt(r,c)]||TERRAINS.plain).def; }
function blog(msg,cls){ battle.log.unshift(`<div class="${cls||'log-hit'}">${msg}</div>`); if(battle.log.length>40) battle.log.length=40; }

function spawnNextWave(){
  const bd=AREA_BATTLE[battle.area.id];
  if(battle.waveIdx>=bd.waves.length) return false;
  const w=bd.waves[battle.waveIdx]; battle.waveIdx++;
  const tpl=ENEMY_TYPES[w.type], hpMul=w.hpMul||1;
  for(let i=0;i<w.n;i++){
    battle.enemies.push({ shape:tpl.shape,name:tpl.name,
      hp:Math.round(tpl.hp*hpMul),maxhp:Math.round(tpl.hp*hpMul),
      atk:Math.round(tpl.atk*(w.boss?1.3:1)),def:tpl.def,
      mv:tpl.spd>=0.7?2:1, rng:tpl.rng?2:1,
      row:(i+(w.boss?1:0))%ROWS, col:COLS-1-(i%2), color:tpl.color, boss:!!w.boss }); }
  blog(`敵【${tpl.name}】${w.n}体 出現${w.boss?"（強敵！）":""}`,"log-lose");
  return true;
}

/* ---- マス目ユーティリティ ---- */
function unitAt(r,c){ return battle.units.find(u=>u.row===r&&u.col===c)||battle.enemies.find(e=>e.row===r&&e.col===c); }
function occupied(r,c){ return !!unitAt(r,c); }
function dist(a,b){ return Math.abs(a.row-b.row)+Math.abs(a.col-b.col); }

/* ---- プレイヤー操作（クリック式・自動では動かない） ---- */
function selectUnit(uid){
  if(battle.turn!=="player"||battle.result) return;
  battle.sel=(battle.sel===uid)?null:uid; renderBattle();
}
function clickCell(r,c){
  if(battle.turn!=="player"||battle.result||battle.sel==null) return;
  const u=battle.units.find(x=>x.uid===battle.sel); if(!u||u.moved) return;
  if(occupied(r,c)) return;
  if(Math.abs(u.row-r)+Math.abs(u.col-c)>u.mv){ toast("移動範囲外"); return; }
  u.row=r; u.col=c; u.moved=true; renderBattle();
}
function clickEnemy(idx){
  if(battle.turn!=="player"||battle.result) return;
  const e=battle.enemies[idx]; if(!e) return;
  const u=battle.sel!=null?battle.units.find(x=>x.uid===battle.sel):null;
  // 選択味方が居ない / 攻撃済 / 射程外 → 攻撃せず敵情報を表示
  if(!u||u.attacked||dist(u,e)>u.rng){
    const wi=document.getElementById("wave-ind");
    if(wi) wi.innerHTML=`敵：${e.name}／HP ${e.hp}/${e.maxhp}・攻${e.atk}・防${e.def}${e.boss?'・ボス':''}`;
    return;
  }
  doUnitHit(u,e); u.attacked=true;
  battle.enemies=battle.enemies.filter(x=>x.hp>0);
  if(battle.enemies.length===0){ if(!spawnNextWave()){ endBattle("win"); return; } }
  battle.sel=null; renderBattle();
}
function flankBonus(u,e){
  // 攻撃側を含め、敵に隣接する味方が2体以上なら挟撃
  let adj=0; battle.units.forEach(a=>{ if(dist(a,e)<=1) adj++; });
  return adj>=2;
}
function calcUnitDamage(u,e){
  const A=ATTACKS[battle.selAttack]||ATTACKS.normal;
  let dmg=u.atk*A.mul*(u.buff>0?1.3:1);
  dmg-=e.def*(1-(A.defPierce||0));
  if(u.ability&&u.ability.type==="bossfire"&&e.boss) dmg*=1+u.ability.val;
  if(flankBonus(u,e)) dmg*=1.25;            // 挟撃ボーナス +25%
  dmg/=(tileDef(e.row,e.col)||1);           // 対象マスの地形防御
  return Math.max(2,Math.round(dmg));
}
function doUnitHit(u,e){
  const A=ATTACKS[battle.selAttack]||ATTACKS.normal;
  const flank=flankBonus(u,e);
  const dmg=calcUnitDamage(u,e);
  e.hp-=dmg; e._hit=true; u._lunge=true;
  pushFx(e,`-${dmg}`,"dmg");
  blog(`${u.name}の${A.name} → ${e.name}に ${dmg} ダメージ${flank?'（挟撃！）':''}`,"log-win");
  if(A.aoe>1){ battle.enemies.forEach(o=>{ if(o!==e&&Math.abs(o.row-e.row)<=1&&Math.abs(o.col-e.col)<=1){ const d2=Math.round(dmg*0.6); o.hp-=d2; o._hit=true; pushFx(o,`-${d2}`,"dmg"); } }); }
  // 反撃：敵が生存かつ隣接、攻撃種別がmg以外
  if(e.hp>0 && dist(u,e)<=1 && battle.selAttack!=="mg"){
    blog(`${e.name} の反撃！`,"log-lose");
    doEnemyHit(e,u);
  }
  flushFxSoon();
}
function pushFx(t,text,cls){ if(!battle.fx)battle.fx=[]; battle.fx.push({col:t.col,row:t.row,text,cls}); }
let fxTimer=null;
function flushFxSoon(){ if(fxTimer)clearTimeout(fxTimer); fxTimer=setTimeout(()=>{ if(battle){ battle.fx=[]; battle.units.concat(battle.enemies).forEach(x=>{x._hit=false;x._lunge=false;}); renderBattle(); } },720); }
function selectAttack(type){ if(!battle)return; battle.selAttack=type; renderBattleControls(); }
function useSkill(id){
  if(!battle||battle.turn!=="player")return; const S=SKILLS[id];
  if((battle.skillCd[id]||0)>0){ toast(`${S.name} はあと${battle.skillCd[id]}ターン`); return; }
  battle.skillCd[id]=S.cd;
  if(id==="charge"){ battle.units.forEach(u=>u.buff=2); blog(`⚡ 全車突撃！ 攻撃力UP（2ターン）`,"log-win"); }
  else if(id==="repair"){ battle.units.forEach(u=>u.hp=Math.min(u.maxhp,u.hp+Math.round(u.maxhp*0.35))); blog(`🛠️ 応急修理！ HP回復`,"log-win"); }
  else if(id==="barrage"){ battle.enemies.forEach(e=>e.hp-=Math.round(e.maxhp*0.5+40)); battle.enemies=battle.enemies.filter(e=>e.hp>0); blog(`☄️ 集中砲火！`,"log-win");
    if(battle.enemies.length===0&&!spawnNextWave()){ endBattle("win"); return; } }
  toast(`${S.icon} ${S.name}`); renderBattleControls(); renderBattle();
}
function endPlayerTurn(){
  if(!battle||battle.turn!=="player"||battle.result) return;
  battle.turn="enemy"; battle.sel=null; renderBattle();
  setTimeout(enemyTurn,350);
}
function enemyTurn(){
  if(!battle||battle.result) return;
  battle.enemies.forEach(e=>{
    let tgt=null,bd=99; battle.units.forEach(u=>{ const d=dist(e,u); if(d<bd||(d===bd&&tgt&&u.hp<tgt.hp)){bd=d;tgt=u;} });
    if(!tgt) return;
    let steps=e.mv;
    while(steps>0 && dist(e,tgt)>e.rng){
      const dr=Math.sign(tgt.row-e.row), dc=Math.sign(tgt.col-e.col);
      let nr=e.row,nc=e.col;
      if(dc!==0 && !occupied(e.row,e.col+dc)) nc=e.col+dc;
      else if(dr!==0 && !occupied(e.row+dr,e.col)) nr=e.row+dr;
      else break;
      e.row=nr; e.col=nc; steps--;
    }
    if(dist(e,tgt)<=e.rng) doEnemyHit(e,tgt);
  });
  battle.units=battle.units.filter(u=>{ if(u.hp<=0){ blog(`${u.name} 撃破…`,"log-lose"); return false; } return true; });
  for(const k in battle.skillCd) if(battle.skillCd[k]>0) battle.skillCd[k]--;
  battle.units.forEach(u=>{ u.moved=false; u.attacked=false; if(u.buff>0)u.buff--; });
  battle.turn="player";
  if(battle.units.length===0){ endBattle("lose"); return; }
  renderBattleControls(); renderBattle(); flushFxSoon();
  if(battle.cutin){ showCutin(battle.cutin); battle.cutin=null; }
}
/* ===== 艦これ風 被弾カットイン ===== */
function showCutin(info){
  const el=document.getElementById("dmg-cutin"); if(!el) return;
  const ratio=info.ratio, label=info.tier>=3?"大破！":"中破！";
  const bgColor=info.tier>=3?"#7a1f1f":"#1f3a7a"; // 大破=赤系/中破=青系
  el.innerHTML=`<div class="ci-bg" style="background:radial-gradient(circle at 30% 40%, ${bgColor}, #05070c)"></div>
    <div class="ci-art"><img src="${dmgSprite(info.cid,ratio)}" alt=""></div>
    <div class="ci-label">${label}</div>
    <div class="ci-name">${info.name}</div>`;
  el.classList.remove("hidden"); el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  setTimeout(()=>{ el.classList.remove("show"); el.classList.add("hidden"); }, 1700);
}
function doEnemyHit(e,u){
  let dmg=e.atk - u.def*0.6;
  if(u.ability&&(u.ability.type==="armor"||u.ability.type==="self_def")) dmg*=1-u.ability.val;
  if(u.ability&&u.ability.type==="laststand"&&u.hp<u.maxhp*0.3) dmg*=1-u.ability.val;
  dmg*=tileDef(u.row,u.col); // マス地形の防御
  dmg=Math.max(1,Math.round(dmg)); u.hp-=dmg; u._hit=true;
  pushFx(u,`-${dmg}`,"dmg-ally");
  blog(`${e.name} → ${u.name}に ${dmg} ダメージ`,"log-lose");
  // 被弾で破損段階が悪化したらカットイン予約（中破以上）
  const nt=dmgTier(u.hp/u.maxhp);
  if(nt>(u._tier||0)){ u._tier=nt; if(nt>=2) battle.cutin={cid:u.cid,name:u.name,ratio:Math.max(0,u.hp/u.maxhp),tier:nt}; }
}

/* ---- 勝敗 ---- */
function endBattle(result){
  battle.result=result; const a=battle.area;
  let html;
  // 戦果サマリー集約（既存処理の値を流用するだけ、新たに資源は足さない）
  const summary={res:{},drops:[],equips:[],exp:0,firstClear:false};
  if(result==="win"){
    html=`<div class="log-head">🏆 勝利！ 敵を殲滅した</div>`;
    const foe=AREA_BATTLE[a.id].eBaseHP*0.2;
    const g={fuel:Math.round(foe*0.18),ammo:Math.round(foe*0.2),steel:Math.round(foe*0.15),parts:Math.round(foe*0.12),gold:Math.round(foe*0.08)};
    for(const k in g) state.res[k]=(state.res[k]||0)+g[k];
    summary.res=Object.assign({},g);
    html+=`<div class="log-win">獲得 ⛽${g.fuel} 💥${g.ammo} 🔩${g.steel} ⚙️${g.parts} 💴${g.gold}</div>`;
    squadMembers().forEach(u=>gainExp(u,200)); gainCmdExp(120); summary.exp=200;
    state.records.wins++; bumpMission("win"); bumpMission("clear");
    if(!state.clearedAreas) state.clearedAreas=[];
    const first=!state.clearedAreas.includes(a.id);
    if(first){ state.clearedAreas.push(a.id); state.res.gold+=150; addItem("remodel",1);
      summary.firstClear=true; summary.res.gold=(summary.res.gold||0)+150;
      html+=`<div class="log-win">🎖 戦域【${a.name}】初攻略！ 💴150 ＋ 🔧改修資材</div>`; }
    if(Math.random()<0.9){ const u=rollUnit(0.6); state.owned.push(u); seeDex(u.charId); state.records.drops++;
      summary.drops.push(`${charOf(u).name}（★${charOf(u).rarity}）`);
      html+=`<div class="log-win">🎁 ${charOf(u).name}（★${charOf(u).rarity}）がドロップ！</div>`; }
    // 装備ドロップ（ボスは高確率＆高レア）
    const isBossWin = battle.waveIdx >= (AREA_BATTLE[a.id].waves.length); // 全wave消化=ボス撃破済み
    if(Math.random() < (isBossWin?0.8:0.45)){
      const eid = rollEquip(isBossWin?0.6:0.3);
      addEquip(eid,1);
      summary.equips.push(`${EQUIPMENTS[eid].name}（★${EQUIPMENTS[eid].rarity}）`);
      html += `<div class="log-win">⚙️ 装備「${EQUIPMENTS[eid].name}」（★${EQUIPMENTS[eid].rarity}）を入手！</div>`;
    }
    battle.units.forEach(pu=>{ const u=findUnit(pu.uid); if(u) u.hp=Math.max(1,Math.round(pu.hp)); });
    toast(`🏆 ${a.name} 制圧！`);
  }else{
    html=`<div class="log-head">💥 敗北… 部隊が全滅した</div>`;
    squadMembers().forEach(u=>{ u.hp=1; gainExp(u,30); }); gainCmdExp(20); state.records.losses++;
    summary.exp=30;
    toast("💥 敗北…");
  }
  battle.log.unshift(html);
  save(); renderRes(); renderCmd();
  document.getElementById("battle-log").innerHTML=battle.log.join("");
  const ov=document.getElementById("battle-result");
  if(ov){ ov.className="br-"+result; ov.innerHTML=battleResultCard(result,a,summary); ov.classList.remove("hidden"); }
}
const RES_ICON={fuel:"⛽燃料",ammo:"💥弾薬",steel:"🔩鉄鋼",parts:"⚙️部品",gold:"💴資金"};
function battleResultCard(result,a,s){
  let rows="";
  if(result==="win"){
    const resLines=Object.keys(RES_ICON).filter(k=>s.res[k]).map(k=>`<li>${RES_ICON[k]} <b>+${s.res[k]}</b></li>`).join("");
    if(resLines) rows+=resLines;
    if(s.exp) rows+=`<li>📈 経験値 <b>+${s.exp}</b></li>`;
    s.drops.forEach(d=>rows+=`<li class="br-special">🎁 ${d} がドロップ！</li>`);
    s.equips.forEach(e=>rows+=`<li class="br-special">⚙️ 装備「${e}」を入手</li>`);
    if(s.firstClear) rows+=`<li class="br-special">🎖 戦域初攻略ボーナス！</li>`;
    return `<div class="br-card"><h3>🏆 勝　利</h3><div class="br-sub">${a.name} を制圧</div>
      <ul class="br-summary">${rows}</ul>
      <button onclick="afterBattle()">確認</button></div>`;
  }else{
    rows+=`<li>📈 経験値 <b>+${s.exp}</b></li>`;
    return `<div class="br-card"><h3>💥 敗　北</h3>
      <div class="br-sub">部隊が損傷しました。工廠で修理を。</div>
      <ul class="br-summary">${rows}</ul>
      <button onclick="afterBattle()">確認</button></div>`;
  }
}
/* 戦闘中のダメージを隊員本体へ反映（戦死=hp1）。撤退でも回復させない */
function syncBattleHp(){
  if(!battle) return;
  squadMembers().forEach(u=>{ const pu=battle.units.find(x=>x.uid===u.uid);
    u.hp = pu ? Math.max(1,Math.round(pu.hp)) : 1; });
  save();
}
function afterBattle(){ document.getElementById("battle-result").classList.add("hidden"); battle=null; renderPreBattle(); }
function gainExp(u,a){ u.exp+=a; while(u.exp>=u.level*100){ u.exp-=u.level*100; u.level++; } }

/* ---- 描画 ---- */
function renderBattleControls(){
  const ab=document.getElementById("bc-attacks");
  ab.innerHTML=Object.entries(ATTACKS).map(([id,A])=>`<button class="atk-btn${battle.selAttack===id?' sel':''}" onclick="selectAttack('${id}')" title="${A.desc}">${A.icon}${A.name}</button>`).join("");
  const sb=document.getElementById("bc-skills");
  sb.innerHTML=Object.entries(SKILLS).map(([id,S])=>{ const cd=battle.skillCd[id]||0;
    return `<button class="skill-btn" ${cd>0?"disabled":""} onclick="useSkill('${id}')" title="${S.desc}">${S.icon}${S.name}${cd>0?` (${cd})`:""}</button>`; }).join("");
}
const CW=()=>88/COLS, RH=()=>80/ROWS;        // 列幅・行ピッチ(%)
const HEXH=()=>RH()*1.34;                      // 六角の実高(行ピッチより大きく重ねて連結)
function tileLeft(col,row){ return 5+(col+0.5)*CW()+((row%2)?CW()/2:0); }
function tileTop(row){ return 8+row*RH()+HEXH()/2; }
function renderBattle(){
  if(!battle) return;
  const sel=battle.sel!=null?battle.units.find(u=>u.uid===battle.sel):null;
  const ti=document.getElementById("turn-ind"); if(ti) ti.textContent=battle.turn==="player"?"🟢 自軍ターン":"🔴 敵ターン（待機）";
  const wi=document.getElementById("wave-ind"); if(wi){ const bd=AREA_BATTLE[battle.area.id];
    wi.innerHTML= sel
      ? `<b style="color:var(--gold2)">選択: ${sel.name}</b>　${sel.moved?'移動済':'青マスで移動'}／${sel.attacked?'攻撃済':'⚔敵で攻撃'}`
      : `WAVE ${Math.min(battle.waveIdx,bd.waves.length)}/${bd.waves.length}・残敵${battle.enemies.length}・部隊${battle.units.length}　味方をタップ`; }
  // 六角マス（千鳥配置）
  const g=document.getElementById("grid-bg"); let gh="";
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    let cls="hex";
    if(sel&&!sel.moved&&!occupied(r,c)&&(Math.abs(sel.row-r)+Math.abs(sel.col-c))<=sel.mv) cls+=" reach";
    const tk=tileAt(r,c), tt=TERRAINS[tk]||TERRAINS.plain;
    gh+=`<div class="${cls}" style="left:${5+c*CW()+((r%2)?CW()/2:0)}%;top:${8+r*RH()}%;width:${CW()}%;height:${HEXH()}%;--tc:${tt.tile}" onclick="clickCell(${r},${c})"><span class="hex-ic">${tt.icon}</span></div>`;
  }
  g.innerHTML=gh;
  // ユニット
  const fu=document.getElementById("field-units"); let h="";
  battle.units.forEach(u=>{ const hpP=Math.round(u.hp/u.maxhp*100), s=battle.sel===u.uid;
    h+=`<div class="fu ally${u.buff>0?' buff':''}${s?' sel':''}${u._hit?' hit':''}${u._lunge?' lunge':''}${(u.moved&&u.attacked)?' done':''}" style="left:${tileLeft(u.col,u.row)}%;top:${tileTop(u.row)}%" onclick="event.stopPropagation();selectUnit(${u.uid})">
      <span class="fu-hp"><i style="width:${hpP}%"></i></span>
      <img src="../assets/chibi/${u.cid}.png${ASSET_V}" onerror="this.style.display='none'"></div>`; });
  battle.enemies.forEach((e,idx)=>{ const hpP=Math.round(e.hp/e.maxhp*100), targetable=sel&&!sel.attacked&&dist(sel,e)<=sel.rng;
    h+=`<div class="fu enemy ${e.shape}${e.boss?' boss':''}${targetable?' target':''}${e._hit?' hit':''}" style="left:${tileLeft(e.col,e.row)}%;top:${tileTop(e.row)}%" onclick="event.stopPropagation();clickEnemy(${idx})">
      <span class="fu-hp enemy"><i style="width:${hpP}%"></i></span>
      <span class="fu-hpnum">${e.hp}</span>
      <span class="shape" style="--ec:${e.color}"></span></div>`; });
  // ダメージ予測（選択中・未攻撃の味方の射程内）
  if(sel&&!sel.attacked){ battle.enemies.forEach(e=>{ if(dist(sel,e)<=sel.rng){
    const dp=calcUnitDamage(sel,e); const kill=dp>=e.hp;
    h+=`<div class="dmg-preview" style="left:${tileLeft(e.col,e.row)}%;top:${tileTop(e.row)}%">${kill?'☠':''}≈${dp}</div>`;
  } }); }
  // ダメージ演出
  (battle.fx||[]).forEach(f=>{ h+=`<div class="dmgfx ${f.cls}" style="left:${tileLeft(f.col,f.row)}%;top:${tileTop(f.row)}%">${f.text}</div>`; });
  fu.innerHTML=h;
  document.getElementById("battle-log").innerHTML=battle.log.join("");
}
/* ===== 詳細モーダル ===== */
let modalUid=null;
const DMG_STATES=[{sfx:"",label:"健在"},{sfx:"_d1",label:"小破"},{sfx:"_d2",label:"中破"},{sfx:"_d3",label:"大破"},{sfx:"_d4",label:"撃破"}];
function setModalArt(cid,sfx){
  const mi=document.getElementById("modal-img");
  mi.classList.remove("dmg1","dmg2","dmg3");
  mi.onerror=()=>{ if(sfx) mi.src=`../assets/characters/${cid}.png${ASSET_V}`; };
  mi.src=`../assets/characters/${cid}${sfx}.png${ASSET_V}`;
  document.querySelectorAll("#modal-states .ms-btn").forEach(b=>b.classList.toggle("sel",b.dataset.sfx===sfx));
}
function openDetail(uid){
  modalUid=uid; const u=findUnit(uid),c=charOf(u),b=u.bonus||{};
  const mi=document.getElementById("modal-img");
  const ratio=u.maxhp?u.hp/u.maxhp:1;
  // 破損状態の切替ボタン（図鑑で全グラフィックを閲覧）
  const curSfx=dmgSuffix(ratio);
  document.getElementById("modal-states").innerHTML=DMG_STATES.map(s=>
    `<button class="ms-btn${s.sfx===curSfx?' sel':''}" data-sfx="${s.sfx}" onclick="event.stopPropagation();setModalArt('${c.id}','${s.sfx}')">${s.label}</button>`).join("");
  setModalArt(c.id, curSfx);
  mi.onclick=()=>document.getElementById("modal-art").classList.toggle("zoom");
  document.getElementById("modal-art").classList.remove("zoom");
  document.getElementById("modal-nation").textContent=c.nation||"";
  document.getElementById("modal-name").textContent=c.name+(u.remodel?` ${remodelFormName(u.remodel)}`:"");
  document.getElementById("modal-base").textContent=c.base;
  document.getElementById("modal-tags").innerHTML=`<span class="mtag">${c.class}</span><span class="mtag star">${"★".repeat(c.rarity)}</span><span class="mtag">Lv.${u.level}</span>`;
  document.getElementById("modal-intro").innerHTML=`<div class="mi-intro">「${c.intro}」</div>`+
    (c.history?`<div class="mi-history"><b>📜 史実背景</b><p>${c.history}</p></div>`:"");
  const eb=u.uid>=0?equipBonus(u):{fire:0,armor:0,mobility:0,range:0,scout:0};
  const bars=[["火力","fire"],["装甲","armor"],["機動","mobility"],["射程","range"],["索敵","scout"]];
  let h=bars.map(([lbl,k])=>{ const base=c[k]+(b[k]||0), v=base+(eb[k]||0), pct=Math.min(100,v);
    const extra=(b[k]||0)+(eb[k]||0);
    return `<div class="srow"><span class="slbl">${lbl}</span><span class="sbar"><i style="width:${pct}%"></i></span><span class="sval">${v}${extra?`<small>${extra>0?'+':''}${extra}</small>`:""}</span></div>`; }).join("");
  h+=`<div class="srow"><span class="slbl">耐久</span><span class="sbar"><i style="width:${Math.round(u.hp/u.maxhp*100)}%;background:linear-gradient(90deg,#c0392b,#7ec97e)"></i></span><span class="sval">${u.hp}/${u.maxhp}</span></div>`;
  h+=`<div class="srow total"><span class="slbl">戦闘力</span><span class="sval big">${unitPower(u)}</span></div>`;
  if(c.ability) h+=`<div class="ability-box"><span class="ab-name">⚡ ${c.ability.name}</span><span class="ab-desc">${c.ability.desc}</span></div>`;
  document.getElementById("modal-stats").innerHTML=h;
  renderEquipSlots();
  refreshToggleBtn();
  document.getElementById("modal").classList.remove("hidden");
}
/* ===== 装備スロット ===== */
function renderEquipSlots(){
  const el=document.getElementById("modal-equip"); if(!el) return;
  const u=modalUid>=0?findUnit(modalUid):null;
  if(!u){ el.innerHTML='<div class="me-locked">図鑑プレビューでは装備できません</div>'; return; }
  el.innerHTML=equipSlots(u).map((id,i)=>{
    const e=id&&EQUIPMENTS[id];
    if(e){ const st=Object.entries(e.st).map(([k,v])=>`${statJP(k)}${v>0?'+':''}${v}`).join(" ");
      return `<div class="me-slot filled" onclick="unequip(${u.uid},${i})"><span class="me-ic">${EQUIP_CAT[e.cat]||"⚙️"}</span><span class="me-body"><b>${e.name}</b><small>${st}</small></span><span class="me-x">✕</span></div>`; }
    return `<div class="me-slot empty" onclick="openEquipPicker(${u.uid},${i})"><span class="me-ic">＋</span><span class="me-body">スロット${i+1}（タップで装備）</span></div>`;
  }).join("");
}
function ownedEquipCount(id){ // 在庫から装備中を引いた利用可能数
  let used=0; state.owned.forEach(u=>equipSlots(u).forEach(x=>{ if(x===id) used++; }));
  return (state.equips[id]||0)-used;
}
function openEquipPicker(uid,slot){
  const list=document.getElementById("equip-picker-list");
  const avail=Object.keys(EQUIPMENTS).filter(id=>ownedEquipCount(id)>0);
  if(!avail.length){ list.innerHTML='<p class="hint">装備がありません。工廠の「鋳造」で製作するか、出撃で入手してください。</p>'; }
  else list.innerHTML=avail.map(id=>{ const e=EQUIPMENTS[id];
    const st=Object.entries(e.st).map(([k,v])=>`${statJP(k)}${v>0?'+':''}${v}`).join(" ");
    return `<div class="ep-item" onclick="equipTo(${uid},${slot},'${id}')"><span class="me-ic">${EQUIP_CAT[e.cat]||"⚙️"}</span><span class="me-body"><b>${e.name}</b><small>${e.cat}・${st}</small></span><span class="cnt">×${ownedEquipCount(id)}</span></div>`; }).join("");
  document.getElementById("equip-picker").classList.remove("hidden");
}
function equipTo(uid,slot,id){
  const u=findUnit(uid); if(!u) return;
  equipSlots(u)[slot]=id; save();
  document.getElementById("equip-picker").classList.add("hidden");
  renderEquipSlots(); if(modalUid===uid) openDetail(uid); renderRoster();
  toast(`🔧 ${EQUIPMENTS[id].name} を装備`);
}
function unequip(uid,slot){
  const u=findUnit(uid); if(!u) return;
  equipSlots(u)[slot]=null; save(); renderEquipSlots(); if(modalUid===uid) openDetail(uid); renderRoster();
}
function refreshToggleBtn(){ const b=document.getElementById("modal-toggle");
  if(modalUid<0){ b.style.display="none"; return; } b.style.display="";
  const ins=activeSquad().includes(modalUid);
  b.textContent=ins?"小隊から外す":"小隊に編入"; b.className=ins?"danger":""; }
function closeDetail(){ document.getElementById("modal").classList.add("hidden"); modalUid=null; }

/* ===== 秘書（母港） ===== */
function secretaryUnit(){ let u=state.secretary?findUnit(state.secretary):null; if(!u){ u=state.owned[0]; state.secretary=u?u.uid:null; } return u; }
function renderPort(){
  const u=secretaryUnit(); if(!u) return; const c=charOf(u);
  const img=document.getElementById("secretary-img");
  const ratio=u.hp/u.maxhp;
  img.style.display="block";
  const base=`../assets/characters/${c.id}.png${ASSET_V}`;
  img.onerror=()=>{ if(!img.src.endsWith(`${c.id}.png${ASSET_V}`)) img.src=base; };
  img.src=dmgSprite(c.id, ratio);
  img.classList.remove("dmg1","dmg2","dmg3"); const dc=dmgClass(ratio); if(dc) img.classList.add(dc);
  document.getElementById("sec-nation").textContent=c.nation||"";
  document.getElementById("sec-name").textContent=c.name+(u.remodel?` 改★${u.remodel}`:"");
  document.getElementById("sec-base").textContent=c.base;
  document.getElementById("sec-class").textContent=`${c.class}・${"★".repeat(c.rarity)}・Lv.${u.level}`;
  document.getElementById("base-msg").textContent=`「${c.intro}」`;
  applyTheme();
  renderBaseStats();
  prefetchVoices(c.id);
}

/* ===== テーマ（模様替え） ===== */
function applyTheme(){
  const p=document.getElementById("port-bg");
  p.className=""; p.classList.add("theme-"+(state.theme||"photo"));
}
function renderConfig(){
  renderCmd();
  document.getElementById("name-input").value=state.player.name;
  renderRecords();
  const vt=document.getElementById("btn-voice-toggle");
  if(vt) vt.textContent="音声: "+(state.voiceOn?"ON":"OFF");
  const vs=document.getElementById("voice-status");
  if(vs){ vs.textContent="VOICEVOXで秘書がしゃべります。確認中…";
    fetch(`${VOICEVOX_URL}/version`).then(r=>r.json()).then(v=>{ vs.textContent=`✅ VOICEVOX 接続OK (v${v})。file://では音が出ない場合あり→ localhost配信推奨`; })
      .catch(()=>{ vs.textContent="⚠ VOICEVOXに接続できません。アプリ起動＋localhost配信(python3 -m http.server)で有効になります"; }); }
  const ul=document.getElementById("uitheme-list"); if(ul){ ul.innerHTML="";
    UI_THEMES.forEach(t=>{ const b=document.createElement("button");
      b.className="uitheme-btn"+(state.uiTheme===t.id?" sel":"")+" ui-sw-"+t.id;
      b.textContent=(state.uiTheme===t.id?"✓ ":"")+t.name;
      b.onclick=()=>{ state.uiTheme=t.id; save(); applyUITheme(); renderConfig(); toast(`UIテーマ: ${t.name}`); };
      ul.appendChild(b);
    }); }
  const tl=document.getElementById("theme-list"); tl.innerHTML="";
  THEMES.forEach(t=>{ const b=document.createElement("button");
    b.textContent=t.name; b.className=state.theme===t.id?"":"danger"; b.style.opacity=state.theme===t.id?1:.7;
    if(state.theme===t.id) b.textContent="✓ "+t.name;
    b.onclick=()=>{ state.theme=t.id; save(); applyTheme(); renderConfig(); toast(`模様替え: ${t.name}`); };
    tl.appendChild(b);
  });
}
function renderRecords(){
  const r=state.records;
  const rate=r.sorties?Math.round(r.wins/(r.wins+r.losses||1)*100):0;
  document.getElementById("records").innerHTML=
    `<div class="rec-grid">
      <div><b>${r.sorties}</b><small>出撃</small></div>
      <div><b>${r.wins}</b><small>勝利</small></div>
      <div><b>${r.losses}</b><small>敗北</small></div>
      <div><b>${rate}%</b><small>勝率</small></div>
      <div><b>${r.deployed}</b><small>配備数</small></div>
      <div><b>${r.drops}</b><small>ドロップ</small></div>
      <div><b>${state.owned.length}</b><small>保有隊員</small></div>
      <div><b>${state.dex.length}/${DB.characters.length}</b><small>図鑑</small></div>
    </div>`;
}

/* ===== 図鑑 ===== */
function renderDex(){
  document.getElementById("dex-progress").textContent=`収集: ${state.dex.length} / ${DB.characters.length}`;
  const g=document.getElementById("dex-grid"); g.innerHTML="";
  DB.characters.forEach(c=>{
    const seen=state.dex.includes(c.id);
    const d=document.createElement("div"); d.className="card"+(seen?" r"+(c.rarity>=3?c.rarity:""):" locked");
    if(seen){
      const no=String(DB.characters.indexOf(c)+1).padStart(2,"0");
      d.innerHTML=`<span class="dex-no">No.${no}</span>
        <div class="portrait"><img class="chibi" src="../assets/chibi/${c.id}.png${ASSET_V}" onerror="this.style.display='none'"></div>
        <div class="cname">${c.name}</div><div class="cbase">${c.nation} ${c.base}</div>
        <div class="meta"><span class="cclass">${c.class}</span><span class="stars">${"★".repeat(c.rarity)}</span></div>
        <div class="dex-tap">📜 タップで史実・立ち絵</div>`;
      d.onclick=()=>{ const tmp=mkUnit(c.id); tmp.uid=-1; state.owned.push(tmp); openDetail(-1); state.owned.pop(); };
    }else{
      d.innerHTML=`<div class="portrait locked">❓</div><div class="cname">？？？</div><div class="cbase">未発見</div>`;
    }
    g.appendChild(d);
  });
}

/* ===== 共通描画 ===== */
function renderAll(){ applyUITheme(); renderCmd(); renderRes(); renderPort(); renderSquad(); renderRoster(); applyTheme(); }
function renderCmd(){
  document.getElementById("cmd-name").textContent=state.player.name;
  document.getElementById("cmd-lv").textContent="Lv."+state.player.level;
  const pct=Math.round(state.player.exp/cmdNeed()*100);
  document.getElementById("cmd-expbar").style.width=pct+"%";
  document.getElementById("cmd-exptxt").textContent=`${state.player.exp}/${cmdNeed()}`;
}
function renderRes(){
  document.getElementById("r-fuel").textContent=state.res.fuel;
  document.getElementById("r-ammo").textContent=state.res.ammo;
  document.getElementById("r-steel").textContent=state.res.steel;
  document.getElementById("r-parts").textContent=state.res.parts;
  document.getElementById("r-gold").textContent=state.res.gold;
}
function renderBaseStats(){
  // 司令官レベル / 経験値（司令室の左パネル）
  const lv=document.getElementById("pc-lv");
  if(lv){
    lv.textContent=state.player.level;
    const pct=Math.max(0,Math.min(100,Math.round(state.player.exp/cmdNeed()*100)));
    const bar=document.getElementById("pc-expbar"); if(bar) bar.style.width=pct+"%";
    const txt=document.getElementById("pc-exptxt"); if(txt) txt.textContent=`${state.player.exp} / ${cmdNeed()}`;
  }
  const e=document.getElementById("pc-stats"); if(!e) return;
  const fill=activeSquad().filter(Boolean).length;
  e.innerHTML=
    `<li><span class="pl">🎖 保有車輌</span><b>${state.owned.length}</b></li>`+
    `<li><span class="pl">🚩 第${state.activeSquad+1}小隊</span><b>${fill}/${SQUAD_SIZE}</b></li>`+
    `<li><span class="pl">🔥 総戦闘力</span><b>${squadPower()}</b></li>`+
    `<li><span class="pl">📖 図鑑収集</span><b>${state.dex.length}/${DB.characters.length}</b></li>`;
}
function rarityClass(u){ const r=charOf(u).rarity; return r>=5?" r5":r>=4?" r4":r>=3?" r3":""; }
function cardInner(u){ const c=charOf(u),chibi=`../assets/chibi/${c.id}.png${ASSET_V}`;
  // 耐久バー（図鑑プレビュー uid<0 や maxhp未定義でも壊れないようガード）
  let hpbar="";
  if(u && typeof u.maxhp==="number" && u.maxhp>0 && typeof u.hp==="number"){
    const ratio=Math.max(0,Math.min(1,u.hp/u.maxhp));
    const pct=Math.round(ratio*100);
    const lvlCls=ratio>=0.5?"hp-ok":(ratio>=0.25?"hp-warn":"hp-bad");
    const badge=ratio<0.5?`<span class="repair-badge">要修理</span>`:"";
    hpbar=`${badge}<div class="hpbar"><span class="hpbar-fill ${lvlCls}" style="width:${pct}%"></span></div>`;
  }
  return `<span class="lvl">Lv.${u.level}${u.remodel?` 改★${u.remodel}`:""}</span>
    <div class="portrait"><span class="phicon">${CLASS_ICON[c.class]||"⭐"}</span><img class="chibi" src="${chibi}" alt="" onerror="this.style.display='none'"></div>
    <div class="cname">${c.name}</div><div class="cbase">${c.nation||""} ${c.base}</div>
    <div class="meta"><span class="cclass">${c.class}</span><span class="stars">${"★".repeat(c.rarity)}</span></div>
    <div class="stat">火${c.fire+(u.bonus.fire||0)} 装${c.armor+(u.bonus.armor||0)} 機${c.mobility+(u.bonus.mobility||0)}<br>戦闘力 <b>${unitPower(u)}</b> ・ 耐久${u.hp}/${u.maxhp}</div>
    ${hpbar}`;
}
let dragUid=null;
function renderRoster(){
  const g=document.getElementById("roster"); if(!g) return; g.innerHTML="";
  state.owned.forEach(u=>{ const d=document.createElement("div");
    d.className="card"+rarityClass(u)+(inAnySquad(u.uid)?" selected":"");
    d.innerHTML=cardInner(u);
    d.draggable=true;
    d.addEventListener("dragstart",e=>{ dragUid=u.uid; d.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; });
    d.addEventListener("dragend",()=>{ dragUid=null; d.classList.remove("dragging"); });
    d.onclick=()=>openDetail(u.uid);
    g.appendChild(d); });
  renderBaseStats();
}
function renderSquad(){
  // 小隊切替タブ
  const tabs=document.getElementById("squad-tabs");
  if(tabs){ tabs.innerHTML="";
    for(let i=0;i<SQUAD_COUNT;i++){ const b=document.createElement("button");
      const cnt=state.squads[i].filter(Boolean).length;
      b.className="sq-tab"+(state.activeSquad===i?" active":""); b.textContent=`第${i+1}小隊 (${cnt}/${SQUAD_SIZE})`;
      b.onclick=()=>setActiveSquad(i); tabs.appendChild(b); }
  }
  const bar=document.getElementById("squad-bar"); if(!bar) return; bar.innerHTML="";
  activeSquad().forEach((uid,i)=>{ const s=document.createElement("div"); s.dataset.slot=i;
    if(uid){ const u=findUnit(uid),c=charOf(u); s.className="slot filled";
      s.innerHTML=`<img class="schibi" src="../assets/chibi/${c.id}.png${ASSET_V}" onerror="this.style.display='none'"><b>${c.name}</b><span>Lv.${u.level}・戦闘力 ${unitPower(u)}</span><span class="slot-x">✕</span>`;
      s.querySelector(".slot-x").onclick=(e)=>{ e.stopPropagation(); toggleSquad(uid); };
      s.onclick=()=>openDetail(uid);
      s.draggable=true;
      s.addEventListener("dragstart",e=>{ dragUid=uid; s.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; });
      s.addEventListener("dragend",()=>{ dragUid=null; s.classList.remove("dragging"); });
    }
    else{ s.className="slot"; s.textContent=`第${i+1}枠（ドラッグで配置）`; }
    // ドロップ受け入れ
    s.addEventListener("dragover",e=>{ e.preventDefault(); s.classList.add("dragover"); });
    s.addEventListener("dragleave",()=>s.classList.remove("dragover"));
    s.addEventListener("drop",e=>{ e.preventDefault(); s.classList.remove("dragover");
      if(dragUid!=null) placeInSlot(dragUid,i); });
    bar.appendChild(s); });
  renderBaseStats();
}
function renderArsenal(sub){
  if(sub==="commission") renderCommissions();
  else if(sub==="remodel") renderRemodel();
  else if(sub==="repair") renderRepair();
  else if(sub==="cast") renderCast();
}
/* ===== 鋳造（装備製作） ===== */
function addEquip(id,n){ state.equips[id]=(state.equips[id]||0)+(n||1); }
function rollEquip(invest){ // invest 0〜1 で高レア確率UP
  const roll=Math.random()*0.6+invest*0.6;
  let minR= roll>1.0?5: roll>0.75?4: roll>0.45?3: 2;
  let pool=Object.keys(EQUIPMENTS).filter(id=>EQUIPMENTS[id].rarity>=minR);
  if(!pool.length) pool=Object.keys(EQUIPMENTS);
  return pool[Math.floor(Math.random()*pool.length)];
}
function doCast(){
  const steel=+document.getElementById("c-steel").value, parts=+document.getElementById("c-parts").value;
  if(state.res.steel<steel||state.res.parts<parts){ toast("資源が足りません"); return; }
  state.res.steel-=steel; state.res.parts-=parts;
  const id=rollEquip((steel+parts)/800); addEquip(id,1); save(); renderRes();
  const e=EQUIPMENTS[id];
  const st=Object.entries(e.st).map(([k,v])=>`${statJP(k)}${v>0?'+':''}${v}`).join(" ");
  document.getElementById("cast-result").innerHTML=
    `<div class="equip-card r${e.rarity>=5?5:e.rarity>=4?4:3}"><span class="me-ic">${EQUIP_CAT[e.cat]||"⚙️"}</span>
      <div><b>${e.name}</b> <span class="stars">${"★".repeat(e.rarity)}</span><br><small>${e.cat}・${st}</small><br><span class="eq-real">${e.real}</span></div></div>`;
  renderEquipInv();
  toast(`⚒️ 装備「${e.name}」を鋳造（★${e.rarity}）`);
}
function renderCast(){
  const cs=document.getElementById("c-steel"),cp=document.getElementById("c-parts");
  if(cs&&!cs._b){ cs._b=1; cs.oninput=()=>document.getElementById("c-steel-v").textContent=cs.value;
    cp.oninput=()=>document.getElementById("c-parts-v").textContent=cp.value;
    document.getElementById("btn-cast").onclick=doCast; }
  renderEquipInv();
}
function renderEquipInv(){
  const g=document.getElementById("equip-inv"); if(!g) return;
  const ids=Object.keys(state.equips||{}).filter(id=>state.equips[id]>0&&EQUIPMENTS[id]);
  if(!ids.length){ g.innerHTML='<p class="hint">所持装備はありません。鋳造するか、出撃のドロップで入手。</p>'; return; }
  g.innerHTML=ids.map(id=>{ const e=EQUIPMENTS[id], avail=ownedEquipCount(id);
    const st=Object.entries(e.st).map(([k,v])=>`${statJP(k)}${v>0?'+':''}${v}`).join(" ");
    return `<div class="equip-card r${e.rarity>=5?5:e.rarity>=4?4:3}"><span class="me-ic">${EQUIP_CAT[e.cat]||"⚙️"}</span>
      <div><b>${e.name}</b> <span class="stars">${"★".repeat(e.rarity)}</span> <span class="cnt">所持${state.equips[id]}（空き${avail}）</span><br><small>${e.cat}・${st}</small></div></div>`; }).join("");
}
function isActive(tab){ return document.getElementById("tab-"+tab).classList.contains("active"); }

init();
