import { describe, it, expect } from 'vitest';
import { scrubAnalyticsEvent } from '../analytics/maskUrl';

const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';

describe('scrubAnalyticsEvent (SA-46)', () => {
  it('masks UUIDs in every URL-bearing property, including $set/$set_once', () => {
    const ev = scrubAnalyticsEvent({
      properties: {
        $current_url: `https://app.test/students/${ID}/360`,
        $pathname: `/students/${ID}/360`,
        $referrer: `https://app.test/teacher/quizzes/${ID}`,
        $prev_pageview_pathname: `/x/${ID}`,
        other: ID,
      },
      $set: { $current_url: `https://app.test/a/${ID}` },
      $set_once: { $initial_pathname: `/b/${ID}`, $initial_current_url: `https://app.test/c/${ID}` },
    });
    expect(ev.properties!.$current_url).toBe('https://app.test/students/:id/360');
    expect(ev.properties!.$pathname).toBe('/students/:id/360');
    expect(ev.properties!.$referrer).toBe('https://app.test/teacher/quizzes/:id');
    expect(ev.properties!.$prev_pageview_pathname).toBe('/x/:id');
    expect(ev.$set!.$current_url).toBe('https://app.test/a/:id');
    expect(ev.$set_once!.$initial_pathname).toBe('/b/:id');
    expect(ev.$set_once!.$initial_current_url).toBe('https://app.test/c/:id');
    // Non-URL properties are left alone.
    expect(ev.properties!.other).toBe(ID);
  });

  it('masks hrefs in autocapture $elements and $elements_chain', () => {
    const ev = scrubAnalyticsEvent({
      properties: {
        $elements: [{ tag_name: 'a', attr__href: `/students/${ID}/360`, href: `/students/${ID}` }],
        $elements_chain: `a:href="/students/${ID}/360"nth-child="1"`,
      },
    });
    const el = (ev.properties!.$elements as Array<Record<string, string>>)[0]!;
    expect(el.attr__href).toBe('/students/:id/360');
    expect(el.href).toBe('/students/:id');
    expect(ev.properties!.$elements_chain).not.toContain(ID);
  });

  it('passes null (a dropped event) through', () => {
    expect(scrubAnalyticsEvent(null)).toBeNull();
  });
});
