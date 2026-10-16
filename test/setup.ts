// Test preload (see bunfig.toml): a DOM for the view code and a fake
// `electrobun/view` so the real view RPC module can run under Bun.
import { mock, spyOn } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { electrobunViewMock } from './helpers/electrobun-view-mock';

if (typeof document === 'undefined') {
  GlobalRegistrator.register({
    url: 'views://mainview/index.html',
    width: 1280,
    height: 900,
  });
}

mock.module('electrobun/view', electrobunViewMock);

// happy-dom has no layout, so give ProseMirror something sane to measure.
if (typeof Element !== 'undefined' && !('__teRectPatched' in Element.prototype)) {
  Object.defineProperty(Element.prototype, '__teRectPatched', { value: true });
  const rect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 100,
    bottom: 20,
    width: 100,
    height: 20,
    toJSON: () => ({}),
  });
  Element.prototype.getBoundingClientRect = rect as unknown as typeof Element.prototype.getBoundingClientRect;
  Element.prototype.getClientRects = (() => [rect()]) as unknown as typeof Element.prototype.getClientRects;
  if (typeof Range !== 'undefined') {
    Range.prototype.getBoundingClientRect = rect as unknown as typeof Range.prototype.getBoundingClientRect;
    Range.prototype.getClientRects = (() => [rect()]) as unknown as typeof Range.prototype.getClientRects;
  }
}

// Expected warnings/errors from the code under test stay out of the test output
// unless TEST_VERBOSE=1.
if (process.env.TEST_VERBOSE !== '1') {
  for (const level of ['info', 'warn', 'error', 'log', 'table'] as const) {
    spyOn(console, level).mockImplementation(() => {});
  }
}
