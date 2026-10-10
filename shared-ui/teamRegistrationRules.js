export const registrationLimits = [
  { key: 'min_players', label: '大名单最低人数', unit: '人' },
  { key: 'max_players', label: '大名单最高人数', unit: '人' },
  { key: 'max_colleges', label: '最多学院数', unit: '个' },
  { key: 'max_foreign_players', label: '最多外援人数', unit: '人' },
  { key: 'max_sports_training_players', label: '最多运训人数', unit: '人', tag: 'sports_training' },
  { key: 'max_football_specialty_players', label: '最多足球特长生人数', unit: '人', tag: 'football_specialty' }
]
export const playerTags = [
  { key: 'foreign', label: '外援' },
  { key: 'sports_training', label: '运训', enabled: 'enable_sports_training' },
  { key: 'football_specialty', label: '足球特长生', enabled: 'enable_football_specialty' }
]
export const tagEnabled = (config, tag) => tag === 'foreign' || (tag === 'sports_training' ? config?.enable_sports_training == null || Boolean(config.enable_sports_training) : Boolean(config?.enable_football_specialty))
export const visibleLimits = config => registrationLimits.filter(f => !f.tag || tagEnabled(config, f.tag))
export const tagLabel = key => playerTags.find(t => t.key === key)?.label || key
