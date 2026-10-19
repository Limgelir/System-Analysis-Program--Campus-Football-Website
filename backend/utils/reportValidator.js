const { createBusinessError } = require('./scheduleValidator');

const GOAL_TYPES = new Set(['normal', 'penalty', 'own_goal']);
const CARD_TYPES = new Set(['yellow', 'red', 'second_yellow_red']);
const MAX_MATCH_SCORE = 30;
const FORFEIT_SIDES = new Set(['none', 'home', 'away', 'both']);

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function toNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeLimitedText(value, fieldLabel, maxLength) {
  const normalized = toNullableString(value);
  if (normalized && normalized.length > maxLength) {
    throw createBusinessError(`${fieldLabel}不能超过 ${maxLength} 字`, {
      code: 'REPORT_TEXT_TOO_LONG'
    });
  }
  return normalized;
}

function toNullableInt(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  if (!/^-?\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function ensureNonNegativeInteger(value, fieldLabel, options = {}) {
  const allowNull = options.allowNull === true;
  const defaultValue = hasOwn(options, 'defaultValue') ? options.defaultValue : undefined;
  const maximum = hasOwn(options, 'max') ? options.max : null;

  if (value === null || value === undefined || value === '') {
    if (allowNull) {
      return null;
    }
    if (defaultValue !== undefined) {
      return ensureNonNegativeInteger(defaultValue, fieldLabel, { allowNull: false });
    }
    throw createBusinessError(`${fieldLabel}不能为空`, {
      code: 'REPORT_FIELD_REQUIRED'
    });
  }

  const parsed = toNullableInt(value);
  if (parsed === null || parsed < 0) {
    throw createBusinessError(`${fieldLabel}必须是大于等于 0 的整数`, {
      code: 'REPORT_FIELD_INVALID'
    });
  }

  if (maximum !== null && parsed > maximum) {
    throw createBusinessError(`${fieldLabel}不能超过 ${maximum}`, {
      code: 'REPORT_SCORE_OUT_OF_RANGE'
    });
  }

  return parsed;
}

function buildMinuteLabel(minuteBase, minuteExtra) {
  return minuteExtra > 0 ? `${minuteBase}+${minuteExtra}` : String(minuteBase);
}

function normalizeMinuteFields(entry, contextLabel) {
  const minuteBase = ensureNonNegativeInteger(entry?.minute_base, `${contextLabel}时间（基础分钟）`);
  const minuteExtra = ensureNonNegativeInteger(entry?.minute_extra, `${contextLabel}时间（补时分钟）`, {
    defaultValue: 0
  });

  return {
    minute_base: minuteBase,
    minute_extra: minuteExtra,
    minute_label: buildMinuteLabel(minuteBase, minuteExtra)
  };
}

function normalizeScoreFields(body = {}, existingState = {}) {
  return {
    home_score: hasOwn(body, 'home_score')
      ? ensureNonNegativeInteger(body.home_score, '主队得分', { defaultValue: 0, max: MAX_MATCH_SCORE })
      : ensureNonNegativeInteger(existingState.home_score, '主队得分', { defaultValue: 0, max: MAX_MATCH_SCORE }),
    away_score: hasOwn(body, 'away_score')
      ? ensureNonNegativeInteger(body.away_score, '客队得分', { defaultValue: 0, max: MAX_MATCH_SCORE })
      : ensureNonNegativeInteger(existingState.away_score, '客队得分', { defaultValue: 0, max: MAX_MATCH_SCORE }),
    home_penalty_score: hasOwn(body, 'home_penalty_score')
      ? ensureNonNegativeInteger(body.home_penalty_score, '主队点球大战得分', { defaultValue: 0, max: MAX_MATCH_SCORE })
      : ensureNonNegativeInteger(existingState.home_penalty_score, '主队点球大战得分', { defaultValue: 0, max: MAX_MATCH_SCORE }),
    away_penalty_score: hasOwn(body, 'away_penalty_score')
      ? ensureNonNegativeInteger(body.away_penalty_score, '客队点球大战得分', { defaultValue: 0, max: MAX_MATCH_SCORE })
      : ensureNonNegativeInteger(existingState.away_penalty_score, '客队点球大战得分', { defaultValue: 0, max: MAX_MATCH_SCORE })
  };
}

function normalizeCardEntry(card, index) {
  const contextLabel = `第 ${index + 1} 条红黄牌记录`;
  const teamId = ensureNonNegativeInteger(card?.team_id, `${contextLabel}的队伍`, { defaultValue: null });
  const teamPlayerId = ensureNonNegativeInteger(card?.team_player_id, `${contextLabel}的球员`, { defaultValue: null });
  const cardType = toNullableString(card?.card_type);

  if (!CARD_TYPES.has(cardType)) {
    throw createBusinessError(`${contextLabel}的牌类型不合法，须为黄牌、直接红牌或两黄变红`, {
      code: 'CARD_TYPE_INVALID'
    });
  }

  const minute = normalizeMinuteFields(card, contextLabel);

  return {
    team_id: teamId,
    team_player_id: teamPlayerId,
    card_type: cardType,
    ...minute,
    description: normalizeLimitedText(card?.description, `${contextLabel}的原因说明`, 255)
  };
}

function normalizeGoalEntry(goal, index) {
  const contextLabel = `第 ${index + 1} 条进球说明`;
  const playerTeamId = ensureNonNegativeInteger(goal?.player_team_id, `${contextLabel}的进球队员所属队伍`, { defaultValue: null });
  const creditedTeamId = ensureNonNegativeInteger(goal?.credited_team_id, `${contextLabel}的记分归属队伍`, { defaultValue: null });
  const teamPlayerId = ensureNonNegativeInteger(goal?.team_player_id, `${contextLabel}的球员`, { defaultValue: null });
  const goalType = toNullableString(goal?.goal_type) || 'normal';

  if (!GOAL_TYPES.has(goalType)) {
    throw createBusinessError(`${contextLabel}的进球类型不合法，只能为 normal、penalty 或 own_goal`, {
      code: 'GOAL_TYPE_INVALID'
    });
  }

  const minute = normalizeMinuteFields(goal, contextLabel);

  return {
    player_team_id: playerTeamId,
    credited_team_id: creditedTeamId,
    team_player_id: teamPlayerId,
    goal_type: goalType,
    ...minute,
    description: normalizeLimitedText(goal?.description, `${contextLabel}的进球说明`, 255)
  };
}

function normalizeMainReportState(body = {}, existingState = {}) {
  const forfeitSide = hasOwn(body, 'forfeit_side') ? body.forfeit_side : (existingState.forfeit_side ?? 'none');
  if (!FORFEIT_SIDES.has(forfeitSide)) {
    throw createBusinessError('弃权方必须为正常比赛、主队、客队或双方', { code: 'FORFEIT_SIDE_INVALID' });
  }
  // 弃权比分必须明确填写，不能把空值默认为 0。
  if (forfeitSide !== 'none') {
    for (const [field, label] of [['home_score', '主队弃权判定比分'], ['away_score', '客队弃权判定比分']]) {
      ensureNonNegativeInteger(hasOwn(body, field) ? body[field] : existingState[field], label, { max: MAX_MATCH_SCORE });
    }
  }
  const scores = normalizeScoreFields(body, existingState);

  let cards = Array.isArray(existingState.cards) ? existingState.cards.map((card, index) => normalizeCardEntry(card, index)) : [];
  if (hasOwn(body, 'cards')) {
    if (!Array.isArray(body.cards)) {
      throw createBusinessError('cards 必须是数组', {
        code: 'CARDS_PAYLOAD_INVALID'
      });
    }
    cards = body.cards.map((card, index) => normalizeCardEntry(card, index));
  }

  let goals = Array.isArray(existingState.goals) ? existingState.goals.map((goal, index) => normalizeGoalEntry(goal, index)) : [];
  if (hasOwn(body, 'goals')) {
    if (!Array.isArray(body.goals)) {
      throw createBusinessError('goals 必须是数组', {
        code: 'GOALS_PAYLOAD_INVALID'
      });
    }
    goals = body.goals.map((goal, index) => normalizeGoalEntry(goal, index));
  }

  return {
    ...scores,
    forfeit_side: forfeitSide,
    cards,
    goals,
    stats: Array.isArray(body.stats) ? body.stats : (Array.isArray(existingState.stats) ? existingState.stats : [])
  };
}

function validateReportResult(state, teamContext) {
  if (state.forfeit_side && state.forfeit_side !== 'none') {
    if (state.goals.length) throw createBusinessError('弃权比赛不能填写进球记录，请先清空进球说明', { code: 'FORFEIT_GOALS_NOT_ALLOWED' });
    if (state.home_penalty_score !== 0 || state.away_penalty_score !== 0) {
      throw createBusinessError('弃权比赛不能填写点球大战比分，请先清零', { code: 'FORFEIT_PENALTIES_NOT_ALLOWED' });
    }
    return;
  }
  validateGoalCountAgainstScore(state.goals, teamContext, state.home_score, state.away_score);
}

function buildTeamContext(schedule = {}) {
  const homeTeamId = ensureNonNegativeInteger(schedule.team_a_id, '主队 ID', { defaultValue: null });
  const awayTeamId = ensureNonNegativeInteger(schedule.team_b_id, '客队 ID', { defaultValue: null });

  return {
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    allowed_team_ids: new Set([homeTeamId, awayTeamId]),
    labels: new Map([
      [homeTeamId, '主队'],
      [awayTeamId, '客队']
    ])
  };
}

function validateCardTeams(cards, teamContext) {
  const counts=new Map();
  for(const card of cards){
    const key=card.team_id+':'+card.team_player_id;
    if(!counts.has(key))counts.set(key,{yellow:0,red:0,second_yellow_red:0});
    counts.get(key)[card.card_type]++;
  }
  for(const count of counts.values()){
    if(count.red+count.second_yellow_red>1||count.yellow>2)throw createBusinessError('同一球员每场最多一次罚下、两张黄牌，请检查重复记录');
    if(count.yellow===2&&!count.second_yellow_red)throw createBusinessError('同一球员两次黄牌请明确记录“两黄变红”');
  }

  cards.forEach((card, index) => {
    if (!teamContext.allowed_team_ids.has(card.team_id)) {
      throw createBusinessError(`第 ${index + 1} 条红黄牌记录的队伍必须是本场主队或客队`, {
        code: 'CARD_TEAM_INVALID'
      });
    }
  });
}

function validateGoalTeams(goals, teamContext) {
  goals.forEach((goal, index) => {
    if (!teamContext.allowed_team_ids.has(goal.player_team_id)) {
      throw createBusinessError(`第 ${index + 1} 条进球说明的进球队员所属队伍必须是本场主队或客队`, {
        code: 'GOAL_PLAYER_TEAM_INVALID'
      });
    }

    if (!teamContext.allowed_team_ids.has(goal.credited_team_id)) {
      throw createBusinessError(`第 ${index + 1} 条进球说明的记分归属队伍必须是本场主队或客队`, {
        code: 'GOAL_CREDITED_TEAM_INVALID'
      });
    }

    if (goal.goal_type === 'own_goal') {
      if (goal.player_team_id === goal.credited_team_id) {
        throw createBusinessError(`第 ${index + 1} 条进球说明标记为乌龙球时，进球队员所属队伍与记分归属队伍必须不同`, {
          code: 'OWN_GOAL_TEAM_INVALID'
        });
      }
      return;
    }

    if (goal.player_team_id !== goal.credited_team_id) {
      throw createBusinessError(`第 ${index + 1} 条进球说明为普通进球/点球时，进球队员所属队伍必须与记分归属队伍一致`, {
        code: 'GOAL_TEAM_MISMATCH'
      });
    }
  });
}

function validateGoalCountAgainstScore(goals, teamContext, homeScore, awayScore) {
  const goalCountByTeam = new Map([
    [teamContext.home_team_id, 0],
    [teamContext.away_team_id, 0]
  ]);

  goals.forEach(goal => {
    goalCountByTeam.set(goal.credited_team_id, (goalCountByTeam.get(goal.credited_team_id) || 0) + 1);
  });

  const homeGoalCount = goalCountByTeam.get(teamContext.home_team_id) || 0;
  const awayGoalCount = goalCountByTeam.get(teamContext.away_team_id) || 0;

  if (homeGoalCount !== homeScore) {
    throw createBusinessError(`主队得分为 ${homeScore}，但主队进球说明数量为 ${homeGoalCount}，两者必须一致`, {
      code: 'HOME_SCORE_GOAL_MISMATCH'
    });
  }

  if (awayGoalCount !== awayScore) {
    throw createBusinessError(`客队得分为 ${awayScore}，但客队进球说明数量为 ${awayGoalCount}，两者必须一致`, {
      code: 'AWAY_SCORE_GOAL_MISMATCH'
    });
  }
}

function validateGoalRecordLimit(goals, teamContext) {
  const goalCountByTeam = new Map([
    [teamContext.home_team_id, 0],
    [teamContext.away_team_id, 0]
  ]);

  goals.forEach(goal => {
    const nextCount = (goalCountByTeam.get(goal.credited_team_id) || 0) + 1;
    if (nextCount > MAX_MATCH_SCORE) {
      const teamLabel = teamContext.labels.get(goal.credited_team_id) || '单队';
      throw createBusinessError(`${teamLabel}进球说明不能超过 ${MAX_MATCH_SCORE} 条`, {
        code: 'REPORT_GOAL_LIMIT_EXCEEDED'
      });
    }
    goalCountByTeam.set(goal.credited_team_id, nextCount);
  });
}

function collectSelectedPlayerIds(cards = [], goals = []) {
  const ids = new Set();

  cards.forEach(card => {
    if (card.team_player_id) ids.add(card.team_player_id);
  });

  goals.forEach(goal => {
    if (goal.team_player_id) ids.add(goal.team_player_id);
  });

  return ids;
}

function validateSelectedPlayers(options = {}) {
  const {
    cards = [],
    goals = [],
    teamContext,
    playerLookup = new Map(),
    latestRosterBatchByTeam = new Map(),
    grandfatheredPlayerIds = new Set()
  } = options;

  const ensurePlayerIsAvailable = (playerInfo, expectedTeamId, contextLabel) => {
    if (!playerInfo) {
      throw createBusinessError(`${contextLabel}所选球员不存在`, {
        code: 'TEAM_PLAYER_NOT_FOUND'
      });
    }

    if (playerInfo.team_id !== expectedTeamId) {
      throw createBusinessError(`${contextLabel}所选球员不属于所选队伍`, {
        code: 'TEAM_PLAYER_TEAM_MISMATCH'
      });
    }

    const latestBatchId = latestRosterBatchByTeam.get(expectedTeamId) || null;
    const isGrandfathered = grandfatheredPlayerIds.has(playerInfo.id);
    const isCurrentRosterPlayer = latestBatchId !== null && playerInfo.roster_batch_id === latestBatchId;

    if (!isCurrentRosterPlayer && !isGrandfathered) {
      const teamLabel = teamContext?.labels?.get(expectedTeamId) || '所选队伍';
      if (!latestBatchId) {
        throw createBusinessError(`${contextLabel}所属的${teamLabel}在本场比赛日期没有可用名单，无法选择球员`, {
          code: 'TEAM_ROSTER_MISSING'
        });
      }

      throw createBusinessError(`${contextLabel}所选球员不在本场比赛使用的名单中`, {
        code: 'TEAM_PLAYER_NOT_IN_CURRENT_ROSTER'
      });
    }
  };

  cards.forEach((card, index) => {
    const playerInfo = playerLookup.get(card.team_player_id) || null;
    ensurePlayerIsAvailable(playerInfo, card.team_id, `第 ${index + 1} 条红黄牌记录`);
  });

  goals.forEach((goal, index) => {
    const playerInfo = playerLookup.get(goal.team_player_id) || null;
    ensurePlayerIsAvailable(playerInfo, goal.player_team_id, `第 ${index + 1} 条进球说明`);
  });
}

module.exports = {
  GOAL_TYPES,
  CARD_TYPES,
  MAX_MATCH_SCORE,
  hasOwn,
  toNullableString,
  normalizeLimitedText,
  toNullableInt,
  ensureNonNegativeInteger,
  buildMinuteLabel,
  normalizeMinuteFields,
  normalizeMainReportState,
  buildTeamContext,
  validateCardTeams,
  validateGoalTeams,
  validateGoalRecordLimit,
  validateGoalCountAgainstScore,
  validateReportResult,
  collectSelectedPlayerIds,
  validateSelectedPlayers
};
