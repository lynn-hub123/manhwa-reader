'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const init = app.match(/async function initApp\(\)[\s\S]*?\nfunction spineColor\(/);
const create = app.match(/async function createSeries\([\s\S]*?\nasync function importFilesToSeries/);
const skip = app.match(/const skipCoverBtn[\s\S]*?const selTextBtn/);
const reset = app.match(/const resetCoverBtn[\s\S]*?const makeTextBtn/);

assert.match(app, /function makeTextCover\(name\)/,
  'the default cover generator should use the entered series name');
assert.match(app, /function persistTextCover\(sid,name,options\)/,
  'text cover persistence should have one shared default-cover path');
assert.match(app, /ctx\.font='900 '\+fontSize\+'px "Microsoft YaHei UI","Microsoft YaHei","Noto Sans CJK SC","Arial Black",sans-serif'/,
  'the generated cover should use a bold comic-friendly Chinese font stack');
assert.match(app, /ctx\.lineJoin='round'/,
  'the generated title should use rounded comic lettering');
assert.match(app, /ctx\.shadowOffsetX=8;ctx\.shadowOffsetY=10/,
  'the generated title should keep a small dimensional offset shadow');

assert(init, 'initApp should remain discoverable');
assert.match(init[0], /persistTextCover\(s\.seriesId,s\.name/,
  'startup should fill missing covers with each series name');

assert(create, 'createSeries should remain discoverable');
assert(create[0].indexOf('await persistTextCover(sid,name') >= 0,
  'new series should persist a text cover from the user-entered name');
assert(create[0].indexOf('await persistTextCover(sid,name') < create[0].indexOf('renderBookshelf()'),
  'new series should have its text cover ready before the first bookshelf render');

assert(skip, 'the import cover completion handler should remain discoverable');
assert.doesNotMatch(skip[0], /autoPickCover\(/,
  'finishing import should keep the generated text cover');
assert.match(skip[0], /使用文字封面/,
  'finishing import should describe the text-cover default');

assert(reset, 'the reset-cover handler should remain discoverable');
assert.doesNotMatch(reset[0], /autoPickCover\(/,
  'restoring the default should not choose a PDF page');
assert.match(reset[0], /persistTextCover\(data\.sid/,
  'restoring the default should regenerate the text cover');

console.log('text-cover-default: PASS');
