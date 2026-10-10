// Frozen catalogue confirmed in the 2026-09-28 production account workbook: future catalogue changes require a new migration.
// Only account college fields change; registration/roster/report snapshots stay intact.
const groups = [
  [
    "经济与管理学院",
    "经管学院",
    "经管",
    "经济管理学院"
  ],
  [
    "建筑与城市规划学院",
    "建筑学院",
    "建院",
    "建筑与城规学院"
  ],
  [
    "土木工程学院",
    "土木学院",
    "土木工程",
    "土木"
  ],
  [
    "机械工程与机器人学院",
    "机械学院",
    "机械工程学院"
  ],
  [
    "环境科学与工程学院",
    "环境学院",
    "环境科学与工程"
  ],
  [
    "生命科学与技术学院",
    "生命学院",
    "生科院",
    "生命科学与技术"
  ],
  [
    "材料科学与工程学院",
    "材料学院",
    "材料科学与工程"
  ],
  [
    "电子与信息工程学院",
    "电信学院",
    "电子信息工程学院",
    "电子与信息工程"
  ],
  [
    "外国语学院",
    "外语学院",
    "外院"
  ],
  [
    "医学院"
  ],
  [
    "口腔医学院",
    "口腔学院"
  ],
  [
    "汽车与能源学院",
    "汽车学院"
  ],
  [
    "海洋与地球科学学院",
    "海洋学院",
    "海洋与地球科学"
  ],
  [
    "交通学院（铁道与城市轨道交通研究院）",
    "交通学院",
    "交通运输学院",
    "交通运输工程学院",
    "铁道与城市轨道交通研究院",
    "轨交院",
    "交通"
  ],
  [
    "医学与生命科学部"
  ],
  [
    "航空航天与力学学院",
    "航力学院",
    "航空航天与力学"
  ],
  [
    "人文学院"
  ],
  [
    "马克思主义学院",
    "马院",
    "马克思主义"
  ],
  [
    "法学院"
  ],
  [
    "政治与国际关系学院",
    "政治与国际关系",
    "政国学院"
  ],
  [
    "设计创意学院",
    "设创学院",
    "设创",
    "设计与创意学院"
  ],
  [
    "测绘与地理信息学院",
    "测绘学院",
    "测绘与地理信息"
  ],
  [
    "物理科学与工程学院",
    "物理学院",
    "物理科学与工程"
  ],
  [
    "艺术与传媒学院",
    "艺传学院",
    "艺传",
    "艺术传媒学院"
  ],
  [
    "化学科学与工程学院",
    "化学学院",
    "化学科学与工程"
  ],
  [
    "数学科学学院",
    "数学学院",
    "数院"
  ],
  [
    "上海国际知识产权学院",
    "国际知识产权学院",
    "知识产权学院"
  ],
  [
    "体育部（国际足球学院）",
    "体育部",
    "体育教学部",
    "国际足球学院",
    "体育部国际足球学院",
    "国际足球学校"
  ],
  [
    "新生院"
  ],
  [
    "国豪书院（未来技术学院）",
    "国豪书院",
    "未来技术学院"
  ],
  [
    "国家卓越工程师学院（国际工程师学院）",
    "国家卓越工程师学院",
    "国际工程师学院"
  ],
  [
    "计算机科学与技术学院（软件学院）",
    "计算机科学与技术学院",
    "计算机学院",
    "软件学院",
    "计算机",
    "软件"
  ],
  [
    "启迪书院"
  ],
  [
    "中德学部"
  ],
  [
    "中德学院"
  ],
  [
    "中德工程学院"
  ],
  [
    "职业技术教育学院",
    "职教学院"
  ],
  [
    "出国培训学院、留德预备部",
    "出国培训学院",
    "留德预备部"
  ],
  [
    "国际文化交流学院"
  ],
  [
    "联合国环境规划署-同济大学环境与可持续发展学院",
    "联合国环境署-同济大学环境与可持续发展学院",
    "环境与可持续发展学院"
  ],
  [
    "中意工程创新学院"
  ],
  [
    "中法工程和管理学院"
  ],
  [
    "中意学院"
  ],
  [
    "中芬中心"
  ],
  [
    "中西学院"
  ],
  [
    "工程智能研究院"
  ],
  [
    "继续教育学院、网络教育学院",
    "继续教育学院",
    "网络教育学院"
  ],
  [
    "女子学院"
  ],
  [
    "创新创业学院"
  ],
  [
    "上海自主智能无人系统科学中心",
    "同济大学自主智能无人系统科学中心",
    "上海自主智能无人科学中心"
  ]
];
function key(value) { return (typeof value === 'string' ? value.trim() : '').replace(/^同济大学\s*/, '').replace(/\s/g, '').replace(/\(/g, '（').replace(/\)/g, '）'); }
const matches = new Map(groups.flatMap(([name, ...aliases]) => [name, ...aliases].map(value => [key(value), name])));
module.exports = {
  version: '0027', name: 'legacy_account_college_standardization',
  description: '本次上线旧球员与裁判学院一次性直接标准化；后续球员自行修改仍需截图审核',
  rollback: '迁移前备份。account_college_standardizations 保存原值；回退须逐条核对账号是否在迁移后自行修改，禁止无条件覆盖。',
  async up(c) {
    await c.query(`CREATE TABLE IF NOT EXISTS account_college_standardizations (
      account_role ENUM('player','referee') NOT NULL,
      account_id INT NOT NULL,
      original_college VARCHAR(100) NULL,
      matched_college VARCHAR(100) NULL,
      match_method VARCHAR(20) NOT NULL,
      changed TINYINT NOT NULL DEFAULT 0,
      account_revision_before INT UNSIGNED NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY(account_role,account_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.beginTransaction();
    try {
      for (const role of ['player','referee']) {
        const [rows] = await c.query(role === 'player'
          ? 'SELECT id,college,revision FROM player_accounts ORDER BY id FOR UPDATE'
          : 'SELECT r.id,p.college FROM referee r LEFT JOIN referee_profile p ON p.referee_id=r.id ORDER BY r.id FOR UPDATE');
        for (const row of rows) {
          const [[done]] = await c.execute('SELECT account_id FROM account_college_standardizations WHERE account_role=? AND account_id=?',[role,row.id]);
          if (done) continue;
          const college = matches.get(key(row.college)) || null;
          const changed = college !== null && college !== row.college;
          const method = !college ? 'unmatched' : row.college === college ? 'exact' : key(row.college) === key(college) ? 'normalized' : 'alias';
          await c.execute('INSERT INTO account_college_standardizations (account_role,account_id,original_college,matched_college,match_method,changed,account_revision_before) VALUES (?,?,?,?,?,?,?)',
            [role,row.id,row.college ?? null,college,method,changed?1:0,row.revision ?? null]);
          if (changed) {
            if (role === 'player') {
              await c.execute('UPDATE player_accounts SET college=?,revision=revision+1 WHERE id=?',[college,row.id]);
            } else {
              await c.execute('UPDATE referee_profile SET college=? WHERE referee_id=?',[college,row.id]);
            }
          }
        }
      }
      await c.commit();
    } catch (error) { await c.rollback(); throw error; }
  }
};
