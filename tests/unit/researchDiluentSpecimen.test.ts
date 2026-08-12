import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const specimenPath = fileURLToPath(
  new URL('../../public/specimens/bacteriostatic-water-30ml.svg', import.meta.url),
);

describe('Research Diluent Solution specimen artwork', () => {
  it('uses the catalog display name everywhere on the rendered package', () => {
    const specimen = readFileSync(specimenPath, 'utf8');

    expect(specimen.match(/Research Diluent Solution/g)).toHaveLength(4);
    expect(specimen).not.toContain('Bacteriostatic Water');
  });
});
