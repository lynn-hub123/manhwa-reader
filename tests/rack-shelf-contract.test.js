'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.match(html, /<script src="rack-interaction\.js"><\/script>\s*<script src="app\.js"><\/script>/,
  'rack interaction helpers must load before app.js');
assert.match(html, /\.rack-book\.is-hovered\{/, 'the shelf animation must use a coordinate-driven hover state');
assert.match(html, /\.bs-rack\{[^}]*transform-style:flat/, 'the shelf must keep sibling books out of a shared 3D stacking context');
assert.match(html, /\.rack-book\{[^}]*isolation:isolate/, 'each book must paint as an isolated layer during the lift');
assert.match(html, /\.rack-rigid-book\{/, 'the shelf must render a shared rigid-book body');
assert.match(html, /\.rack-pages\{/, 'the rigid body must include a page block');
assert.match(html, /\.rack-cover-box\{/, 'the rigid body must include front and back cover shells');
assert.match(app, /rack-spine-volume/, 'renderBookshelf must render manga volume markers');
assert.match(app, /rack-spine-imprint/, 'renderBookshelf must render manga spine imprint');
assert.match(app, /rack-rigid-book/, 'renderBookshelf must mount the rigid book body');
assert.match(app, /renderRackMotion/, 'the shelf must animate a shared pose instead of a detached cover');
assert.match(html, /#rack-overlay\{[^}]*position:fixed/, 'the dynamic book layer must live outside the shelf clipping window');
assert.match(app, /ensureRackOverlay/, 'the shelf must create a dedicated dynamic book layer');
assert.match(app, /overlay\.appendChild\(rigid\)/, 'the lifted rigid body must be moved into the dynamic book layer');
assert.match(app, /const cardRect=card\.getBoundingClientRect\(\)/, 'the lifted rigid body must be anchored to the card viewport position');
assert.match(app, /RackInteraction\.findRackBookAtPoint/, 'the shelf must resolve hover by pointer coordinates');
assert.match(app, /addEventListener\('pointermove',[^;]*,true\)/, 'rack pointer tracking must run in capture phase');
assert.match(app, /rackHoverPending=null/, 'a pending hover target must use a distinct empty state so -1 can clear hover');
assert.match(app, /rackHoverPending===null&&index===rackHoverIndex/, 'the hover queue must distinguish an empty pending state from a clear target');

console.log('rack-shelf-contract: PASS');
