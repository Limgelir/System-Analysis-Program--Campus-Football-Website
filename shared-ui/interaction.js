// No drafts are persisted: credentials, reports and private roster data stay in memory.
const drafts = new Map()
const snapshot = value => JSON.stringify(value, (_key, item) => typeof File !== 'undefined' && item instanceof File ? [item.name, item.size, item.lastModified] : item)
const isDirty = entry => entry.binding.ready !== false && snapshot(entry.binding.value) !== entry.accepted && (typeof entry.binding.dirty === 'boolean' ? entry.binding.dirty : snapshot(entry.binding.value) !== entry.baseline)
export function confirmDraftLeave(root = document, clear = true) {
  if (!root?.contains) return true
  const entries = [...drafts].filter(([el, entry]) => el.isConnected && root.contains(el) && isDirty(entry))
  if (!entries.length) return true
  if (!window.confirm('有尚未保存的内容。离开后将丢失这些修改，确定离开吗？')) return false
  if (clear) for (const [, entry] of entries) entry.accepted = snapshot(entry.binding.value)
  return true
}
export function markDraftSaved(root) {
  if (!root) return
  for (const [el, entry] of drafts) if (root === el || root.contains(el)) { entry.baseline = snapshot(entry.binding.value); entry.accepted = entry.baseline }
}
export function installInteraction(app, router) {
  app.config.globalProperties.$confirmLeave = confirmDraftLeave
  app.config.globalProperties.$markDraftSaved = markDraftSaved
  app.directive('draft', {
    mounted(el, { value }) { drafts.set(el, { binding: value, baseline: snapshot(value.value), key: value.resetKey }) },
    updated(el, { value }) {
      const entry = drafts.get(el)
      if (!entry) return
      if (entry.key !== value.resetKey || entry.binding.ready === false) entry.baseline = snapshot(value.value)
      entry.binding = value; entry.key = value.resetKey
      el.toggleAttribute('data-unsaved', isDirty(entry))
    },
    unmounted(el) { drafts.delete(el) }
  })
  router.beforeEach((to, from) => to.path === from.path && JSON.stringify(to.query) === JSON.stringify(from.query) || confirmDraftLeave())
  window.addEventListener('beforeunload', event => {
    if ([...drafts].some(([el, entry]) => el.isConnected && isDirty(entry))) { event.preventDefault(); event.returnValue = '' }
  })
  let fieldSequence = 0
  const showFieldError = input => {
    if (!input.id) input.id = `ui-field-${++fieldSequence}`
    let message = document.getElementById(input.id + '-error')
    if (!message) { message = document.createElement('span'); message.id = input.id + '-error'; message.className = 'field-error'; input.after(message) }
    message.textContent = input.validationMessage; input.setAttribute('aria-invalid', 'true')
    const described = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean)); described.add(message.id)
    input.setAttribute('aria-describedby', [...described].join(' '))
  }
  document.addEventListener('invalid', event => showFieldError(event.target), true)
  document.addEventListener('input', event => {
    const input = event.target
    if (!input.matches('input,select,textarea') || !input.hasAttribute('aria-invalid')) return
    if (!input.validity.valid) return showFieldError(input)
    input.removeAttribute('aria-invalid'); document.getElementById(input.id + '-error')?.remove()
  })
  const focusable = root => [...root.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el => el.getClientRects().length)
  const dialogs = new Map()
  function enhance() {
    for (const [dialog, opener] of dialogs) if (!dialog.isConnected) { dialogs.delete(dialog); if (opener?.isConnected) opener.focus() }
    for (const dialog of document.querySelectorAll('.modal-overlay > div, .modal-mask > div, .modal-mask > form, .external-dialog, [role="dialog"]')) {
      if (dialogs.has(dialog) || !dialog.getClientRects().length) continue
      dialogs.set(dialog, document.activeElement); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true')
      const title = dialog.querySelector('h2,h3,.modal-title,.dialog-title')
      if (title && !dialog.hasAttribute('aria-labelledby')) { if (!title.id) title.id = `ui-dialog-${++fieldSequence}`; dialog.setAttribute('aria-labelledby', title.id) }
      dialog.tabIndex = -1; (focusable(dialog)[0] || dialog).focus()
    }
    for (const input of document.querySelectorAll('.ui-app input,.ui-app select,.ui-app textarea')) {
      if (input.closest('label') || input.hasAttribute('aria-label') || input.hasAttribute('aria-labelledby')) continue
      if (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) continue
      const label = input.closest('.form-group')?.querySelector('label') || (input.previousElementSibling?.tagName === 'LABEL' ? input.previousElementSibling : null)
      if (label) { if (!input.id) input.id = `ui-field-${++fieldSequence}`; label.htmlFor = input.id }
      else if (input.placeholder) input.setAttribute('aria-label', input.placeholder)
    }
    for (const el of document.querySelectorAll('.ui-app .alert.error,.ui-app .form-error,.ui-app .error-state')) el.setAttribute('role','alert')
    for (const el of document.querySelectorAll('.ui-app .alert.success,.ui-app .loading-state')) el.setAttribute('role','status')
  }
  const observer = new MutationObserver(enhance)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('click', event => {
    const button = event.target.closest('button')
    const dialog = event.target.closest('[role="dialog"]')
    const overlay = event.target.matches('.modal-overlay,.modal-mask,.external-overlay') ? event.target : null
    if (overlay || dialog && button && (button.matches('.close-btn,.modal-close,.close-icon,[data-close]') || /^(取消|关闭|×)$/.test(button.textContent.trim()))) {
      if (!confirmDraftLeave(overlay || dialog)) { event.preventDefault(); event.stopImmediatePropagation() }
    }
  }, true)
  document.addEventListener('keydown', event => {
    const dialog = [...dialogs.keys()].filter(el => el.isConnected).at(-1)
    if (!dialog) return
    if (event.key === 'Tab') {
      const items = focusable(dialog), first = items[0] || dialog, last = items.at(-1) || dialog
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    if (event.key === 'Escape') {
      const close = dialog.querySelector('button.close-btn:not(:disabled),button.modal-close:not(:disabled),button.close-icon:not(:disabled),button[data-close]:not(:disabled)') || focusable(dialog).find(el => el.tagName === 'BUTTON' && /^(取消|关闭)$/.test(el.textContent.trim()))
      if (close) { event.preventDefault(); close.click() }
    }
  })
  router.afterEach((to, from, failure) => {
    if (failure || to.path === from.path) return
    requestAnimationFrame(() => {
      const title = document.querySelector('#page-content h1,#page-content .header-bar .title,#page-content h2')
      if (title) { title.setAttribute('tabindex','-1'); title.focus({preventScroll:true}); document.title = title.textContent.trim() + ' · 同济校园足球' }
    })
  })
}
