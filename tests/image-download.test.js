const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/background/background.js', 'utf8');
const functions = source.slice(source.indexOf('async function normalizeImageBlob('),
  source.indexOf('// function to actually download the markdown file'));
const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0];

function setup(blob, imageStyle = 'markdown') {
  const blobs = [];
  const context = vm.createContext({
    Uint8Array,
    FileReader: class {
      readAsArrayBuffer(value) {
        value.arrayBuffer().then(result => {
          this.result = result;
          this.onload();
        });
      }
    },
    XMLHttpRequest: class {
      open() {}
      send() {
        this.response = blob;
        this.onload();
      }
    },
    getOptions: async () => ({ imageStyle }),
    mimedb: { 'image/png': 'png', 'text/plain': 'txt' },
    URL: { createObjectURL(value) { blobs.push(value); return 'blob:test'; } },
  });
  vm.runInContext(functions, context);
  return { context, blobs };
}

for (const style of ['markdown', 'obsidian', 'obsidian-nofolder']) {
  test(`PNG served as text/plain gets a PNG blob and matching ${style} link`, async () => {
    const { context, blobs } = setup(new Blob([new Uint8Array(png)], { type: 'text/plain' }), style);
    const result = await context.preDownloadImages({ 'https://example.com/1': '1.idunno' },
      style === 'markdown' ? '![](1.idunno)' : '![[1.idunno]]');
    assert.equal(result.imageList['blob:test'], '1.png');
    assert.equal(result.markdown, style === 'markdown' ? '![](1.png)' : '![[1.png]]');
    assert.equal(blobs[0].type, 'image/png');
    assert.deepEqual([...new Uint8Array(await blobs[0].arrayBuffer())], png);
  });
}

test('PNG filename is preserved while incorrect MIME type is corrected', async () => {
  const { context, blobs } = setup(new Blob([new Uint8Array(png)], { type: 'text/plain' }));
  const result = await context.preDownloadImages({ url: 'image.png' }, '![](image.png)');
  assert.equal(result.imageList['blob:test'], 'image.png');
  assert.equal(blobs[0].type, 'image/png');
});

test('other signatures are detected and unrecognized content is preserved', async () => {
  const { context } = setup();
  for (const [bytes, type] of [
    [[255, 216, 255], 'image/jpeg'],
    [[71, 73, 70, 56, 57, 97], 'image/gif'],
    [[82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80], 'image/webp'],
  ]) {
    assert.equal((await context.normalizeImageBlob(new Blob([new Uint8Array(bytes)]))).type, type);
  }
  const svg = new Blob(['<svg/>'], { type: 'image/svg+xml' });
  assert.equal(await context.normalizeImageBlob(svg), svg);
});
