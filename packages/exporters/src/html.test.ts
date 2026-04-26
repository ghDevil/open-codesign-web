import { describe, expect, it } from 'vitest';
import { buildHtmlDocument } from './html';

describe('buildHtmlDocument', () => {
  it('exports JSX source as browser-openable HTML with the standalone runtime', () => {
    const out = buildHtmlDocument(
      'function App() { return <div className="p-4">hi</div>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      { prettify: false },
    );

    expect(out).toContain('CODESIGN_STANDALONE_RUNTIME');
    expect(out).toContain('window.Babel.transform');
    expect(out).toContain('https://cdn.tailwindcss.com');
    expect(out).not.toContain('CODESIGN_OVERLAY_SCRIPT');
  });
});
