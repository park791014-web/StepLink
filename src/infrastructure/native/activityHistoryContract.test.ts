import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)
const database = readFileSync(new URL('android/app/src/main/java/kr/co/steplink/app/StepLinkDatabase.java', root), 'utf8')
const plugin = readFileSync(new URL('android/app/src/main/java/kr/co/steplink/app/NativeGpsPlugin.java', root), 'utf8')
const app = readFileSync(new URL('src/App.tsx', root), 'utf8')
const history = readFileSync(new URL('src/screens/ActivityHistoryScreen.tsx', root), 'utf8')

test('completed activity history is a read-only newest-first SQLite query', () => {
  assert.match(database, /completedActivities[\s\S]*status='COMPLETED'[\s\S]*COALESCE\(ended_at,updated_at\) DESC/)
  assert.match(plugin, /listCompletedActivities[\s\S]*db\.completedActivities/)
  assert.doesNotMatch(database.match(/completedActivities[\s\S]*?return result;/)?.[0] ?? '', /getWritableDatabase|execSQL|\.insert|\.update|\.delete/i)
})

test('history exposes event and personal completion metrics and opens saved detail', () => {
  assert.match(history, /eventContext\?\.eventName/)
  assert.match(history, /filteredDistanceM/)
  assert.match(history, /formatDuration/)
  assert.match(history, /readPoints\(\{ activityId: activity\.id, afterSequence: 0 \}\)/)
  assert.match(app, /history-summary[\s\S]*SummaryScreen/)
})
