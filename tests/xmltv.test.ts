import { describe, expect, it } from 'vitest';
import { decodeXml, normName, parseXmltvTime, XmltvParser } from '../src/epg/xmltv';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="cnn.us"><display-name>CNN HD</display-name><display-name lang="en">CNN</display-name><icon src="x.png"/></channel>
  <channel id="bbc1.uk"><display-name>BBC One</display-name></channel>
  <programme start="20261012060000 +0000" stop="20261012070000 +0000" channel="cnn.us">
    <title lang="en">Morning &amp; News</title><desc>Headlines &#38; weather</desc><category>News</category>
  </programme>
  <programme start="20261012080000 +0200" stop="20261012083000 +0200" channel="bbc1.uk"><title><![CDATA[Breakfast <live>]]></title></programme>
  <programme start="20261012070000" channel="cnn.us"><title>No stop</title></programme>
</tv>`;

function parseAll(text: string, chunk: number) {
  const channels: [string, string[]][] = [];
  const progs: [string, number, number, string, string][] = [];
  const p = new XmltvParser({
    channel: (id, names) => channels.push([id, names]),
    programme: (c, s, e, t, d) => progs.push([c, s, e, t, d]),
  });
  for (let i = 0; i < text.length; i += chunk) p.push(text.slice(i, i + chunk));
  return { channels, progs };
}

describe('XMLTV', () => {
  it('parses times with and without offsets', () => {
    expect(parseXmltvTime('20261012060000 +0000')).toBe(Date.UTC(2026, 9, 12, 6) / 1000);
    expect(parseXmltvTime('20261012080000 +0200')).toBe(Date.UTC(2026, 9, 12, 6) / 1000);
    expect(parseXmltvTime('20261012013000 -0430')).toBe(Date.UTC(2026, 9, 12, 6) / 1000);
    expect(parseXmltvTime('202610120600')).toBe(Date.UTC(2026, 9, 12, 6) / 1000);
    expect(parseXmltvTime('garbage')).toBeNaN();
  });
  it('decodes entities and CDATA', () => {
    expect(decodeXml('A &amp; B &lt;3 &#x41;&#66;')).toBe('A & B <3 AB');
    expect(decodeXml('<![CDATA[a <b>]]>')).toBe('a <b>');
  });
  it('parses channels and programmes regardless of chunk boundaries', () => {
    for (const size of [1, 7, 64, 100000]) {
      const { channels, progs } = parseAll(XML, size);
      expect(channels).toEqual([['cnn.us', ['CNN HD', 'CNN']], ['bbc1.uk', ['BBC One']]]);
      expect(progs).toHaveLength(3);
      expect(progs[0]).toEqual(['cnn.us', Date.UTC(2026, 9, 12, 6) / 1000, Date.UTC(2026, 9, 12, 7) / 1000, 'Morning & News', 'Headlines & weather']);
      expect(progs[1][3]).toBe('Breakfast <live>');
      expect(progs[2][2] - progs[2][1]).toBe(1800); // missing stop -> 30 min
    }
  });
  it('matches channel names loosely', () => {
    expect(normName('UK| BBC One HD')).toBe(normName('BBC One'));
    expect(normName('US: CNN [FHD]')).toBe(normName('CNN'));
    expect(normName('Sky Sports 1 (backup)')).toBe('skysports1');
  });
  it('parses a large guide quickly', () => {
    const parts = ['<tv>'];
    for (let c = 0; c < 500; c++) parts.push(`<channel id="c${c}"><display-name>Channel ${c}</display-name></channel>`);
    for (let c = 0; c < 500; c++) for (let i = 0; i < 100; i++) {
      parts.push(`<programme start="2026101${i % 10}0${i % 10}0000 +0000" stop="2026101${i % 10}0${i % 10}3000 +0000" channel="c${c}"><title>Show ${i}</title><desc>Some description text for the show.</desc></programme>`);
    }
    parts.push('</tv>');
    const text = parts.join('\n');
    const t = performance.now();
    const { progs } = parseAll(text, 64 * 1024);
    expect(progs).toHaveLength(50000);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});
