<template>
  <div class="detail-container" v-draft="{ value: { form, selectedFourthOfficialFile, revisionReason }, ready: !loading, resetKey: report }">
    <div class="header-bar">
      <div class="referee-header-left">
        <img class="brand-logo-sm" :src="logoUrl" alt="徽标" />
        <div>
          <div class="title">{{ pageTitle }}</div>
          <div class="subtitle">{{ pageSubtitle }}</div>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn-header" @click="goBack">{{ backButtonText }}</button>
      </div>
    </div>

    <PageState v-if="loading" kind="loading" />
    <PageState v-else-if="error" kind="error" :message="error" @retry="loadReport" />
    <div v-else class="content"><MatchDiscipline v-if="schedule?.id" :key="`${schedule.id}-${sections.main?.revision}`" :schedule-id="schedule.id" />
      <div v-if="reportNotice" class="report-notice" :class="{ 'report-notice-error': reportNoticeError }" :role="reportNoticeError ? 'alert' : 'status'">{{ reportNotice }} <button type="button" @click="reportNotice = ''" aria-label="关闭报告提示">关闭</button></div>
      <div class="card">
        <h3>赛程基础信息</h3>
        <div class="grid">
          <div><span class="label">赛程ID：</span>{{ schedule.id }}</div>
          <div><span class="label">比赛类型：</span>{{ schedule.match_type || '-' }}</div>
          <div><span class="label">比赛场地：</span>{{ venueText(schedule) }}</div>
          <div><span class="label">比赛日期：</span>{{ formatDate(schedule.match_date) }} · {{ displayMatchTime(schedule.match_time) }}</div>
          <div><span class="label">场序：</span>{{ schedule.field_order || '-' }}</div>
          <div><span class="label">对阵：</span>{{ schedule.team_a_name_snapshot }} vs {{ schedule.team_b_name_snapshot }}</div>
          <div><span class="label">查看身份：</span>{{ viewerRoleLabel }}</div>
          <div><span class="label">裁判员状态：</span>{{ mainProgressLabel }}</div>
          <div><span class="label">裁判监督状态：</span>{{ supervisorProgressLabel }}</div>
        </div>
        <div class="grid" style="margin-top:12px">
          <div v-for="official in schedule.officials" :key="official.id">{{ getRefereeNameForRole(official.role) }}</div>
        </div>
      </div>

      <div v-if="isAdminPage && viewerPermissions.can_admin_revise" class="card revision-controls">
        <h3>管理员退回 / 修订</h3>
        <p class="section-tip">裁判员区正式修订会立即公开比分和进球，首次修订也会公开；普通保存草稿不会公开。修订生成新版本并保留报告提交状态；退回后保留上次正式结果并标记修订中。两种操作都不解锁赛程或岗位，图片修订单独保存。</p>
        <div class="form-row">
          <div class="form-group"><label for="revision-target">操作对象</label>
            <select id="revision-target" v-model="revisionTarget" :disabled="Boolean(revisionSection) || writeBusy">
              <option value="main">裁判员区内容</option><option v-if="supervisorRequired" value="supervisor">裁判监督区内容</option><option value="image">第四官员记录单图片</option>
            </select>
          </div>
          <div class="form-group"><label for="revision-reason">原因（必填，最多 500 字）</label><textarea id="revision-reason" v-model="revisionReason" maxlength="500" :disabled="writeBusy" /></div>
        </div>
        <p v-if="revisionError" class="revision-error" role="alert">{{ revisionError }}</p>
        <p v-if="revisionSection" class="readonly-banner">正在修订{{ revisionTarget === 'supervisor' ? '裁判监督区' : revisionTarget === 'image' ? '第四官员记录单图片' : '裁判员区' }}：请在下方对应区域修改并保存；取消不会修改数据库。</p>
        <div v-if="revisionConfirmation" class="revision-confirmation" role="alertdialog" aria-labelledby="revision-confirm-title">
          <h4 id="revision-confirm-title">确认报告操作</h4>
          <p>{{ revisionConfirmationText }}</p>
          <button class="btn-primary" @click="confirmAdminAction" :disabled="saving">确认继续</button>
          <button class="btn-secondary" @click="revisionConfirmation = null" :disabled="saving">暂不操作</button>
        </div>
        <div v-else class="form-actions">
          <button v-if="!revisionSection" class="btn-primary" @click="beginAdminRevision" :disabled="writeBusy">进入管理员修订</button>
          <button v-if="!revisionSection && canReturnSelected" class="btn-secondary" @click="returnSelectedSection" :disabled="writeBusy">退回重填</button>
          <button v-if="revisionSection" class="btn-secondary" @click="cancelAdminRevision" :disabled="writeBusy">取消修订并刷新</button>
        </div>
        <p v-if="revisionTarget === 'main' && schedule.officials?.some(a => a.role === 'main' && a.source_type === 'external')" class="section-tip">非系统裁判员不能退回给裁判；请使用代填或管理员修订。</p>
      </div>

      <div class="card progress-summary-card">
        <p v-if="isProxySupervisor" class="readonly-banner">代非系统裁判监督填写：{{ schedule.supervisor_name }}。需填写本场所需场上裁判岗位的评分，包括裁判监督兼任的岗位。</p>
        <p v-if="isProxyMain" class="readonly-banner">代非系统裁判员填写：{{ schedule.main_referee_name }}。普通代填只开放未提交的裁判员区；已提交内容须使用独立修订入口。</p>
        <div v-if="actorEvents.length">
          <details><summary>裁判填写 / 管理员代填记录（{{ actorEvents.length }} 条，最近 200 条；修订请查看下方历史）</summary>
            <p v-for="event in actorEvents" :key="event.id">{{ displayDateTime(event.created_at) }} · {{ event.actor_name_snapshot }} · {{ event.source_type === 'admin_proxy' ? '管理员代填' : '裁判本人' }} · {{ actorOperationLabel(event.operation) }}</p>
          </details>
        </div>
        <p v-else class="section-tip">尚无实际操作记录。旧报告不补造历史操作者。</p>
        <div class="section-header">
          <h3>报告进度摘要</h3>
          <div v-if="isAdminReadonly" class="mode-chip">查看模式（可另行进入修订）</div>
        </div>
        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-label">裁判员区</div>
            <div class="summary-value">{{ mainProgressLabel }}</div>
            <div class="summary-meta">版本 V{{ sections.main?.version_no || 0 }} · 每次提交或管理员修订递增</div>
            <div class="summary-meta">开始：{{ displayDateTime(report.main_report_started_at) }}</div>
            <div class="summary-meta">提交：{{ displayDateTime(report.main_report_submitted_at) }}</div>
            <div v-if="sections.main?.original_submission" class="summary-meta">首次提交：{{ submissionSummary(sections.main.original_submission) }}</div>
            <div v-if="sections.main?.last_submission" class="summary-meta">最近提交人：{{ submissionSummary(sections.main.last_submission) }}</div>
            <p v-if="report.main_report_status === 'returned'" class="return-notice">退回原因：{{ sections.main?.return_reason }}（{{ displayDateTime(sections.main?.returned_at) }}）</p>
          </div>
          <div v-if="supervisorRequired" class="summary-item">
            <div class="summary-label">裁判监督区</div>
            <div class="summary-value">{{ supervisorProgressLabel }}</div>
            <div class="summary-meta">版本 V{{ sections.supervisor?.version_no || 0 }}</div>
            <div class="summary-meta">开始：{{ displayDateTime(report.supervisor_review_started_at) }}</div>
            <div class="summary-meta">提交：{{ displayDateTime(report.supervisor_review_submitted_at) }}</div>
            <div v-if="sections.supervisor?.original_submission" class="summary-meta">首次提交：{{ submissionSummary(sections.supervisor.original_submission) }}</div>
            <div v-if="sections.supervisor?.last_submission" class="summary-meta">最近提交人：{{ submissionSummary(sections.supervisor.last_submission) }}</div>
            <p v-if="report.supervisor_review_status === 'returned'" class="return-notice">退回原因：{{ sections.supervisor?.return_reason }}（{{ displayDateTime(sections.supervisor?.returned_at) }}）</p>
          </div>
        </div>
        <div v-if="isAdminReadonly" class="readonly-banner admin-banner">
          管理员可查看完整报告；修改须通过上方独立修订入口并填写原因。
        </div>
        <div v-else-if="isReadonlyViewer && !revisionSection" class="readonly-banner">
          您当前身份仅可查看报告内容。
        </div>
      </div>

      <ReportHistoryPanel :key="`${schedule.id}-${sections.main?.revision}-${sections.supervisor?.revision}`" :schedule-id="schedule.id" :supervisor-required="supervisorRequired" />

      <div class="card">
        <div class="section-header">
          <h3>{{ canEditMainSection ? '裁判员填写区' : '裁判员区（只读）' }}</h3>
          <div v-if="canEditMainSection" class="mode-chip editable">可编辑</div>
        </div>
        <div class="section-tip">裁判员区包含比分、执法数据、进球说明、红黄牌明细与第四官员记录单图片。</div>

        <fieldset class="readonly-fieldset" :disabled="!canEditMainSection || writeBusy">
          <div v-if="scoreError" class="alert error score-error" role="alert">{{ scoreError }}；已恢复为上次有效比分，请核对后继续。</div>
          <div class="form-row">
            <div class="form-group">
              <label>主队得分</label>
              <input type="number" min="0" max="30" step="1" v-model.number="form.home_score" @input="handleScoreChange" />
            </div>
            <div class="form-group">
              <label>客队得分</label>
              <input type="number" min="0" max="30" step="1" v-model.number="form.away_score" @input="handleScoreChange" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>主队点球战得分</label>
              <input type="number" min="0" max="30" step="1" v-model.number="form.home_penalty_score" @input="handlePenaltyScoreChange('home_penalty_score', '主队点球大战得分')" />
            </div>
            <div class="form-group">
              <label>客队点球战得分</label>
              <input type="number" min="0" max="30" step="1" v-model.number="form.away_penalty_score" @input="handlePenaltyScoreChange('away_penalty_score', '客队点球大战得分')" />
            </div>
          </div>

          <div class="subsection">
            <h4>裁判员执法数据</h4>
            <div class="form-row">
              <div class="form-group"><label>跑动距离(m)</label><input type="number" min="0" v-model.number="form.stats.main.running_distance_m" /></div>
              <div class="form-group"><label>最大心率</label><input type="number" min="0" v-model.number="form.stats.main.max_heart_rate" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>冲刺次数</label><input type="number" min="0" v-model.number="form.stats.main.sprint_count" /></div>
              <div class="form-group"><label>高强度跑动(m)</label><input type="number" min="0" v-model.number="form.stats.main.high_intensity_distance_m" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>平均心率</label><input type="number" min="0" v-model.number="form.stats.main.avg_heart_rate" /></div>
              <div class="form-group"><label>平均速度(m/s)</label><input type="number" min="0" step="0.1" v-model.number="form.stats.main.avg_speed_mps" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>红牌张数</label><input type="number" min="0" v-model.number="form.stats.main.red_card_count" /></div>
              <div class="form-group"><label>红牌准确率%</label><input type="number" min="0" max="100" step="0.1" v-model.number="form.stats.main.red_card_accuracy" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>黄牌张数</label><input type="number" min="0" v-model.number="form.stats.main.yellow_card_count" /></div>
              <div class="form-group"><label>黄牌准确率%</label><input type="number" min="0" max="100" step="0.1" v-model.number="form.stats.main.yellow_card_accuracy" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>点球判罚次数</label><input type="number" min="0" v-model.number="form.stats.main.penalty_count" /></div>
              <div class="form-group"><label>点球准确率%</label><input type="number" min="0" max="100" step="0.1" v-model.number="form.stats.main.penalty_accuracy" /></div>
            </div>
          </div>

          <div class="subsection">
            <h4>助理裁判员数据（可选）</h4>
            <div class="form-row">
              <div class="form-group"><label>第一助理裁判员 越位举旗</label><input type="number" min="0" v-model.number="form.stats.assistant1.offside_flag_count" /></div>
              <div class="form-group"><label>第一助理裁判员 协助次数</label><input type="number" min="0" v-model.number="form.stats.assistant1.assist_count" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>第二助理裁判员 越位举旗</label><input type="number" min="0" v-model.number="form.stats.assistant2.offside_flag_count" /></div>
              <div class="form-group"><label>第二助理裁判员 协助次数</label><input type="number" min="0" v-model.number="form.stats.assistant2.assist_count" /></div>
            </div>
          </div>

          <div class="subsection">
            <h4>进球说明（按比分自动生成）</h4>
            <div class="tip">进球说明数量由比分自动决定；修改比分时，如会影响已填内容，系统会先提示确认。</div>
            <div v-if="rosterWarning" class="status-note warn">{{ rosterWarning }}</div>

            <div class="goal-columns">
              <div class="goal-column">
                <h5>主队进球说明（{{ homeGoalEntries.length }} / {{ normalizedHomeScore }}）</h5>
                <div v-if="homeGoalEntries.length === 0" class="empty-tip">主队当前无进球说明项。</div>
                <div v-for="(goal, index) in homeGoalEntries" :key="goal._slotKey" class="goal-item">
                  <div class="goal-title">主队第 {{ index + 1 }} 球</div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>进球类型</label>
                      <select v-model="goal.goal_type" @change="handleGoalTypeChange(goal)">
                        <option value="normal">普通</option>
                        <option value="penalty">点球</option>
                        <option value="own_goal">乌龙</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label>记分归属</label>
                      <input type="text" :value="teamLabel(goal.credited_team_id)" disabled />
                    </div>
                    <div class="form-group">
                      <label>进球队员所属队伍</label>
                      <select
                        v-if="goal.goal_type === 'own_goal'"
                        v-model.number="goal.player_team_id"
                        @change="handleGoalPlayerTeamChange(goal)"
                      >
                        <option :value="schedule.team_a_id">主队</option>
                        <option :value="schedule.team_b_id">客队</option>
                      </select>
                      <input v-else type="text" :value="teamLabel(goal.player_team_id)" disabled />
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>球员</label>
                      <select v-model.number="goal.team_player_id">
                        <option :value="null">请选择球员</option>
                        <option v-for="player in getRosterOptions(goal.player_team_id)" :key="player.id" :value="player.id">
                          {{ player.label }}
                        </option>
                      </select>
                    </div>
                    <div class="form-group"><label>时间(基础)</label><input type="number" min="0" v-model.number="goal.minute_base" /></div>
                    <div class="form-group"><label>补时</label><input type="number" min="0" v-model.number="goal.minute_extra" /></div>
                  </div>
                  <div class="form-row single-column">
                    <div class="form-group"><label>说明</label><input type="text" v-model="goal.description" maxlength="255" /></div>
                  </div>
                </div>
              </div>

              <div class="goal-column">
                <h5>客队进球说明（{{ awayGoalEntries.length }} / {{ normalizedAwayScore }}）</h5>
                <div v-if="awayGoalEntries.length === 0" class="empty-tip">客队当前无进球说明项。</div>
                <div v-for="(goal, index) in awayGoalEntries" :key="goal._slotKey" class="goal-item">
                  <div class="goal-title">客队第 {{ index + 1 }} 球</div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>进球类型</label>
                      <select v-model="goal.goal_type" @change="handleGoalTypeChange(goal)">
                        <option value="normal">普通</option>
                        <option value="penalty">点球</option>
                        <option value="own_goal">乌龙</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label>记分归属</label>
                      <input type="text" :value="teamLabel(goal.credited_team_id)" disabled />
                    </div>
                    <div class="form-group">
                      <label>进球队员所属队伍</label>
                      <select
                        v-if="goal.goal_type === 'own_goal'"
                        v-model.number="goal.player_team_id"
                        @change="handleGoalPlayerTeamChange(goal)"
                      >
                        <option :value="schedule.team_a_id">主队</option>
                        <option :value="schedule.team_b_id">客队</option>
                      </select>
                      <input v-else type="text" :value="teamLabel(goal.player_team_id)" disabled />
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>球员</label>
                      <select v-model.number="goal.team_player_id">
                        <option :value="null">请选择球员</option>
                        <option v-for="player in getRosterOptions(goal.player_team_id)" :key="player.id" :value="player.id">
                          {{ player.label }}
                        </option>
                      </select>
                    </div>
                    <div class="form-group"><label>时间(基础)</label><input type="number" min="0" v-model.number="goal.minute_base" /></div>
                    <div class="form-group"><label>补时</label><input type="number" min="0" v-model.number="goal.minute_extra" /></div>
                  </div>
                  <div class="form-row single-column">
                    <div class="form-group"><label>说明</label><input type="text" v-model="goal.description" maxlength="255" /></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="subsection">
            <h4>红黄牌明细</h4><p class="section-tip">两黄罚下请选择“两黄变红”；可保留第一张黄牌的时间记录，停赛累计会自动忽略该球员本场黄牌，仅计1张红牌。</p>
            <div v-for="(card, index) in form.cards" :key="card._rowKey" class="card-item">
              <div class="form-row">
                <div class="form-group">
                  <label>队伍</label>
                  <select v-model.number="card.team_id" @change="handleCardTeamChange(card)">
                    <option :value="schedule.team_a_id">主队</option>
                    <option :value="schedule.team_b_id">客队</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>球员</label>
                  <select v-model.number="card.team_player_id">
                    <option :value="null">请选择球员</option>
                    <option v-for="player in getRosterOptions(card.team_id)" :key="player.id" :value="player.id">
                      {{ player.label }}
                    </option>
                  </select>
                </div>
                <div class="form-group">
                  <label>牌种</label>
                  <select v-model="card.card_type">
                    <option value="yellow">黄牌</option>
                    <option value="red">直接红牌</option><option value="second_yellow_red">两黄变红</option>
                  </select>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group"><label>时间(基础)</label><input type="number" min="0" v-model.number="card.minute_base" /></div>
                <div class="form-group"><label>补时</label><input type="number" min="0" v-model.number="card.minute_extra" /></div>
                <div class="form-group"><label>说明</label><input v-model="card.description" maxlength="255" /></div>
              </div>
              <div class="form-actions compact-actions" v-if="canEditMainSection">
                <button type="button" class="btn-secondary small" @click="removeCard(index)">删除</button>
              </div>
            </div>
            <button v-if="canEditMainSection" type="button" class="btn-secondary" @click="addCard">新增红黄牌</button>
          </div>
        </fieldset>

        <div class="subsection">
          <h4>比赛第四官员记录单</h4>
          <div class="tip">第四官员记录单图片单独上传；管理员与只读查看者可预览与放大查看。</div>
          <div v-if="report.fourth_official_image_path" class="upload-preview">
            <div class="upload-meta">已上传文件：{{ fourthOfficialImageName || '第四官员记录单图片' }}</div>
            <div class="preview-actions">
              <button type="button" class="btn-secondary" @click="openImagePreview">点击放大</button>
              <a :href="fourthOfficialImageUrl" target="_blank" rel="noopener noreferrer" class="preview-link">打开原图</a>
            </div>
            <img :src="fourthOfficialImageUrl" alt="第四官员记录单预览" class="preview-image" @click="openImagePreview" />
          </div>
          <div v-else class="upload-empty">当前尚未上传第四官员记录单图片。</div>

          <div v-if="canEditImage" class="upload-actions">
            <div v-if="imageRemovalPending" class="revision-confirmation" role="alertdialog" aria-label="确认移除当前图片">
              <p>确认从当前报告移除第四官员记录单图片吗？历史版本中的图片仍保留。</p>
              <button class="btn-primary" @click="removeFourthOfficialImage(true)" :disabled="fourthOfficialRemoving">确认移除当前图片</button>
              <button class="btn-secondary" @click="imageRemovalPending = false" :disabled="fourthOfficialRemoving">保留当前图片</button>
            </div>
            <input
              ref="fourthOfficialImageInput"
              class="upload-input"
              type="file"
              :disabled="writeBusy"
              accept="image/png,image/jpeg,image/jpg"
              @change="handleFourthOfficialFileChange"
            />
            <div v-if="selectedFourthOfficialFileName" class="upload-meta">待上传：{{ selectedFourthOfficialFileName }}</div>
            <div class="form-actions">
              <button type="button" class="btn-secondary" @click="uploadFourthOfficialImage" :disabled="writeBusy || !selectedFourthOfficialFile">{{ report.fourth_official_image_path ? '替换第四官员记录单' : '上传第四官员记录单' }}</button>
              <button type="button" class="btn-secondary" @click="removeFourthOfficialImage" :disabled="writeBusy || !report.fourth_official_image_path">删除第四官员记录单</button>
            </div>
          </div>
        </div>

        <div class="form-actions" v-if="canEditMainSection">
          <button v-if="revisionSection === 'main'" class="btn-primary" @click="saveAdminRevision" :disabled="writeBusy">保存裁判员区修订（保留当前状态）</button>
          <template v-else>
            <button class="btn-primary" @click="saveMainReport" :disabled="writeBusy">保存裁判员区</button>
            <button class="btn-primary" @click="submitMainReport" :disabled="writeBusy || report.main_report_status === 'submitted'">提交裁判员区</button>
          </template>
        </div>
      </div>

      <div v-if="supervisorRequired" class="card">
        <div class="section-header">
          <h3>{{ canEditSupervisorSection ? '裁判监督填写区' : '裁判监督区（只读）' }}</h3>
          <div v-if="canEditSupervisorSection" class="mode-chip editable">可编辑</div>
        </div>
        <div class="section-tip">裁判监督区包含对本场所需场上裁判岗位的评分和建议；兼任时也需填写本人岗位评分。</div>

        <fieldset class="readonly-fieldset" :disabled="!canEditSupervisorSection || writeBusy">
          <div class="subsection subsection-tight">
            <h4>裁判监督评分与建议</h4>
            <div v-for="(review, index) in filteredReviews" :key="review.target_role" class="review-item">
              <div class="form-row">
                <div class="form-group"><label>被评角色</label><input type="text" :value="getRefereeNameForRole(review.target_role)" disabled /></div>
                <div class="form-group"><label>评分 (1-10)</label><input type="number" min="1" max="10" step="0.1" v-model.number="review.score" /></div>
              </div>
              <div class="form-row single-column">
                <div class="form-group"><label>建议</label><textarea v-model="review.advice" maxlength="100"></textarea></div>
              </div>
            </div>
          </div>
        </fieldset>

        <div class="form-actions" v-if="canEditSupervisorSection">
          <button v-if="revisionSection === 'supervisor'" class="btn-primary" @click="saveAdminRevision" :disabled="writeBusy">保存裁判监督区修订（保留当前状态）</button>
          <template v-else>
            <button class="btn-primary" @click="saveSupervisorReport" :disabled="saving">保存裁判监督区</button>
            <button class="btn-primary" @click="submitSupervisorReport" :disabled="saving || report.supervisor_review_status === 'submitted'">提交裁判监督区</button>
          </template>
        </div>
      </div>
    </div>

    <div v-if="imagePreviewVisible" class="image-modal" @click.self="closeImagePreview">
      <div class="image-modal-card">
        <div class="image-modal-header">
          <div class="image-modal-title">第四官员记录单图片预览</div>
          <button type="button" class="btn-secondary" @click="closeImagePreview">关闭</button>
        </div>
        <div class="image-modal-body">
          <img :src="fourthOfficialImageUrl" alt="第四官员记录单大图预览" class="image-modal-preview" />
        </div>
        <div class="image-modal-footer">
          <a :href="fourthOfficialImageUrl" target="_blank" rel="noopener noreferrer" class="preview-link">打开原图</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import MatchDiscipline from '../components/MatchDiscipline.vue'
import { venueText } from '../utils/matchSignup.js'
import { displayMatchTime } from '../utils/matchTime.js'
import { scheduleReturnQuery } from '../utils/scheduleNavigation.js'
import { fileAPI, reportAPI, teamAPI } from '../api'
import ReportHistoryPanel from '../components/ReportHistoryPanel.vue'

function extractErrorMessage(error, fallback = '操作失败') {
  return error?.response?.data?.message || error?.message || fallback
}

function getPayload(response) {
  if (response && typeof response === 'object' && response.data && Object.prototype.hasOwnProperty.call(response.data, 'data')) {
    return response.data.data
  }
  if (response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'data')) {
    return response.data
  }
  return response
}

function buildDefaultViewerPermissions(roleCode = null) {
  return {
    can_view: Boolean(roleCode),
    can_edit_main: roleCode === 'main',
    can_edit_supervisor: roleCode === 'supervisor',
    is_readonly: Boolean(roleCode) && roleCode !== 'main' && roleCode !== 'supervisor'
  }
}

function extractFileNameFromPath(imagePath) {
  if (!imagePath) return ''
  const segments = String(imagePath).split('/')
  return segments[segments.length - 1] || ''
}

function buildEmptyMainStats() {
  return {
    running_distance_m: null,
    max_heart_rate: null,
    sprint_count: null,
    high_intensity_distance_m: null,
    avg_heart_rate: null,
    avg_speed_mps: null,
    red_card_count: null,
    red_card_accuracy: null,
    yellow_card_count: null,
    yellow_card_accuracy: null,
    penalty_count: null,
    penalty_accuracy: null
  }
}

function buildEmptyAssistantStats() {
  return {
    offside_flag_count: null,
    assist_count: null
  }
}

function coerceNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed
}

const MAX_MATCH_SCORE = 30

function parseBoundedScore(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_MATCH_SCORE) return null
  return parsed
}

export default {
  name: 'RefereeReportDetail',
  components: {ReportHistoryPanel,MatchDiscipline},
  data() {
    return {
      schedule: null,
      report: null,
      loading: true,
      error: '',
      rosterWarning: '',
      scoreError: '',
      form: {
        home_score: 0,
        away_score: 0,
        home_penalty_score: 0,
        away_penalty_score: 0,
        stats: {
          main: buildEmptyMainStats(),
          assistant1: buildEmptyAssistantStats(),
          assistant2: buildEmptyAssistantStats()
        },
        goals: [],
        cards: [],
        reviews: []
      },
      viewerRole: null,
      actorEvents: [],
      sections: {main:{revision:0,version_no:0},supervisor:{revision:0,version_no:0}},
      revisionTarget: 'main',
      revisionConfirmation: null,
      reportNotice: '',
      reportNoticeError: false,
      imageRemovalPending: false,
      revisionSection: null,
      revisionReason: '',
      revisionError: '',
      viewerRoleCode: null,
      viewerRoleCodes: [],
      viewerPermissions: buildDefaultViewerPermissions(null),
      saving: false,
      fourthOfficialUploading: false,
      fourthOfficialRemoving: false,
      selectedFourthOfficialFile: null,
      teamRosters: {},
      scoreSnapshot: {
        home: 0,
        away: 0,
        homePenalty: 0,
        awayPenalty: 0
      },
      goalSlotSeed: 1,
      cardRowSeed: 1,
      imagePreviewVisible: false,
      fourthOfficialImageObjectUrl: ''
    }
  },
  computed: {
    writeBusy() { return this.saving || this.fourthOfficialUploading || this.fourthOfficialRemoving || Boolean(this.revisionConfirmation) || this.imageRemovalPending },
    revisionConfirmationText() {
      const area = this.revisionTarget === 'supervisor' ? '裁判监督区' : this.revisionTarget === 'image' ? '第四官员记录单图片' : '裁判员区'
      if (this.revisionConfirmation === 'begin') return `进入${area}修订将重新加载已保存内容，未保存的普通编辑不会保留。是否继续？`
      if (this.revisionConfirmation === 'cancel') return '取消本次尚未保存的修订并刷新？已经成功保存的历史操作不会撤销。'
      return `确认仅退回${area}给原系统裁判？原内容和版本保留，另一分区、比赛及岗位仍锁定。原因：${this.revisionReason}`
    },
    logoUrl() {
      return '/brand-logo.png'
    },
    routeNameText() {
      return String(this.$route?.name || '')
    },
    isAdminPage() {
      return this.routeNameText === 'AdminScheduleReportDetail' || String(this.$route?.path || '').startsWith('/admin-schedule/')
    },
    supervisorRequired() { return this.schedule?.supervisor_required !== false && this.schedule?.supervisor_required !== 0 },
    isProxySupervisor() { return this.isAdminPage && this.viewerPermissions.can_proxy_supervisor === true },
    isProxyMain() { return this.isAdminPage && this.viewerPermissions.can_proxy_main === true },
    isAdminReadonly() { return this.isAdminPage && !this.isProxyMain && !this.isProxySupervisor && !this.revisionSection },
    pageTitle() {
      return this.isAdminReadonly ? '裁判报告' : '裁判报告'
    },
    pageSubtitle() {
      return (this.isProxyMain || this.isProxySupervisor) ? '管理员可代非系统裁判员或裁判监督填写对应报告；提交后通过独立修订入口修改。' : this.isAdminReadonly
        ? '查看完整报告；可通过独立入口退回或修订，保留原因与历史版本。'
        : '裁判员与裁判监督分区填写报告内容。'
    },
    backButtonText() {
      return this.isAdminPage ? '返回赛程详情' : '返回'
    },
    viewerRoleLabel() {
      if (this.isProxyMain || this.isProxySupervisor) return '管理员（代非系统裁判填写）'
      if (this.isAdminPage && this.revisionSection) return '管理员（修订）'
      if (this.isAdminReadonly) return '管理员（查看）'
      return this.viewerRole || '仅可查看'
    },
    canEditMainSection() {
      if (this.revisionSection) return this.isAdminPage && this.viewerPermissions.can_admin_revise && this.revisionSection === 'main'
      return (this.isProxyMain || (!this.isAdminPage && this.viewerRoleCode === 'main')) &&
        this.viewerPermissions.can_edit_main &&
        this.report?.main_report_status !== 'submitted'
    },
    canEditSupervisorSection() {
      if (!this.supervisorRequired) return false
      if (this.revisionSection) return this.isAdminPage && this.viewerPermissions.can_admin_revise && this.revisionSection === 'supervisor'
      return this.viewerPermissions.can_edit_supervisor === true &&
        this.report?.supervisor_review_status !== 'submitted'
    },
    canEditImage() {
      if (this.revisionSection) return this.isAdminPage && this.viewerPermissions.can_admin_revise && this.revisionSection === 'image'
      return this.canEditMainSection
    },
    canReturnSelected() {
      return this.revisionTarget !== 'image' && this.viewerPermissions[`can_return_${this.revisionTarget}`] === true
    },
    isReadonlyViewer() {
      return !this.canEditMainSection && !this.canEditSupervisorSection
    },
    fourthOfficialImageUrl() {
      return this.fourthOfficialImageObjectUrl
    },
    fourthOfficialImageName() {
      return extractFileNameFromPath(this.report?.fourth_official_image_path)
    },
    selectedFourthOfficialFileName() {
      return this.selectedFourthOfficialFile?.name || ''
    },
    normalizedHomeScore() {
      return coerceNonNegativeInteger(this.form.home_score)
    },
    normalizedAwayScore() {
      return coerceNonNegativeInteger(this.form.away_score)
    },
    homeGoalEntries() {
      return this.form.goals.filter(goal => goal.credited_team_id === this.schedule?.team_a_id)
    },
    awayGoalEntries() {
      return this.form.goals.filter(goal => goal.credited_team_id === this.schedule?.team_b_id)
    },
    mainProgressLabel() {
      return this.formatReportProgress(this.report?.main_report_status, this.report?.main_report_started_at, this.report?.main_report_submitted_at)
    },
    supervisorProgressLabel() {
      if (!this.supervisorRequired) return '无需裁判监督报告'
      return this.formatReportProgress(this.report?.supervisor_review_status, this.report?.supervisor_review_started_at, this.report?.supervisor_review_submitted_at)
    },
    filteredReviews() {
      // 管理员和裁判监督可以看到所有评分
      if (this.isAdminPage || this.viewerPermissions.can_read_all_reviews) {
        return this.form.reviews
      }
      // 其他裁判只能看到自己的评分
      return this.form.reviews.filter(review => (this.viewerRoleCodes?.length ? this.viewerRoleCodes : [this.viewerRoleCode]).includes(review.target_role))
    }
  },
  async mounted() {
    await this.loadReport()
  },
  beforeUnmount() {
    this.releaseFourthOfficialImagePreview()
  },
  methods: {
    venueText(value) { return venueText(value) },
    displayMatchTime(value) { return displayMatchTime(value) },
    showReportNotice(message, error = false) { this.reportNotice = message; this.reportNoticeError = error },
    submissionSummary(value) {
      const submission = typeof value === 'string' ? JSON.parse(value) : value
      const source = {referee:'裁判本人',admin_proxy:'管理员代填',admin_revision:'管理员修订'}[submission.actor?.source_type]
      return `负责人：${submission.owner?.name_snapshot || '未知'} · 实际提交人：${submission.actor?.actor_name_snapshot || '未知（旧记录）'}${source ? `（${source}）` : ''} · ${this.displayDateTime(submission.submitted_at)}`
    },
    validRevisionReason() {
      if (!this.revisionReason.trim()) { this.revisionError = '请填写原因'; return false }
      this.revisionError = ''
      return true
    },
    async beginAdminRevision(confirmed = false) {
      if (!this.validRevisionReason()) return
      const role = this.revisionTarget === 'supervisor' ? 'supervisor' : 'main'
      if (!this.schedule.officials?.some(a=>a.role === role)) { this.revisionError = '请先选派该分区负责人'; return }
      if (confirmed !== true) { this.revisionConfirmation = 'begin'; return }
      this.reportNotice = ''
      await this.loadReport()
      if (!this.error) this.revisionSection = this.revisionTarget
    },
    async cancelAdminRevision(confirmed = false) {
      if (confirmed !== true) { this.revisionConfirmation = 'cancel'; return }
      this.revisionSection = null
      this.revisionError = ''
      this.resetFourthOfficialFileSelection()
      await this.loadReport()
    },
    async returnSelectedSection(confirmed = false) {
      if (!this.canReturnSelected || !this.validRevisionReason()) return
      if (confirmed !== true) { this.revisionConfirmation = 'return'; return }
      this.saving = true
      try {
        await reportAPI.returnSection(this.schedule.id,this.revisionTarget,this.revisionReason.trim(),this.sections[this.revisionTarget].revision)
        this.revisionReason = ''
        await this.loadReport()
        this.showReportNotice('已退回所选分区，原系统裁判可重填；另一分区、比赛与岗位锁定不变')
      } catch(error) { this.revisionError = extractErrorMessage(error) }
      finally { this.saving = false }
    },
    async saveAdminRevision() {
      if (!['main','supervisor'].includes(this.revisionSection) || !this.validRevisionReason()) return
      this.saving = true
      try {
        const section = this.revisionSection
        const data = section === 'main' ? this.buildMainReportPayload() : {reviews:this.form.reviews}
        await reportAPI.reviseSection(this.schedule.id,section,data,this.revisionReason.trim(),this.sections[section].revision)
        this.revisionSection = null
        this.revisionReason = ''
        await this.loadReport()
        this.showReportNotice('修订已保存，新版本已记录；原提交状态保持不变')
      } catch(error) { this.revisionError = extractErrorMessage(error) }
      finally { this.saving = false }
    },
    async confirmAdminAction() {
      const action = this.revisionConfirmation
      this.revisionConfirmation = null
      if (action === 'begin') await this.beginAdminRevision(true)
      else if (action === 'cancel') await this.cancelAdminRevision(true)
      else if (action === 'return') await this.returnSelectedSection(true)
    },
    actorOperationLabel(operation) { return ({save_main:'保存裁判员区',submit_main:'提交裁判员区',upload_image:'上传第四官员记录单',remove_image:'删除第四官员记录单',save_supervisor:'保存裁判监督区',submit_supervisor:'提交裁判监督区'})[operation] || operation },
    nextGoalSlotKey() {
      const key = `goal-slot-${this.goalSlotSeed}`
      this.goalSlotSeed += 1
      return key
    },
    nextCardRowKey() {
      const key = `card-row-${this.cardRowSeed}`
      this.cardRowSeed += 1
      return key
    },
    teamLabel(teamId) {
      if (!this.schedule) return '-'
      if (teamId === this.schedule.team_a_id) return `主队（${this.schedule.team_a_name_snapshot}）`
      if (teamId === this.schedule.team_b_id) return `客队（${this.schedule.team_b_name_snapshot}）`
      return '-'
    },
    getOppositeTeamId(teamId) {
      if (!this.schedule) return null
      return teamId === this.schedule.team_a_id ? this.schedule.team_b_id : this.schedule.team_a_id
    },
    normalizeGoalRecord(goal = {}, creditedTeamId) {
      const goalType = goal.goal_type || 'normal'
      const safeCreditedTeamId = creditedTeamId || goal.credited_team_id || this.schedule?.team_a_id || null
      const playerTeamId = goalType === 'own_goal'
        ? (goal.player_team_id || this.getOppositeTeamId(safeCreditedTeamId) || safeCreditedTeamId)
        : safeCreditedTeamId

      return {
        id: goal.id ?? null,
        _slotKey: goal._slotKey || (goal.id ? `goal-${goal.id}` : this.nextGoalSlotKey()),
        player_team_id: playerTeamId,
        credited_team_id: safeCreditedTeamId,
        team_player_id: goal.team_player_id ?? null,
        player_jersey_number: goal.player_jersey_number ?? null,
        player_name: goal.player_name || null,
        player_remark: goal.player_remark || null,
        roster_batch_id: goal.roster_batch_id ?? null,
        goal_type: goalType,
        minute_base: coerceNonNegativeInteger(goal.minute_base),
        minute_extra: coerceNonNegativeInteger(goal.minute_extra),
        description: goal.description || ''
      }
    },
    normalizeCardRecord(card = {}) {
      return {
        id: card.id ?? null,
        _rowKey: card._rowKey || (card.id ? `card-${card.id}` : this.nextCardRowKey()),
        team_id: card.team_id || this.schedule?.team_a_id || null,
        team_player_id: card.team_player_id ?? null,
        player_jersey_number: card.player_jersey_number ?? null,
        player_name: card.player_name || null,
        player_remark: card.player_remark || null,
        roster_batch_id: card.roster_batch_id ?? null,
        card_type: card.card_type || 'yellow',
        minute_base: coerceNonNegativeInteger(card.minute_base),
        minute_extra: coerceNonNegativeInteger(card.minute_extra),
        description: card.description || ''
      }
    },
    buildEmptyGoal(creditedTeamId) {
      return this.normalizeGoalRecord({
        goal_type: 'normal',
        player_team_id: creditedTeamId,
        team_player_id: null,
        minute_base: 0,
        minute_extra: 0,
        description: ''
      }, creditedTeamId)
    },
    goalHasMeaningfulContent(goal) {
      if (!goal) return false
      return Boolean(
        goal.team_player_id ||
        (goal.description && String(goal.description).trim()) ||
        coerceNonNegativeInteger(goal.minute_base) > 0 ||
        coerceNonNegativeInteger(goal.minute_extra) > 0 ||
        goal.goal_type === 'penalty' ||
        goal.goal_type === 'own_goal'
      )
    },
    isPlayerAvailableForTeam(teamId, teamPlayerId) {
      if (!teamId || !teamPlayerId) return false
      return this.getRosterOptions(teamId).some(player => player.id === teamPlayerId)
    },
    reconcileTeamGoals(existingGoals, targetCount, creditedTeamId) {
      const preserved = existingGoals.map(goal => this.normalizeGoalRecord(goal, creditedTeamId))
      const removed = preserved.slice(targetCount)
      const nextGoals = preserved.slice(0, targetCount)

      while (nextGoals.length < targetCount) {
        nextGoals.push(this.buildEmptyGoal(creditedTeamId))
      }

      return {
        nextGoals,
        removed
      }
    },
    buildGoalsForScores(homeScore, awayScore) {
      const homeResult = this.reconcileTeamGoals(this.homeGoalEntries, homeScore, this.schedule.team_a_id)
      const awayResult = this.reconcileTeamGoals(this.awayGoalEntries, awayScore, this.schedule.team_b_id)

      return {
        goals: [...homeResult.nextGoals, ...awayResult.nextGoals],
        removedGoals: [...homeResult.removed, ...awayResult.removed]
      }
    },
    applyGoalsForScores(homeScore, awayScore, options = {}) {
      const { skipConfirm = false } = options
      const nextHomeScore = parseBoundedScore(homeScore)
      const nextAwayScore = parseBoundedScore(awayScore)
      if (nextHomeScore === null || nextAwayScore === null) {
        this.scoreError = `正常比分必须是 0 到 ${MAX_MATCH_SCORE} 的整数`
        return false
      }
      const { goals, removedGoals } = this.buildGoalsForScores(nextHomeScore, nextAwayScore)
      const removedMeaningfulGoals = removedGoals.filter(goal => this.goalHasMeaningfulContent(goal))

      if (!skipConfirm && removedMeaningfulGoals.length > 0) {
        const confirmed = window.confirm(`修改比分会删除 ${removedMeaningfulGoals.length} 条已填写的进球说明内容，是否继续？`)
        if (!confirmed) {
          return false
        }
      }

      this.form.goals = goals.map(goal => this.normalizeGoalRecord(goal, goal.credited_team_id))
      this.form.home_score = nextHomeScore
      this.form.away_score = nextAwayScore
      this.scoreSnapshot = {
        home: nextHomeScore,
        away: nextAwayScore,
        homePenalty: this.scoreSnapshot.homePenalty,
        awayPenalty: this.scoreSnapshot.awayPenalty
      }
      this.scoreError = ''
      return true
    },
    handleScoreChange() {
      if (!this.canEditMainSection) {
        this.form.home_score = this.scoreSnapshot.home
        this.form.away_score = this.scoreSnapshot.away
        return
      }

      const nextHomeScore = parseBoundedScore(this.form.home_score)
      const nextAwayScore = parseBoundedScore(this.form.away_score)

      if (nextHomeScore === null || nextAwayScore === null) {
        this.scoreError = `正常比分必须是 0 到 ${MAX_MATCH_SCORE} 的整数`
        this.form.home_score = this.scoreSnapshot.home
        this.form.away_score = this.scoreSnapshot.away
        return
      }

      const changed = nextHomeScore !== this.scoreSnapshot.home || nextAwayScore !== this.scoreSnapshot.away
      if (!changed) {
        this.form.home_score = nextHomeScore
        this.form.away_score = nextAwayScore
        return
      }

      const accepted = this.applyGoalsForScores(nextHomeScore, nextAwayScore, { skipConfirm: false })
      if (!accepted) {
        this.form.home_score = this.scoreSnapshot.home
        this.form.away_score = this.scoreSnapshot.away
      }
    },
    handlePenaltyScoreChange(field, label) {
      const snapshotKey = field === 'home_penalty_score' ? 'homePenalty' : 'awayPenalty'
      const parsed = parseBoundedScore(this.form[field])
      if (parsed === null) {
        this.scoreError = `${label}必须是 0 到 ${MAX_MATCH_SCORE} 的整数`
        this.form[field] = this.scoreSnapshot[snapshotKey]
        return
      }
      this.form[field] = parsed
      this.scoreSnapshot[snapshotKey] = parsed
      this.scoreError = ''
    },
    loadTeamRosters(items = []) {
      this.rosterWarning = ''
      this.teamRosters = Object.fromEntries(items.map(item => [item.team_id, item.players || []]))
    },
    buildLegacyPlayerOptions(teamId) {
      if (!teamId) return []

      const selectedPlayers = new Map()
      this.form.cards.forEach(card => {
        if (card.team_id === teamId && card.team_player_id) {
          selectedPlayers.set(card.team_player_id, card)
        }
      })
      this.form.goals.forEach(goal => {
        if (goal.player_team_id === teamId && goal.team_player_id) {
          selectedPlayers.set(goal.team_player_id, goal)
        }
      })

      const currentIds = new Set((this.teamRosters[teamId] || []).map(player => player.id))
      return Array.from(selectedPlayers.entries())
        .filter(([id]) => !currentIds.has(id))
        .map(([id, player]) => {
          const playerText = player.player_name
            ? `#${player.player_jersey_number || '-'} ${player.player_name}${player.player_remark ? `（${player.player_remark}）` : ''}`
            : `球员 ID: ${id}`

          return {
            id,
            label: `${playerText}（历史名单）`
          }
        })
    },
    getRosterOptions(teamId) {
      if (!teamId) return []

      const currentPlayers = (this.teamRosters[teamId] || []).map(player => ({
        id: player.id,
        label: `#${player.jersey_number} ${player.player_name}${player.remark ? `（${player.remark}）` : ''}`
      }))

      return [...currentPlayers, ...this.buildLegacyPlayerOptions(teamId)]
    },
    async loadReport() {
      this.loading = true
      this.error = ''
      try {
        const scheduleId = Number(this.$route.params.scheduleId)
        const resp = await reportAPI.getScheduleReport(scheduleId)
        const payload = getPayload(resp)
        if (!payload) {
          throw new Error('报告数据解析失败')
        }

        const {
          schedule,
          report,
          stats = [],
          reviews = [],
          cards = [],
          goals = [],
          viewer_role,
          viewer_role_code,
          viewer_permissions
        } = payload

        this.schedule = schedule
        this.report = report || {}
        this.sections = payload.sections || {main:{revision:0,version_no:0},supervisor:{revision:0,version_no:0}}
        await this.loadFourthOfficialImagePreview()
        this.viewerRole = viewer_role || schedule?.my_role || null
        this.actorEvents = Array.isArray(payload.actor_events) ? payload.actor_events : []
        this.viewerRoleCode = viewer_role_code || schedule?.my_role_code || null
        this.viewerRoleCodes = Array.isArray(payload.viewer_role_codes) ? payload.viewer_role_codes : [this.viewerRoleCode]
        this.viewerPermissions = viewer_permissions || schedule?.viewer_permissions || buildDefaultViewerPermissions(this.viewerRoleCode)

        this.form.home_score = report?.home_score ?? 0
        this.form.away_score = report?.away_score ?? 0
        this.form.home_penalty_score = report?.home_penalty_score ?? 0
        this.form.away_penalty_score = report?.away_penalty_score ?? 0
        this.scoreSnapshot.homePenalty = parseBoundedScore(this.form.home_penalty_score) ?? 0
        this.scoreSnapshot.awayPenalty = parseBoundedScore(this.form.away_penalty_score) ?? 0

        this.form.stats.main = { ...buildEmptyMainStats(), ...(stats.find(item => item.role === 'main') || {}) }
        this.form.stats.assistant1 = { ...buildEmptyAssistantStats(), ...(stats.find(item => item.role === 'assistant1') || {}) }
        this.form.stats.assistant2 = { ...buildEmptyAssistantStats(), ...(stats.find(item => item.role === 'assistant2') || {}) }

        this.form.reviews = ['main', 'assistant1', 'assistant2', ...(schedule.fourth_required?['fourth']:[])].map(role => {
          const existing = reviews.find(item => item.target_role === role)
          return {
            target_role: role,
            score: existing?.score ? Number(existing.score) : null,
            advice: existing?.advice || ''
          }
        })

        this.form.cards = cards.map(card => this.normalizeCardRecord(card))
        this.form.goals = goals.map(goal => this.normalizeGoalRecord(goal, goal.credited_team_id))

        this.loadTeamRosters(payload.match_rosters || [])
        this.applyGoalsForScores(this.form.home_score, this.form.away_score, { skipConfirm: true })
      } catch (err) {
        this.error = extractErrorMessage(err, '加载失败')
      } finally {
        this.loading = false
      }
    },
    releaseFourthOfficialImagePreview() {
      if (this.fourthOfficialImageObjectUrl) {
        URL.revokeObjectURL(this.fourthOfficialImageObjectUrl)
        this.fourthOfficialImageObjectUrl = ''
      }
    },
    async loadFourthOfficialImagePreview() {
      this.releaseFourthOfficialImagePreview()
      if (!this.schedule?.id || !this.report?.fourth_official_image_path) return
      try {
        const blob = await fileAPI.getFourthOfficialImage(this.schedule.id)
        this.fourthOfficialImageObjectUrl = URL.createObjectURL(blob)
      } catch (error) {
        console.error('第四官员记录单预览加载失败:', error)
      }
    },
    formatDate(dateString) {
      return dateString ? String(dateString).slice(0, 10) : '-'
    },
    displayDateTime(value) {
      if (!value) return '-'
      try {
        return new Date(value).toLocaleString('zh-CN')
      } catch {
        return String(value)
      }
    },
    formatReportProgress(status, startedAt, submittedAt) {
      if (status === 'returned') return '已退回，待重填'
      if (status === 'submitted' || submittedAt) return '已提交'
      if (startedAt) return '填写中'
      return '未开始'
    },
    handleFourthOfficialFileChange(event) {
      const [file] = event?.target?.files || []
      this.selectedFourthOfficialFile = file || null
    },
    resetFourthOfficialFileSelection() {
      this.imageRemovalPending = false
      this.selectedFourthOfficialFile = null
      if (this.$refs.fourthOfficialImageInput) {
        this.$refs.fourthOfficialImageInput.value = ''
      }
    },
    async uploadFourthOfficialImage() {
      if (!this.canEditImage) {
        this.showReportNotice('当前身份不可上传第四官员记录单', true)
        return
      }

      if (!this.selectedFourthOfficialFile) {
        this.showReportNotice('请先选择要上传的第四官员记录单图片', true)
        return
      }

      const formData = new FormData()
      formData.append('fourth_official_image', this.selectedFourthOfficialFile)
      if (this.revisionSection === 'image') {
        if (!this.validRevisionReason()) return
        formData.append('reason',this.revisionReason.trim())
      }

      this.fourthOfficialUploading = true
      try {
        const hadExistingImage = Boolean(this.report?.fourth_official_image_path)
        await (this.revisionSection === 'image' ? reportAPI.reviseImage : this.isProxyMain ? reportAPI.uploadProxyImage : reportAPI.uploadFourthOfficialImage)(this.schedule.id, formData,this.sections.main.revision)
        this.revisionSection = null
        this.showReportNotice(hadExistingImage ? '第四官员记录单替换成功' : '第四官员记录单上传成功')
        this.resetFourthOfficialFileSelection()
        await this.loadReport()
      } catch (err) {
        this.showReportNotice('第四官员记录单上传失败: ' + extractErrorMessage(err, '未知错误'), true)
      } finally {
        this.fourthOfficialUploading = false
      }
    },
    async removeFourthOfficialImage(confirmed = false) {
      if (!this.canEditImage) {
        this.showReportNotice('当前身份不可删除第四官员记录单', true)
        return
      }

      if (!this.report?.fourth_official_image_path) {
        this.showReportNotice('当前没有已上传的第四官员记录单图片', true)
        return
      }

      if (this.revisionSection === 'image' && !this.validRevisionReason()) return
      if (confirmed !== true) { this.imageRemovalPending = true; return }
      this.imageRemovalPending = false

      this.fourthOfficialRemoving = true
      try {
        if (this.revisionSection === 'image') await reportAPI.removeRevisionImage(this.schedule.id,this.revisionReason.trim(),this.sections.main.revision)
        else await (this.isProxyMain ? reportAPI.deleteProxyImage : reportAPI.deleteFourthOfficialImage)(this.schedule.id,this.sections.main.revision)
        this.revisionSection = null
        this.showReportNotice('当前第四官员记录单已移除，历史图片保留')
        this.resetFourthOfficialFileSelection()
        await this.loadReport()
      } catch (err) {
        this.showReportNotice('第四官员记录单删除失败: ' + extractErrorMessage(err, '未知错误'), true)
      } finally {
        this.fourthOfficialRemoving = false
      }
    },
    buildMainReportPayload() {
      const homeScore = parseBoundedScore(this.form.home_score)
      const awayScore = parseBoundedScore(this.form.away_score)
      const homePenaltyScore = parseBoundedScore(this.form.home_penalty_score)
      const awayPenaltyScore = parseBoundedScore(this.form.away_penalty_score)
      if ([homeScore, awayScore, homePenaltyScore, awayPenaltyScore].some(score => score === null)) {
        throw new Error(`正常比分和点球大战比分必须是 0 到 ${MAX_MATCH_SCORE} 的整数`)
      }
      return {
        home_score: homeScore,
        away_score: awayScore,
        home_penalty_score: homePenaltyScore,
        away_penalty_score: awayPenaltyScore,
        stats: [
          { role: 'main', ...this.form.stats.main },
          { role: 'assistant1', ...this.form.stats.assistant1 },
          { role: 'assistant2', ...this.form.stats.assistant2 }
        ],
        cards: this.form.cards.map(card => ({
          team_id: card.team_id,
          team_player_id: card.team_player_id,
          card_type: card.card_type,
          minute_base: coerceNonNegativeInteger(card.minute_base),
          minute_extra: coerceNonNegativeInteger(card.minute_extra),
          description: card.description || ''
        })),
        goals: this.form.goals.map(goal => ({
          player_team_id: goal.goal_type === 'own_goal' ? goal.player_team_id : goal.credited_team_id,
          credited_team_id: goal.credited_team_id,
          team_player_id: goal.team_player_id,
          goal_type: goal.goal_type,
          minute_base: coerceNonNegativeInteger(goal.minute_base),
          minute_extra: coerceNonNegativeInteger(goal.minute_extra),
          description: goal.description || ''
        }))
      }
    },
    async saveMainReport() {
      if (!this.canEditMainSection) {
        this.showReportNotice('当前身份不可保存裁判员区内容', true)
        return
      }

      this.saving = true
      try {
        const payload = this.buildMainReportPayload()
        await (this.isProxyMain ? reportAPI.saveProxyMainReport : reportAPI.saveMainReport)(this.schedule.id, payload,this.sections.main.revision)
        this.showReportNotice('裁判员区保存成功')
        await this.loadReport()
      } catch (err) {
        this.showReportNotice('保存失败: ' + extractErrorMessage(err, '未知错误'), true)
      } finally {
        this.saving = false
      }
    },
    async submitMainReport() {
      if (!this.canEditMainSection) {
        this.showReportNotice('当前身份不可提交裁判员区', true)
        return
      }

      this.saving = true
      try {
        const payload = this.buildMainReportPayload()
        const saved = await (this.isProxyMain ? reportAPI.saveProxyMainReport : reportAPI.saveMainReport)(this.schedule.id, payload,this.sections.main.revision)
        this.sections.main = getPayload(saved).sections.main
        await (this.isProxyMain ? reportAPI.submitProxyMainReport : reportAPI.submitMainReport)(this.schedule.id,this.sections.main.revision)
        this.showReportNotice('裁判员区提交成功')
        await this.loadReport()
      } catch (err) {
        this.showReportNotice('提交失败: ' + extractErrorMessage(err, '未知错误'), true)
      } finally {
        this.saving = false
      }
    },
    async saveSupervisorReport() {
      if (!this.canEditSupervisorSection) {
        this.showReportNotice('当前身份不可保存裁判监督区内容', true)
        return
      }

      this.saving = true
      try {
        await (this.isProxySupervisor ? reportAPI.saveProxySupervisorReport : reportAPI.saveSupervisorReport)(this.schedule.id, { reviews: this.form.reviews },this.sections.supervisor.revision)
        this.showReportNotice('裁判监督区保存成功')
        await this.loadReport()
      } catch (err) {
        this.showReportNotice('保存失败: ' + extractErrorMessage(err, '未知错误'), true)
      } finally {
        this.saving = false
      }
    },
    async submitSupervisorReport() {
      if (!this.canEditSupervisorSection) {
        this.showReportNotice('当前身份不可提交裁判监督区', true)
        return
      }

      this.saving = true
      try {
        const saved = await (this.isProxySupervisor ? reportAPI.saveProxySupervisorReport : reportAPI.saveSupervisorReport)(this.schedule.id, { reviews: this.form.reviews },this.sections.supervisor.revision)
        this.sections.supervisor = getPayload(saved).sections.supervisor
        await (this.isProxySupervisor ? reportAPI.submitProxySupervisorReport : reportAPI.submitSupervisorReport)(this.schedule.id,this.sections.supervisor.revision)
        this.showReportNotice('裁判监督区提交成功')
        await this.loadReport()
      } catch (err) {
        this.showReportNotice('提交失败: ' + extractErrorMessage(err, '未知错误'), true)
      } finally {
        this.saving = false
      }
    },
    handleGoalTypeChange(goal) {
      if (!goal) return
      if (goal.goal_type === 'own_goal') {
        if (goal.player_team_id === goal.credited_team_id) {
          goal.player_team_id = this.getOppositeTeamId(goal.credited_team_id)
        }
      } else {
        goal.player_team_id = goal.credited_team_id
      }

      if (!this.isPlayerAvailableForTeam(goal.player_team_id, goal.team_player_id)) {
        goal.team_player_id = null
      }
    },
    handleGoalPlayerTeamChange(goal) {
      if (!goal) return
      if (goal.goal_type !== 'own_goal') {
        goal.player_team_id = goal.credited_team_id
      }
      if (!this.isPlayerAvailableForTeam(goal.player_team_id, goal.team_player_id)) {
        goal.team_player_id = null
      }
    },
    handleCardTeamChange(card) {
      if (!card) return
      if (!this.isPlayerAvailableForTeam(card.team_id, card.team_player_id)) {
        card.team_player_id = null
      }
    },
    addCard() {
      if (!this.canEditMainSection) return
      this.form.cards.push(this.normalizeCardRecord({
        team_id: this.schedule.team_a_id,
        team_player_id: null,
        card_type: 'yellow',
        minute_base: 0,
        minute_extra: 0,
        description: ''
      }))
    },
    removeCard(index) {
      if (!this.canEditMainSection) return
      this.form.cards.splice(index, 1)
    },
    openImagePreview() {
      if (!this.fourthOfficialImageUrl) return
      this.imagePreviewVisible = true
    },
    closeImagePreview() {
      this.imagePreviewVisible = false
    },
    getRefereeNameForRole(role) {
      const roleMap = {
        main: { name: this.schedule?.main_referee_name, label: '裁判员' },
        assistant1: { name: this.schedule?.assistant1_name, label: '第一助理裁判员' },
        assistant2: { name: this.schedule?.assistant2_name, label: '第二助理裁判员' },
        fourth: { name: this.schedule?.fourth_official_name, label: '第四官员' },
        supervisor: { name: this.schedule?.supervisor_name, label: '裁判监督' }
      }
      const roleInfo = roleMap[role]
      if (roleInfo?.name) {
        const source = this.schedule?.officials?.find(a => a.role === role)?.source_type
        return `${roleInfo.name}（${roleInfo.label} · ${source === 'external' ? '非系统裁判' : '系统裁判'}）`
      }
      return roleInfo?.label || role
    },
    goBack() {
      const scheduleId = this.schedule?.id || this.$route.params.scheduleId
      if (this.isAdminPage) {
        this.$router.push({ path: `/admin-schedule/${scheduleId}`, query: scheduleReturnQuery(this.$route.query, this.schedule?.season_id) })
        return
      }
      if (window.history.length > 1) {
        this.$router.back()
        return
      }
      this.$router.push('/referee-dashboard')
    }
  }
}
</script>

<style scoped>
@layer legacy {


.report-notice{display:block;position:sticky;top:8px;z-index:20;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;padding:12px;border-radius:8px;line-height:1.6;overflow-wrap:anywhere}
.report-notice-error{background:#fef2f2;color:#991b1b;border-color:#fecaca}.report-notice button{width:auto;padding:2px 8px;margin:0 0 0 8px;background:transparent;color:inherit;border:1px solid currentColor;border-radius:4px}
.revision-confirmation{background:#fffbeb;border:1px solid #fcd34d;color:#78350f;padding:14px;border-radius:8px;margin-top:12px}
.revision-confirmation h4{margin:0}.revision-confirmation button{margin-right:10px;width:auto}
.revision-error{display:block;color:#991b1b;background:#fef2f2;padding:12px;border:1px solid #fecaca;border-radius:6px}
.return-notice{color:#92400e;background:#fffbeb;padding:10px;overflow-wrap:anywhere}
.revision-controls textarea{min-height:75px}.revision-controls select{padding:10px;background:#fff;color:#1f2937}

.alert { display: block; }

.detail-container {
  min-height: 100vh;
  background: #f5f5f5;
  padding: 1.5rem;
}

.header-bar {
  /* 报告页头随文档滚动，避免遮挡手机端的长报告和历史对比。 */
  position: relative;
  top: auto;
  right: auto;
  left: auto;
  width: auto;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  border-radius: 8px;
  gap: 1rem;
}

.header-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.title {
  font-size: 1.2rem;
  font-weight: 600;
}

.subtitle {
  margin-top: 0.4rem;
  font-size: 0.92rem;
  color: rgba(255, 255, 255, 0.85);
}

.status {
  text-align: center;
  padding: 2rem;
  color: #666;
}

.status.error {
  color: #e74c3c;
}

.status-note {
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
  font-size: 0.95rem;
}

.status-note.warn {
  background: #fff7ed;
  color: #c2410c;
  border: 1px solid #fdba74;
}

.content {
  display: grid;
  gap: 1rem;
}

.card {
  background: #fff;
  border-radius: 8px;
  padding: 1.25rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.grid {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.section-header h3,
.card h3,
.card h4,
.card h5 {
  margin: 0;
}

.section-tip {
  margin-top: 0.5rem;
  color: #6b7280;
  font-size: 0.92rem;
}

.summary-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  margin-top: 0.75rem;
}

.summary-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.85rem;
  background: #fafafa;
}

.summary-label {
  color: #6b7280;
  font-size: 0.9rem;
}

.summary-value {
  margin-top: 0.35rem;
  font-weight: 700;
  color: #111827;
}

.summary-meta {
  margin-top: 0.25rem;
  color: #6b7280;
  font-size: 0.88rem;
}

.mode-chip {
  padding: 0.3rem 0.55rem;
  border-radius: 999px;
  background: #e0e7ff;
  color: #4338ca;
  font-size: 0.82rem;
  font-weight: 600;
}

.mode-chip.editable {
  background: #dcfce7;
  color: #166534;
}

.readonly-banner {
  margin-top: 0.9rem;
  padding: 0.8rem 0.9rem;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid #dbeafe;
  color: #1e3a8a;
}

.readonly-banner.admin-banner {
  background: #eef2ff;
  border-color: #c7d2fe;
}

.readonly-fieldset {
  border: none;
  padding: 0;
  margin: 0;
  min-inline-size: auto;
}

.score-error {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  color: #991b1b;
  background: #fee2e2;
  border: 1px solid #fecaca;
  border-radius: 6px;
}

.readonly-fieldset:disabled {
  opacity: 1;
}

.form-row {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.form-row.single-column {
  grid-template-columns: 1fr;
}

.form-group {
  display: flex;
  flex-direction: column;
}

.form-group label {
  color: #333;
  margin-bottom: 0.25rem;
}

input,
select,
textarea {
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 0.45rem;
  background: #fff;
}

input[disabled],
select[disabled],
textarea[disabled] {
  background: #f3f4f6;
  color: #4b5563;
}

textarea {
  min-height: 92px;
}

.subsection {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid #eee;
}

.subsection-tight {
  margin-top: 0.5rem;
}

.form-actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.compact-actions {
  margin-top: 0.5rem;
}

.goal-columns {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}

.goal-column {
  display: grid;
  gap: 0.75rem;
}

.goal-title {
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.empty-tip,
.upload-meta,
.upload-empty,
.tip {
  color: #6b7280;
}

.upload-actions {
  margin-top: 0.75rem;
  display: grid;
  gap: 0.5rem;
}

.upload-input {
  max-width: 420px;
}

.upload-preview {
  display: grid;
  gap: 0.5rem;
}

.preview-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.preview-link {
  color: #4f46e5;
  text-decoration: none;
}

.preview-image {
  max-width: 100%;
  max-height: 420px;
  object-fit: contain;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fafafa;
  cursor: zoom-in;
}

.btn-primary {
  padding: 0.55rem 1rem;
  border: none;
  background: #4f46e5;
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
}

.btn-secondary,
.btn-header {
  padding: 0.45rem 0.8rem;
  border: 1px solid #ccc;
  background: #f9fafb;
  border-radius: 6px;
  cursor: pointer;
  color: #111827;
}

.goal-item,
.card-item,
.review-item {
  margin-bottom: 0.8rem;
  border: 1px solid #e5e7eb;
  padding: 0.8rem;
  border-radius: 6px;
}

.image-modal {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  z-index: 2000;
}

.image-modal-card {
  background: #fff;
  border-radius: 12px;
  width: min(1080px, 100%);
  max-height: 90vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  overflow: hidden;
}

.image-modal-header,
.image-modal-footer {
  padding: 0.9rem 1rem;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.image-modal-footer {
  border-bottom: none;
  border-top: 1px solid #e5e7eb;
}

.image-modal-title {
  font-weight: 700;
  color: #111827;
}

.image-modal-body {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  overflow: auto;
  background: #f8fafc;
}

.image-modal-preview {
  max-width: 100%;
  max-height: 72vh;
  object-fit: contain;
}
@media(max-width:600px){
  .page-container,.page-shell,.report-detail-container,.report-page{min-width:0;padding-left:12px;padding-right:12px}
  .form-row,.summary-grid,.image-layout,.image-grid,.goal-columns{grid-template-columns:minmax(0,1fr)}
  .detail-container{min-width:0;padding:0}.content{padding:12px}
  .form-group,fieldset,.card,.summary-card{min-width:0;max-width:100%;box-sizing:border-box}
  input,select,textarea{min-width:0;width:100%;max-width:100%;box-sizing:border-box}
  .header-bar,.section-header,.summary-header{flex-wrap:wrap;gap:10px}
  .header-actions,.button-row{flex-wrap:wrap}
  .goal-item,.card-item,.review-item{padding:10px;overflow-wrap:anywhere}
}

}
</style>
