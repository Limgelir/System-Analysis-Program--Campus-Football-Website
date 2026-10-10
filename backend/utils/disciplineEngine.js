// Pure replay of effective formal reports and administrator operations. Report revisions
// replace their original event, while explicit service receipts prevent retroactive service.
const playerKey = (teamId, playerId, rosterId, importPersonId) => `${teamId}:${playerId ? 'p'+playerId : importPersonId ? 'i'+importPersonId : 'r'+rosterId}`;
function emptyPlayer(card) {
  return { key:card.key, team_id:card.team_id, player_id:card.player_id || null,
    player_name:card.player_name, jersey_number:card.jersey_number,
    yellow:0, red:0, total_yellow:0, total_red:0, remaining:0,
    trigger_yellow:false, trigger_red:false, origin:null, origin_kickoff:null, records:[] };
}
function finish(state) {
  if (state.trigger_yellow) state.yellow = 0;
  if (state.trigger_red) state.red = 0;
  state.remaining = 0;
  state.trigger_yellow = false;
  state.trigger_red = false;
}
function effectiveCards(cards) {
  const secondYellows = new Set(cards.filter(c=>c.card_type==='second_yellow_red').map(c=>c.key));
  return cards.filter(c=>c.card_type!=='yellow'||!secondYellows.has(c.key))
    .map(c=>({...c,card_type:c.card_type==='second_yellow_red'?'red':c.card_type}));
}
function replay(events, rules) {
  const players = new Map(), warnings = [];
  let cutoff = null;
  for (const event of events) {
    const p = event.payload;
    if (event.operation === 'reset') {
      cutoff = p.cutoff;warnings.length=0;
      for (const state of players.values()) {
        state.yellow=0;state.red=0;finish(state);state.origin=null;state.origin_kickoff=null;
        state.records.push({operation:'reset',reason:event.reason,at:event.created_at});
      }
      continue;
    }
    if (event.operation === 'adjust') {
      const state = players.get(p.key);
      if (state) {
        if (p.remaining > 0 && (!state.origin || state.origin !== p.origin)) {
          warnings.push({key:p.key,schedule_id:p.origin,message:`${state.player_name}的原停赛依据已被报告修订改变，请重新核对管理员纠正记录`});
          continue;
        }
        if (p.remaining > 0 && !state.remaining) {
          const original=state.records.filter(r=>r.operation==='suspension').at(-1);
          if(original){
            state.trigger_yellow=original.yellow;state.trigger_red=original.red;
            if(original.yellow)state.yellow+=original.yellow_count;
            if(original.red)state.red+=original.red_count;
          }
        }
        state.remaining=p.remaining;
        for(let i=warnings.length-1;i>=0;i--)if(warnings[i].key===p.key)warnings.splice(i,1);
        if (!state.remaining) finish(state);
        state.records.push({operation:'adjust',remaining:p.remaining,reason:event.reason,at:event.created_at});
      }
      continue;
    }
    if (event.operation !== 'report') continue;
    const cards = effectiveCards(p.cards), keys = new Set(cards.map(c=>c.key));
    const excluded = p.ignored_by_reset || Boolean(cutoff && p.kickoff<=cutoff);
    for (const state of players.values()) {
      if (!state.remaining || !p.team_ids.includes(state.team_id) || p.kickoff<=state.origin_kickoff || excluded) continue;
      const served = (p.served || []).some(v=>v.key===state.key&&v.origin===state.origin);
      if (keys.has(state.key)) warnings.push({key:state.key,schedule_id:p.schedule_id,message:`${state.player_name}在待执行停赛期间有吃牌记录，需管理员核对`});
      else if (served) {
        state.remaining--;
        state.records.push({operation:'served',schedule_id:p.schedule_id,remaining:state.remaining});
        if (!state.remaining) finish(state);
      } else warnings.push({key:state.key,schedule_id:p.schedule_id,message:`${state.player_name}的处罚与本场原停赛执行记录不一致，请管理员核对剩余场数`});
    }
    const touched = new Set();
    for (const card of cards) {
      if (!players.has(card.key)) players.set(card.key,emptyPlayer(card));
      const state=players.get(card.key);
      state.player_name=card.player_name;state.jersey_number=card.jersey_number;
      state['total_'+card.card_type]++;
      if (!excluded) state[card.card_type]++;
      state.records.push({operation:'card',schedule_id:p.schedule_id,card_type:card.card_type,excluded,source_history_id:event.source_history_id});
      touched.add(card.key);
    }
    if (!excluded) for (const key of touched) {
      const state=players.get(key);
      if (state.remaining) continue;
      const yellow=state.yellow>=rules.yellow_threshold,red=state.red>=rules.red_threshold;
      if (yellow||red) {
        state.remaining=Math.max(yellow?rules.yellow_suspension:0,red?rules.red_suspension:0);
        state.trigger_yellow=yellow;state.trigger_red=red;state.origin=p.schedule_id;state.origin_kickoff=p.kickoff;
        state.records.push({operation:'suspension',schedule_id:p.schedule_id,remaining:state.remaining,yellow,red,yellow_count:state.yellow,red_count:state.red});
      }
    }
  }
  return {players:[...players.values()],warnings};
}
function serviceReceipts(state, match, cards) {
  const keys=new Set(cards.map(c=>c.key));
  return state.players.filter(p=>p.remaining>0&&match.team_ids.includes(p.team_id)&&match.kickoff>p.origin_kickoff&&!keys.has(p.key))
    .map(p=>({key:p.key,origin:p.origin}));
}
function project(players,matches) {
  const remaining=new Map(players.map(p=>[p.key,p.remaining]));
  return matches.map(m=>{
    const suspensions=[];
    for(const p of players) {
      const n=remaining.get(p.key);
      if(n>0&&[m.team_a_id,m.team_b_id].includes(p.team_id)&&m.kickoff>p.origin_kickoff) {
        suspensions.push({key:p.key,team_id:p.team_id,player_name:p.player_name,jersey_number:p.jersey_number,
          reason:[p.trigger_yellow?'累计黄牌':'',p.trigger_red?'累计红牌':''].filter(Boolean).join('、'),remaining_before:n,origin_schedule_id:p.origin});
        remaining.set(p.key,n-1);
      }
    }
    return {schedule_id:m.id,suspensions};
  });
}
module.exports={playerKey,effectiveCards,replay,serviceReceipts,project,emptyPlayer};
