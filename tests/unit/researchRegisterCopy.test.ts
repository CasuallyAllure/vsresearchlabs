/**
 * Research-register pins for the public compound copy.
 *
 * Audit finding (docs/RESEARCH_CONTENT_SEPARATION_BLUEPRINT.md §3.2, §3.5):
 * the `laymanSummary` layer — not the product pages — was the compliance
 * exposure. It carried consumer drug-brand anchors, human-outcome claims,
 * routes of administration implying human use, and second-person physiology.
 * The classification taxonomy compounded it with a class labelled
 * "Antioxidant / Beauty".
 *
 * These are data-scanning tests, matching the precedent set by
 * documentPlaceholders.test.ts: the guarantee lives in the seed data, so the
 * seed data is what gets asserted. They pin the register — not the prose — so
 * copy can keep being edited, but cannot regress into consumer-retail voice.
 *
 * `laymanSummary` stays plain-English on purpose. Readability is an asset;
 * it is the FRAMING that must stay research-side.
 */
import { describe, expect, test } from 'vitest';

import generated from '../../src/data/biopeptideCompounds.generated.json';
import productsData from '../../src/data/products.json';
import {
  CLASSIFICATION_LABELS,
  CLASSIFICATION_DEFINITIONS,
  CLASSIFICATION_LAYMAN,
  CLASSIFICATION_SECTION_BLURB,
} from '../../src/lib/compoundIntelligence';

interface SummaryRecord {
  slug: string;
  laymanSummary?: string;
}

function readSummaries(data: unknown): SummaryRecord[] {
  const rows = (Array.isArray(data) ? data : (data as { products: unknown[] }).products) as SummaryRecord[];
  return rows.filter((row) => typeof row.laymanSummary === 'string');
}

const GENERATED = readSummaries(generated);
const HAND_AUTHORED = readSummaries(productsData);
const ALL_SUMMARIES = [...GENERATED, ...HAND_AUTHORED];

/** Slugs whose offending phrase must never come back, with the reason. */
const BANNED_PATTERNS: { label: string; pattern: RegExp }[] = [
  // Consumer drug-brand anchors — these name retail medicines, not research
  // compounds, and invite a human-use read of the catalog.
  { label: 'consumer drug brand name', pattern: /\b(ozempic|wegovy|mounjaro|zepbound|saxenda|trulicity|victoza)\b/i },
  // Administration route / schedule language implying a human subject.
  { label: 'administration route implying human use', pattern: /\btaken (intranasally|orally|subcutaneously)\b/i },
  { label: 'human dosing schedule', pattern: /\b(once-weekly|once weekly|daily) (research )?dosing\b/i },
  { label: 'per-dose human framing', pattern: /\bper dose\b/i },
  // Second-person framing — the reader is not the research subject.
  { label: 'second-person physiology', pattern: /\byour (body|system|brain|skin|cells)\b/i },
];

describe('laymanSummary research register', () => {
  test('covers every generated compound and every hand-authored peptide', () => {
    expect(GENERATED).toHaveLength(50);
    expect(HAND_AUTHORED).toHaveLength(13);
  });

  test.each(BANNED_PATTERNS)('no summary contains a $label', ({ pattern }) => {
    const offenders = ALL_SUMMARIES
      .filter((row) => pattern.test(row.laymanSummary!))
      .map((row) => row.slug);

    expect(offenders).toEqual([]);
  });

  test('preserves the inline emphasis markup the summary renderer parses', () => {
    // SummaryText renders **bold** / *italic* / ~stat~. A summary that lost
    // all markup has usually been rewritten by something that did not know
    // the markup existed.
    const unmarked = ALL_SUMMARIES
      .filter((row) => !/(\*\*.+?\*\*|~.+?~|\*.+?\*)/.test(row.laymanSummary!))
      .map((row) => row.slug);

    // The plain supply-spec blends legitimately carry no markup.
    expect(unmarked).toEqual([
      'glow-blend-cu',
      'glow-blend-ghk',
      'klow-blend',
      'lemon-bottle',
      'lipo-c',
      'thymalin',
    ]);
  });

  test('published efficacy figures are attributed to the study that reported them', () => {
    // No summary carries an efficacy figure today: the plain-language register
    // describes mechanism, and outcome numbers were removed from the incretin
    // summaries (they read as a promised result on a product listing, and the
    // trials behind them tested prescription formulations, not this material).
    // The published research is still cited in knownStudies, where a reader can
    // see the figure in its own context. The attribution rule below stays armed
    // for the day a figure comes back — hence no "at least one" pin here, which
    // would only force a figure to exist.
    const withFigures = ALL_SUMMARIES.filter((row) => /~[^~]*\d+%[^~]*~/.test(row.laymanSummary!));

    const unattributed = withFigures
      .filter((row) => !/\b(reported|published|trial|phase)\b/i.test(row.laymanSummary!))
      .map((row) => row.slug);

    expect(unattributed).toEqual([]);
  });
});

describe('classification taxonomy register', () => {
  test('no classification label uses beauty-counter framing', () => {
    const offenders = Object.entries(CLASSIFICATION_LABELS)
      .filter(([, label]) => /beaut/i.test(label))
      .map(([key]) => key);

    expect(offenders).toEqual([]);
  });

  test('the antioxidant class is labelled as dermatological research', () => {
    expect(CLASSIFICATION_LABELS['antioxidant-beauty']).toBe('Antioxidant / Dermatological');
  });

  test('no classification copy in any register uses beauty framing', () => {
    const registers = {
      definitions: CLASSIFICATION_DEFINITIONS,
      layman: CLASSIFICATION_LAYMAN,
      sectionBlurb: CLASSIFICATION_SECTION_BLURB,
    };

    const offenders = Object.entries(registers).flatMap(([register, map]) =>
      Object.entries(map)
        .filter(([, copy]) => /beaut/i.test(copy))
        .map(([key]) => `${register}.${key}`),
    );

    expect(offenders).toEqual([]);
  });
});
