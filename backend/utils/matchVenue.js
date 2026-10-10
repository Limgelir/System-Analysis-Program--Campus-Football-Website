const {createBusinessError}=require('./scheduleValidator');
const VENUES=Object.freeze(['樱花人草','129运动场','铁笼','嘉定人草','嘉定天然草','其它']);
function validateVenue(data,{allowUnknown=false}={}) {
  const {venue,venue_detail}=data;
  if(venue===undefined || venue===null || venue==='') {
    if(!allowUnknown) throw createBusinessError('请选择比赛场地',{code:'VENUE_REQUIRED'});
    if(venue_detail) throw createBusinessError('请先选择场地',{code:'VENUE_INVALID'});
    return {venue:null,venue_detail:null};
  }
  if(!VENUES.includes(venue)) throw createBusinessError('请选择有效的比赛场地',{code:'VENUE_INVALID'});
  if(venue==='其它') {
    if(typeof venue_detail!=='string' || !venue_detail.trim() || venue_detail.trim().length>120) throw createBusinessError('其它场地请填写1—120字的具体地点',{code:'VENUE_DETAIL_REQUIRED'});
    return {venue,venue_detail:venue_detail.trim()};
  }
  if(venue_detail!==undefined && venue_detail!==null && venue_detail!=='') throw createBusinessError('固定场地不需要填写其它地点',{code:'VENUE_INVALID'});
  return {venue,venue_detail:null};
}
function displayVenue(row) { return row.venue==='其它'?row.venue_detail:row.venue||'场地待定'; }
module.exports={VENUES,validateVenue,displayVenue};
