/* 陸これ（仮） v0.8.0 — フル機能版（戦闘は battle.js） */
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
function effStat(u,key){ const c=charOf(u); return Math.max(0, (c[key]||0)+((u.bonus&&u.bonus[key])||0)+(equipBonus(u)[key]||0)); }

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
  bindTabs(); bindButtons(); fitStage();
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
  state.squads.forEach(sq=>compactSquad(sq)); // 空き枠は前に詰める（v0.8.0 の編成画面）
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
function lvMul(u){ return 1+(u.level-1)*0.04+(u.remodel||0)*0.08; }
function unitPower(u){ // 基礎＋改装＋装備（effStat）で数える
  const s=k=>effStat(u,k);
  return Math.round((s("fire")*1.3+s("armor")*0.8+s("mobility")*0.5+s("range")*0.7+s("scout")*0.3)*lvMul(u));
}
function activeSquad(){ return state.squads[state.activeSquad]; }
function squadMembers(){ return activeSquad().filter(Boolean).map(findUnit).filter(Boolean); }
function squadPower(){ return squadMembers().reduce((s,u)=>s+unitPower(u),0); }

/* 固有能力の効き目。改装で3段ごとに強化（abilityLv）され、1段あたり元の値の25%ずつ伸びる */
function abilityOf(u){ return charOf(u).ability||{}; }
function abilityVal(u){ const ab=abilityOf(u); return (ab.val||0)*(1+0.25*(u.abilityLv||0)); }
/* 戦闘に出た隊員の中で、その固有能力を持つ者の最大値（resource/exp/luck など部隊単位で効くもの） */
function teamAbility(units,type){ return units.reduce((m,u)=>u.abType===type?Math.max(m,u.abVal):m,0); }
const RANGE_LONG=75;   // 射程がこれ以上なら2マス先まで撃てる（隣接しないので反撃を受けない）
function critRate(u){ return Math.min(0.25,(effStat(u,"luck")+effStat(u,"scout"))/1000); } // 運＋索敵で会心

/* ===== 画面の切り替え（艦これ式：上の帯・左の献立・母港の丸から） ===== */
const SCREEN_NAME={base:"母港",squad:"編成",sortie:"出撃",arsenal:"工廠",mission:"任務",dex:"図鑑",shop:"補給",config:"設定"};
let curTab="base";
function showTab(t,sub,scroll){
  if(battle) return; // 戦闘中は動かない
  curTab=t;
  document.querySelectorAll("#screen > .tab").forEach(x=>x.classList.toggle("active",x.id==="tab-"+t));
  document.getElementById("stage").dataset.screen=t;
  document.getElementById("scr-name").textContent=SCREEN_NAME[t]||"";
  document.querySelectorAll("#sidemenu [data-go]").forEach(b=>b.classList.toggle("active",b.dataset.go===t&&(!b.dataset.sub||b.dataset.sub===sub)));
  if(t==="arsenal"&&sub) selectSub(sub);
  renderTab(t);
  const scr=document.getElementById("screen"); scr.scrollTop=0;
  if(scroll){ const el=document.getElementById(scroll); if(el) setTimeout(()=>el.scrollIntoView({behavior:"smooth",block:"center"}),30); }
}
function selectSub(sub){
  document.querySelectorAll("#arsenal-nav button").forEach(x=>x.classList.toggle("active",x.dataset.sub===sub));
  document.querySelectorAll("#tab-arsenal .subtab").forEach(x=>x.classList.toggle("active",x.id==="sub-"+sub));
  renderArsenal(sub);
}
function bindTabs(){
  document.querySelectorAll("[data-go]").forEach(b=>{ b.onclick=()=>showTab(b.dataset.go,b.dataset.sub,b.dataset.scroll); });
  document.querySelectorAll("#arsenal-nav button").forEach(b=>{ b.onclick=()=>selectSub(b.dataset.sub); });
}
function renderTab(t){
  if(t==="base") renderPort();
  else if(t==="squad") renderSquad();
  else if(t==="sortie") renderSortie();
  else if(t==="arsenal") renderArsenal(currentSub());
  else if(t==="mission") renderMissions();
  else if(t==="dex") renderDex();
  else if(t==="shop") renderShop();
  else if(t==="config") renderConfig();
}
/* ===== 1200×720 の画面を窓に合わせる。縦持ちは「横にして」と出す ===== */
function fitStage(){
  const w=window.innerWidth, h=window.innerHeight, k=Math.min(w/1200,h/720);
  const st=document.getElementById("stage");
  st.style.transform=`translate(-50%,-50%) scale(${k})`;
  document.body.classList.toggle("portrait", h>w && w<900);
}
async function goLandscape(){
  try{ await document.documentElement.requestFullscreen(); }catch(e){}
  try{ await screen.orientation.lock("landscape"); }catch(e){ toast("この端末では自動で横にできません。端末を横向きにしてください"); }
}
function currentSub(){ const a=document.querySelector("#arsenal-nav button.active"); return a?a.dataset.sub:"build"; }

/* ===== ボタン ===== */
function bindButtons(){
  document.getElementById("btn-changesec").onclick=openSecretarySelect;
  document.getElementById("modal-close").onclick=closeDetail;
  document.getElementById("modal-toggle").onclick=()=>{ if(modalUid!=null){ toggleSquad(modalUid); refreshToggleBtn(); } };
  const ds=document.getElementById("d-steel"),dp=document.getElementById("d-parts");
  ds.oninput=()=>document.getElementById("d-steel-v").textContent=ds.value;
  dp.oninput=()=>document.getElementById("d-parts-v").textContent=dp.value;
  document.getElementById("btn-deploy").onclick=doDeploy;
  bindBattle();
  document.getElementById("btn-landscape").onclick=goLandscape;
  document.getElementById("sq-clear").onclick=clearEscorts;
  document.getElementById("sq-name-input").onchange=e=>{ if(!state.squadNames) state.squadNames=[]; state.squadNames[state.activeSquad]=e.target.value.trim().slice(0,10); save(); };
  ["modal","ship-list","sec-select","equip-picker"].forEach(id=>{ const o=document.getElementById(id); o.addEventListener("click",e=>{ if(e.target===o){ if(id==="modal") closeDetail(); else o.classList.add("hidden"); } }); });
  window.addEventListener("resize",fitStage);
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
    const hm=`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`, md=`${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
    document.querySelectorAll(".clock").forEach(e=>e.textContent=hm);
    document.querySelectorAll(".clock-date").forEach(e=>e.textContent=md);
    tickCommissions();
    tickRepairs();
    applyAutoSupply();
    if(state.missions.date!==todayKey()){ state.missions={date:todayKey(),prog:{}}; save();
      if(isActive("mission")) renderMissions(); toast("📋 日付が変わり、任務が更新されました"); }
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
  if(v&&v.trim()){ state.player.name=v.trim().slice(0,12); save(); renderCmd(); renderBaseStats(); toast(`司令官名を「${state.player.name}」に変更`); }
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
        <div class="cm-pool">製造候補: ${ws.pool.map(id=>DB.characters.find(c=>c.id===id).name).join("・")} ＋装備</div>
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
  }else{ // 装備（鋳造と同じ EQUIPMENTS。旧「武装」は所持分だけ商店で使える）
    const id=rollEquip(0.4); addEquip(id,1);
    toast(`🔧 ${ws.name}より 装備「${EQUIPMENTS[id].name}」（★${EQUIPMENTS[id].rarity}）が完成！`);
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
  save(); renderBaseStats();
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
  renderRes(); renderCmd(); renderMissions(); renderBaseStats();
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
  state.squads.forEach(compactSquad);
  save(); renderSquad();
}
/* ドラッグ&ドロップ用：スロットへ配置 */
function placeInSlot(uid, slotIdx){
  const sq=activeSquad();
  if(uid==null){ sq[slotIdx]=null; }
  else{
    const prev=sq[slotIdx], from=sq.indexOf(uid);
    if(from>=0){ sq[from]=prev; sq[slotIdx]=uid; }            // 同じ小隊の中なら入れ替え
    else{ state.squads.forEach(s=>{ const i=s.indexOf(uid); if(i>=0) s[i]=null; }); sq[slotIdx]=uid; }
  }
  state.squads.forEach(compactSquad);
  save(); closeShipList(); renderSquad();
  if(uid!=null){ const c=charOf(findUnit(uid)); toast(`${c.name} を${squadName(state.activeSquad)}に編入`); }
}
function swapSlots(a,b){ const sq=activeSquad(); const t=sq[a]; sq[a]=sq[b]; sq[b]=t; save(); renderSquad(); }
function setActiveSquad(i){ state.activeSquad=i; save(); renderSquad(); }

/* 小隊枠の耐久バー（50%未満は要修理、修理中はその表示） */
function slotHp(u){
  const hpPct=Math.round(u.hp/u.maxhp*100), repairing=u.repairEnd>Date.now();
  const tag=repairing?`<span class="slot-tag rep">🔧修理中</span>`:hpPct<50?`<span class="slot-tag">要修理</span>`:"";
  return `<span class="hpbar ${hpPct<50?'dmg':''}"><i style="width:${hpPct}%"></i></span><span class="hptxt">${u.hp}/${u.maxhp}</span>${tag}`;
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
  renderEquipSlots(); if(modalUid===uid) openDetail(uid); renderSquad();
  toast(`🔧 ${EQUIPMENTS[id].name} を装備`);
}
function unequip(uid,slot){
  const u=findUnit(uid); if(!u) return;
  equipSlots(u)[slot]=null; save(); renderEquipSlots(); if(modalUid===uid) openDetail(uid); renderSquad();
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
      d.onclick=()=>{ const nu=state.nextUid, tmp=mkUnit(c.id); state.nextUid=nu; tmp.uid=-1; state.owned.push(tmp); openDetail(-1); state.owned.pop(); };
    }else{
      d.innerHTML=`<div class="portrait locked">❓</div><div class="cname">？？？</div><div class="cbase">未発見</div>`;
    }
    g.appendChild(d);
  });
}

/* ===== 共通描画 ===== */
function renderAll(){ applyUITheme(); renderCmd(); renderRes(); renderTab(curTab); renderBaseStats(); applyTheme(); }
function renderCmd(){
  document.getElementById("cmd-name").textContent=state.player.name;
  document.getElementById("cmd-lv").textContent=state.player.level;
  document.getElementById("hq-rank").textContent=rankOf(state.player.level);
  const pct=Math.round(state.player.exp/cmdNeed()*100);
  document.getElementById("cmd-expbar").style.width=pct+"%";
  document.getElementById("cmd-exptxt").textContent=`${state.player.exp}/${cmdNeed()}`;
}
function renderRes(){
  for(const k of ["fuel","ammo","steel","parts","gold"]) document.getElementById("r-"+k).textContent=state.res[k];
  document.getElementById("hq-owned").textContent=state.owned.length;
  document.getElementById("hq-equips").textContent=Object.values(state.equips||{}).reduce((s,n)=>s+n,0);
  for(const k of ["repair","build","remodel"]) document.getElementById("hq-i-"+k).textContent=state.items[k]||0;
}
/* 司令官の階級（艦これの提督の階級にあたる）。5レベルごとに上がる */
const RANKS=["三等陸尉","二等陸尉","一等陸尉","三等陸佐","二等陸佐","一等陸佐","陸将補","陸将"];
function rankOf(lv){ return RANKS[Math.min(RANKS.length-1,Math.floor((lv-1)/5))]; }
function claimableMissions(){ return MISSIONS.filter(m=>{ const p=state.missions.prog[m.id]; return p&&p.prog>=m.need&&!p.claimed; }).length; }
function renderBaseStats(){
  const kb=document.getElementById("kh-badge"); if(kb){ const n=claimableMissions(); kb.textContent=n; kb.classList.toggle("hidden",!n); }
  renderRes();
  const e=document.getElementById("pc-stats"); if(!e) return;
  const fill=activeSquad().filter(Boolean).length;
  e.innerHTML=
    `<li><span>${squadName(state.activeSquad)}</span><b>${fill}/${SQUAD_SIZE}</b></li>`+
    `<li><span>総戦闘力</span><b>${squadPower()}</b></li>`+
    `<li><span>図鑑</span><b>${state.dex.length}/${DB.characters.length}</b></li>`;
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
    <div class="stat">火${effStat(u,"fire")} 装${effStat(u,"armor")} 機${effStat(u,"mobility")}<br>戦闘力 <b>${unitPower(u)}</b> ・ 耐久${u.hp}/${u.maxhp}</div>
    ${hpbar}`;
}
/* ===== 編成画面（艦これ式：2列×3段の枠・詳細と変更・隊員の一覧） ===== */
function squadName(i){ return (state.squadNames&&state.squadNames[i])||`第${i+1}小隊`; }
const CLASS_SHORT={"MBT":"主力","重戦車":"重戦","中戦車":"中戦","軽戦車":"軽戦","歩兵戦車":"歩戦","機動戦闘車":"機動","装甲戦闘車":"装戦","自走砲":"自走","偵察":"偵察"};
function renderSquad(){
  const tabs=document.getElementById("squad-tabs");
  if(tabs){ tabs.innerHTML="";
    for(let i=0;i<SQUAD_COUNT;i++){ const b=document.createElement("button");
      b.className="num-tab"+(state.activeSquad===i?" active":""); b.textContent=i+1; b.title=squadName(i);
      b.onclick=()=>setActiveSquad(i); tabs.appendChild(b); } }
  const ni=document.getElementById("sq-name-input"); if(ni) ni.value=squadName(state.activeSquad);
  const pw=document.getElementById("sq-power"); if(pw) pw.textContent=squadPower();
  const bar=document.getElementById("squad-bar"); if(!bar) return; bar.innerHTML="";
  activeSquad().forEach((uid,i)=>{
    const d=document.createElement("div");
    const u=uid&&findUnit(uid);
    if(!u){ d.className="sp empty";
      d.innerHTML=`<div class="sp-shutter"></div><span class="sp-no">${i+1}</span>
        ${i===0||activeSquad()[i-1]?`<button class="sp-btn change" onclick="openShipList(${i})">⇄ 変更</button>`:""}`;
      bar.appendChild(d); return; }
    const c=charOf(u), r=u.hp/u.maxhp, pct=Math.round(r*100), repairing=u.repairEnd>Date.now();
    const expPct=Math.round(u.exp/(u.level*100)*100);
    d.className="sp"+rarityClass(u)+(repairing?" repairing":"");
    d.innerHTML=`<span class="sp-no${i===0?" flag":""}">${i===0?"旗":i+1}</span>
      <div class="sp-left">
        <div class="sp-name">${c.name}${u.remodel?`<small>${remodelFormName(u.remodel)}</small>`:""}</div>
        <div class="sp-lv">Lv<b>${u.level}</b></div>
        <div class="sp-stars">${"★".repeat(c.rarity)}</div>
        <div class="sp-hp${r<0.25?" bad":r<0.5?" warn":""}"><i style="width:${pct}%"></i></div>
        <div class="sp-hpt">${repairing?"🔧整備中 ":r<0.5?"要整備 ":""}${u.hp}/${u.maxhp}</div>
        <div class="sp-stats">
          <span><i>🔥</i>火力<b>${effStat(u,"fire")}</b></span><span><i>🛡️</i>装甲<b>${effStat(u,"armor")}</b></span>
          <span><i>⚙️</i>機動<b>${effStat(u,"mobility")}</b></span><span><i>🔭</i>射程<b>${effStat(u,"range")}</b></span>
        </div>
      </div>
      <div class="sp-banner" style="background-image:url('${dmgSprite(c.id,r)}')"><span class="sp-cls">${CLASS_SHORT[c.class]||c.class}</span></div>
      <div class="sp-exp"><i style="width:${expPct}%"></i></div>
      <div class="sp-btns"><button class="sp-btn detail" onclick="openDetail(${u.uid})">🔍 詳細</button><button class="sp-btn change" onclick="openShipList(${i})">⇄ 変更</button></div>`;
    bar.appendChild(d);
  });
  renderBaseStats();
}
function clearEscorts(){ const sq=activeSquad(); for(let i=1;i<sq.length;i++) sq[i]=null; save(); renderSquad(); toast("随伴を解除しました（隊長だけ残します）"); }
/* 空き枠を詰める（艦これと同じく、前から順に並ぶ） */
function compactSquad(sq){ const a=sq.filter(Boolean); for(let i=0;i<sq.length;i++) sq[i]=a[i]||null; }
let slTarget=0, slSort="lv";
function openShipList(slot){
  slTarget=slot;
  document.getElementById("sl-title").textContent=`隊員選択（${squadName(state.activeSquad)}・${slot===0?"隊長":"第"+(slot+1)+"枠"}）`;
  document.getElementById("sl-sort").innerHTML=[["lv","Lv順"],["class","兵科順"],["power","戦闘力順"],["new","新着順"]]
    .map(([k,l])=>`<button class="${slSort===k?"sel":""}" onclick="slSort='${k}';openShipList(${slot})">${l}</button>`).join("");
  const cur=activeSquad()[slot];
  document.getElementById("sl-remove").innerHTML=cur&&slot>0?`<button class="danger" onclick="placeInSlot(null,${slot})">✕ この枠を外す</button>`:"";
  const rows=[...state.owned];
  const cls=Object.keys(CLASS_ICON);
  rows.sort((a,b)=> slSort==="lv"?b.level-a.level||b.exp-a.exp : slSort==="power"?unitPower(b)-unitPower(a) : slSort==="new"?b.uid-a.uid : cls.indexOf(charOf(a).class)-cls.indexOf(charOf(b).class));
  document.getElementById("sl-table").innerHTML=`<table class="sl-tab"><thead><tr><th></th><th>兵科</th><th>名前</th><th>Lv</th><th>耐久</th><th>火力</th><th>装甲</th><th>機動</th><th>射程</th><th>状態</th></tr></thead><tbody>`+
    rows.map(u=>{ const c=charOf(u), where=state.squads.findIndex(sq=>sq.includes(u.uid)), rep=u.repairEnd>Date.now();
      return `<tr class="${u.uid===cur?"cur":""}${rep?" rep":""}" onclick="placeInSlot(${u.uid},${slot})">
        <td><img src="../assets/chibi/${c.id}.png${ASSET_V}" alt=""></td><td>${CLASS_SHORT[c.class]||c.class}</td>
        <td class="nm">${c.name}<small>${"★".repeat(c.rarity)}</small></td><td>${u.level}</td>
        <td><span class="mini-hp${u.hp/u.maxhp<0.5?" warn":""}"><i style="width:${u.hp/u.maxhp*100}%"></i></span>${u.hp}/${u.maxhp}</td>
        <td>${effStat(u,"fire")}</td><td>${effStat(u,"armor")}</td><td>${effStat(u,"mobility")}</td><td>${effStat(u,"range")}</td>
        <td>${rep?"🔧整備中":where>=0?`<span class="in-sq">${squadName(where)}</span>`:""}</td></tr>`; }).join("")+`</tbody></table>`;
  document.getElementById("ship-list").classList.remove("hidden");
}
function closeShipList(){ document.getElementById("ship-list").classList.add("hidden"); }
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
