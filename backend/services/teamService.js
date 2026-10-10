const pool = require('../db');
const { resolveSeasonScope } = require('../utils/seasonScope');


const MAX_ROSTER_PLAYERS = 31;

function normalizeString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized === '' ? null : normalized;
}

function normalizeRosterEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return {
        jersey_number: '',
        player_name: '',
        remark: null
      };
    }

    return {
      jersey_number: normalizeString(
        entry.jersey_number ?? entry.jerseyNo ?? entry.number ?? entry.no
      ),
      player_name: normalizeString(
        entry.player_name ?? entry.playerName ?? entry.name
      ),
      remark: normalizeNullableString(entry.remark ?? entry.note ?? entry.notes)
    };
  });
}

class TeamService {
  async getCurrentSeason(connection) {
    const [rows] = await connection.execute(
      `
        SELECT
          id,
          season_code,
          season_name,
          start_date,
          end_date,
          is_active
        FROM seasons
        WHERE is_active = 1
        LIMIT 1
      `
    );

    if (rows.length === 0) {
      throw new Error('请先启用赛季');
    }

    return rows[0];
  }

  async getTeamBaseRow(connection, teamId) {
    const id = Number(teamId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('无效的队伍ID');
    }

    const [rows] = await connection.execute(
      `
        SELECT
          t.id,
          t.season_id,
          t.team_name,
          t.league_type,
          t.description, t.registration_revoked, t.revision, t.manager_player_id, t.captain_player_id, t.shirt_color, t.shorts_color, t.socks_color,
          t.created_at,
          t.updated_at,
          s.season_code,
          s.season_name,
          s.start_date,
          s.end_date,
          s.is_active
        FROM team t
        INNER JOIN seasons s ON s.id = t.season_id
        WHERE t.id = ?
        LIMIT 1
      `,
      [id]
    );

    if (rows.length === 0) {
      throw new Error('队伍不存在');
    }

    return rows[0];
  }

  async getLatestRosterBatch(connection, teamId) {
    return require('./playerRosterService').effectiveBatch(teamId,undefined,connection);
  }

  validateLeagueType(leagueType) {
    return require('../utils/competitionRules').competitionName(leagueType);
  }

  validateRosterEntries(entries) {
    const normalizedEntries = normalizeRosterEntries(entries);

    if (normalizedEntries.length === 0) {
      throw new Error('名单至少需要包含一名球员');
    }

    if (normalizedEntries.length > MAX_ROSTER_PLAYERS) {
      throw new Error(`单份名单最多包含 ${MAX_ROSTER_PLAYERS} 名球员`);
    }

    const duplicateCheck = new Set();
    normalizedEntries.forEach((entry, index) => {
      if (!entry.jersey_number || !entry.player_name) {
        throw new Error(`第 ${index + 1} 条名单数据缺少号码或姓名`);
      }

      const duplicateKey = entry.jersey_number;
      if (duplicateCheck.has(duplicateKey)) {
        throw new Error(`名单中存在重复号码：${entry.jersey_number}`);
      }
      duplicateCheck.add(duplicateKey);
    });

    return normalizedEntries;
  }

  buildTeamListSql(includeLeagueFilter) {
    return `
      SELECT
        t.id,
        t.season_id,
        s.season_code,
        s.season_name,
        t.team_name,
        t.league_type,
        t.description,
        t.created_at,
        t.updated_at,
        rb.id AS current_roster_batch_id,
        rb.version_no AS current_roster_version,
        rb.uploaded_at AS current_roster_uploaded_at,
        COALESCE(pc.player_count, 0) AS current_roster_player_count
      FROM team t
      INNER JOIN seasons s ON s.id = t.season_id
      LEFT JOIN team_roster_batches rb ON rb.id = (
        SELECT rb2.id
        FROM team_roster_batches rb2
        WHERE rb2.team_id = t.id AND (rb2.effective_from IS NULL OR rb2.effective_from <= '${require('../utils/competitionTime').businessDate()}')
        ORDER BY rb2.effective_from DESC, rb2.version_no DESC, rb2.id DESC
        LIMIT 1
      )
      LEFT JOIN (
        SELECT roster_batch_id, COUNT(*) AS player_count
        FROM team_player
        GROUP BY roster_batch_id
      ) pc ON pc.roster_batch_id = rb.id
      WHERE t.registration_revoked = 0 AND t.season_id = ?
      ${includeLeagueFilter ? 'AND t.league_type = ?' : ''}
      ORDER BY t.league_type ASC, t.team_name ASC, t.id ASC
    `;
  }

  // 获取当前启用赛季下的所有队伍（可选按 league_type 过滤）
  async getAllTeams(leagueType = null) {
    const connection = await pool.getConnection();
    try {
      const currentSeason = await this.getCurrentSeason(connection);
      const params = [currentSeason.id];
      let sql = this.buildTeamListSql(false);

      if (leagueType) {
        const normalizedLeagueType = this.validateLeagueType(leagueType);
        sql = this.buildTeamListSql(true);
        params.push(normalizedLeagueType);
      }

      const [teams] = await connection.execute(sql, params);
      return teams;
    } finally {
      connection.release();
    }
  }

  // 历史赛程编辑使用该赛程所属赛季的队伍，不改变当前启用赛季。
  async getTeamsForSeason(seasonId) {
    const connection = await pool.getConnection();
    try {
      const context = await resolveSeasonScope(connection, seasonId);
      const [teams] = await connection.execute(this.buildTeamListSql(false), [context.selected_season.id]);
      return { teams, selected_season: context.selected_season };
    } finally {
      connection.release();
    }
  }

  // 按赛事类型获取当前启用赛季下的队伍
  async getTeamsByLeague(leagueType) {
    return this.getAllTeams(leagueType);
  }

  // 获取单个队伍详情（附当前名单批次摘要）
  async getTeamById(teamId) {
    const connection = await pool.getConnection();
    try {
      const team = await this.getTeamBaseRow(connection, teamId);
      const latestBatch = await this.getLatestRosterBatch(connection, team.id);

      return {
        ...team,
        current_roster_batch_id: latestBatch ? latestBatch.id : null,
        current_roster_version: latestBatch ? latestBatch.version_no : null,
        current_roster_uploaded_at: latestBatch ? latestBatch.uploaded_at : null
      };
    } finally {
      connection.release();
    }
  }

  async createRosterBatch(connection, teamId, seasonId, rosterEntries) {
    const [[online]] = await connection.execute("SELECT id FROM team_roster_batches WHERE team_id=? AND source_type<>'legacy' LIMIT 1", [teamId]);
    if (online) throw Object.assign(new Error('正式球队请通过名单变更或新版 Excel 导入审核'), { isBusinessError: true });
    const normalizedEntries = this.validateRosterEntries(rosterEntries);

    const [versionRows] = await connection.execute(
      `
        SELECT COALESCE(MAX(version_no), 0) AS max_version
        FROM team_roster_batches
        WHERE team_id = ? AND season_id = ?
      `,
      [teamId, seasonId]
    );

    const nextVersion = Number(versionRows[0].max_version) + 1;

    const [batchResult] = await connection.execute(
      `
        INSERT INTO team_roster_batches (
          team_id,
          season_id,
          version_no
        ) VALUES (?, ?, ?)
      `,
      [teamId, seasonId, nextVersion]
    );

    if (normalizedEntries.length > 0) {
      const values = normalizedEntries.map((entry) => [
        batchResult.insertId,
        teamId,
        entry.jersey_number,
        entry.player_name,
        entry.remark
      ]);

      await connection.query(
        `
          INSERT INTO team_player (
            roster_batch_id,
            team_id,
            jersey_number,
            player_name,
            remark
          ) VALUES ?
        `,
        [values]
      );
    }

    return {
      id: batchResult.insertId,
      team_id: teamId,
      season_id: seasonId,
      version_no: nextVersion,
      player_count: normalizedEntries.length
    };
  }

  // 添加队伍（默认使用当前启用赛季；可选同时写入首个名单批次）
  async addTeam(teamData) {
    const team_name = normalizeString(teamData.team_name);
    const league_type = this.validateLeagueType(teamData.league_type);
    const description = normalizeNullableString(teamData.description);
    const rosterEntries = Array.isArray(teamData.roster_entries)
      ? teamData.roster_entries
      : (Array.isArray(teamData.players) ? teamData.players : []);

    if (!team_name) {
      throw new Error('队伍名称为必填项');
    }

    if (rosterEntries.length === 0) {
      throw new Error('新建队伍时必须同时提供球员名单');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const currentSeason = await this.getCurrentSeason(connection);
      await require('./competitionService').requireCompetition(connection,currentSeason.id,league_type);

      const [existing] = await connection.execute(
        `
          SELECT id
          FROM team
          WHERE season_id = ? AND team_name = ? AND league_type = ?
          LIMIT 1
        `,
        [currentSeason.id, team_name, league_type]
      );

      if (existing.length > 0) {
        throw new Error('当前赛季该赛事中队伍名称已存在');
      }

      const [result] = await connection.execute(
        `
          INSERT INTO team (
            season_id,
            team_name,
            league_type,
            description
          ) VALUES (?, ?, ?, ?)
        `,
        [currentSeason.id, team_name, league_type, description]
      );

      const rosterBatch = await this.createRosterBatch(
        connection,
        result.insertId,
        currentSeason.id,
        rosterEntries
      );

      const team = await this.getTeamBaseRow(connection, result.insertId);

      await connection.commit();

      return {
        ...team,
        current_roster_batch_id: rosterBatch ? rosterBatch.id : null,
        current_roster_version: rosterBatch ? rosterBatch.version_no : null,
        current_roster_player_count: rosterBatch ? rosterBatch.player_count : 0
      };
    } catch (error) {
      await connection.rollback();

      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('当前赛季该赛事中队伍名称已存在');
      }

      throw error;
    } finally {
      connection.release();
    }
  }

  // 为已有队伍新增一个名单批次（2.2 阶段供 service 层和后续路由复用）
  async addRosterBatch(teamId, rosterEntries) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const team = await this.getTeamBaseRow(connection, teamId);
      const currentSeason = await this.getCurrentSeason(connection);
      if (Number(team.season_id) !== Number(currentSeason.id)) {
        throw new Error('只能为当前启用赛季的队伍上传名单');
      }

      const batch = await this.createRosterBatch(connection, team.id, team.season_id, rosterEntries);

      await connection.commit();

      return {
        team_id: team.id,
        season_id: team.season_id,
        team_name: team.team_name,
        league_type: team.league_type,
        batch_id: batch.id,
        version_no: batch.version_no,
        player_count: batch.player_count
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // 获取当前名单（即最新批次）
  async getCurrentRoster(teamId) {
    const connection = await pool.getConnection();
    try {
      const team = await this.getTeamBaseRow(connection, teamId);
      const latestBatch = await this.getLatestRosterBatch(connection, team.id);

      if (!latestBatch) {
        return {
          team,
          roster_batch: null,
          players: []
        };
      }

      const [players] = await connection.execute(
        `
          SELECT
            id,
            roster_batch_id,
            team_id,
            jersey_number,
            COALESCE((SELECT a.name FROM player_accounts a JOIN seasons s ON s.id=? AND s.is_active=1 WHERE a.id=team_player.player_account_id), player_name) AS player_name,
            COALESCE((SELECT a.college FROM player_accounts a JOIN seasons s ON s.id=? AND s.is_active=1 WHERE a.id=team_player.player_account_id), JSON_UNQUOTE(JSON_EXTRACT(profile_snapshot,'$.college'))) AS college,
            player_account_id, is_goalkeeper,is_foreign,is_sports_training,is_football_specialty,
            CASE WHEN player_account_id IS NULL THEN is_captain ELSE player_account_id=(SELECT captain_player_id FROM team WHERE id=team_player.team_id) END AS is_captain,
            remark,
            created_at
          FROM team_player
          WHERE roster_batch_id = ? AND team_id = ?
          ORDER BY
            CASE
              WHEN jersey_number REGEXP '^[0-9]+$' THEN CAST(jersey_number AS UNSIGNED)
              ELSE 99999
            END ASC,
            jersey_number ASC,
            id ASC
        `,
        [team.season_id, team.season_id, latestBatch.id, team.id]
      );

      return {
        team,
        roster_batch: latestBatch,
        players: await require('../utils/teamTags').projectRoster(connection,team,players)
      };
    } finally {
      connection.release();
    }
  }

  // 获取历史名单批次
  async getRosterBatches(teamId) {
    const connection = await pool.getConnection();
    try {
      const team = await this.getTeamBaseRow(connection, teamId);

      const [batches] = await connection.execute(
        `
          SELECT
            rb.id,
            rb.team_id,
            rb.season_id,
            rb.version_no, rb.effective_from, rb.source_type, rb.approved_at, rb.metadata_snapshot,
            rb.uploaded_at,
            rb.created_at,
            COALESCE(pc.player_count, 0) AS player_count
          FROM team_roster_batches rb
          LEFT JOIN (
            SELECT roster_batch_id, COUNT(*) AS player_count
            FROM team_player
            GROUP BY roster_batch_id
          ) pc ON pc.roster_batch_id = rb.id
          WHERE rb.team_id = ?
          ORDER BY rb.version_no DESC, rb.id DESC
        `,
        [team.id]
      );

      return {
        team,
        batches
      };
    } finally {
      connection.release();
    }
  }

  // 获取某个历史批次的球员明细
  async getRosterBatchPlayers(teamId, batchId) {
    const connection = await pool.getConnection();
    try {
      const team = await this.getTeamBaseRow(connection, teamId);
      const batchIdNumber = Number(batchId);
      if (!Number.isInteger(batchIdNumber) || batchIdNumber <= 0) {
        throw new Error('无效的名单批次ID');
      }

      const [batchRows] = await connection.execute(
        `
          SELECT
            id,
            team_id,
            season_id,
            version_no, effective_from, source_type, approved_at, metadata_snapshot,
            uploaded_at,
            created_at
          FROM team_roster_batches
          WHERE id = ? AND team_id = ?
          LIMIT 1
        `,
        [batchIdNumber, team.id]
      );

      if (batchRows.length === 0) {
        throw new Error('名单批次不存在');
      }

      const [players] = await connection.execute(
        `
          SELECT
            id,
            roster_batch_id,
            team_id,
            jersey_number,
            player_name, player_account_id, is_captain, is_goalkeeper, is_foreign, is_sports_training, is_football_specialty,
            remark,
            created_at
          FROM team_player
          WHERE roster_batch_id = ? AND team_id = ?
          ORDER BY
            CASE
              WHEN jersey_number REGEXP '^[0-9]+$' THEN CAST(jersey_number AS UNSIGNED)
              ELSE 99999
            END ASC,
            jersey_number ASC,
            id ASC
        `,
        [batchIdNumber, team.id]
      );

      return {
        team,
        roster_batch: batchRows[0],
        players: await require('../utils/teamTags').projectRoster(connection,team,players)
      };
    } finally {
      connection.release();
    }
  }

  // 修改队伍基本信息（仍限定在当前这条 team 记录所属赛季内做唯一性校验）
  async updateTeam(teamId, teamData) {
    const connection = await pool.getConnection();
    try {
      const team = await this.getTeamBaseRow(connection, teamId);
      const [[online]] = await connection.execute("SELECT id FROM team_roster_batches WHERE team_id=? AND source_type<>'legacy' LIMIT 1", [team.id]);
      if (online) throw Object.assign(new Error('正式球队资料修改请使用名单变更或新版 Excel 导入审核'), { isBusinessError: true });

      const nextTeamName = normalizeString(teamData.team_name) || team.team_name;
      const nextLeagueType = teamData.league_type
        ? this.validateLeagueType(teamData.league_type)
        : team.league_type;
      await require('./competitionService').requireCompetition(connection,team.season_id,nextLeagueType);
      const nextDescription = teamData.description === undefined
        ? team.description
        : normalizeNullableString(teamData.description);

      const [duplicateRows] = await connection.execute(
        `
          SELECT id
          FROM team
          WHERE season_id = ? AND team_name = ? AND league_type = ? AND id != ?
          LIMIT 1
        `,
        [team.season_id, nextTeamName, nextLeagueType, team.id]
      );

      if (duplicateRows.length > 0) {
        throw new Error('当前赛季该赛事中队伍名称已存在');
      }

      await connection.execute(
        `
          UPDATE team
          SET team_name = ?, league_type = ?, description = ?
          WHERE id = ?
        `,
        [nextTeamName, nextLeagueType, nextDescription, team.id]
      );

      return await this.getTeamById(team.id);
    } finally {
      connection.release();
    }
  }

  // 删除队伍
  async deleteTeam(teamId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await this.getTeamBaseRow(connection, teamId);

      const [result] = await connection.execute(
        'DELETE FROM team WHERE id = ?',
        [teamId]
      );

      if (result.affectedRows === 0) {
        throw new Error('队伍不存在');
      }

      await connection.commit();
      return { success: true, message: '队伍删除成功' };
    } catch (error) {
      await connection.rollback();

      if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        throw new Error('该队伍已被名单批次、球员或赛程等历史数据引用，无法删除');
      }

      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = new TeamService();
