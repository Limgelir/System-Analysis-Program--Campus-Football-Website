import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const source = fs.readFileSync(new URL('../../shared-ui/local-appearance/settings.js', import.meta.url), 'utf8')
const { DEFAULT_APPEARANCE, readAppearance, saveAppearance } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('正式外观参数按角色和账号隔离，损坏或不可用存储回默认', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  saveAppearance(storage, { blur: 9, tint: 22, cards: 'solid' }, 'tj-appearance-v1:player:7')
  assert.equal(readAppearance(storage, 'tj-appearance-v1:player:7').blur, 9)
  assert.deepEqual(readAppearance(storage, 'tj-appearance-v1:referee:7'), DEFAULT_APPEARANCE)
  assert.deepEqual(readAppearance(storage, 'tj-appearance-v1:player:8'), DEFAULT_APPEARANCE)
  values.set('broken', '{')
  assert.deepEqual(readAppearance(storage, 'broken'), DEFAULT_APPEARANCE)
  const blocked = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }
  assert.deepEqual(readAppearance(blocked), DEFAULT_APPEARANCE)
  assert.equal(saveAppearance(blocked, DEFAULT_APPEARANCE), false)
})
