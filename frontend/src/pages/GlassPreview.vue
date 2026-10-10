<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import GlassSurface from '../components/glass-preview/GlassSurface.vue'

const mode = ref('frosted')
const mobile = ref(false)
const strength = ref(0)
const blur = ref(3)
const tint = ref(8)
const glassCards = ref(true)
const menuOpen = ref(false)
const supported = ref(false)
const reducedMotion = ref(false)
const stageScroll = ref(null)
const menuButton = ref(null)
const dialog = ref(null)
const selectedMatch = ref(null)
const activeSection = ref('overview')
const toast = ref('')
let toastTimer
let motionQuery
let previousTitle
const modes = [{ value: 'original', label: '原版' }, { value: 'frosted', label: '磨砂' }, { value: 'liquid', label: '液态玻璃' }]
const materialProps = computed(() => ({ mode: mode.value, strength: strength.value, blur: blur.value, tint: tint.value, supported: supported.value }))
const cardMaterialProps = computed(() => ({ ...materialProps.value, mode: glassCards.value ? mode.value : 'original' }))
const matches = [
  { id: 1, date: '10 月 10 日', day: '周六', time: '15:00', home: '建筑与城市规划学院', away: '土木工程学院', venue: '四平路校区 · 南操场', role: '主裁判', state: '待执法', score: 'VS' },
  { id: 2, date: '10 月 11 日', day: '周日', time: '13:30', home: '机械与能源工程学院', away: '电子与信息工程学院', venue: '嘉定校区 · 体育场', role: '第一助理裁判', state: '待执法', score: 'VS' },
  { id: 3, date: '09 月 27 日', day: '周日', time: '16:00', home: '经济与管理学院', away: '外国语学院', venue: '四平路校区 · 南操场', role: '主裁判', state: '已完成', score: '2 : 1' },
  { id: 4, date: '09 月 26 日', day: '周六', time: '14:00', home: '汽车学院', away: '交通学院', venue: '嘉定校区 · 体育场', role: '第四官员', state: '已完成', score: '1 : 1' },
  { id: 5, date: '09 月 20 日', day: '周日', time: '15:30', home: '设计创意学院', away: '人文学院', venue: '四平路校区 · 南操场', role: '主裁判', state: '已完成', score: '3 : 2' },
  { id: 6, date: '09 月 19 日', day: '周六', time: '13:00', home: '数学科学学院', away: '物理科学与工程学院', venue: '嘉定校区 · 体育场', role: '第二助理裁判', state: '已完成', score: '0 : 2' }
]
function reset() { mode.value = 'frosted'; strength.value = 0; blur.value = 3; tint.value = 8; glassCards.value = true }
function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) stageScroll.value?.scrollTo({ top: 0, behavior: 'instant' })
}
async function closeMenu() { if (menuOpen.value) { menuOpen.value = false; await nextTick(); menuButton.value?.focus() } }
function notify(message) { clearTimeout(toastTimer); toast.value = message; toastTimer = setTimeout(() => { toast.value = '' }, 3600) }
async function jump(section) {
  activeSection.value = section
  menuOpen.value = false
  await nextTick()
  const element = stageScroll.value?.querySelector(`[data-section="${section}"]`)
  if (element && stageScroll.value) stageScroll.value.scrollTo({ top: stageScroll.value.scrollTop + element.getBoundingClientRect().top - stageScroll.value.getBoundingClientRect().top - 110, behavior: reducedMotion.value ? 'instant' : 'smooth' })
}
async function showMatch(match) { selectedMatch.value = match; await nextTick(); dialog.value?.showModal() }
function closeDialog() { dialog.value?.close(); selectedMatch.value = null }
function updateMotion() { reducedMotion.value = motionQuery.matches }
onMounted(() => {
  previousTitle = document.title
  document.title = '液态玻璃 · 裁判首页本地预览'
  // Conservative gate: CSS.supports alone cannot verify SVG backdrop refraction.
  supported.value = /Chrome\//.test(navigator.userAgent) && !/EdgiOS|CriOS|Firefox|FxiOS/.test(navigator.userAgent) && CSS.supports('backdrop-filter', 'blur(1px)')
  motionQuery = matchMedia('(prefers-reduced-motion: reduce)')
  updateMotion()
  motionQuery.addEventListener('change', updateMotion)
})
onBeforeUnmount(() => { clearTimeout(toastTimer); motionQuery?.removeEventListener('change', updateMotion); if (previousTitle) document.title = previousTitle })
</script>

<template>
  <div class="glass-preview">
    <div class="preview-heading">
      <div><p class="eyebrow">TJ FOOTBALL / MATERIAL STUDY 01</p><h1>让界面，多一点轻盈。</h1><p class="preview-description">裁判首页 · 本地视觉试验 <span>所有姓名与比赛均为示例</span></p></div>
      <a class="back-link" href="/">返回网站 <span aria-hidden="true">↗</span></a>
    </div>

    <section class="preview-controls" aria-label="效果控制">
      <div class="control-top">
        <div class="segmented" role="group" aria-label="玻璃效果">
          <button v-for="item in modes" :key="item.value" :aria-pressed="mode === item.value" @click="mode = item.value">{{ item.label }}</button>
        </div>
        <div class="card-treatment" role="group" aria-label="卡片表面"><span>卡片</span><button :aria-pressed="!glassCards" @click="glassCards = false">实底</button><button :aria-pressed="glassCards" @click="glassCards = true">跟随玻璃</button></div>
        <div class="viewport-control" role="group" aria-label="预览宽度">
          <button :aria-pressed="!mobile" @click="mobile = false; menuOpen = false">桌面</button>
          <button :aria-pressed="mobile" @click="mobile = true; menuOpen = false">手机</button>
        </div>
        <button class="reset-button" @click="reset">恢复默认</button>
      </div>
      <div class="parameter-row">
        <label for="glass-strength">折射 <output>{{ strength }}</output><input id="glass-strength" v-model.number="strength" type="range" min="0" max="100" step="1" :disabled="mode !== 'liquid' || !supported" /></label>
        <label for="glass-blur">模糊 <output>{{ blur }} px</output><input id="glass-blur" v-model.number="blur" type="range" min="0" max="20" step="1" :disabled="mode === 'original'" /></label>
        <label for="glass-tint">底色 <output>{{ tint }}%</output><input id="glass-tint" v-model.number="tint" type="range" min="8" max="85" step="1" :disabled="mode === 'original'" /></label>
        <p class="effect-status"><span :class="{ 'is-liquid': mode === 'liquid' && supported }" />{{ mode === 'original' ? '实色表面' : mode === 'frosted' ? '磨砂表面' : supported ? '折射效果已启用' : '当前浏览器使用磨砂效果' }}</p>
      </div>
    </section>
    <p class="preview-hint"><span aria-hidden="true">↓</span> 顶栏、底栏、赛季注册和比赛卡片共用上方参数；切换卡片“实底／跟随玻璃”可直接比较。<span v-if="mobile">手机模式为窄屏布局预览。</span></p>

    <div class="stage-surround">
      <div class="dashboard-stage" :class="{ 'phone-size': mobile }" :data-mode="mode">
        <div ref="stageScroll" class="stage-scroll" @keydown.esc="closeMenu">
          <div class="ambient-background" aria-hidden="true" />
          <div class="topbar-position">
            <GlassSurface v-bind="materialProps" :radius="22" class="topbar-surface">
              <header class="demo-topbar">
                <a href="#overview" class="demo-brand" @click.prevent="jump('overview')"><img src="/brand-logo.png" alt="同济大学校徽" /><span>同济校园足球<small>裁判工作台</small></span></a>
                <span class="topbar-motto">赛场上的每一份热爱</span>
                <button ref="menuButton" class="menu-toggle" :aria-expanded="menuOpen" aria-controls="demo-navigation" @click="toggleMenu">{{ menuOpen ? '收起菜单' : '展开菜单' }}</button>
                <button class="avatar-button" aria-label="查看示例账号" @click="notify('当前为示例账号。验收时可测试导航、滚动和比赛详情。')">林</button>
              </header>
            </GlassSurface>
          </div>
          <div class="demo-workspace">
            <aside id="demo-navigation" class="demo-sidebar" :class="{ 'menu-open': menuOpen }">
              <p class="nav-label">我的赛季</p>
              <button :class="{ current: activeSection === 'overview' }" @click="jump('overview')"><span aria-hidden="true">◫</span>裁判首页</button>
              <button :class="{ current: activeSection === 'registration' }" @click="jump('registration')"><span aria-hidden="true">▤</span>赛季注册</button>
              <button @click="notify('选派报名入口演示：当前页面只使用示例数据。')"><span aria-hidden="true">＋</span>选派报名</button>
              <p class="nav-label second-group">我的执法</p>
              <button :class="{ current: activeSection === 'assignments' }" @click="jump('assignments')"><span aria-hidden="true">☷</span>执法与报告</button>
              <button @click="notify('示例统计：本赛季执法 8 场，待执法 2 场。')"><span aria-hidden="true">▥</span>个人统计</button>
              <div class="sidebar-note"><span class="season-dot" />2026 秋季赛季<small>认真对待每一次哨响。</small></div>
            </aside>

            <main class="demo-main">
              <section data-section="overview" class="welcome-section-preview">
                <div class="welcome-copy"><p class="eyebrow">2026 / AUTUMN SEASON</p><h2>我的赛季与执法</h2><p>欢迎回来，林同学。<br class="mobile-break" />新一场比赛，准备就绪。</p><span class="grade-tag">二级裁判员 <span aria-hidden="true">·</span> 示例账号</span></div>
                <div class="pitch-art" aria-hidden="true"><div class="pitch-markings"><i /><b /><em /></div><span>FOR THE LOVE<br />OF THE GAME.</span><small>TONGJI FOOTBALL</small></div>
              </section>

              <div class="stats-strip"><div><span>本赛季执法</span><strong>08<small>场</small></strong></div><div><span>待执法比赛</span><strong>02<small>场</small></strong></div><div><span>当前注册状态</span><strong class="status-value"><i />已通过</strong></div></div>

              <section data-section="registration" class="registration-surface">
                <GlassSurface v-bind="cardMaterialProps" :radius="16"><div class="registration-panel">
                <div class="registration-icon" aria-hidden="true">✓</div><div><h3>本赛季注册已通过</h3><p>2026 秋季 · 可以报名比赛与接受选派</p></div><button class="subtle-button" @click="notify('示例注册：已通过审核。当前无需提交任何资料。')">查看注册 <span aria-hidden="true">↗</span></button>
                </div></GlassSurface>
              </section>

              <section data-section="assignments" class="assignment-section">
                <div class="list-heading"><div><p class="eyebrow">YOUR MATCHES</p><h3>我的执法列表 <span>{{ matches.length }}</span></h3></div><button class="subtle-button" @click="notify('示例比赛已刷新，共 6 场。')">刷新列表 <span aria-hidden="true">↻</span></button></div>
                <article v-for="match in matches" :key="match.id" class="match-surface">
                  <GlassSurface v-bind="cardMaterialProps" :radius="15"><div class="match-card">
                  <div class="match-meta"><span>{{ match.date }} <span class="muted-dot">/</span> {{ match.day }} {{ match.time }}</span><span class="match-state" :class="{ completed: match.state === '已完成' }">{{ match.state }}</span></div>
                  <div class="match-teams"><span>{{ match.home }}</span><strong :class="{ 'versus-label': match.score === 'VS' }">{{ match.score }}</strong><span>{{ match.away }}</span></div>
                  <div class="match-bottom"><p>{{ match.venue }}<span class="role-badge">{{ match.role }}</span></p><button @click="showMatch(match)">查看详情 <span aria-hidden="true">↗</span></button></div>
                  </div></GlassSurface>
                </article>
              </section>
              <footer class="demo-footer">同济校园足球 · 以热爱赴赛场<small>本地预览 · 示例数据</small></footer>
            </main>
          </div>
        </div>
        <div class="dock-position">
          <GlassSurface v-bind="materialProps" :radius="26">
            <nav class="demo-dock" aria-label="快捷操作"><button @click="jump('overview')"><span aria-hidden="true">⌂</span>回到首页</button><span class="dock-divider" /><button @click="jump('assignments')"><span aria-hidden="true">☷</span>我的比赛</button><button class="dock-primary" @click="notify('选派报名入口演示：验收页面不提交业务数据。')"><span aria-hidden="true">＋</span>选派报名</button></nav>
          </GlassSurface>
        </div>
        <p v-if="toast" class="preview-toast" role="status">{{ toast }}</p>
      </div>
    </div>
    <p class="acceptance-note">默认使用你选定的磨砂 3px／底色 8%。建议先比较卡片实底与玻璃，再调整参数、滚动列表和查看手机布局。</p>

    <dialog ref="dialog" class="match-dialog" @close="selectedMatch = null" @click="event => { if (event.target === dialog) closeDialog() }">
      <template v-if="selectedMatch"><div class="dialog-heading"><span class="eyebrow">示例比赛</span><button aria-label="关闭比赛详情" @click="closeDialog">×</button></div><h2>{{ selectedMatch.home }}<span>对阵</span>{{ selectedMatch.away }}</h2><dl><div><dt>开球时间</dt><dd>{{ selectedMatch.date }} {{ selectedMatch.time }}</dd></div><div><dt>比赛场地</dt><dd>{{ selectedMatch.venue }}</dd></div><div><dt>执法岗位</dt><dd>{{ selectedMatch.role }}</dd></div></dl><p>此弹窗用于验收文字、层级和键盘操作，内容均为示例。</p><button class="dialog-done" @click="closeDialog">完成</button></template>
    </dialog>
  </div>
</template>

<style scoped>
.card-treatment{display:flex;align-items:center;gap:3px;padding:3px;background:#eff3f7;border:1px solid #e5ebf1;border-radius:12px}
.card-treatment>span{font-size:11px;color:#6b7d90;padding:0 7px}
.glass-preview .card-treatment button{font-size:11px;padding:8px 10px;min-height:34px;white-space:nowrap}
.card-treatment button[aria-pressed=true]{background:#fff;box-shadow:0 1px 5px #19395115;color:#194f87}
.glass-preview .control-top{flex-wrap:wrap}
.registration-surface{margin-bottom:35px}
.match-surface{margin-bottom:12px}
.registration-surface .registration-panel,.match-surface .match-card{background:transparent;border:0;box-shadow:none;margin-bottom:0}
.glass-preview{--preview-ink:#172e49;--preview-muted:#657a91;padding:34px 34px 22px;max-width:1520px;margin:0 auto;color:var(--preview-ink);font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif}
.glass-preview *{box-sizing:border-box}.glass-preview h1,.glass-preview h2,.glass-preview h3,.glass-preview p{margin:0}.glass-preview button{font:inherit;min-height:40px;font-size:13px;font-weight:600;border:0;box-shadow:none;transition:background .16s,color .16s;background:transparent;padding:9px 14px;border-radius:12px;color:var(--preview-ink);cursor:pointer}.glass-preview button:hover{background:#123b6d0c}.glass-preview button:focus-visible,.glass-preview a:focus-visible{outline:3px solid #347bd0;outline-offset:3px}.glass-preview button:disabled{cursor:not-allowed;opacity:.4}.glass-preview a{text-decoration:none;color:inherit}
.preview-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:0 0 23px}.glass-preview .eyebrow{font-size:10px;font-weight:700;letter-spacing:2px;color:#6b8298}.preview-heading h1{font-size:29px;font-weight:650;letter-spacing:-1px;line-height:1.7;margin-top:5px}.glass-preview .preview-description{font-size:13px;color:#61768b;margin-top:5px}.preview-description span{padding-left:14px;color:#8a97a7}.back-link{font-size:12px;border-bottom:1px solid #c5d1de;padding:8px 0;white-space:nowrap}.back-link span{padding-left:16px}
.preview-controls{background:#fff;border:1px solid #dce5ee;border-radius:18px;padding:12px 18px;box-shadow:0 3px 16px #15365503}.control-top{display:flex;gap:18px;align-items:center}.segmented,.viewport-control{display:flex;background:#eff3f7;border:1px solid #e5ebf1;border-radius:12px;padding:3px}.glass-preview .segmented button{min-width:92px}.segmented button[aria-pressed=true],.viewport-control button[aria-pressed=true]{background:#fff;box-shadow:0 1px 5px #19395115;color:#194f87}.viewport-control{margin-left:auto}.glass-preview .viewport-control button{min-height:34px;padding:6px 13px;font-size:12px}.glass-preview .reset-button{font-size:12px;color:#6b7d90;padding-inline:6px}.parameter-row{display:flex;align-items:center;gap:28px;padding:12px 0 2px}.parameter-row label{display:grid;grid-template-columns:1fr auto;gap:0 8px;flex:1;min-width:0;font-size:11px;color:#5e7287;font-weight:500;margin:0}.parameter-row output{font-variant-numeric:tabular-nums;color:#203f60}.glass-preview .parameter-row input{grid-column:1/-1;width:100%;min-width:0;min-height:22px;height:22px;padding:0;margin:0;accent-color:#37648d;background:transparent;border:0;box-shadow:none}.effect-status{font-size:11px;color:#6b7d90;min-width:140px;display:flex;align-items:center;gap:7px}.effect-status>span{width:6px;height:6px;border-radius:50%;background:#8c9aac}.effect-status>span.is-liquid{background:#43877b}.glass-preview .preview-hint{font-size:11px;color:#8191a3;margin:13px 3px 14px}.preview-hint>span:first-child{margin-right:8px}.preview-hint>span:last-child:not(:first-child){margin-left:10px}
.stage-surround{display:flex;justify-content:center;background:#e9eef4;padding:14px;border-radius:26px;border:1px solid #dbe3ec}.dashboard-stage{container-type:inline-size;width:100%;height:780px;max-height:calc(100dvh - 170px);min-height:530px;position:relative;border:1px solid #d5dfeb;border-radius:18px;overflow:hidden;box-shadow:0 20px 50px #12355e0d;background:#f2f6fb}.dashboard-stage.phone-size{max-width:390px;height:780px;max-height:none;border:5px solid #20364a;border-radius:35px;box-shadow:0 16px 40px #162a4530}.stage-scroll{height:100%;overflow-y:auto;overflow-x:hidden;position:relative;scrollbar-width:thin;scrollbar-color:#b6c8d8 transparent;padding-bottom:80px}.ambient-background{position:absolute;inset:0 0 auto;height:1000px;pointer-events:none;background:radial-gradient(ellipse at 95% 5%,#a8caf287,transparent 45%),radial-gradient(ellipse at 20% 45%,#d2e9ee90,transparent 44%),linear-gradient(120deg,#edf3fa,#f8fbfd);z-index:0}.topbar-position{position:sticky;top:12px;z-index:30;margin:12px 16px 0}.demo-topbar{display:flex;align-items:center;gap:18px;padding:12px 19px;min-height:70px}.demo-brand{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:650;letter-spacing:.3px}.demo-brand img{width:36px;height:36px;object-fit:contain}.demo-brand small{display:block;font-size:9px;font-weight:400;letter-spacing:2px;color:#617b93;margin-top:1px}.topbar-motto{font-size:11px;color:#6a8198;margin-left:auto}.glass-preview .avatar-button{border-radius:50%;background:#e1edf9;border:1px solid #ffffffa0;width:34px;height:34px;min-height:34px;padding:0;font-size:12px;color:#2b5681}.glass-preview .menu-toggle{display:none}
.demo-workspace{display:grid;grid-template-columns:180px minmax(0,1fr);position:relative;align-items:start;padding:35px 30px 0 20px;gap:26px}.demo-sidebar{position:sticky;top:114px;padding:4px 5px}.demo-sidebar .nav-label{font-size:10px;letter-spacing:1px;color:#8393a4;margin:0 12px 12px}.demo-sidebar button{display:flex;gap:13px;align-items:center;width:100%;text-align:left;font-size:12px;font-weight:500;min-height:43px;margin:3px 0;padding:10px 13px}.demo-sidebar button>span{font-size:18px;color:#617d99;width:18px;text-align:center;line-height:1}.demo-sidebar button.current{background:#e0ebf6;color:#174b7e}.demo-sidebar .second-group{margin-top:34px}.sidebar-note{font-size:10px;margin:65px 12px 0;color:#6d879e}.sidebar-note small{display:block;font-size:10px;margin-top:7px;color:#9aa8b4}.season-dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:#658d89;margin-right:7px}.demo-main{min-width:0;max-width:980px}.welcome-section-preview{position:relative;display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:215px;padding:12px 8px 18px}.welcome-copy{position:relative;z-index:1}.welcome-copy h2{font-size:30px;font-weight:650;line-height:1.4;letter-spacing:-.7px;margin:13px 0}.welcome-copy>p:not(.eyebrow){font-size:12px;line-height:1.9;color:#6b8095}.grade-tag{display:inline-block;margin-top:16px;font-size:10px;color:#5a748d;border:1px solid #cbdceacc;padding:4px 10px;border-radius:20px}.grade-tag>span{margin:0 5px}.mobile-break{display:none}.pitch-art{position:relative;width:235px;height:190px;flex-shrink:0;border-radius:24px;overflow:hidden;background:linear-gradient(145deg,#204872,#14344f);box-shadow:0 15px 34px #1b456c1a;transform:rotate(-5deg);color:white}.pitch-art:after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 0 100%,#5590b75e,transparent 70%)}.pitch-markings{position:absolute;width:190px;height:270px;border:1px solid #d4efff30;right:-35px;top:-22px;transform:rotate(25deg)}.pitch-markings:before{content:'';position:absolute;inset:50% 0 auto;border-top:1px solid #d4efff30}.pitch-markings i{position:absolute;left:50%;top:50%;width:76px;height:76px;transform:translate(-50%,-50%);border:1px solid #d4efff30;border-radius:50%}.pitch-markings b,.pitch-markings em{position:absolute;width:110px;height:42px;left:40px;border:1px solid #d4efff30;top:-1px}.pitch-markings em{top:auto;bottom:-1px}.pitch-art>span{position:absolute;z-index:1;left:23px;top:48px;font-size:22px;font-weight:650;letter-spacing:-.5px;line-height:1.2}.pitch-art>small{position:absolute;bottom:21px;left:24px;font-size:7px;letter-spacing:2.5px;color:#b7d2e6}
.stats-strip{display:grid;grid-template-columns:repeat(3,1fr);padding:24px 0;border-top:1px solid #ccdce880;border-bottom:1px solid #ccdce880;margin:18px 0 24px}.stats-strip>div{padding:0 25px;border-right:1px solid #ccdce890}.stats-strip>div:first-child{padding-left:9px}.stats-strip>div:last-child{border:0}.stats-strip>div>span{display:block;font-size:10px;color:#768a9d}.stats-strip strong{display:block;font-size:32px;line-height:1.5;font-weight:500;letter-spacing:-1px;font-variant-numeric:tabular-nums;margin-top:3px}.stats-strip strong>small{font-size:10px;font-weight:400;margin-left:7px;color:#8093a5;letter-spacing:0}.stats-strip .status-value{font-size:17px;letter-spacing:0;margin-top:13px;color:#346e65}.status-value>i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#6c9d8b;margin-right:7px}
.registration-panel{display:flex;align-items:center;gap:13px;padding:18px 20px;background:#faffff;border:1px solid #d7e6e5;border-radius:16px;margin-bottom:35px}.registration-icon{width:33px;height:33px;border-radius:50%;display:grid;place-items:center;background:#e6f1ed;color:#3e7c6b;font-size:15px;flex-shrink:0}.registration-panel h3{font-size:12px;font-weight:600}.registration-panel p{font-size:10px;color:#7a9395;margin-top:4px}.glass-preview .subtle-button{font-size:11px;color:#688198;padding:7px 8px;white-space:nowrap}.registration-panel>button{margin-left:auto}.subtle-button>span{margin-left:7px}.list-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:17px;padding:0 3px}.list-heading h3{font-size:19px;font-weight:600;margin-top:5px}.list-heading h3>span{font-size:10px;vertical-align:middle;background:#e2ebf5;border-radius:6px;padding:2px 6px;margin-left:6px;color:#5b7792}.match-card{padding:18px 21px;background:#fff;border:1px solid #dfe7ef;border-radius:15px;margin-bottom:12px;box-shadow:0 2px 8px #16395703}.match-meta{display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#71889f;gap:10px}.muted-dot{margin:0 7px;color:#b3bec9}.match-state{font-size:9px;border-radius:5px;padding:3px 7px;background:#eef4fc;color:#4475a2;white-space:nowrap}.match-state.completed{background:#eff4f2;color:#7b928a}.match-teams{display:grid;grid-template-columns:1fr 60px 1fr;align-items:center;gap:10px;padding:22px 0;font-size:15px;font-weight:600}.match-teams>span:last-child{text-align:right}.match-teams>strong{text-align:center;white-space:nowrap;font-size:20px;font-weight:500;color:#315574}.match-teams>strong.versus-label{font-size:11px;font-weight:500;letter-spacing:2px;color:#aab9c7}.match-bottom{border-top:1px solid #edf1f6;padding-top:11px;display:flex;justify-content:space-between;align-items:center;gap:10px}.match-bottom p{display:flex;align-items:center;flex-wrap:wrap;gap:10px;font-size:10px;color:#8497a8}.role-badge{font-size:9px;color:#667e95;background:#f1f5f9;border-radius:4px;padding:2px 5px}.glass-preview .match-bottom button{font-size:10px;color:#315d87;padding:4px 2px;min-height:32px;white-space:nowrap}.match-bottom button>span{margin-left:9px}.demo-footer{text-align:center;padding:35px 0 45px;color:#8093a4;font-size:10px}.demo-footer small{display:block;font-size:9px;color:#a2b0bc;margin-top:6px}
.dock-position{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);z-index:40;width:max-content;max-width:calc(100% - 32px)}.demo-dock{display:flex;align-items:center;gap:5px;padding:7px}.glass-preview .demo-dock button{font-size:11px;display:flex;align-items:center;gap:7px;padding:10px 14px;min-height:41px;white-space:nowrap;border-radius:19px}.demo-dock button>span{font-size:17px;line-height:1}.dock-divider{height:17px;width:1px;background:#8da8c14a;margin:0 2px}.glass-preview .demo-dock .dock-primary{color:#fff;background:#275f92;box-shadow:inset 0 1px 0 #ffffff38}.glass-preview .demo-dock .dock-primary:hover{background:#184b7b}.preview-toast{position:absolute;left:50%;bottom:93px;transform:translateX(-50%);z-index:50;background:#173249f2;color:#fff;font-size:12px;line-height:1.7;padding:12px 18px;border-radius:14px;box-shadow:0 6px 24px #16344b26;width:max-content;max-width:calc(100% - 32px);text-align:center}.glass-preview .acceptance-note{font-size:11px;text-align:center;color:#8a99a8;margin:18px 0 0}
.match-dialog{border:1px solid #d9e3ec;border-radius:24px;padding:26px;width:min(450px,calc(100vw - 36px));margin:auto;color:#203d59;box-shadow:0 25px 100px #152f4c40;background:#fff;max-height:calc(100dvh - 40px);overflow:auto}.match-dialog::backdrop{background:#15354f55;backdrop-filter:blur(4px)}.dialog-heading{display:flex;align-items:center;justify-content:space-between}.glass-preview .dialog-heading button{font-size:25px;min-width:42px;padding:2px}.match-dialog h2{font-size:21px;line-height:1.5;margin:20px 0}.match-dialog h2>span{display:block;font-size:11px;font-weight:400;color:#8a9baa;margin:9px 0}.match-dialog dl{margin:0}.match-dialog dl>div{display:flex;gap:20px;justify-content:space-between;border-top:1px solid #e8eef4;padding:13px 0;font-size:12px}.match-dialog dt{color:#7a8d9e;white-space:nowrap}.match-dialog dd{margin:0;text-align:right}.match-dialog p{font-size:11px;color:#8a9baa;line-height:1.8;margin-top:17px}.glass-preview .dialog-done{display:block;background:#275f92;color:#fff;width:100%;margin-top:21px}
@container(max-width:850px){.demo-workspace{grid-template-columns:145px minmax(0,1fr);gap:15px;padding:25px 23px 0 12px}.pitch-art{width:165px;height:170px}.pitch-art>span{font-size:18px;left:17px}.pitch-art>small{left:17px}.welcome-copy h2{font-size:25px}.welcome-copy>p:not(.eyebrow){font-size:11px}.stats-strip>div{padding-inline:15px}.match-teams{font-size:12px;grid-template-columns:1fr 46px 1fr}}
@container(max-width:640px){.topbar-position{top:10px;margin:10px 10px 0}.demo-topbar{padding:11px 13px;gap:9px;min-height:66px}.demo-brand{font-size:12px;gap:8px}.demo-brand img{width:29px;height:29px}.demo-brand small{font-size:8px;letter-spacing:1px}.topbar-motto,.avatar-button{display:none}.glass-preview .menu-toggle{display:block;margin-left:auto;font-size:10px;padding:6px 8px;min-height:34px}.demo-workspace{display:block;padding:20px 18px 0}.demo-sidebar{display:none;position:relative;top:auto;background:#f5f9fd;border:1px solid #d8e3ee;border-radius:17px;padding:18px;margin-bottom:18px}.demo-sidebar.menu-open{display:block}.sidebar-note{display:none}.demo-sidebar .second-group{margin-top:17px}.welcome-section-preview{min-height:180px;padding:10px 0 14px;gap:9px}.welcome-copy h2{font-size:24px;white-space:nowrap}.welcome-copy .eyebrow{font-size:8px;letter-spacing:1.2px}.welcome-copy>p:not(.eyebrow){font-size:11px}.mobile-break{display:block}.grade-tag{font-size:9px;margin-top:13px}.pitch-art{position:absolute;width:110px;height:150px;right:0;top:12px;opacity:.12;transform:rotate(-12deg)}.pitch-art>span{display:none}.stats-strip{margin:10px 0 17px;padding:18px 0}.stats-strip>div{padding:0 12px}.stats-strip>div:first-child{padding-left:0}.stats-strip>div>span{font-size:9px}.stats-strip strong{font-size:27px}.stats-strip .status-value{font-size:14px;margin-top:12px}.registration-panel{padding:15px 12px;gap:10px;flex-wrap:wrap;margin-bottom:27px}.registration-panel h3{font-size:11px}.registration-panel p{font-size:9px}.registration-panel>button{font-size:10px;min-height:30px;padding:4px 0;margin-left:43px}.list-heading h3{font-size:17px}.list-heading .eyebrow{font-size:9px}.match-card{padding:14px}.match-meta{font-size:9px}.muted-dot{margin:0 3px}.match-teams{font-size:12px;grid-template-columns:1fr 34px 1fr;gap:7px;line-height:1.7;padding:18px 0}.match-teams>strong{font-size:17px}.match-bottom p{gap:5px;font-size:9px}.match-bottom button{font-size:9px}.role-badge{font-size:8px}.dock-position{bottom:14px;max-width:calc(100% - 20px)}.demo-dock{padding:6px;gap:1px}.glass-preview .demo-dock button{font-size:10px;padding:10px 11px;gap:5px;min-height:41px}.demo-dock button>span{font-size:15px}}
@media(max-width:700px){.glass-preview{padding:21px 12px 18px}.preview-heading{gap:10px;margin-bottom:17px}.preview-heading h1{font-size:24px;letter-spacing:-.6px}.preview-heading .eyebrow{font-size:8px;letter-spacing:1.5px}.preview-heading .preview-description{font-size:11px}.preview-description span{display:block;padding:0;margin-top:4px;font-size:10px}.back-link{font-size:10px}.back-link span{padding-left:4px}.preview-controls{padding:10px 12px}.control-top{gap:8px;flex-wrap:wrap}.glass-preview .segmented button{min-width:0;font-size:11px;padding:8px 13px;min-height:34px}.viewport-control{margin-left:auto}.glass-preview .viewport-control button{font-size:10px;padding:6px 8px}.glass-preview .reset-button{font-size:10px;margin-left:auto}.parameter-row{gap:12px;flex-wrap:wrap;padding-top:8px}.parameter-row label{flex:1 1 25%;font-size:10px}.effect-status{flex-basis:100%;font-size:10px}.stage-surround{padding:6px;border-radius:21px}.dashboard-stage{min-height:560px;max-height:none;height:700px}.dashboard-stage.phone-size{max-width:390px;height:720px}.glass-preview .preview-hint{font-size:10px;line-height:1.7;margin:10px 3px}.glass-preview .acceptance-note{font-size:10px;line-height:1.8;padding:0 10px}}
@media(prefers-reduced-motion:reduce){.glass-preview *{scroll-behavior:auto!important;transition:none!important}}
</style>
