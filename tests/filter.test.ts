import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSettings,syncFilter} from '../src/model';
test('selective sync matches whole paths and Markdown extensions',()=>{
  const includes=syncFilter(loadSettings({markdownOnly:true,excludedPaths:'Private\nMedia/clip.md'}));
  assert.equal(includes('private/note.md'),false);
  assert.equal(includes('Private-copy/note.MD'),true);
  assert.equal(includes('Media/clip.md'),false);
  assert.equal(includes('Media/photo.png'),false);
  assert.equal(syncFilter(loadSettings({}))('Media/photo.png'),true);
});
